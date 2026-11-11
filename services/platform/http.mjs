import { getMerchantPricing } from './pricing.mjs';
import { getCustomerProfile } from './customer.mjs';
import { getMarketCatalog } from './market.mjs';
import { handleMerchantApi } from './merchant-http.mjs';
import { applyCommand, getPublicWorkspace } from './core.mjs';
import { ApiError, ensure, analyzeModel } from './geometry.mjs';

const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
export async function readLimited(request,limit) {
  const length=Number(request.headers.get('content-length'));
  ensure(!Number.isFinite(length)||length<=limit,413,'BODY_TOO_LARGE','请求数据超过当前大小限制');
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader(),chunks=[];let size=0;
  try { for(;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','请求数据超过当前大小限制');}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;
}
export function jsonResponse(data,status=200,extra={}) {return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extra}});}
export async function handleApi(request,{store,ownerId,userLabel='创作者',clock=Date.now}) {
  const requestId=crypto.randomUUID(),url=new URL(request.url),path=url.pathname;
  try {
    ensure(path.startsWith('/api/v2/')||path==='/health',404,'NOT_FOUND','接口不存在');
    if((path.startsWith('/api/v2/merchant/')&&path!=='/api/v2/merchant/pricing')||path.startsWith('/api/v2/gateway/'))return handleMerchantApi(request,{store,ownerId,clock});
    if(path==='/health'&&request.method==='GET')return jsonResponse({ok:true,version:'0.7.0',mode:'SERVER_SANDBOX',persistence:store.kind,realPayments:false,realDevices:false});
    ensure(ownerId,401,'AUTH_REQUIRED','请先登录或建立本地沙盒会话');
    if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'CROSS_ORIGIN_DENIED','不接受跨站调用');
    const origin=request.headers.get('origin');
    ensure(!origin||origin===url.origin,403,'CROSS_ORIGIN_DENIED','不接受其他网站的请求');
    if(request.method==='GET'&&path==='/api/v2/markets') {
      const country = url.searchParams.get('country');
      ensure(country === null || /^(?:[A-Za-z]{2}|OTHER)$/.test(country),400,'INVALID_COUNTRY','请选择国家或地区，或填写两位国家或地区代码');
      return jsonResponse(getMarketCatalog(country ?? undefined));
    }
    if(request.method==='GET'&&path==='/api/v2/merchant/pricing')return jsonResponse(getMerchantPricing(await store.load(ownerId)));
    if(request.method==='GET'&&path==='/api/v2/session')return jsonResponse({mode:'SERVER_SANDBOX',authenticated:true,user:{id:ownerId,label:userLabel},persistence:store.kind,capabilities:{uploads:true,maxUploadBytes:20*1024*1024,maxStlTriangles:50000,realPayments:false,realDevices:false,wechatAuthentication:false}});
    if(request.method==='GET'&&path==='/api/v2/customer/profile')return jsonResponse({profile:getCustomerProfile(await store.load(ownerId))});
    if(request.method==='GET'&&path==='/api/v2/workspace')return jsonResponse({mode:'SERVER_SANDBOX',workspace:getPublicWorkspace(await store.load(ownerId))});
    const download=path.match(/^\/api\/v2\/models\/(mdl_[a-zA-Z0-9_-]+)\/download$/);
    if(request.method==='GET'&&download){
      const state=await store.load(ownerId),model=state.models.find(m=>m.id===download[1]);
      ensure(model,404,'MODEL_NOT_FOUND','模型不存在');
      const bytes=await store.getFile(ownerId,model.id);ensure(bytes,404,'FILE_NOT_FOUND','文件尚未保存');
      return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(model.name),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    ensure(request.method==='POST',405,'METHOD_NOT_ALLOWED','此接口不支持该方法');
    const key=request.headers.get('idempotency-key');
    ensure(typeof key==='string'&&/^[A-Za-z0-9_.:-]{8,128}$/.test(key),400,'IDEMPOTENCY_REQUIRED','请提供 8–128 位唯一请求标识');
    let type,payload,pendingFile;
    if(path==='/api/v2/models') {
      ensure(request.headers.get('content-type')?.split(';')[0]==='application/octet-stream',415,'INVALID_CONTENT_TYPE','上传需要 application/octet-stream');
      let name;try{name=decodeURIComponent(request.headers.get('x-file-name')||'');}catch{throw new ApiError(400,'INVALID_FILENAME','文件名编码无效');}
      const bytes=await readLimited(request,20*1024*1024);
      payload=await analyzeModel(bytes,name);type='register-model';
      // The store validates the command before saving content-addressed bytes.
      // SQLite commits metadata and bytes in one transaction; R2 uses CAS coordination.
      pendingFile={id:payload.id,bytes};
    } else {
      const routes={'/api/v2/merchant/pricing':'pricing-profile','/api/v2/customer/profile':'customer-profile','/api/v2/quotes':'quote','/api/v2/orders':'order','/api/v2/actions':'action'};
      type=routes[path];ensure(type,404,'NOT_FOUND','接口不存在');
      ensure(request.headers.get('content-type')?.split(';')[0]==='application/json',415,'INVALID_CONTENT_TYPE','接口需要 application/json');
      try{payload=JSON.parse(new TextDecoder().decode(await readLimited(request,32768)));}
      catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'INVALID_JSON','请求体不是有效 JSON');}
      ensure(payload&&typeof payload==='object'&&!Array.isArray(payload),400,'INVALID_PAYLOAD','请求体必须为对象');
    }
    const outcome=await store.transact(ownerId,workspace=>applyCommand(workspace,{type,payload,idempotencyKey:key},{now:clock(),idFactory:()=>crypto.randomUUID()}),pendingFile);
    return jsonResponse({...outcome.result,mode:'SERVER_SANDBOX',workspace:getPublicWorkspace(outcome.workspace),replayed:outcome.replayed===true,requestId},type==='order'||type==='register-model'?201:200);
  }catch(error){
    const expected=error instanceof ApiError||['DomainError','PlatformError'].includes(error.name);
    const status=error.status||(['DomainError','PlatformError'].includes(error.name)?409:500);
    return jsonResponse({error:{code:expected?error.code:'INTERNAL_ERROR',message:expected?error.message:'服务暂时无法处理请求，请稍后使用同一请求标识重试'},requestId},status);
  }
}
