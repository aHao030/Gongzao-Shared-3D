import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateConfig,normalizeBambuPrinter,loadConfig } from '../services/device-gateway/config.mjs';
import { gatewayMenu,saveGatewayConfig } from '../tools/bambu-gateway.mjs';

const origin='http://127.0.0.1:3000',token='test-pairing-token-dummy-01234567890123456789';
const base={platformUrl:origin,token,mdns:false,targets:[]};
const one={host:'192.168.22.14',serial:'FAKEABC000001',accessCode:'Test0001'};
const pin='A1'.repeat(32);
async function files(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gongzao-setup-fixture-'));
  t.after(()=>fs.rm(directory,{force:true,recursive:true}));
  const gatewayPath=path.join(directory,'local-settings','gateway.private.json');
  const download=path.join(directory,'downloaded.json');
  await fs.writeFile(download,JSON.stringify(base));
  return {gatewayPath,download};
}
function prompts(answers) {
  const logs=[],calls=[];
  return {calls,logs,io:{
    ask:async(prompt,secret=false)=>{ calls.push({prompt,secret}); assert.ok(answers.length,'unexpected prompt '+prompt); return answers.shift(); },
    say:line=>logs.push(line)
  }};
}
test('legacy gateway profiles enable Bambu discovery and keep protocol credentials scoped to a private address and unique serial',()=>{
  const old=validateConfig(base);
  assert.equal(old.bambuLan,true);assert.deepEqual(old.bambuPrinters,[]);
  assert.equal(validateConfig({...base,bambuLan:false}).bambuLan,false);
  assert.deepEqual(normalizeBambuPrinter({...one,serial:one.serial.toLowerCase(),certificateFingerprint:pin.match(/../g).join(':')}),{...one,certificateFingerprint:pin});
  for(const patch of [{host:'8.8.8.8'},{host:'127.0.0.1'},{host:'printer.example'},{serial:'bad/serial'},{accessCode:'bad'},{certificateFingerprint:'bad'}]) {
    assert.throws(()=>normalizeBambuPrinter({...one,...patch}));
  }
  const duplicateIP={...one,serial:'OTHERABC00002'},duplicateSerial={...one,host:'192.168.22.15'};
  for(const other of [duplicateIP,duplicateSerial]) assert.throws(()=>validateConfig({...base,bambuPrinters:[one,other]}),{code:'DUPLICATE_BAMBU_PRINTER'});
  assert.throws(()=>validateConfig({...base,bambuLan:'true'}),{code:'INVALID_CONFIG'});
});
test('first-use wizard imports a pairing file, picks an advertised device, hides the LAN access code, and saves user-private settings',async t=>{
  const {gatewayPath,download}=await files(t);
  const {calls,logs,io}=prompts([download,'Y','2','','1',one.accessCode,'农场一号','','1']);
  const advertised={host:one.host,serial:one.serial,name:'Example P1S',model:'P1S'};
  assert.equal(await gatewayMenu({file:gatewayPath,io,discover:async()=>({advertisements:[advertised],diagnostics:[]})}),true);
  const loaded=await loadConfig(gatewayPath,{useEnvironment:false});
  assert.deepEqual(loaded.bambuPrinters,[{...one,name:'农场一号'}]);
  assert.equal(calls.filter(c=>c.secret).length,1);
  assert.match(calls.find(c=>c.secret).prompt,/访问码/);
  assert(!calls.some(c=>c.prompt.includes('完整序列号')||c.prompt.includes('打印机局域网 IPv4')));
  for (const secret of [token,one.accessCode,one.serial]) assert(!logs.join('\n').includes(secret));
  if (process.platform!=='win32') assert.equal((await fs.stat(gatewayPath)).mode&0o777,0o600);
  assert.deepEqual(await fs.readdir(path.dirname(gatewayPath)),['gateway.private.json']);
});
test('manual setup updates the same serial on DHCP change, retains an existing pin, and removes only selected local permissions',async t=>{
  const {gatewayPath}=await files(t);
  const first=await saveGatewayConfig(gatewayPath,{...base,bambuPrinters:[{...one,certificateFingerprint:pin,name:'机台1'}]},null);
  const newHost='192.168.22.16',newCode='Test0002';
  const flow=prompts(['2','M',newHost,one.serial,newCode,'','','1']);
  assert.equal(await gatewayMenu({file:gatewayPath,io:flow.io,discover:async()=>{throw new Error('manual must not scan');}}),true);
  const changed=await loadConfig(gatewayPath,{useEnvironment:false});
  assert.equal(changed.bambuPrinters.length,1);
  assert.deepEqual(changed.bambuPrinters[0],{...first.bambuPrinters[0],host:newHost,accessCode:newCode});
  const remove=prompts(['4','1','0']);
  assert.equal(await gatewayMenu({file:gatewayPath,io:remove.io}),false);
  assert.deepEqual((await loadConfig(gatewayPath)).bambuPrinters,[]);
});
test('existing settings survive cancelled imports, invalid authorization and a stale open wizard',async t=>{
  const {gatewayPath,download}=await files(t);
  const first=await saveGatewayConfig(gatewayPath,{...base,bambuPrinters:[one]},null);
  const flow=prompts(['3',download,'N','2','M','8.8.8.8',one.serial,'Test0002','','','0']);
  assert.equal(await gatewayMenu({file:gatewayPath,io:flow.io}),false);
  assert.deepEqual(await loadConfig(gatewayPath,{useEnvironment:false}),first);
  assert.ok(flow.logs.some(s=>s.includes('IPv4')));
  const updated=await saveGatewayConfig(gatewayPath,{...first,bambuLan:false},first);
  await assert.rejects(saveGatewayConfig(gatewayPath,{...first,mdns:true},first),{code:'GATEWAY_CONFIG_CHANGED'});
  assert.deepEqual(await loadConfig(gatewayPath,{useEnvironment:false}),updated);
});
test('reading an imported config does not persist an environment-supplied private site token',async t=>{
  const {gatewayPath,download}=await files(t);
  const previous=process.env.GONGZAO_SITE_ACCESS_TOKEN;
  process.env.GONGZAO_SITE_ACCESS_TOKEN='fixture_environment_secret_only';
  try {
    const flow=prompts([download,'Y','0']);
    assert.equal(await gatewayMenu({file:gatewayPath,io:flow.io}),false);
    assert.equal((await loadConfig(gatewayPath)).siteAccessToken,process.env.GONGZAO_SITE_ACCESS_TOKEN);
    assert.equal((await loadConfig(gatewayPath,{useEnvironment:false})).siteAccessToken,undefined);
  } finally {
    if (previous===undefined) delete process.env.GONGZAO_SITE_ACCESS_TOKEN;
    else process.env.GONGZAO_SITE_ACCESS_TOKEN=previous;
  }
});

