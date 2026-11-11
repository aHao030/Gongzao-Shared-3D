import { D1Store } from './store-d1.mjs';
import { handleApi, jsonResponse, isAppEntryPath, staticAssetResponse } from './http.mjs';
import { ASSETS } from '../../generated/assets.mjs';
import { handleHostedAuth } from './auth-config.mjs';

export default {async fetch(request,env){
  const url=new URL(request.url);
  const authResponse=handleHostedAuth(request);
  if(authResponse)return authResponse;
  if(url.pathname.startsWith('/api/')||url.pathname==='/health'){
    if(!env.DB||!env.BUCKET)return jsonResponse({error:{code:'STORAGE_UNAVAILABLE',message:'服务端存储尚未配置完成'}},503);
    const ownerId = request.headers.get('oai-authenticated-user-id');
    return handleApi(request,{store:new D1Store(env.DB,env.BUCKET),ownerId,accountAuthenticated:Boolean(ownerId),userLabel:'我的制造空间'});
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const asset=ASSETS[isAppEntryPath(url.pathname)?'/index.html':url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  return staticAssetResponse(request.method==='HEAD' ? null : asset.body, asset.type);
}};
