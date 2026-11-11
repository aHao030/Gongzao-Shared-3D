import { createHash } from 'node:crypto';
import { check,IntegrationError,validateIntegrationConfig } from './config.mjs';
import { createTransport } from './transport.mjs';
export { IntegrationError,loadIntegrationConfig,validateIntegrationConfig } from './config.mjs';

import { INTEGRATION_CATALOG as CATALOG } from './catalog.mjs';
export { unconfiguredStatus } from './catalog.mjs';
const clean=(v,max=160)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max):'';
const n=(v)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const ident=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?String(v):typeof v==='string'&&/^[A-Za-z0-9_.-]{1,120}$/.test(v)?v:null;
const sha=v=>createHash('sha256').update(v).digest('hex');
const rows=value=>Array.isArray(value)?value:Array.isArray(value?.results)?value.results:null;
const requireRows=value=>{const result=rows(value);check(result,'UPSTREAM_INVALID_RESPONSE','服务返回列表结构不匹配',502);return result;};
function authorization(service,c){if(!c.apiKey)return {};return service==='spoolman'?{'x-api-key':c.apiKey}:service==='karrio'?{authorization:'Token '+c.apiKey}:service==='hyperswitch'?{'api-key':c.apiKey}:service==='moonraker'||service==='octoprint'?{'x-api-key':c.apiKey}:{authorization:'Bearer '+c.apiKey};}
export function normalizeTracking(raw,{carrier,trackingNumber,now=Date.now()}={}){
  check(raw&&typeof raw==='object'&&!Array.isArray(raw),'UPSTREAM_INVALID_RESPONSE','物流响应无效',502);
  const statuses={pending:'PENDING',unknown:'UNKNOWN',in_transit:'IN_TRANSIT',out_for_delivery:'OUT_FOR_DELIVERY',delivered:'DELIVERED',delivery_failed:'EXCEPTION',on_hold:'EXCEPTION',ready_for_pickup:'READY_FOR_PICKUP',returned:'RETURNED',cancelled:'CANCELLED'};
  const status=statuses[raw.status]||'UNKNOWN';
  const events=(Array.isArray(raw.events)?raw.events:[]).slice(0,200).filter(e=>e&&typeof e==='object'&&!Array.isArray(e)).map(e=>{
    const at=e.date?(String(e.date)+(e.time?'T'+String(e.time):'')):e.timestamp??e.created_at;
    const ms=Date.parse(at);const observedTime=Number.isFinite(ms)?new Date(ms).toISOString():null;
    const description=clean(e.description??e.message,300),location=clean(e.location??e.city,120),code=clean(e.code??e.status,80);
    return {id:sha(JSON.stringify([carrier,trackingNumber,observedTime,description,location,code])).slice(0,24),at:observedTime,description,location,code};
  }).filter((e,i,a)=>a.findIndex(x=>x.id===e.id)===i).sort((a,b)=>(a.at??'9999').localeCompare(b.at??'9999'));
  return {source:'karrio',carrier:clean(raw.carrier_name??carrier,80),trackingNumber:clean(raw.tracking_number??trackingNumber,120),status,delivered:status==='DELIVERED',testMode:raw.test_mode===true,events,observedAt:now,customerAcceptanceRequired:true,settlementTriggered:false};
}
function address(raw){check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&/^[A-Z]{2}$/.test(raw.country_code??''),'INVALID_ADDRESS','运价查询需要有效国家代码',400);
  return Object.fromEntries(['country_code','postal_code','city','state_code','address_line1','address_line2','person_name','company_name','phone_number','email'].filter(k=>raw[k]!==undefined).map(k=>{check(typeof raw[k]==='string'&&raw[k].length<=200&&!/[\r\n\0]/.test(raw[k]),'INVALID_ADDRESS','地址字段无效',400);return [k,raw[k]];}));}
