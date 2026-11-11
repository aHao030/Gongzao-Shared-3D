import { isIP } from 'node:net';
import fs from 'node:fs/promises';

export class GatewayError extends Error {
  constructor(code, message) { super(message); this.name='GatewayError'; this.code=code; }
}
const fail=(code,message)=>{throw new GatewayError(code,message);};
export function isPrivateIPv4(value) {
  if(isIP(value)!==4)return false;
  const [a,b]=value.split('.').map(Number);
  return a===10 || a===172&&b>=16&&b<=31 || a===192&&b===168;
}
export function normalizeEndpoint(value,{allowLoopback=false}={}) {
  if(typeof value!=='string'||value.length>512)fail('INVALID_ENDPOINT','设备地址格式不正确');
  let url;try{url=new URL(value);}catch{fail('INVALID_ENDPOINT','设备地址格式不正确');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)fail('INVALID_ENDPOINT','设备地址不能包含账户、查询或片段');
  if(!isPrivateIPv4(url.hostname)&&!(allowLoopback&&url.hostname==='127.0.0.1'))fail('INVALID_ENDPOINT','设备地址必须为授权局域网的私有 IPv4 地址');
  if(/%|\\|\/\//.test(url.pathname)||url.pathname.length>160)fail('INVALID_ENDPOINT','设备地址路径不受支持');
  return url.origin+url.pathname.replace(/\/+$/,'');
}
export function normalizePlatform(value) {
  let url;try{url=new URL(value);}catch{fail('INVALID_PLATFORM','平台地址格式不正确');}
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['http:','https:'].includes(url.protocol))fail('INVALID_PLATFORM','平台地址必须是没有路径和凭据的 origin');
  if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))fail('INVALID_PLATFORM','远程平台必须使用 HTTPS');
  return url.origin;
}
export function normalizeTarget(value,{allowLoopback=false}={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||!['moonraker','octoprint'].includes(value.protocol))fail('INVALID_TARGET','设备协议仅支持 Moonraker 或 OctoPrint');
  const endpoint=normalizeEndpoint(value.endpoint,{allowLoopback});
  if(value.apiKey!==undefined&&(typeof value.apiKey!=='string'||value.apiKey.length>512||/[\r\n\0]/.test(value.apiKey)))fail('INVALID_KEY','设备 API Key 格式不正确');
  if(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>80))fail('INVALID_NAME','设备名称过长');
  return {protocol:value.protocol,endpoint,name:value.name?.trim()||'',...(value.apiKey?{apiKey:value.apiKey}:{})};
}
export function normalizeBambuPrinter(value, {allowLoopback=false}={}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_BAMBU_PRINTER','拓竹授权记录格式不正确');
  const host = value.host;
  if (!isPrivateIPv4(host) && !(allowLoopback && host === '127.0.0.1')) fail('INVALID_BAMBU_HOST','请输入打印机所在局域网的 IPv4 地址');
  const serial = typeof value.serial === 'string' ? value.serial.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6,32}$/.test(serial)) fail('INVALID_BAMBU_SERIAL','请核对打印机上显示的完整序列号');
  if (typeof value.accessCode !== 'string' || !/^[A-Za-z0-9]{8}$/.test(value.accessCode)) fail('INVALID_BAMBU_CODE','LAN 访问码须为 8 位字母或数字');
  const fingerprint = value.certificateFingerprint;
  if (fingerprint !== undefined && (typeof fingerprint !== 'string' || !/^(?:[\da-f]{64}|(?:[\da-f]{2}:){31}[\da-f]{2})$/i.test(fingerprint))) {
    fail('INVALID_BAMBU_CERTIFICATE','设备证书 SHA-256 指纹格式不正确');
  }
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 80 || /[\x00-\x1f\x7f]/.test(value.name))) fail('INVALID_NAME','设备名称含无效字符或过长');
  return { host, serial, accessCode:value.accessCode,
    ...(fingerprint ? { certificateFingerprint:fingerprint.replaceAll(':','').toUpperCase() } : {}),
    ...(value.name?.trim() ? { name:value.name.trim() } : {}) };
}
export function validateConfig(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_CONFIG','网关配置必须是 JSON 对象');
  const platformUrl=normalizePlatform(value.platformUrl);
  if(typeof value.token!=='string'||value.token.length<32||value.token.length>2048||/\s/.test(value.token))fail('INVALID_TOKEN','请使用商家工作台生成的网关凭据');
  if(value.siteAccessToken!==undefined&&(typeof value.siteAccessToken!=='string'||value.siteAccessToken.length<16||value.siteAccessToken.length>8192||/\s/.test(value.siteAccessToken)))fail('INVALID_SITE_ACCESS','站点服务访问凭据格式不正确');
  if(value.mdns!==undefined&&typeof value.mdns!=='boolean')fail('INVALID_CONFIG','mdns 必须为布尔值');
  if(value.bambuLan!==undefined&&typeof value.bambuLan!=='boolean')fail('INVALID_CONFIG','bambuLan 必须为布尔值');
  if(value.bambuPrinters!==undefined&&(!Array.isArray(value.bambuPrinters)||value.bambuPrinters.length>100))fail('TOO_MANY_BAMBU_PRINTERS','每台网关最多配置 100 台拓竹授权设备');
  if(value.allowLoopbackTargets!==undefined&&typeof value.allowLoopbackTargets!=='boolean')fail('INVALID_CONFIG','allowLoopbackTargets 必须为布尔值');
  if(value.targets!==undefined&&(!Array.isArray(value.targets)||value.targets.length>32))fail('TOO_MANY_TARGETS','每次最多检测 32 个设备地址');
  const allowLoopbackTargets=value.allowLoopbackTargets===true;
  const targets=(value.targets||[]).map(target=>normalizeTarget(target,{allowLoopback:allowLoopbackTargets}));
  const bambuPrinters=(value.bambuPrinters || []).map(printer=>normalizeBambuPrinter(printer,{allowLoopback:allowLoopbackTargets}));
  if(new Set(bambuPrinters.map(p=>p.host)).size !== bambuPrinters.length || new Set(bambuPrinters.map(p=>p.serial)).size !== bambuPrinters.length) fail('DUPLICATE_BAMBU_PRINTER','局域网地址或打印机序列号重复，请核对授权清单');
  return {platformUrl,token:value.token,...(value.siteAccessToken?{siteAccessToken:value.siteAccessToken}:{}),mdns:value.mdns!==false,allowLoopbackTargets,targets,bambuLan:value.bambuLan!==false,bambuPrinters};
}
export async function loadConfig(filename,{useEnvironment=true}={}) {
  const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>262144)fail('CONFIG_TOO_LARGE','请使用不超过 256 KiB 的普通网关配置文件');
  let value;try{value=JSON.parse(await fs.readFile(filename,'utf8'));}catch{fail('INVALID_CONFIG','无法解析网关 JSON 配置');}
  if(value && useEnvironment && !value.siteAccessToken&&process.env.GONGZAO_SITE_ACCESS_TOKEN)value.siteAccessToken=process.env.GONGZAO_SITE_ACCESS_TOKEN;
  return validateConfig(value);
}
