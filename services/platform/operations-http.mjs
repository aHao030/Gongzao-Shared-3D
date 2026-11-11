import { ApiError, ensure, sha256 } from './geometry.mjs';
import { applyOperationsCommand, getOperations } from './operations.mjs';
import { getPublicWorkspace } from './core.mjs';
import { requireMerchant } from './merchant.mjs';
import { authenticateWorker, workerReadiness } from './worker-access.mjs';
import { requireMerchantAccess } from '../identity/authorization.mjs';

const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const userCommands = new Set(['save-spool','set-spool-cost','save-profile','queue-job','cancel-job','create-production','readiness','dispatch-production','reconcile-production','finish-production','qc-production','cancel-production','schedule']);
async function body(request) {
  ensure(request.headers.get('content-type')?.split(';')[0] === 'application/json', 415, 'INVALID_CONTENT_TYPE', '接口需要 application/json');
  const reader = request.body?.getReader(); ensure(reader,400,'INVALID_JSON','请求体不能为空');
  const chunks=[]; let length=0;
  try { for (;;) { const {value,done}=await reader.read(); if(done)break; length+=value.byteLength; if(length>65536){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','请求数据过大');} chunks.push(value); } }
  finally { reader.releaseLock(); }
  const joined=new Uint8Array(length); let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  let data;try{data=JSON.parse(new TextDecoder().decode(joined));}catch{throw new ApiError(400,'INVALID_JSON','请求体不是有效 JSON');}
  ensure(data && typeof data==='object' && !Array.isArray(data),400,'INVALID_PAYLOAD','请求体必须为对象');return data;
}
function originGuard(request) {
  const origin=request.headers.get('origin');
  ensure(request.headers.get('sec-fetch-site')!=='cross-site' && (!origin || origin===new URL(request.url).origin),403,'CROSS_ORIGIN_DENIED','拒绝跨站请求');
}
async function scopedKey(request, scope) {
  const key=request.headers.get('idempotency-key');
  ensure(/^[A-Za-z0-9_.:-]{8,128}$/.test(key||''),400,'IDEMPOTENCY_REQUIRED','请提供 8–128 位唯一请求标识');
  return 'ops-' + await sha256(new TextEncoder().encode(scope+':'+key));
}
function errorResponse(error, requestId) {
  const known = error instanceof ApiError || ['PlatformError','DomainError','IntegrationError','AuthorizationError'].includes(error.name);
  return json({error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'服务暂时无法处理请求，请使用原请求标识重试'},requestId},known?(error.status||409):500);
}
function replaySpoolSync(workspace, idempotencyKey, httpRequestDigest) {
  const ledger=workspace.operations?.ledger;
  if(!ledger || !Object.prototype.hasOwnProperty.call(ledger,idempotencyKey)) return null;
  const cached=ledger[idempotencyKey];
  ensure(cached.httpRequestDigest===httpRequestDigest,409,'IDEMPOTENCY_CONFLICT','同一请求标识不能用于不同操作');
  return {workspace,result:structuredClone(cached.result),replayed:true};
}

export async function handleOperationsApi(request, {store,ownerId,accountAuthenticated=true,clock=Date.now,workerAccess,integrations,unconfiguredIntegrations}={}) {
  const requestId=crypto.randomUUID(), now=clock(), url=new URL(request.url), path=url.pathname;
  try {
    originGuard(request);
    ensure(ownerId,401,'AUTH_REQUIRED','请先登录账号');
    const current=await store.load(ownerId);
    requireMerchantAccess({ownerId,accountAuthenticated,workspace:current,mode:'OWNER_WORKSPACE'});
    if(request.method==='GET' && path==='/api/v2/merchant/operations') return json({...getOperations(current,now),workerReadiness:workerReadiness(workerAccess,ownerId,now),requestId});
    if(request.method==='GET' && path==='/api/v2/merchant/integrations') return json({...((integrations?.status({ownerId})) ?? unconfiguredIntegrations),requestId});
    ensure(request.method==='POST',405,'METHOD_NOT_ALLOWED','此接口不支持该方法');
    const idempotencyKey=await scopedKey(request,'merchant:'+ownerId), payload=await body(request);
    if(path==='/api/v2/merchant/operations/commands') {
      ensure(userCommands.has(payload.type),403,'OPERATION_NOT_ALLOWED','此命令仅允许后台服务执行，或不属于商家操作');
      const outcome=await store.transact(ownerId, workspace=>applyOperationsCommand(workspace,{type:payload.type,payload:payload.payload,idempotencyKey},{now}));
      return json({...outcome.result,operations:getOperations(outcome.workspace,now),workspace:getPublicWorkspace(outcome.workspace),replayed:outcome.replayed===true,mode:'SERVER_SANDBOX',requestId});
    }
    if(path==='/api/v2/merchant/integrations/sync-spools') {
      ensure(Object.keys(payload).length===0,400,'INVALID_PAYLOAD','库存只能从已配置的耗材服务读取');
      // Bind replay to the authenticated owner's original HTTP request, not to
      // a fresh provider observation whose timestamp and inventory may change.
      const httpRequestDigest=await sha256(new TextEncoder().encode(JSON.stringify({method:request.method,path,payload})));
      const cached=replaySpoolSync(current,idempotencyKey,httpRequestDigest);
      if(cached) return json({...cached.result,operations:getOperations(current,now),replayed:true,requestId});
      ensure(integrations,503,'INTEGRATIONS_NOT_CONFIGURED','此部署尚未配置外部服务，请先完成独立服务配置');
      const observed=await integrations.spools({ownerId});
      const allSpools=Array.isArray(observed)?observed:observed.spools;
      ensure(Array.isArray(allSpools),502,'INVALID_PROVIDER_RESULT','耗材服务返回无效数据');
      const spools=allSpools.filter(item=>!item.archived && ['PLA','PETG','ABS','RESIN','ALUMINUM','CNC'].includes(item.material) && Number.isFinite(item.remainingGrams) && item.remainingGrams>=0).slice(0,100);
      const observation={spools,observedAt:observed.observedAt??now,skippedCount:allSpools.length-spools.length,truncated:observed.truncated===true};
      // The network read happens once, before the store's retryable transaction.
      const outcome=await store.transact(ownerId,async workspace=>{
        // A concurrent request may have committed while the provider was read,
        // or while this pure callback was retried after a version collision.
        const replay=replaySpoolSync(workspace,idempotencyKey,httpRequestDigest);
        if(replay) return replay;
        const applied=await applyOperationsCommand(workspace,{type:'sync-spools',payload:{spools},idempotencyKey},{now,integration:'spoolman'});
        const result={...applied.result,...observation};
        const entry=applied.workspace.operations.ledger[idempotencyKey];
        entry.httpRequestDigest=httpRequestDigest;
        entry.result=structuredClone(result);
        return {...applied,result};
      });
      return json({...outcome.result,operations:getOperations(outcome.workspace,now),replayed:outcome.replayed===true,requestId});
    }
    ensure(integrations,503,'INTEGRATIONS_NOT_CONFIGURED','此部署尚未配置外部服务，请先完成独立服务配置');
    if(path==='/api/v2/merchant/integrations/probe') {
      ensure(Object.keys(payload).every(k=>k==='service'),400,'INVALID_PAYLOAD','连接地址与凭据只能由服务端配置');
      return json({...await integrations.probe(payload.service,{ownerId}),requestId});
    }
    if(path==='/api/v2/merchant/integrations/tracking') {
      ensure(Object.keys(payload).every(k=>['carrier','trackingNumber'].includes(k)),400,'INVALID_PAYLOAD','只允许填写承运商和运单号');
      return json({...await integrations.tracking(payload,{ownerId}),requestId});
    }
    throw new ApiError(404,'NOT_FOUND','接口不存在');
  } catch(error) { return errorResponse(error,requestId); }
}

export async function handleProductionWorkerApi(request,{store,clock=Date.now,workerAccess}={}) {
  const requestId=crypto.randomUUID(),now=clock(),url=new URL(request.url);
  try {
    originGuard(request);
    const principal=await authenticateWorker(request,workerAccess,now), {ownerId,workerId,kinds}=principal;
    const workspace=await store.load(ownerId);requireMerchant(workspace);
    const download=url.pathname.match(/^\/api\/v2\/worker\/models\/(mdl_[a-zA-Z0-9_-]+)\/download$/);
    if(request.method==='GET' && download) {
      const job=workspace.operations?.jobs?.find(job=>job.id===url.searchParams.get('jobId'));
      ensure(job && job.status==='LEASED' && job.workerId===workerId && job.leaseUntil>now && job.leaseToken===request.headers.get('x-job-lease') && job.attempt===Number(request.headers.get('x-job-attempt')) && kinds.includes(job.kind) && job.modelId===download[1],403,'WORKER_MODEL_DENIED','仅可读取当前任务租约绑定的模型');
      const model=workspace.models.find(model=>model.id===job.modelId);
      ensure(model && model.sha256===job.modelHash && (model.version??1)===job.modelVersion,409,'MODEL_CHANGED','模型已更新，请重新领取任务');
      const bytes=await store.getFile(ownerId,job.modelId);ensure(bytes,404,'FILE_NOT_FOUND','模型文件不可用');
      ensure(await sha256(bytes)===job.modelHash,409,'MODEL_HASH_MISMATCH','模型内容校验失败');
      return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Model-Sha256':job.modelHash}});
    }
    ensure(request.method==='POST',405,'METHOD_NOT_ALLOWED','此接口不支持该方法');
    const routes={'/api/v2/worker/claim':'claim-job','/api/v2/worker/complete':'complete-job','/api/v2/worker/fail':'fail-job'};
    const type=routes[url.pathname];ensure(type,404,'NOT_FOUND','计算服务接口不存在');
    const idempotencyKey=await scopedKey(request,'worker:'+workerId),payload=await body(request);
    if(type==='claim-job' && payload.kinds===undefined) payload.kinds=[...kinds];
    const outcome=await store.transact(ownerId,w=>applyOperationsCommand(w,{type,payload,idempotencyKey},{now,workerId,workerKinds:kinds}));
    return json({...outcome.result,replayed:outcome.replayed===true,requestId});
  } catch(error) { return errorResponse(error,requestId); }
}
