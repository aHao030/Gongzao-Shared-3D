import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import dgram from 'node:dgram';
import { parseBambuAdvertisement, discoverBambuLan, bambuDeviceKey, bambuTargets } from '../services/device-gateway/bambu-discovery.mjs';
import { discoverDevices, monitorBambuDevices } from '../services/device-gateway/discovery.mjs';

const interfaces = [{address:'192.168.50.2',netmask:'255.255.255.0'}];
const host = '192.168.50.40', serial = '01P000000000001';
const printer = {host,serial,accessCode:'TEST0001'};
const config = {mdns:false,targets:[],bambuLan:true,bambuPrinters:[]};
function announcement({ip=host,sn=serial,model='C12',name='打印机 A'}={}) {
  return Buffer.from(['NOTIFY * HTTP/1.1','Host: 239.255.255.250:1990','Server: UPnP/1.0',
    'Location: '+ip,'NT: urn:bambulab-com:device:3dprinter:1','NTS: ssdp:alive','USN: '+sn,
    'DevModel.bambu.com: '+model,'DevName.bambu.com: '+name,'DevConnect.bambu.com: lan','',''].join('\r\n'));
}
const normal = parseBambuAdvertisement(announcement(),host,interfaces);
const discover = (advertisements,diagnostics=[])=>async()=>({advertisements,diagnostics});

test('Bambu LAN reads private, same-subnet NOTIFY from the real sender and maps public model codes', () => {
  for (const [model,prefix,expected] of [
    ['BL-P001','00M','X1 Carbon'],['3DPrinter-X1-Carbon','00M','X1 Carbon'],['BL-P002','00W','X1'],
    ['C11','01S','P1P'],['C12','01P','P1S'],['C13','03W','X1E'],['N1','030','A1 mini'],['N2S','039','A1'],
    ['O1D','094','H2D'],['O1S','093','H2S'],['O1C','31B','H2C'],['O1C2','31B','H2C'],['O1E','239','H2D Pro'],['N7','22E','P2S']
  ]) {
    const sn=prefix+'000000000001', item=parseBambuAdvertisement(announcement({model,sn,name:'SN '+sn}),host,interfaces);
    assert.equal(item.model,'Bambu Lab '+expected);
    assert.ok(!item.name.includes(sn));
  }
  assert.equal(parseBambuAdvertisement(announcement({model:'FUTURE99'}),host,interfaces).model,'Bambu Lab（型号待核对）');
  assert.equal(parseBambuAdvertisement(announcement({model:'N1'}),host,interfaces),null);
  for (const addr of ['192.168.50.41','192.168.50.255','10.0.0.5','127.0.0.1','1.2.3.4']) {
    assert.equal(parseBambuAdvertisement(announcement(),addr,interfaces),null);
  }
  for (const text of [
    announcement({ip:'http://'+host+':1234/file'}).toString(),
    announcement().toString().replace('ssdp:alive','ssdp:byebye'),
    announcement().toString().replace('urn:bambulab-com:device:3dprinter:1','upnp:rootdevice'),
    announcement().toString().replace('DevName.bambu.com:','USN:'),
    announcement().toString().replace('NOTIFY * HTTP/1.1','M-SEARCH * HTTP/1.1'),
    'x'.repeat(9000)
  ]) assert.equal(parseBambuAdvertisement(Buffer.from(text),host,interfaces),null);
});

function passiveSocket(records,ports) {
  return () => new class extends EventEmitter {
    bind(port,ready) {
      ports.push(port);ready();
      for (const [ip,message] of records) this.emit('message',message,{address:ip});
    }
    addMembership(group, nic) { assert.equal(group,'239.255.255.250');assert.equal(nic,interfaces[0].address); }
    close() {}
  }();
}
test('both notification ports deduplicate the fleet, omitting competing serial or IP announcements',async()=>{
  const ports=[],other='192.168.50.41';
  let result=await discoverBambuLan({interfaces,durationMs:100,createSocket:passiveSocket([[host,announcement()],[host,announcement()]],ports)});
  assert.deepEqual(ports,[1990,2021]);assert.deepEqual(result.advertisements,[normal]);
  result=await discoverBambuLan({interfaces,durationMs:100,createSocket:passiveSocket([[host,announcement()],[other,announcement({ip:other})],[host,announcement({sn:'01P000000000002'})]],[])});
  assert.deepEqual(result.advertisements,[]);assert.ok(result.diagnostics.includes('BAMBU_DISCOVERY_IDENTITY_CONFLICT'));
  const withheld=await discoverDevices({...config,bambuPrinters:[printer]},{bambuDiscover:async()=>result,bambuReadStatus:()=>assert.fail('conflicting identities must not be probed')});
  assert.deepEqual(withheld.candidates,[]);assert.ok(withheld.diagnostics.includes('BAMBU_DISCOVERY_IDENTITY_CONFLICT'));
  assert.deepEqual(await discoverBambuLan({interfaces:[],createSocket:()=>assert.fail()}),{advertisements:[],diagnostics:['NO_LOCAL_IPV4_INTERFACE']});
});

