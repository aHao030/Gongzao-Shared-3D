import { D1Store } from './store-d1.mjs';
import { handleApi, jsonResponse } from './http.mjs';
import { ASSETS } from '../../generated/assets.mjs';

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')||url.pathname==='/health'){
    if(!env.DB||!env.BUCKET)return jsonResponse({error:{code:'STORAGE_UNAVAILABLE',message:'服务端存储尚未配置完成'}},503);
    return handleApi(request,{store:new D1Store(env.DB,env.BUCKET),ownerId:request.headers.get('oai-authenticated-user-id'),userLabel:'我的制造空间'});
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const asset=ASSETS[url.pathname==='/'?'/index.html':url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://chatgpt.com"}});
}};
