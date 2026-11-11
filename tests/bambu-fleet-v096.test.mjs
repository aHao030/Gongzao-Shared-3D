import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { GatewayClient } from '../services/device-gateway/client.mjs';
import { discoverDevices, monitorBambuDevices } from '../services/device-gateway/discovery.mjs';
import { parseBambuAdvertisement } from '../services/device-gateway/bambu-discovery.mjs';
import { validateConfig } from '../services/device-gateway/config.mjs';

// Exercise the public HTTP routes, two separate accounts, the shipping gateway
// client, the UDP parser and durable device records. Network observations at the
// printer boundary are synthetic; the test does not contact a printer.
const interfaces = [{ address:'192.168.31.10', netmask:'255.255.255.0', family:'IPv4', internal:false }];
const first = { host:'192.168.31.41', serial:'03000A123456789', code:'N1' };
const second = { host:'192.168.31.42', serial:'01P00B123456789', code:'C12' };

function advertisement({ host, serial, code }) {
  const bytes = Buffer.from([
    'NOTIFY * HTTP/1.1', 'HOST: 239.255.255.250:1990', 'NT: urn:bambulab-com:device:3dprinter:1',
    'NTS: ssdp:alive', 'USN: '+serial, 'Location: '+host, 'DevModel.bambu.com: '+code,
    'DevName.bambu.com: Printer', '', ''
  ].join('\r\n'));
  const item = parseBambuAdvertisement(bytes,host,interfaces);
  assert.ok(item,'captured protocol shape must normalize to a printer advertisement');
  return item;
}

async function shopFixture(t) {
  let now = Date.now();
  const clock = () => now;
  const {server,store} = createPlatformServer({dbPath:':memory:',clock,integrationConfig:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve)); store.close();});
  const base = 'http://127.0.0.1:'+server.address().port;
  async function call(route,{cookie,body,key=randomUUID()}={}) {
    const r = await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{
      ...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json','Idempotency-Key':key}:{})
    },body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,headers:r.headers,data:await r.json()};
  }
  async function merchant(name) {
    const registration=await call('/api/auth/register',{body:{email:randomUUID()+'@example.invalid',password:'Fixture-password-2026',displayName:name}});
    assert.equal(registration.status,201);
    const cookie=registration.headers.getSetCookie().find(v=>!v.includes('Max-Age=0')).split(';')[0];
    const request=(route,body,key)=>call('/api/v2/merchant/'+route,{cookie,body,key});
    assert.equal((await request('enroll',{name})).status,201);
    return request;
  }
  const owner=await merchant('Fixture farm A'), other=await merchant('Fixture farm B');
  const pairing=await owner('pairing',{name:'Farm A local gateway'});
  assert.equal(pairing.status,201);
  const gatewayId=pairing.data.gateway.id;
  const config=validateConfig({platformUrl:base,token:pairing.data.token,mdns:false,bambuLan:true,targets:[]});
  const client=new GatewayClient(config,{clock});
  await client.cycle(async()=>assert.fail('no discovery requested'));
  const devices=async merchant=>(await merchant('devices')).data.devices;
  async function survey(adverts, {authorized,diagnostics=[],read=async()=>assert.fail('credentials must not be used without a pinned local target')}={}) {
    const scan=await owner('scan',{scope:'real',gatewayId,autoRegister:'bambu'});
    assert.equal(scan.status,200,JSON.stringify(scan.data.error));
    const localConfig=validateConfig({...config,bambuPrinters:authorized?[authorized]:[]});
    let obs;
    const cycle=await client.cycle(async command=>{
      assert.equal(command.kind,'discover');
      assert.equal(command.autoRegister,'bambu');
      obs=await discoverDevices(localConfig,{
        onlyBambu:command.autoRegister==='bambu',
        bambuDiscover:async()=>({advertisements:adverts.map(advertisement),diagnostics}),
        bambuReadStatus:read
      });
      return obs;
    },localConfig);
    assert.equal(cycle.events.length,1);
    const fetched=await owner('scan-result?scanId='+encodeURIComponent(scan.data.scan.id));
    assert.equal(fetched.status,200);
    assert.equal(fetched.data.scan.status,'complete');
    return {scan:fetched.data.scan,obs};
  }
  return {owner,other,devices,survey,advance:ms=>{now+=ms;},client,config};
}