test('untrusted real loopback UDP cannot claim the source address named in a Bambu announcement',async t=>{
  const client=dgram.createSocket('udp4');t.after(()=>client.close());
  const receivers=[];
  const pending=discoverBambuLan({interfaces,durationMs:300,createSocket:()=>{
    const socket=dgram.createSocket('udp4');receivers.push(socket);
    // Bind only loopback ephemeral ports. Never listen to live farm traffic.
    const bind=socket.bind.bind(socket);
    socket.bind=(_port,ready)=>bind(0,'127.0.0.1',ready);
    socket.addMembership=()=>{};return socket;
  }});
  await Promise.all(receivers.map(s=>once(s,'listening')));
  const received=once(receivers[0],'message');
  client.send(announcement(),receivers[0].address().port,'127.0.0.1');
  await received;
  assert.deepEqual((await pending).advertisements,[]);
});

test('a discovery click needs no access code; only the pinned configuration can get print state',async()=>{
  const deps={bambuDiscover:discover([normal]),bambuReadStatus:()=>assert.fail('no credential to probe')};
  const ad=(await discoverDevices(config,deps)).candidates[0];
  assert.equal(ad.protocol,'bambu');assert.equal(ad.connectionState,'authorization_required');
  assert.deepEqual(ad.probeEvidence,{method:'SSDP',advertised:true});
  const direct={...config,bambuLan:false,bambuPrinters:[printer]};
  let called=0;
  const authorized=(await discoverDevices(direct,{bambuDiscover:()=>assert.fail(),bambuReadStatus:async p=>{
    assert.equal(p,printer);called++;return {printState:'printing',progressPercent:37};
  }})).candidates[0];
  assert.equal(called,1);assert.equal(authorized.deviceKey,ad.deviceKey);
  assert.equal(authorized.model,'Bambu Lab P1S');assert.equal(authorized.connectionState,'online');
  assert.deepEqual(authorized.probeEvidence,{method:'MQTT_TLS',advertised:false,printState:'RUNNING',progressPercent:37});
  assert.ok(!JSON.stringify([ad,authorized]).includes(serial));assert.ok(!JSON.stringify(authorized).includes(printer.accessCode));
  for (const [code,state] of [['BAMBU_CERTIFICATE_MISMATCH','authorization_required'],['BAMBU_AUTH_REQUIRED','authorization_required'],['BAMBU_STATUS_UNAVAILABLE','offline']]) {
    const result=await discoverDevices({...config,bambuPrinters:[printer]},{...deps,bambuReadStatus:async()=>{throw Object.assign(new Error(),{code});}});
    assert.equal(result.candidates[0].connectionState,state);assert.deepEqual(result.candidates[0].probeEvidence,ad.probeEvidence);
  }
});

