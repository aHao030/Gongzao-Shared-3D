import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { check,IntegrationError,publicAddress } from './config.mjs';

/** Resolve once and pin the connection address. Redirects never carry credentials. */
async function pinnedFetch(url,options,{allowPrivateOrigins,timeoutMs,maxResponseBytes},lookupImpl=lookup){
  const u=new URL(url),hostname=u.hostname.replace(/^\[|\]$/g,'');
  let dnsTimer;
  const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await Promise.race([lookupImpl(hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new IntegrationError('UPSTREAM_TIMEOUT','服务域名解析超时',504)),timeoutMs);})]).finally(()=>clearTimeout(dnsTimer));
  check(addresses.length>0&&addresses.every(a=>isIP(a.address)),'DNS_FAILURE','无法解析服务地址',502);
  check(allowPrivateOrigins.includes(u.origin)||addresses.every(a=>publicAddress(a.address)),'PRIVATE_SERVICE_DENIED','解析地址属于未授权私网',403);
  const address=addresses[0];
  return new Promise((resolve,reject)=>{
    const req=(u.protocol==='https:'?https:http).request(u,{method:options.method,headers:options.headers,agent:false,lookup:(_host,opts,cb)=>cb(null,opts.all?[address]:address.address,opts.all?undefined:address.family)},res=>{
      let size=0;const chunks=[];
      if(res.statusCode>=300&&res.statusCode<400){res.resume();req.destroy();reject(new IntegrationError('REDIRECT_DENIED','服务返回重定向，已停止请求',502));return;}
      res.on('data',chunk=>{size+=chunk.length;if(size>maxResponseBytes){req.destroy(new IntegrationError('UPSTREAM_TOO_LARGE','服务返回数据超过限制',502));}else chunks.push(chunk);});
      res.on('end',()=>resolve(new Response([204,205,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
      res.on('error',reject);
    });
    const deadline=setTimeout(()=>req.destroy(new IntegrationError('UPSTREAM_TIMEOUT','外部服务请求超时',504)),timeoutMs);
    req.on('close',()=>clearTimeout(deadline));
    req.on('error',reject);if(options.body)req.write(options.body);req.end();
  });
}
export function createTransport(config,{fetchImpl,lookupImpl}={}){
  return async function request(connection,path,{method='GET',json,bytes,headers={},allowPlainHealth=false}={}){
    check(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&!path.includes('\\'),'INVALID_REQUEST','服务请求路径无效',400);
    const url=connection.baseUrl+path,options={method,redirect:'error',headers:{accept:'application/json',...headers},body:bytes};
    if(json!==undefined){options.body=JSON.stringify(json);options.headers['content-type']='application/json';}
    let response;
    try{
      if(fetchImpl){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),config.timeoutMs);try{response=await fetchImpl(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}}
      else response=await pinnedFetch(url,options,config,lookupImpl);
      check(!response.redirected&&!(response.status>=300&&response.status<400),'REDIRECT_DENIED','服务返回重定向，已停止请求',502);
      check(response.ok,'UPSTREAM_HTTP_ERROR',response.status===401||response.status===403?'服务授权失败，请检查服务器凭据':'外部服务请求失败',response.status===401||response.status===403?502:502);
      if(response.status===204)return {};
      const reader=response.body?.getReader();if(!reader)return {};let length=0;const chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;check(length<=config.maxResponseBytes,'UPSTREAM_TOO_LARGE','服务返回数据超过限制',502);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const buffer=new Uint8Array(length);let at=0;for(const chunk of chunks){buffer.set(chunk,at);at+=chunk.byteLength;}
      const text=new TextDecoder().decode(buffer);
      if(allowPlainHealth&&text.trim()==='health is good')return {health:'ok'};
      try{return length?JSON.parse(text):{};}catch{throw new IntegrationError('UPSTREAM_INVALID_RESPONSE','服务未返回有效 JSON',502);}
    }catch(error){if(error instanceof IntegrationError)throw error;if(error?.name==='AbortError'||error?.name==='TimeoutError')throw new IntegrationError('UPSTREAM_TIMEOUT','外部服务请求超时',504);throw new IntegrationError('UPSTREAM_UNAVAILABLE','外部服务暂时不可达',502);}
  };
}
