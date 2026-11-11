import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { normalizeEndpoint, normalizePlatform, validateConfig, GatewayError } from '../services/device-gateway/config.mjs';
import { buildQuery, parsePacket, candidatesFromRecords, sameSubnet, discoverMdns } from '../services/device-gateway/mdns.mjs';
import { probeTarget, discoverDevices, requestJson } from '../services/device-gateway/discovery.mjs';
import { GatewayClient } from '../services/device-gateway/client.mjs';
import { runCli } from '../services/device-gateway/cli.mjs';

const token='test-only-token-012345678901234567890123456789';
const baseConfig={platformUrl:'https://platform.example',token,mdns:false,bambuLan:false,targets:[]};
const target={protocol:'moonraker',endpoint:'http://192.168.1.20:7125',name:'Test printer'};
const interfaces=[{family:'IPv4',address:'192.168.1.10',netmask:'255.255.255.0',internal:false}];
const moonraker={result:{klippy_connected:true,klippy_state:'ready',components:['klippy_apis'],moonraker_version:'fixture'}};
const name=value=>Buffer.concat([...value.split('.').map(x=>Buffer.concat([Buffer.from([Buffer.byteLength(x)]),Buffer.from(x)])),Buffer.from([0])]);
function record(owner,type,data){const fields=Buffer.alloc(10);fields.writeUInt16BE(type,0);fields.writeUInt16BE(1,2);fields.writeUInt32BE(60,4);fields.writeUInt16BE(data.length,8);return Buffer.concat([name(owner),fields,data]);}
function advertisement(address=[192,168,1,20]){const header=Buffer.alloc(12);header.writeUInt16BE(0x8400,2);header.writeUInt16BE(3,6);const srv=Buffer.alloc(6);srv.writeUInt16BE(7125,4);return Buffer.concat([header,record('_moonraker._tcp.local',12,name('printer._moonraker._tcp.local')),record('printer._moonraker._tcp.local',33,Buffer.concat([srv,name('printer.local')])),record('printer.local',1,Buffer.from(address))]);}
async function fixture(handler,run){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{return await run('http://127.0.0.1:'+server.address().port);}finally{await new Promise(resolve=>server.close(resolve));}}