test('a same-LAN DHCP move goes through the original serial/TLS verifier; only a successful identity is remembered',async()=>{
  const cfg={...config,bambuPrinters:[{...printer}]};
  const newHost='192.168.50.41', moved=parseBambuAdvertisement(announcement({ip:newHost}),newHost,interfaces);
  const key=bambuDeviceKey(serial), attempts=[];
  const read=async (p)=>{ attempts.push(p.host);assert.equal(p.serial,serial);return {printState:'paused',progressPercent:10}; };
  const poll=(ads,readStatus)=>monitorBambuDevices(cfg,[key],{bambuDiscover:discover(ads),bambuReadStatus:readStatus});
  const denied=await poll([moved],async p=>{assert.equal(p.host,newHost);throw Object.assign(new Error(),{code:'BAMBU_CERTIFICATE_MISMATCH'});});
  assert.equal(denied.candidates[0].connectionState,'authorization_required');
  await poll([],read);assert.deepEqual(attempts,[host]);
  const ok=await poll([moved],read);assert.equal(ok.candidates[0].deviceKey,key);assert.equal(ok.candidates[0].probeEvidence.printState,'PAUSE');
  const retry=await poll([],read);assert.equal(retry.candidates[0].endpoint,'mqtts://'+newHost+':8883');
  assert.deepEqual(attempts,[host,newHost,newHost]);assert.equal(cfg.bambuPrinters[0].host,host);
});
test('subnet changes or occupied addresses cannot redirect a configured probe; monitor connects only to enrolled serials',async()=>{
  const otherHost='192.168.50.42', second={...printer,serial:'01P000000000002',host:otherHost};
  const moved={...normal,host:'192.168.60.41',lan:{address:'192.168.60.2',netmask:'255.255.255.0'}};
  const fleet=bambuTargets([printer],[moved]);
  assert.ok(fleet.diagnostics.includes('BAMBU_CONFIG_ADDRESS_CHANGED'));assert.deepEqual(fleet.targets,[{advertised:moved}]);
  const occupied=bambuTargets([printer],[{...normal,serial:second.serial}]);
  assert.deepEqual(occupied.targets,[]);assert.ok(occupied.diagnostics.includes('BAMBU_CONFIG_ADDRESS_CHANGED'));
  const calls=[];
  const results=await monitorBambuDevices({...config,bambuPrinters:[printer,second]},[bambuDeviceKey(serial)],{
    bambuDiscover:discover([normal]),bambuReadStatus:async p=>{calls.push(p.host);return {printState:'idle',progressPercent:null};}
  });
  assert.deepEqual(calls,[host]);assert.equal(results.candidates.length,1);assert.equal(results.candidates[0].probeEvidence.printState,'IDLE');
  await assert.rejects(monitorBambuDevices(config,['wrong']),{code:'INVALID_MONITOR_TARGET'});
  assert.deepEqual(await monitorBambuDevices(config,[],{bambuDiscover:()=>assert.fail()}),{candidates:[],diagnostics:[]});
});

function makeFleet(n) {
  return Array.from({length:n},(_,i)=>{
    const ip='192.168.50.'+(i+10), sn='01P'+String(i).padStart(12,'0');
    return parseBambuAdvertisement(announcement({ip,sn}),ip,interfaces);
  });
}
test('Bambu-only one-click inventory returns all 100 advertised devices without touching HTTP or MQTT',async()=>{
  const ads=makeFleet(100);
  const cfg={...config,mdns:true,targets:Array.from({length:32},(_,i)=>({protocol:'moonraker',endpoint:'http://10.1.2.'+(i+1)}))};
  const mustNotProbe=()=>assert.fail('discovery did not require this probe');
  const found=await discoverDevices(cfg,{onlyBambu:true,bambuDiscover:discover(ads),mdns:mustNotProbe,probe:mustNotProbe,bambuReadStatus:mustNotProbe});
  assert.equal(found.candidates.length,100);assert.deepEqual(found.diagnostics,[]);
  assert.equal(new Set(found.candidates.map(d=>d.deviceKey)).size,100);
  assert.ok(found.candidates.every(d=>d.protocol==='bambu' && d.probeEvidence.method==='SSDP'));
});
test('mixed discovery returns 40 passive Bambu advertisements even when 32 active HTTP slots are full',async()=>{
  const ads=makeFleet(40);
  const cfg={...config,targets:Array.from({length:32},(_,i)=>({protocol:'moonraker',endpoint:'http://10.1.2.'+(i+1)}))};
  let calls=0;
  const found=await discoverDevices(cfg,{bambuDiscover:discover(ads),probe:async t=>{
    calls++;return {deviceKey:t.endpoint,protocol:t.protocol};
  },bambuReadStatus:()=>assert.fail()});
  assert.equal(calls,32);assert.equal(found.candidates.length,72);assert.deepEqual(found.diagnostics,[]);
});
test('with 40 configured printers a later batch authenticates the eight deferred devices',async()=>{
  const ads=makeFleet(40), cfg={...config,bambuPrinters:ads.map(({host,serial})=>({host,serial,accessCode:'TEST0001'}))};
  const called=new Set();let probes=0;
  const options={onlyBambu:true,bambuDiscover:discover(ads),bambuReadStatus:async p=>{called.add(p.serial);probes++;return {printState:'idle',progressPercent:null};}};
  const first=await discoverDevices(cfg,options);
  assert.equal(probes,32);assert.equal(first.candidates.length,40);
  assert.equal(first.candidates.filter(c=>c.probeEvidence.deferred===true && c.connectionState!=='online').length,8);
  assert.ok(first.diagnostics.includes('DISCOVERY_TARGET_LIMIT'));
  const next=await discoverDevices(cfg,options);
  assert.equal(probes,64);assert.equal(called.size,40);assert.equal(next.candidates.length,40);
});
