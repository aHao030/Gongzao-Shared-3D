import fs from 'node:fs/promises';
import { isIP } from 'node:net';

export class IntegrationError extends Error {
  constructor(code,message,status=409){super(message);this.name='IntegrationError';this.code=code;this.status=status;}
}
export const check=(ok,code,message,status)=>{if(!ok)throw new IntegrationError(code,message,status);};
export const SERVICE_IDS=['spoolman','fdmMonster','obico','karrio','hyperswitch'];
export function publicAddress(ip){
  if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);}
  // Accept only global-unicast IPv6; mapped/loopback/link-local/ULA are explicit allowlist only.
  if(isIP(ip)===6)return /^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:db8:/i.test(ip);
  return false;
}
function origin(value){let u;try{u=new URL(value);}catch{throw new IntegrationError('INVALID_CONFIG','服务地址格式无效',400);}
  check(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash,'INVALID_CONFIG','服务地址只允许 HTTP(S)，不能含凭据、查询或片段',400);
  check(!/%|\\|\/\//.test(u.pathname)&&!u.pathname.split('/').includes('..'),'INVALID_CONFIG','服务地址路径无效',400);return u;}
export function validateIntegrationConfig(raw={},env=process.env){
  check(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_CONFIG','集成配置必须是对象',400);
  const allow=raw.allowPrivateOrigins??[];check(Array.isArray(allow)&&allow.length<=64,'INVALID_CONFIG','私网白名单无效',400);
  const allowPrivateOrigins=allow.map(value=>{const u=origin(value);check(u.pathname==='/','INVALID_CONFIG','私网白名单只填写 origin',400);return u.origin;});
  const ownerId=typeof raw.ownerId==='string'?raw.ownerId.trim():'';check(ownerId.length<=200,'INVALID_CONFIG','工作空间标识无效',400);
  const services={};const parse=(id,s)=>{check(s&&typeof s==='object'&&!Array.isArray(s),'INVALID_CONFIG','服务配置必须是对象',400);if(!s.baseUrl)return null;
    const u=origin(s.baseUrl);check(u.protocol==='https:'||allowPrivateOrigins.includes(u.origin),'INSECURE_SERVICE','HTTP 服务必须在管理员私网 origin 白名单内',400);
    if(isIP(u.hostname.replace(/^\[|\]$/g,''))&&!publicAddress(u.hostname.replace(/^\[|\]$/g,'')))check(allowPrivateOrigins.includes(u.origin),'PRIVATE_SERVICE_DENIED','私网服务需显式授权 origin',400);
    let apiKey=s.apiKey||'';if(s.apiKeyEnv){check(/^[A-Z][A-Z0-9_]{1,100}$/.test(s.apiKeyEnv),'INVALID_CONFIG','密钥环境变量名无效',400);apiKey=env[s.apiKeyEnv]||'';}
    check(typeof apiKey==='string'&&apiKey.length<=8192&&!/[\r\n\0]/.test(apiKey),'INVALID_CONFIG','服务密钥格式无效',400);
    const paymentMode=s.mode??'test';if(id==='hyperswitch')check(paymentMode==='test','LIVE_PAYMENTS_DISABLED','本版本仅开放支付测试通道',400);
    return {baseUrl:u.origin+u.pathname.replace(/\/+$/,''),apiKey,mode:paymentMode,profileId:typeof s.profileId==='string'?s.profileId:'',allowLivePrint:s.allowLivePrint===true};};
  for(const id of SERVICE_IDS)if(raw.services?.[id])services[id]=parse(id,raw.services[id]);
  const devices=(raw.devices??[]);check(Array.isArray(devices)&&devices.length<=32,'INVALID_CONFIG','最多配置32台设备',400);
  const parsed=devices.map(d=>{check(d&&/^[A-Za-z0-9_-]{1,100}$/.test(d.id??'')&&['moonraker','octoprint'].includes(d.protocol),'INVALID_CONFIG','设备标识或协议无效',400);const connection=parse(d.protocol,d);check(connection,'INVALID_CONFIG','设备地址不能为空',400);return {id:d.id,name:typeof d.name==='string'?d.name.slice(0,80):d.id,protocol:d.protocol,...connection};});
  check(new Set(parsed.map(d=>d.id)).size===parsed.length,'INVALID_CONFIG','设备标识不可重复',400);
  const configured=Object.values(services).some(Boolean)||parsed.length>0;
  check(!configured||ownerId,'OWNER_BINDING_REQUIRED','外部服务必须绑定本地工作空间 ownerId',400);
  return {ownerId,allowPrivateOrigins,services,devices:parsed,timeoutMs:Math.min(30000,Math.max(500,Number(raw.timeoutMs)||8000)),maxResponseBytes:1024*1024};
}
export async function loadIntegrationConfig(filename=process.env.GONGZAO_INTEGRATIONS_CONFIG||'integrations.config.json',env=process.env){
  try {const stat=await fs.stat(filename);check(stat.size<=65536,'INVALID_CONFIG','集成配置文件过大',400);return validateIntegrationConfig(JSON.parse(await fs.readFile(filename,'utf8')),env);}
  catch(error){if(error.code==='ENOENT')return validateIntegrationConfig({},env);if(error instanceof IntegrationError)throw error;throw new IntegrationError('INVALID_CONFIG','无法读取集成配置，请检查管理员配置文件',400);}
}