export function createIntegrationHub({config={},fetchImpl,lookupImpl,clock=Date.now,journal}={}){
  // Already normalized config may be supplied by loadIntegrationConfig; normalize again to detach references.
  const c=validateIntegrationConfig(structuredClone(config));
  const request=createTransport(c,{fetchImpl,lookupImpl});const observations=new Map();
  const owned=ctx=>Boolean(c.ownerId&&ctx?.ownerId===c.ownerId);
  function assertOwner(ctx){check(owned(ctx),'INTEGRATION_OWNER_REQUIRED','当前工作空间未配置专属服务连接',403);}
  function connection(id,ctx){assertOwner(ctx);check(CATALOG.some(s=>s[0]===id),'UNKNOWN_SERVICE','未知服务',400);const s=c.services[id];check(s,'NOT_CONFIGURED','请先由管理员配置服务连接',503);return s;}
  async function call(id,path,options={},ctx){const s=connection(id,ctx);return request(s,path,{...options,headers:{...authorization(id,s),...options.headers}});}
  const hub={
    status(ctx){return {services:CATALOG.map(([id,label,mode,capabilities,message])=>{const configured=owned(ctx)&&(['moonraker','octoprint'].includes(id)?c.devices.some(d=>d.protocol===id):Boolean(c.services[id]));return {id,label,configured,state:configured?(observations.get(id)?.state??'CONFIGURED_UNVERIFIED'):'NOT_CONFIGURED',mode,capabilities:[...capabilities],message:configured?message:'尚未为当前工作空间配置；请由管理员配置服务器连接',...(configured&&observations.has(id)?{lastCheckedAt:observations.get(id).checkedAt}:{})};}),realPayments:false,realDeviceDispatch:false};},
    async spools(ctx){const result=[];let truncated=false;for(let offset=0;offset<500;offset+=100){const batch=requireRows(await call('spoolman',`/api/v1/spool?allow_archived=false&limit=100&offset=${offset}`,{},ctx));
      for(const s of batch.slice(0,100)){check(ident(s.id)!==null,'UPSTREAM_INVALID_RESPONSE','耗材卷标识无效',502);const remaining=n(s.remaining_weight);result.push({externalId:ident(s.id),name:clean(s.filament?.name||'耗材卷 '+s.id,100),material:clean(s.filament?.material,40).toUpperCase(),color:clean(s.filament?.color_hex,20),remainingGrams:remaining,usedGrams:n(s.used_weight),initialGrams:n(s.initial_weight??s.filament?.weight),location:clean(s.location,64),archived:s.archived===true,source:'spoolman',observedAt:clock(),requiresCostConfiguration:true});}
      if(batch.length<100)break;if(offset===400)truncated=true;}
      return {source:'spoolman',observedAt:clock(),spools:result,truncated};},
    async printers(service,ctx){check(['fdmMonster','obico'].includes(service),'UNKNOWN_SERVICE','此服务不支持设备列表',400);const values=requireRows(await call(service,service==='fdmMonster'?'/api/v2/printer':'/api/v1/printers/',{},ctx));
      return {service,observedAt:clock(),printers:values.slice(0,200).map(v=>({externalId:ident(v.id),name:clean(v.name,100),status:clean(typeof v.status==='string'?v.status:v.status?.state?.text,80)||'UNKNOWN',monitoring:typeof v.watching_enabled==='boolean'?v.watching_enabled:null,possibleFailure:typeof v.normalized_p==='number'&&Number.isFinite(v.normalized_p)?Math.max(0,Math.min(1,v.normalized_p)):null})),truncated:values.length>200,qualityAccepted:false};},
    async tracking({carrier,trackingNumber}={},ctx){check(/^[a-z][a-z0-9_]{1,59}$/.test(carrier??'')&&/^[A-Za-z0-9-]{3,100}$/.test(trackingNumber??''),'INVALID_TRACKING','承运商或运单号格式无效',400);const raw=await call('karrio',`/v1/trackers/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`,{},ctx);return normalizeTracking(raw,{carrier,trackingNumber,now:clock()});},
    async rates({shipper,recipient,parcels,carrierIds=[]}={},ctx){check(Array.isArray(parcels)&&parcels.length>=1&&parcels.length<=20,'INVALID_PARCELS','包裹数量须为1–20',400);const normalized=parcels.map(p=>{check(n(p.weight)>0&&p.weight<100000&&['KG','LB','G','OZ'].includes(p.weight_unit)&&['CM','IN','MM'].includes(p.dimension_unit),'INVALID_PARCELS','包裹重量和单位无效',400);for(const key of ['length','width','height'])check(n(p[key])>0&&p[key]<100000,'INVALID_PARCELS','包裹尺寸无效',400);return Object.fromEntries(['weight','weight_unit','dimension_unit','length','width','height'].map(k=>[k,p[k]]));});
      check(Array.isArray(carrierIds)&&carrierIds.length<=20&&carrierIds.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)),'INVALID_CARRIER','承运商连接标识无效',400);
      const raw=await call('karrio','/v1/proxy/rates',{method:'POST',json:{shipper:address(shipper),recipient:address(recipient),parcels:normalized,...(carrierIds.length?{carrier_ids:carrierIds}:{})}},ctx);
      check(Array.isArray(raw.rates),'UPSTREAM_INVALID_RESPONSE','运价响应结构不匹配',502);
      return {source:'karrio',observedAt:clock(),rates:raw.rates.slice(0,100).map(r=>({id:ident(r.id),carrier:clean(r.carrier_name,80),service:clean(r.service,100),totalCharge:n(typeof r.total_charge==='string'?Number(r.total_charge):r.total_charge),currency:/^[A-Z]{3}$/.test(r.currency??'')?r.currency:null,transitDays:n(r.transit_days),testMode:r.test_mode===true})),purchased:false};},
    async createTestPaymentIntent({orderId,amountCents,currency,idempotencyKey}={},ctx){const s=connection('hyperswitch',ctx);check(s.mode==='test','LIVE_PAYMENTS_DISABLED','真实收付款未开放',409);check(/^[A-Za-z0-9_-]{1,100}$/.test(orderId??'')&&Number.isSafeInteger(amountCents)&&amountCents>0&&amountCents<=100000000&&/^[A-Z]{3}$/.test(currency??'')&&/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey??''),'INVALID_PAYMENT','测试支付参数无效',400);
      const paymentId='gz_'+sha(ctx.ownerId+':'+orderId).slice(0,40);const raw=await call('hyperswitch','/payments',{method:'POST',headers:{'idempotency-key':idempotencyKey},json:{payment_id:paymentId,amount:amountCents,currency,confirm:false,...(s.profileId?{profile_id:s.profileId}:{}),metadata:{gongzao_order_id:orderId}}},ctx);
      check(raw.payment_id===paymentId&&raw.amount===amountCents&&raw.currency===currency,'PAYMENT_MISMATCH','支付服务返回金额或订单标识不匹配',502);
      return {provider:'hyperswitch',paymentId,status:clean(raw.status,80),amountCents,currency,mode:'TEST_ONLY',charged:false,settlementEnabled:false};},
    async paymentStatus({paymentId,expectedAmountCents,expectedCurrency}={},ctx){check(/^gz_[a-f0-9]{40}$/.test(paymentId??''),'INVALID_PAYMENT','支付标识无效',400);const raw=await call('hyperswitch','/payments/'+paymentId+'?force_sync=true',{},ctx);
      check(raw.payment_id===paymentId&&raw.amount===expectedAmountCents&&raw.currency===expectedCurrency,'PAYMENT_MISMATCH','支付查询结果与冻结订单不一致',502);return {provider:'hyperswitch',paymentId,status:clean(raw.status,80),amountCents:raw.amount,currency:raw.currency,mode:'TEST_ONLY',livePaymentVerified:false,settlementEnabled:false};},
    async probe(service,ctx){assertOwner(ctx);let count;
      if(service==='spoolman'){const data=requireRows(await call(service,'/api/v1/spool?limit=1',{},ctx));count=data.length;}
      else if(['fdmMonster','obico'].includes(service)){count=(await hub.printers(service,ctx)).printers.length;}
      else if(service==='karrio'){const data=await call(service,'/v1/carriers?limit=1',{},ctx);check(Array.isArray(data)||data&&typeof data==='object','UPSTREAM_INVALID_RESPONSE','物流服务响应无效',502);}
      else if(service==='hyperswitch'){const s=connection(service,ctx);const data=await request(s,'/health',{headers:authorization(service,s),allowPlainHealth:true});check(data&&typeof data==='object','UPSTREAM_INVALID_RESPONSE','支付服务响应无效',502);}
      else if(['moonraker','octoprint'].includes(service)){const devices=c.devices.filter(d=>d.protocol===service);check(devices.length,'NOT_CONFIGURED','尚未配置此协议设备',503);await hub.deviceStatus({deviceId:devices[0].id},ctx);count=devices.length;}
      else throw new IntegrationError('UNKNOWN_SERVICE','未知服务',400);
      const result={service,state:'AVAILABLE',checkedAt:clock(),message:'接口可达；仍需按具体业务验证凭据与能力',...(count!==undefined?{itemCount:count}:{})};observations.set(service,result);return result;},
    async deviceStatus({deviceId}={},ctx){assertOwner(ctx);const d=c.devices.find(d=>d.id===deviceId);check(d,'DEVICE_NOT_CONFIGURED','设备未配置',404);const data=await request(d,d.protocol==='moonraker'?'/printer/objects/query?print_stats&virtual_sdcard&webhooks':'/api/job',{headers:authorization(d.protocol,d)});
      if(d.protocol==='moonraker'){const state=data.result?.status;check(state&&typeof state==='object','UPSTREAM_INVALID_RESPONSE','设备状态响应无效',502);return {deviceId,protocol:d.protocol,state:clean(state.print_stats?.state,40)||'UNKNOWN',filename:clean(state.print_stats?.filename,160),progress:n(state.virtual_sdcard?.progress),observedAt:clock(),ready:state.webhooks?.state==='ready'&&['standby','complete','cancelled'].includes(state.print_stats?.state)};}
      check(typeof data.state==='string','UPSTREAM_INVALID_RESPONSE','设备状态响应无效',502);return {deviceId,protocol:d.protocol,state:clean(data.state,40),filename:clean(data.job?.file?.name,160),progress:n(data.progress?.completion)===null?null:data.progress.completion/100,observedAt:clock(),ready:data.state==='Operational'};},
  };
  // Write methods are only server-side adapters. They are intentionally absent from public HTTP routes.
  const realJob=(deviceId,job,ctx)=>{assertOwner(ctx);const d=c.devices.find(d=>d.id===deviceId);check(d,'DEVICE_NOT_CONFIGURED','设备未配置',404);check(d.allowLivePrint===true,'LIVE_PRINT_DISABLED','管理员尚未启用真实设备派单',409);check(journal&&typeof journal.begin==='function','DURABLE_JOURNAL_REQUIRED','真实设备操作必须配置持久指令账本',409);
    check(job&&job.ownerId===ctx.ownerId&&job.deviceId===deviceId&&job.mode==='REAL'&&job.paymentState==='PAID_VERIFIED'&&job.paidByVerifiedWebhook===true&&job.engineeringApproved===true&&job.disputeState==='NONE'&&job.refundState==='NONE','REAL_JOB_REQUIRED','必须有已验证付款和已批准工艺的真实工单',409);
    check(ident(job.id)&&/^[a-f0-9]{64}$/.test(job.artifactHash??'')&&typeof job.profileVersion==='string'&&job.profileVersion===job.approvedProfileVersion,'ARTIFACT_MISMATCH','工单文件或工艺版本不一致',409);return d;};
  hub.uploadGcode=async({deviceId,job,bytes}={},ctx)=>{const d=realJob(deviceId,job,ctx);check(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=50*1024*1024,'INVALID_GCODE','加工文件大小无效',400);check(sha(bytes)===job.artifactHash,'ARTIFACT_MISMATCH','加工文件校验失败',409);
    const filename='gz-'+job.artifactHash+'.gcode',fingerprint=sha(JSON.stringify([job.id,deviceId,job.artifactHash,job.profileVersion]));const entry=journal.begin({jobId:job.id,deviceId,kind:'upload',fingerprint});if(entry.replayed)return {...entry,filename};
    try{const boundary='gz'+createHash('sha256').update(fingerprint).digest('hex').slice(0,24);const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${d.protocol==='moonraker'?'root':'select'}"\r\n\r\n${d.protocol==='moonraker'?'gcodes':'false'}\r\n--${boundary}--\r\n`)]);
      const uploaded=await request(d,d.protocol==='moonraker'?'/server/files/upload':'/api/files/local',{method:'POST',bytes:body,headers:{...authorization(d.protocol,d),'content-type':'multipart/form-data; boundary='+boundary}});const remoteName=d.protocol==='moonraker'?uploaded.result?.item?.path:uploaded.files?.local?.name;check(remoteName===filename,'UPLOAD_RESULT_MISMATCH','设备未确认预期的加工文件名',502);journal.finish(entry.id,'SUCCEEDED');return {commandId:entry.id,status:'UPLOADED',filename,artifactHash:job.artifactHash};}
    catch(error){journal.finish(entry.id,'UNKNOWN',error.code);throw new IntegrationError('DEVICE_COMMAND_UNKNOWN','上传结果未确认；请核对设备文件，不自动重试',409);}};
  hub.startPrint=async({deviceId,job,bedClear,materialReady}={},ctx)=>{const d=realJob(deviceId,job,ctx);check(bedClear===true&&materialReady===true,'READINESS_REQUIRED','需确认清台、材料和设备现场状态',409);
    const fingerprint=sha(JSON.stringify([job.id,deviceId,job.artifactHash,job.profileVersion]));const prior=journal.get(job.id,deviceId,'start');if(prior){check(prior.fingerprint===fingerprint,'COMMAND_CONFLICT','同一工单启动指令已绑定不同文件或工艺',409);return {...prior,replayed:true,reconcileRequired:true,observedPrinting:false};}
    const upload=journal.get(job.id,deviceId,'upload');check(upload?.status==='SUCCEEDED'&&upload.fingerprint===fingerprint,'UPLOAD_REQUIRED','必须先上传并确认同一加工文件',409);const state=await hub.deviceStatus({deviceId},ctx);check(state.ready,'DEVICE_NOT_READY','设备当前不适合启动',409);
    const entry=journal.begin({jobId:job.id,deviceId,kind:'start',fingerprint});if(entry.replayed)return entry;const filename='gz-'+job.artifactHash+'.gcode';
    try{if(d.protocol==='moonraker')await request(d,'/printer/print/start',{method:'POST',json:{filename},headers:authorization(d.protocol,d)});else await request(d,'/api/files/local/'+filename,{method:'POST',json:{command:'select',print:true},headers:authorization(d.protocol,d)});journal.finish(entry.id,'ACKNOWLEDGED');return {commandId:entry.id,status:'ACKNOWLEDGED',observedPrinting:false,reconcileRequired:true};}
    catch(error){journal.finish(entry.id,'UNKNOWN',error.code);throw new IntegrationError('DEVICE_COMMAND_UNKNOWN','启动结果未知；必须查询设备核对，禁止自动重新启动',409);}};
  const originalProbe=hub.probe;
  hub.probe=async(service,ctx)=>{try{return await originalProbe(service,ctx);}catch(error){if(owned(ctx)&&CATALOG.some(s=>s[0]===service))observations.set(service,{state:'UNAVAILABLE',checkedAt:clock()});throw error;}};
  return hub;
}