test('running gateway rereads local permissions every cycle and invokes the dedicated Bambu-only monitor',async t=>{
  const { createPollCycle } = await import('../services/device-gateway/cli.mjs');
  const {gatewayPath} = await files(t);
  const initial = await saveGatewayConfig(gatewayPath,base,null);
  const watched='a'.repeat(64), seen=[]; let created=0;
  const cycle=createPollCycle(gatewayPath,{
    clientFor:()=>{created++;return {cycle:discover=>discover({kind:'monitor-bambu',deviceKeys:[watched]})};},
    discover:()=>assert.fail('monitor must not run legacy discovery'),
    monitor:(config,keys)=>{assert.deepEqual(keys,[watched]);seen.push(config.bambuPrinters.length);}
  });
  await cycle();
  const authorized=await saveGatewayConfig(gatewayPath,{...initial,bambuPrinters:[one]},initial);
  await cycle();
  await saveGatewayConfig(gatewayPath,initial,authorized);
  await cycle();
  assert.equal(created,1); assert.deepEqual(seen,[0,1,0]);
  await fs.writeFile(gatewayPath,'{bad');
  await assert.rejects(cycle(),{code:'INVALID_CONFIG'});
  assert.equal(seen.length,3);
});

test('local trial read separates new telemetry, denied access, certificate mismatch, network failure and an unanswered subscription',async t=>{
  const {gatewayPath}=await files(t);
  const original=await saveGatewayConfig(gatewayPath,{...base,bambuPrinters:[one]},null);
  const checks=[
    [{printState:'printing',progressPercent:28},/打印中 · 28%/],
    ['BAMBU_AUTH_REQUIRED',/拒绝授权/], ['BAMBU_CERTIFICATE_MISMATCH',/证书身份/],
    ['BAMBU_CONNECTION_FAILED',/超时/], ['BAMBU_STATUS_UNAVAILABLE',/订阅已获准/],
    ['UNEXPECTED_DRIVER_FAILURE',/未取得设备状态/]
  ];
  for (const [response,expected] of checks) {
    const flow=prompts(['6','1','0']);
    await gatewayMenu({file:gatewayPath,io:flow.io,readStatus:async p=>{
      assert.equal(p.serial,one.serial);
      if (typeof response==='string') throw Object.assign(new Error(one.accessCode),{code:response});
      return response;
    }});
    assert.match(flow.logs.join('\n'),expected);assert(!flow.logs.join('\n').includes(one.accessCode));
  }
  assert.deepEqual(await loadConfig(gatewayPath,{useEnvironment:false}),original);
});

test('Bambu-only polls reuse unchanged local identities and discard verification memory after credential rotation',async t=>{
  const { createPollCycle } = await import('../services/device-gateway/cli.mjs');
  const {gatewayPath}=await files(t);
  const config=await saveGatewayConfig(gatewayPath,{...base,bambuPrinters:[one]},null);
  const snapshots=[];
  const poll=createPollCycle(gatewayPath,{
    clientFor:()=>({cycle:read=>read({kind:'discover',autoRegister:'bambu'})}),
    discover:(cfg,options)=>{assert.equal(options.onlyBambu,true);snapshots.push(cfg);}
  });
  await poll();await poll();
  assert.strictEqual(snapshots[0],snapshots[1]);
  const mdns=await saveGatewayConfig(gatewayPath,{...config,mdns:true},config);await poll();
  assert.strictEqual(snapshots[2].bambuPrinters[0],snapshots[1].bambuPrinters[0]);
  await saveGatewayConfig(gatewayPath,{...mdns,bambuPrinters:[{...one,accessCode:'Temp0002'}]},mdns);await poll();
  assert.notStrictEqual(snapshots[3].bambuPrinters[0],snapshots[2].bambuPrinters[0]);
});
test('a farm can configure one hundred unique printer credentials; each scan has its own bounded page',()=>{
  const entries=Array.from({length:100},(_,i)=>({...one,serial:'MOCKSERIAL'+i,host:'192.168.30.'+(i+1)}));
  assert.equal(validateConfig({...base,bambuPrinters:entries}).bambuPrinters.length,100);
  assert.throws(()=>validateConfig({...base,bambuPrinters:[...entries,entries[0]]}),{code:'TOO_MANY_BAMBU_PRINTERS'});
});
