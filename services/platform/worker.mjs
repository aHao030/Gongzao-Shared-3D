import { readinessResponse } from './readiness.mjs';
import { D1Store } from './store-d1.mjs';
import { handleApi, jsonResponse, appEntryAsset, staticAssetResponse } from './http.mjs';
import { ASSETS } from '../../generated/assets.mjs';
import { handleHostedAuth } from './auth-config.mjs';
import { handleAdminHttp } from './admin-http.mjs';
import { createAdminControl } from './admin-control.mjs';

export default {async fetch(request,env){
  const url=new URL(request.url);
  const authResponse=handleHostedAuth(request);
  if(authResponse)return authResponse;
  if (url.pathname.startsWith('/api/admin/')) {
    if (!env.DB) return jsonResponse({ error: { code: 'STORAGE_UNAVAILABLE', message: '管理存储尚未配置' } }, 503, { 'Cache-Control': 'private, no-store' });
    const store = new D1Store(env.DB, env.BUCKET);
    const control = createAdminControl({ store, bootstrapOwnerId: env.GONGZAO_ADMIN_OWNER ?? null });
    const actorId = request.headers.get('oai-authenticated-user-id');
    return handleAdminHttp(request, { actorId, control, store });
  }
  if(url.pathname.startsWith('/api/')||url.pathname==='/health'||url.pathname==='/ready'){
    if(!env.DB||!env.BUCKET)return jsonResponse({error:{code:'STORAGE_UNAVAILABLE',message:'服务端存储尚未配置完成'}},503);
    const ownerId = request.headers.get('oai-authenticated-user-id');
    const store = new D1Store(env.DB, env.BUCKET);
    const adminControl = createAdminControl({ store, bootstrapOwnerId: env.GONGZAO_ADMIN_OWNER ?? null });
    if(url.pathname==='/ready')return readinessResponse(request,store,adminControl);
    return handleApi(request,{store,ownerId,accountId:ownerId,accountAuthenticated:Boolean(ownerId),userLabel:'我的制造空间',adminControl});
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const asset=ASSETS[appEntryAsset(url.pathname)];
  if(!asset)return new Response('Not found',{status:404});
  return staticAssetResponse(request.method==='HEAD' ? null : asset.body, asset.type, url.pathname);
}};