test('Bambu fleet: one action registers separate printers once, an IP move preserves identity and reports remain private',async t=>{
  const {owner,other,devices,survey,client}=await shopFixture(t);
  const initial=await survey([first,second,first]);
  assert.equal(initial.scan.registrationResult.added,2);
  const registered=await devices(owner);
  assert.equal(registered.length,2);
  const mini=registered.find(p=>p.model.includes('A1 mini'));
  assert.ok(mini); assert.ok(registered.some(p=>p.model.includes('P1S')));
  assert.ok(registered.every(p=>p.connectionState==='authorization_required' && p.automaticPrinting===false));
  for(const raw of [initial.obs,initial.scan,registered]) for(const id of [first.serial,second.serial]) assert.equal(JSON.stringify(raw).includes(id),false);
  assert.deepEqual(await devices(other),[]);
  assert.equal((await other('scan-result?scanId='+initial.scan.id)).status,404);
  const moved={...first,host:'192.168.31.51'};
  const repeated=await survey([second,moved]);
  assert.equal(repeated.scan.registrationResult.added,0);
  const after=await devices(owner);
  assert.equal(after.length,2);
  assert.match(after.find(p=>p.id===mini.id).endpoint,/192\.168\.31\.51/);
  assert.equal((await client.cycle(async()=>assert.fail('completed scan cannot be resent'))).events.length,0);
});

test('Bambu fleet: only authenticated reports show print status and a later missing printer loses live status',async t=>{
  const {owner,devices,survey}=await shopFixture(t);
  const account={host:first.host,serial:first.serial,accessCode:'xA93yB27'};
  const observed=await survey([first,second],{authorized:account,read:async target=>{
    assert.equal(target.serial,first.serial);assert.equal(target.host,first.host);
    return {printState:'printing',progressPercent:38};
  }});
  const authenticated=(await devices(owner)).find(p=>p.model.includes('A1 mini'));
  assert.equal(authenticated.verification.level,'BAMBU_READONLY_REPORTED');
  assert.equal(authenticated.probeEvidence.printState,'RUNNING');
  assert.equal(authenticated.probeEvidence.progressPercent,38);
  for(const v of [observed.obs,observed.scan,authenticated]) assert.equal(JSON.stringify(v).includes(account.accessCode),false);
  await survey([second]);
  const missing=(await devices(owner)).find(p=>p.id===authenticated.id);
  assert.equal(missing.connectionState,'offline');
  assert.notEqual(missing.probeEvidence?.printState,'RUNNING');
  assert.equal(missing.probeEvidence?.progressPercent??null,null);
  assert.equal(missing.automaticPrinting,false);
});


test('Bambu fleet: a truncated sweep never asserts absence or leaks upstream details; old observations expire normally',async t=>{
  const {owner,devices,survey,advance,client}=await shopFixture(t);
  const account={host:first.host,serial:first.serial,accessCode:'xA93yB27'};
  await survey([first,second],{authorized:account,read:async()=>({printState:'idle',progressPercent:null})});
  const before=(await devices(owner)).find(p=>p.model.includes('A1 mini'));
  advance(10_000);
  const partial=await survey([second],{diagnostics:['DISCOVERY_TARGET_LIMIT','private broker error: '+account.accessCode]});
  assert.deepEqual(partial.scan.partialDiagnostics,['DISCOVERY_TARGET_LIMIT']);
  const kept=(await devices(owner)).find(p=>p.id===before.id);
  assert.equal(kept.lastSeenAt,before.lastSeenAt);
  assert.equal(kept.connectionState,'online');
  assert.equal(kept.probeEvidence.printState,'IDLE');
  advance(5*60_000+1);
  await client.cycle(async()=>({candidates:[],diagnostics:['BAMBU_LISTEN_UNAVAILABLE']}));
  const expired=(await devices(owner)).find(p=>p.id===before.id);
  assert.equal(expired.connectionState,'offline');
  assert.notEqual(expired.probeEvidence?.printState,'IDLE');
});

