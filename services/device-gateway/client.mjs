import { randomUUID } from 'node:crypto';
import { requestJson } from './discovery.mjs';
import { GatewayError, validateConfig } from './config.mjs';

export class GatewayClient {
  constructor(config,{transport=requestJson,clock=Date.now}={}) {this.config=validateConfig(config);this.transport=transport;this.clock=clock;this.pendingPoll=null;this.results=new Map();}
  async post(route,payload,key) {
    if(!['poll','report'].includes(route))throw new GatewayError('INVALID_ROUTE','网关只允许发现任务接口');
    const url=new URL('/api/v2/gateway/'+route,this.config.platformUrl),body=JSON.stringify(payload);
    let response;
    try{response=await this.transport(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+this.config.token,...(this.config.siteAccessToken?{'OAI-Sites-Authorization':'Bearer '+this.config.siteAccessToken}:{}),'Idempotency-Key':key,'Content-Length':String(Buffer.byteLength(body))},body,timeoutMs:10000,maxBytes:131072});}
    catch(error){if(error.code==='REDIRECT_REFUSED')throw new GatewayError('PLATFORM_ACCESS_REQUIRED','私人托管需要站点服务访问凭据，应用网关凭据不能替代');throw error;}
    if(response.contentType?.includes('text/html'))throw new GatewayError('PLATFORM_ACCESS_REQUIRED','私人托管需要站点服务访问凭据，应用网关凭据不能替代');
    if(response.status!==200)throw new GatewayError(response.status===401||response.status===403?'GATEWAY_AUTH_FAILED':'PLATFORM_REQUEST_FAILED','平台未接受网关请求');
    if(!response.data||typeof response.data!=='object'||Array.isArray(response.data))throw new GatewayError('INVALID_PLATFORM_RESPONSE','平台响应格式不正确');return response.data;
  }
  async cycle(discover) {
    this.pendingPoll ||= 'gw-poll:'+randomUUID();
    const result=await this.post('poll',{},this.pendingPoll);this.pendingPoll=null;
    if(!Array.isArray(result.commands)||result.commands.length>8)throw new GatewayError('INVALID_PLATFORM_RESPONSE','平台命令列表不正确');
    const events=[];
    for(const command of result.commands){
      if(command?.kind!=='discover'||typeof command.id!=='string'||command.id.length>160||!Number.isFinite(command.expiresAt)||command.expiresAt<=this.clock())continue;
      let cached=this.results.get(command.id);
      if(!cached){
        let observation;try{observation=await discover();}catch{observation={candidates:[],diagnostics:['DISCOVERY_FAILED']};}
        const payload={scanId:command.id,candidates:observation.candidates};
        if(observation.diagnostics?.length&&!observation.candidates.length)payload.error={code:'DISCOVERY_UNAVAILABLE',message:'本地发现未完成，请检查网关网络接口或设备地址配置'};
        cached={key:'gw-report:'+randomUUID(),payload,sent:false};this.results.set(command.id,cached);
        if(this.results.size>128)this.results.delete(this.results.keys().next().value);
      }
      if(!cached.sent){const report=await this.post('report',cached.payload,cached.key);if(report.accepted!==true)throw new GatewayError('INVALID_PLATFORM_RESPONSE','平台未确认发现结果');cached.sent=true;}
      events.push({scanId:command.id,count:cached.payload.candidates.length,diagnostics:cached.payload.error?['DISCOVERY_UNAVAILABLE']:[]});
    }
    return {events,pollAfterMs:Math.max(1000,Math.min(30000,Number(result.pollAfterMs)||5000))};
  }
}