test('gateway: private explicit endpoints are normalized and public, metadata, credentials and ambiguous hosts are rejected',()=>{
  assert.equal(normalizeEndpoint('http://192.168.1.20:7125/moonraker/p1/'),'http://192.168.1.20:7125/moonraker/p1');
  for(const value of ['http://169.254.169.254','http://8.8.8.8','http://printer.local','http://localhost','http://127.0.0.1','http://[::1]','http://user:pass@192.168.1.20','http://192.168.1.20?key=secret','http://192.168.1.20/%2fapi'])assert.throws(()=>normalizeEndpoint(value));
  assert.equal(normalizeEndpoint('http://127.0.0.1:8000',{allowLoopback:true}),'http://127.0.0.1:8000');
  assert.throws(()=>normalizePlatform('http://platform.example'));assert.throws(()=>normalizePlatform('https://platform.example/path'));
  assert.throws(()=>validateConfig({...baseConfig,targets:Array(33).fill(target)}));
});
test('gateway: mDNS query and bounded packet parser only produce same-subnet declared service candidates',()=>{
  assert.equal(buildQuery().readUInt16BE(4),2);
  const records=parsePacket(advertisement());const found=candidatesFromRecords(records,interfaces);
  assert.equal(found.length,1);assert.equal(found[0].endpoint,'http://192.168.1.20:7125');assert.equal(found[0].protocol,'moonraker');
  assert.equal(candidatesFromRecords(parsePacket(advertisement([10,8,0,20])),interfaces).length,0);
  assert.equal(sameSubnet('192.168.1.255',interfaces),false);assert.equal(sameSubnet('192.168.1.0',interfaces),false);
  assert.equal(sameSubnet('169.254.169.254',interfaces),false);
  assert.throws(()=>parsePacket(Buffer.alloc(9001)));assert.throws(()=>parsePacket(advertisement().subarray(0,30)));
  const loop=Buffer.alloc(18);loop.writeUInt16BE(1,4);loop[12]=0xc0;loop[13]=12;assert.throws(()=>parsePacket(loop));
});
test('gateway: absent LAN interfaces returns honest diagnostic without opening a socket',async()=>{
  let opened=false;const result=await discoverMdns({interfaces:[],createSocket(){opened=true;throw new Error();}});
  assert.equal(opened,false);assert.deepEqual(result,{targets:[],diagnostics:['NO_LOCAL_IPV4_INTERFACE']});
});
test('gateway: multicast listener validates source subnet and reports socket failure without pretending discovery',async()=>{
  class FakeSocket extends EventEmitter {
    bind(port,callback){assert.equal(port,0);callback();}
    setMulticastTTL(ttl){assert.equal(ttl,255);}
    setMulticastInterface(address){assert.equal(address,'192.168.1.10');}
    send(packet,port,address,callback){assert.equal(port,5353);assert.equal(address,'224.0.0.251');this.emit('message',advertisement([192,168,1,21]),{address:'10.8.0.20'});this.emit('message',advertisement(),{address:'192.168.1.20'});callback();}
    close(){}
  }
  const success=await discoverMdns({interfaces,durationMs:100,createSocket:()=>new FakeSocket()});assert.equal(success.targets.length,1);assert.equal(success.targets[0].endpoint,'http://192.168.1.20:7125');
  class BrokenSocket extends FakeSocket {bind(){this.emit('error',new Error('unavailable'));}}
  const failure=await discoverMdns({interfaces,createSocket:()=>new BrokenSocket()});assert.deepEqual(failure,{targets:[],diagnostics:['MDNS_SOCKET_UNAVAILABLE']});
});
test('gateway: exact read-only protocol probes carry keys only to local device and never serialize them',async()=>{
  let request;
  const result=await probeTarget({...target,apiKey:'fixture-device-secret'},{transport:async(url,options)=>{request={url:String(url),options};return {status:200,data:moonraker};}});
  assert.equal(request.url,target.endpoint+'/server/info');assert.equal(request.options.method,'GET');assert.equal(request.options.headers['X-Api-Key'],'fixture-device-secret');
  assert.equal(result.connectionState,'online');assert.equal(JSON.stringify(result).includes('fixture-device-secret'),false);assert.equal(result.deviceKey.length,64);
  const octo=await probeTarget({protocol:'octoprint',endpoint:'http://192.168.1.30'},{transport:async(url)=>{assert.equal(url.pathname,'/api/version');return {status:200,data:{api:'0.1',server:'fixture',text:'OctoPrint fixture'}};}});
  assert.equal(octo.connectionState,'online');
});
test('gateway: generic web services, denied redirects and oversized responses never become verified devices',async()=>{
  assert.equal(await probeTarget(target,{transport:async()=>({status:200,data:{ok:true}})}),null);
  assert.equal(await probeTarget(target,{transport:async()=>{throw new GatewayError('REDIRECT_REFUSED','x');}}),null);
  assert.equal(await probeTarget(target,{transport:async()=>{throw new GatewayError('RESPONSE_TOO_LARGE','x');}}),null);
  const denied=await probeTarget(target,{transport:async()=>({status:401,data:{}})});assert.equal(denied.connectionState,'authorization_required');
  const offline=await probeTarget(target,{transport:async()=>{throw new GatewayError('CONNECTION_FAILED','x');}});assert.equal(offline.connectionState,'offline');
  const disconnected=await probeTarget(target,{transport:async()=>({status:200,data:{result:{...moonraker.result,klippy_connected:false}}})});assert.equal(disconnected.connectionState,'offline');
});
test('gateway: discovery deduplicates advertised endpoints, limits targets and never exceeds four probes',async()=>{
  let active=0,max=0,count=0;
  const config=validateConfig({...baseConfig,mdns:true,targets:[target]});
  const result=await discoverDevices(config,{mdns:async()=>({targets:[target,...Array.from({length:40},(_,i)=>({...target,endpoint:'http://192.168.1.'+(i+40)+':7125'}))],diagnostics:[]}),probe:async(input)=>{active++;max=Math.max(max,active);count++;await new Promise(resolve=>setTimeout(resolve,1));active--;return {deviceKey:input.endpoint,connectionState:'online'};}});
  assert.equal(count,32);assert.equal(result.candidates.length,32);assert.ok(max<=4);
});
test('gateway: empty discovery is empty and does not substitute demonstration devices',async()=>{
  const result=await discoverDevices(validateConfig({...baseConfig,mdns:true}),{mdns:async()=>({targets:[],diagnostics:[]}),probe:async()=>{throw new Error('must not probe');}});
  assert.deepEqual(result,{candidates:[],diagnostics:[]});
});
test('gateway: HTTP transport refuses redirects without sending keys to redirect destination and enforces body limit',async()=>{
  let second=0;
  await fixture((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'/secret-leak'});res.end();}else if(req.url==='/large'){res.end('x'.repeat(100));}else{second++;res.end('{}');}},async origin=>{
    await assert.rejects(requestJson(new URL(origin+'/redirect'),{headers:{'X-Api-Key':'private-test-key'}}),{code:'REDIRECT_REFUSED'});
    assert.equal(second,0);await assert.rejects(requestJson(new URL(origin+'/large'),{maxBytes:10}),{code:'RESPONSE_TOO_LARGE'});
  });
});
test('gateway: real local fixture GET is identified without touching LAN or executing commands',async()=>{
  const methods=[];
  await fixture((req,res)=>{methods.push(req.method+' '+req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(moonraker));},async origin=>{
    const result=await probeTarget({...target,endpoint:origin},{allowLoopback:true});assert.equal(result.connectionState,'online');
  });
  assert.deepEqual(methods,['GET /server/info']);
});
test('gateway: failed report retry reuses immutable body/key and does not repeat device discovery',async()=>{
  const calls=[];let discoveryCount=0,reportAttempts=0;
  const client=new GatewayClient(baseConfig,{clock:()=>1000,transport:async(url,options)=>{
    calls.push({url:String(url),...options});if(url.pathname.endsWith('/poll'))return {status:200,data:{gatewayId:'g1',commands:[{id:'scan1',kind:'discover',expiresAt:5000}],pollAfterMs:5000}};
    if(++reportAttempts===1)throw new GatewayError('CONNECTION_FAILED','transient');return {status:200,data:{accepted:true}};
  }});
  const discover=async()=>{discoveryCount++;return {candidates:[{deviceKey:'stable',protocol:'moonraker',endpoint:target.endpoint,name:'fixture',connectionState:'online'}],diagnostics:[]};};
  await assert.rejects(client.cycle(discover),{code:'CONNECTION_FAILED'});await client.cycle(discover);
  const reports=calls.filter(x=>x.url.endsWith('/report'));assert.equal(reports.length,2);assert.equal(reports[0].body,reports[1].body);assert.equal(reports[0].headers['Idempotency-Key'],reports[1].headers['Idempotency-Key']);assert.equal(discoveryCount,1);
});
test('gateway: expired or unknown commands are ignored, pairing and site access stay in same-origin request headers',async()=>{
  const seen=[];const client=new GatewayClient({...baseConfig,siteAccessToken:'operator-supplied-site-secret'},{clock:()=>1000,transport:async(url,options)=>{seen.push({url,options});return {status:200,data:{commands:[{id:'expired',kind:'discover',expiresAt:999},{id:'start',kind:'print',expiresAt:9999}]}};}});
  const outcome=await client.cycle(async()=>{throw new Error('must not execute');});assert.deepEqual(outcome.events,[]);
  assert.equal(seen[0].url.origin,baseConfig.platformUrl);assert.equal(seen[0].options.headers.Authorization,'Bearer '+token);assert.equal(seen[0].options.headers['OAI-Sites-Authorization'],'Bearer operator-supplied-site-secret');assert.equal(seen[0].options.body,'{}');
  await assert.rejects(client.post('start',{},'unsafe-key'),{code:'INVALID_ROUTE'});
});
test('gateway: private hosted login gate gives explicit access error and never follows it',async()=>{
  for(const transport of [async()=>({status:200,data:null,contentType:'text/html'}),async()=>{throw new GatewayError('REDIRECT_REFUSED','x');}]){
    const client=new GatewayClient(baseConfig,{transport});await assert.rejects(client.cycle(async()=>({candidates:[],diagnostics:[]})),{code:'PLATFORM_ACCESS_REQUIRED'});
  }
});
test('gateway: HTTP 200 without report acknowledgement is not reported as success',async()=>{
  const client=new GatewayClient(baseConfig,{clock:()=>1,transport:async(url)=>({status:200,data:url.pathname.endsWith('/poll')?{commands:[{id:'scan1',kind:'discover',expiresAt:10000}]}:{accepted:false}})});
  await assert.rejects(client.cycle(async()=>({candidates:[],diagnostics:[]})),{code:'INVALID_PLATFORM_RESPONSE'});
  assert.equal(client.results.get('scan1').sent,false);
});
test('gateway: failed poll reuses its idempotency key and denied token does not masquerade as empty inventory',async()=>{
  const keys=[];let calls=0;const client=new GatewayClient(baseConfig,{transport:async(url,options)=>{keys.push(options.headers['Idempotency-Key']);if(++calls===1)throw new GatewayError('CONNECTION_FAILED','x');return {status:200,data:{commands:[]}};}});
  await assert.rejects(client.cycle(()=>{}));await client.cycle(()=>{});assert.equal(keys[0],keys[1]);
  const denied=new GatewayClient(baseConfig,{transport:async()=>({status:401,data:{error:{code:'GATEWAY_AUTH_REQUIRED'}}})});await assert.rejects(denied.cycle(()=>{}),{code:'GATEWAY_AUTH_FAILED'});
});
test('gateway: CLI without arguments prints usage only and does not load credentials or open network',async()=>{
  const logs=[];assert.equal(await runCli([],{log:x=>logs.push(x),error:x=>logs.push(x)}),0);assert.match(logs.join(''),/用法/);
});