test('Bambu monitoring commands publish only requested, previously identified devices and ignore unrelated work',async()=>{
  const wanted='a'.repeat(64),unrelated='b'.repeat(64),reports=[];
  const command={id:'fresh-bambu',kind:'monitor-bambu',deviceKeys:[wanted],expiresAt:2000};
  const client=new GatewayClient({platformUrl:'http://127.0.0.1:3000',token:'test-only-token-012345678901234567890123456789',bambuLan:true}, {
    clock:()=>1000,transport:async(url,options)=>{
      if(url.pathname.endsWith('/poll')) return {status:200,data:{commands:[{...command,id:'invalid-batch',deviceKeys:['bad']},command]}};
      reports.push(JSON.parse(options.body));return {status:200,data:{accepted:true}};
    }});
  let ran=0;
  await client.cycle(async job=>{
    ran++;assert.deepEqual(job,command);
    return {candidates:[{protocol:'bambu',deviceKey:wanted},{protocol:'bambu',deviceKey:unrelated},{protocol:'octoprint',deviceKey:wanted}],
      diagnostics:['BAMBU_MULTICAST_UNAVAILABLE','arbitrary external messages are not forwarded']};
  });
  assert.equal(ran,1);
  assert.deepEqual(reports,[{scanId:command.id,candidates:[{protocol:'bambu',deviceKey:wanted}],partialDiagnostics:['BAMBU_MULTICAST_UNAVAILABLE']}]);
});


test('Bambu fleet: the paired gateway receives scheduled read-only refreshes and updates the existing registration',async t=>{
  const {owner,other,devices,survey,advance,client,config}=await shopFixture(t);
  const account={host:first.host,serial:first.serial,accessCode:'xA93yB27'};
  const authorized=validateConfig({...config,bambuPrinters:[account]});
  const {scan}=await survey([first],{authorized:account,read:async()=>({printState:'idle',progressPercent:null})});
  const original=(await devices(owner))[0];
  advance(120_001);
  const result=await client.cycle(async command=>{
    assert.equal(command.kind,'monitor-bambu');
    assert.deepEqual(command.deviceKeys,[original.deviceKey]);
    return monitorBambuDevices(authorized,command.deviceKeys,{
      bambuDiscover:async()=>({advertisements:[first,second].map(advertisement),diagnostics:[]}),
      bambuReadStatus:async()=>({printState:'printing',progressPercent:56})
    });
  },authorized);
  assert.equal(result.events[0].count,1);
  const records=await devices(owner);
  assert.equal(records.length,1);
  assert.equal(records[0].id,original.id);
  assert.equal(records[0].probeEvidence.printState,'RUNNING');
  assert.equal(records[0].probeEvidence.progressPercent,56);
  assert.equal((await owner('scan-result')).data.scan.id,scan.id);
  assert.deepEqual(await devices(other),[]);
});

test('Bambu fleet: a DHCP change replaces the last authenticated address only after the new connection proves the same identity',async t=>{
  const {owner,devices,survey}=await shopFixture(t);
  const account={host:first.host,serial:first.serial,accessCode:'xA93yB27'};
  await survey([first],{authorized:account,read:async()=>({printState:'idle',progressPercent:null})});
  const original=(await devices(owner))[0];
  const moved={...first,host:'192.168.31.51'};
  const failed=await survey([moved],{authorized:account,read:async target=>{
    assert.equal(target.host,moved.host); assert.equal(target.serial,first.serial);
    throw Object.assign(new Error('fixture certificate mismatch'),{code:'BAMBU_CERTIFICATE_MISMATCH'});
  }});
  assert.equal(failed.scan.registrationResult.added,0);
  assert.equal((await devices(owner))[0].endpoint,original.endpoint);
  assert.notEqual((await devices(owner))[0].connectionState,'online');
  const accepted=await survey([moved],{authorized:account,read:async target=>{
    assert.equal(target.host,moved.host);assert.equal(target.serial,first.serial);
    return {printState:'preparing',progressPercent:0};
  }});
  assert.equal(accepted.scan.registrationResult.added,0);
  const updated=await devices(owner);
  assert.equal(updated.length,1);
  assert.equal(updated[0].id,original.id);
  assert.match(updated[0].endpoint,/192\.168\.31\.51/);
  assert.equal(updated[0].probeEvidence.printState,'PREPARE');
});


test('Bambu fleet: one-click registration covers forty advertised printers on one farm without forty individual authorizations',async t=>{
  const {owner,other,devices,survey}=await shopFixture(t);
  const machines=Array.from({length:40},(_,i)=>({
    host:'192.168.31.'+(i+20),serial:'01P'+String(i+1000).padStart(12,'0'),code:'C12'
  }));
  const found=await survey(machines);
  assert.equal(found.scan.registrationResult.added,40);
  assert.equal(found.scan.candidates.length,40);
  assert.equal(new Set((await devices(owner)).map(p=>p.id)).size,40);
  assert.deepEqual(await devices(other),[]);
  const repeat=await survey(machines.toReversed());
  assert.equal(repeat.scan.registrationResult.existing,40);
  assert.equal(repeat.scan.registrationResult.added,0);
  assert.equal((await devices(owner)).length,40);
});
