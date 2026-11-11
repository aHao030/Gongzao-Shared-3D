import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { normalizeTarget, GatewayError } from './config.mjs';
import { discoverMdns } from './mdns.mjs';
import { discoverBambuLan, bambuTargets, probeBambu, bambuDeviceKey } from './bambu-discovery.mjs';
import { readBambuStatus } from './bambu-status.mjs';

export function requestJson(url,{method='GET',headers={},body,timeoutMs=2000,maxBytes=65536}={}) {
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const req=(url.protocol==='https:'?https:http).request(url,{method,headers},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();finish(new GatewayError('REDIRECT_REFUSED','不跟随重定向'));return;}
      if(Number(res.headers['content-length'])>maxBytes){res.destroy();finish(new GatewayError('RESPONSE_TOO_LARGE','响应超过大小限制'));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();finish(new GatewayError('RESPONSE_TOO_LARGE','响应超过大小限制'));}else chunks.push(chunk);});
      res.on('error',()=>finish(new GatewayError('CONNECTION_FAILED','连接响应中断')));
      res.on('end',()=>{if(settled)return;let data=null;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}finish(null,{status:res.statusCode,data,contentType:res.headers['content-type']||''});});
    });
    timer=setTimeout(()=>{req.destroy();finish(new GatewayError('REQUEST_TIMEOUT','请求超时'));},timeoutMs);
    req.on('error',()=>finish(new GatewayError('CONNECTION_FAILED','无法连接目标服务')));
    if(body)req.write(body);req.end();
  });
}
const observationText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,100):'';
const stableKey=target=>createHash('sha256').update(target.protocol+'|'+target.endpoint).digest('hex');
export async function probeTarget(input,{allowLoopback=false,transport=requestJson}={}) {
  const target=normalizeTarget(input,{allowLoopback});
  const candidate={deviceKey:stableKey(target),protocol:target.protocol,endpoint:target.endpoint,name:target.name||(target.protocol==='moonraker'?'Moonraker 设备':'OctoPrint 设备'),model:target.protocol==='moonraker'?'Klipper / Moonraker':'OctoPrint',connectionState:'offline'};
  const url=new URL(target.endpoint+(target.protocol==='moonraker'?'/server/info':'/api/version'));
  const headers={Accept:'application/json',...(target.apiKey?{'X-Api-Key':target.apiKey}:{})};
  try {
    const {status,data}=await transport(url,{method:'GET',headers,timeoutMs:2000,maxBytes:65536});
    if(status===401||status===403)return {...candidate,connectionState:'authorization_required'};
    if(status!==200||!data||typeof data!=='object')return null;
    if(target.protocol==='moonraker'){
      const info=data.result||data;
      if(typeof info.klippy_connected!=='boolean'||typeof info.klippy_state!=='string'||!Array.isArray(info.components))return null;
      return {...candidate,connectionState:info.klippy_connected?'online':'offline',probeEvidence:{method:'GET',endpoint:'/server/info',serviceReachable:true,controllerConnected:info.klippy_connected,controllerState:observationText(info.klippy_state),serviceVersion:observationText(info.moonraker_version)}};
    }
    if(typeof data.text!=='string'||!/^OctoPrint(?:\s|$)/.test(data.text)||typeof data.api!=='string'||typeof data.server!=='string')return null;
    return {...candidate,connectionState:'online',probeEvidence:{method:'GET',endpoint:'/api/version',serviceReachable:true,controllerConnected:null,controllerState:'',serviceVersion:observationText(data.server)}};
  }catch(error){
    if(['REDIRECT_REFUSED','RESPONSE_TOO_LARGE'].includes(error.code))return null;
    // A configured endpoint may be temporarily unavailable. Keep its offline observation,
    // which the server must not treat as verified / eligible for automatic registration.
    return candidate;
  }
}
async function runProbes(targets,diagnostics) {
  const candidates=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,targets.length)},async()=>{
    while(cursor<targets.length){const runProbe=targets[cursor++];const candidate=await runProbe();if(candidate)candidates.push(candidate);}
  }));
  return {candidates:candidates.sort((a,b)=>a.deviceKey.localeCompare(b.deviceKey)),diagnostics:[...diagnostics]};
}
// The CLI retains unchanged private configurations across polls. Keep bounded
// cursor state per configuration; a new pairing starts its own rotation.
const discoveryCursors = new WeakMap();
function nextBatch(items,limit,cursors,key) {
  if (items.length <= limit) { cursors[key]=0; return items; }
  const offset=(cursors[key] ?? 0) % items.length;
  const ordered=items.slice(offset).concat(items.slice(0,offset));
  cursors[key]=(offset+limit)%items.length;
  return ordered.slice(0,limit);
}
export async function monitorBambuDevices(config,deviceKeys,{bambuDiscover=discoverBambuLan,bambuReadStatus=readBambuStatus}={}) {
  if (!Array.isArray(deviceKeys) || deviceKeys.length>32 || deviceKeys.some(k=>typeof k!=='string' || !/^[a-f0-9]{64}$/.test(k))) {
    throw new GatewayError('INVALID_MONITOR_TARGET','拓竹状态刷新需要有效的已登记设备标识');
  }
  if (!deviceKeys.length) return {candidates:[],diagnostics:[]};
  const registered = new Set(deviceKeys);
  const found = config.bambuLan ? await bambuDiscover() : {advertisements:[],diagnostics:[]};
  const fleet = bambuTargets(config.bambuPrinters ?? [],found.advertisements,found.conflicts);
  const selected = fleet.targets.filter(item=>registered.has(bambuDeviceKey((item.printer??item.advertised).serial)));
  return runProbes(selected.map(item=>()=>probeBambu(item,{allowLoopback:config.allowLoopbackTargets,readStatus:bambuReadStatus})),
    new Set([...found.diagnostics,...fleet.diagnostics]));
}
export async function discoverDevices(config,{onlyBambu=false,mdns=discoverMdns,probe=probeTarget,bambuDiscover=discoverBambuLan,bambuReadStatus=readBambuStatus}={}) {
  const [found,bambu] = await Promise.all([
    !onlyBambu && config.mdns ? mdns() : {targets:[],diagnostics:[]},
    config.bambuLan ? bambuDiscover() : {advertisements:[],diagnostics:[]}
  ]);
  const fleet=bambuTargets(config.bambuPrinters ?? [],bambu.advertisements,bambu.conflicts);
  const diagnostics=new Set([...found.diagnostics,...bambu.diagnostics,...fleet.diagnostics]);
  const active=[], passive=[], seen=new Set(), options={allowLoopback:config.allowLoopbackTargets};
  function addHttp(raw) {
    try {
      const target=normalizeTarget(raw,options), key=target.protocol+'|'+target.endpoint;
      if (!seen.has(key)) { seen.add(key); active.push({run:() => probe(target,options)}); }
    } catch { diagnostics.add('INVALID_DISCOVERY_ADDRESS'); }
  }
  // A passive advertisement costs no network round trip. Only active HTTP
  // and TLS probes share the 32-probe budget; the server accepts 100 rows.
  if (!onlyBambu) config.targets.forEach(addHttp);
  for (const item of fleet.targets) {
    if (item.printer) active.push({run:()=>probeBambu(item,{...options,readStatus:bambuReadStatus}),advertised:item.advertised});
    else passive.push({advertised:item.advertised});
  }
  found.targets.forEach(addHttp);
  if (!discoveryCursors.has(config)) discoveryCursors.set(config,{});
  const cursors=discoveryCursors.get(config), scope=onlyBambu?'bambu':'all';
  const selected=nextBatch(active,32,cursors,scope+'Active');
  if (selected.length<active.length) {
    diagnostics.add('DISCOVERY_TARGET_LIMIT');
    const attempted=new Set(selected);
    for (const entry of active) {
      if (!attempted.has(entry) && entry.advertised) passive.push({advertised:entry.advertised,deferred:true});
    }
  }
  const result=await runProbes(selected.map(entry=>entry.run),diagnostics);
  const remainder=nextBatch(passive,100-result.candidates.length,cursors,scope+'Passive');
  if (remainder.length<passive.length) diagnostics.add('DISCOVERY_TARGET_LIMIT');
  for (const {advertised,deferred} of remainder) {
    const candidate=await probeBambu({advertised},{});
    if (deferred) candidate.probeEvidence.deferred=true;
    result.candidates.push(candidate);
  }
  return {candidates:result.candidates.sort((a,b)=>a.deviceKey.localeCompare(b.deviceKey)),diagnostics:[...diagnostics]};
}
