import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { normalizeTarget, GatewayError } from './config.mjs';
import { discoverMdns } from './mdns.mjs';

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
      return {...candidate,connectionState:info.klippy_connected?'online':'offline'};
    }
    if(typeof data.text!=='string'||!/^OctoPrint(?:\s|$)/.test(data.text)||typeof data.api!=='string'||typeof data.server!=='string')return null;
    return {...candidate,connectionState:'online'};
  }catch(error){
    if(['REDIRECT_REFUSED','RESPONSE_TOO_LARGE'].includes(error.code))return null;
    // A configured endpoint may be temporarily unavailable. Keep its offline observation,
    // which the server must not treat as verified / eligible for automatic registration.
    return candidate;
  }
}
export async function discoverDevices(config,{mdns=discoverMdns,probe=probeTarget}={}) {
  const found=config.mdns?await mdns():{targets:[],diagnostics:[]};
  const all=[...config.targets,...found.targets],targets=[],seen=new Set(),diagnostics=[...found.diagnostics];
  for(const raw of all){
    try{const target=normalizeTarget(raw,{allowLoopback:config.allowLoopbackTargets});const key=target.protocol+'|'+target.endpoint;if(seen.has(key))continue;seen.add(key);targets.push(target);if(targets.length===32)break;}
    catch{if(!diagnostics.includes('INVALID_DISCOVERY_ADDRESS'))diagnostics.push('INVALID_DISCOVERY_ADDRESS');}
  }
  const candidates=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,targets.length)},async()=>{
    while(cursor<targets.length){const target=targets[cursor++];const candidate=await probe(target,{allowLoopback:config.allowLoopbackTargets});if(candidate)candidates.push(candidate);}
  }));
  return {candidates:candidates.sort((a,b)=>a.deviceKey.localeCompare(b.deviceKey)),diagnostics};
}
