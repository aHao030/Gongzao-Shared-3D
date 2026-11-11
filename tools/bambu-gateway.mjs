import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { GatewayError, loadConfig, normalizeBambuPrinter, validateConfig } from '../services/device-gateway/config.mjs';
import { runCli } from '../services/device-gateway/cli.mjs';
import { readBambuStatus } from '../services/device-gateway/bambu-status.mjs';

const help = '共造 · 拓竹农场网关\n在打印机所在局域网的电脑上运行：node tools/bambu-gateway.mjs\n首次从商家工作台「设备 → 连接网关」下载配对配置。';
export function defaultGatewayFile() {
  const directory = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Gongzao')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gongzao');
  return path.join(directory, 'gateway.private.json');
}
const validUserConfirmation = value => /^y(es)?$/i.test(value.trim()) || value.trim() === '确认';

async function existingConfig(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new GatewayError('INVALID_CONFIG_PATH','本机配置路径必须为普通文件。');
    return await loadConfig(file, { useEnvironment:false });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function restrictWindowsFile(file) {
  if (process.platform !== 'win32') return;
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const who = spawnSync(path.join(system,'whoami.exe'), ['/user','/fo','csv','/nh'], {encoding:'utf8',windowsHide:true});
  const sid = who.status === 0 && who.stdout?.match(/\bS-1-[0-9-]+\b/i)?.[0];
  if (!sid) throw new GatewayError('PRIVATE_FILE_ACL','无法识别当前 Windows 用户，未保存凭据。');
  for (const args of [['/grant:r','*'+sid+':F'], ['/inheritance:r']]) {
    const result = spawnSync(path.join(system,'icacls.exe'), [file,...args], {windowsHide:true});
    if (result.status !== 0) throw new GatewayError('PRIVATE_FILE_ACL','无法为当前 Windows 用户设置私有文件权限，未保存凭据。');
  }
}

// Use a short-lived exclusive writer lock. Its contents contain no credentials.
// Compare the original configuration so two open wizards cannot lose an edit.
export async function saveGatewayConfig(file, next, previous) {
  const config = validateConfig(next), directory = path.dirname(file);
  await fs.mkdir(directory, {recursive:true,mode:0o700});
  const parent = await fs.lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new GatewayError('INVALID_CONFIG_PATH','本机配置目录无效。');
  const lock = file+'.lock', tmp = path.join(directory,'.gongzao-'+randomUUID()+'.private.json');
  let handle;
  try { handle = await fs.open(lock,'wx',0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new GatewayError('GATEWAY_SETTINGS_BUSY','配置正在写入。若上一次写入被强制中断，请先关闭其他向导，再删除同目录的 gateway.private.json.lock。');
    throw error;
  }
  try {
    if (JSON.stringify(await existingConfig(file)) !== JSON.stringify(previous)) throw new GatewayError('GATEWAY_CONFIG_CHANGED','配置已在另一个窗口更改，请重新打开向导。');
    const out = await fs.open(tmp,'wx',0o600);
    try {
      restrictWindowsFile(tmp);
      await out.writeFile(JSON.stringify(config,null,2)+'\n','utf8');
      await out.sync();
    } finally { await out.close(); }
    await fs.rename(tmp,file);
  } finally {
    await fs.rm(tmp,{force:true});
    await handle.close();
    await fs.rm(lock,{force:true});
  }
  return config;
}

function terminal() {
  let muted = false;
  const output = new Writable({write(chunk,encoding,done) { if (!muted) process.stdout.write(chunk); done(); }});
  const rl = createInterface({input:process.stdin,output,terminal:true,historySize:0});
  const stop = new AbortController();
  rl.on('SIGINT',()=>{stop.abort(); rl.close();});
  rl.on('close',()=>stop.abort());
  return {
    ask:async (prompt,secret=false)=>{
      if (stop.signal.aborted) throw new GatewayError('CANCELLED','已退出。');
      if (secret) { process.stdout.write(prompt); muted=true; }
      try { return (await rl.question(secret?'':prompt,{signal:stop.signal})).trim(); }
      finally { if (secret) { muted=false; process.stdout.write('\n'); } }
    },
    say:line=>console.log(line),
    close:()=>rl.close()
  };
}

function fromPath(input) {
  const text=input.trim().replace(/^"(.+)"$/,'$1');
  if (!text) throw new GatewayError('EMPTY_PATH','请输入下载文件的完整路径。');
  return path.resolve(text);
}

async function importPairing(current, io) {
  const filename = await io.ask('粘贴商家页面下载的 gateway.private.json 的路径（可拖入窗口）：');
  const incoming = await loadConfig(fromPath(filename),{useEnvironment:false});
  io.say('网关将连接此平台：'+incoming.platformUrl);
  if (current) io.say('导入成功后将替换此网关的现有配对以及本机设备授权。');
  if (!validUserConfirmation(await io.ask('与商家页面域名核对无误后输入 Y：'))) return current;
  return incoming;
}

async function authorizePrinter(config,io,discover) {
  io.say('核对设备序列号及局域网 IP。按回车从本机网络选择，输入 M 可直接填写。');
  const advertised = (await io.ask('选择方式 [回车/M]：')).toUpperCase() !== 'M';
  let selected;
  if (advertised) {
    io.say('正在等待本地打印机广播…');
    const found = await discover();
    for (const [i,item] of found.advertisements.entries()) io.say((i+1)+'. '+item.model+' · '+item.host+' · 序列号尾号 '+item.serial.slice(-6));
    if (found.advertisements.length) {
      const choice = await io.ask('按打印机屏幕上的尾号和 IP 选择序号，按回车手动填写：');
      if (choice) {
        if (!/^[1-9][0-9]*$/.test(choice) || !found.advertisements[Number(choice)-1]) throw new GatewayError('INVALID_SELECTION','设备序号无效。');
        selected=found.advertisements[Number(choice)-1];
      }
    } else io.say('未收到可用的设备广播，可按打印机屏幕上的信息直接填写。');
  }
  const host=selected?.host || await io.ask('打印机局域网 IPv4：');
  const serial=(selected?.serial || await io.ask('打印机机身完整序列号：')).toUpperCase();
  const old=config.bambuPrinters.find(p=>p.serial===serial);
  io.say('即将为 '+host+'、序列号尾号 '+serial.slice(-6)+' 设置只读授权。');
  const accessCode=await io.ask('打印机 LAN 访问码（隐藏输入）：',true);
  const name=await io.ask('设备别名（选填）：');
  io.say('默认使用厂商证书和序列号核验设备。只有通过独立可信途径核对过的设备证书，才填写 SHA-256 指纹。');
  if (old?.certificateFingerprint) io.say('已有固定指纹，回车沿用，输入 CA 可改回厂商证书校验。');
  const pin=await io.ask('设备证书指纹（通常直接回车）：');
  const certificateFingerprint = pin.toUpperCase()==='CA' ? undefined : (pin || old?.certificateFingerprint);
  const printer=normalizeBambuPrinter({serial,host,accessCode,name:name||old?.name||selected?.name,certificateFingerprint});
  return validateConfig({...config,bambuPrinters:[...config.bambuPrinters.filter(p=>p.serial!==serial),printer]});
}

async function chooseConfigured(config,io,prompt) {
  config.bambuPrinters.forEach((p,i)=>io.say((i+1)+'. '+(p.name||'拓竹设备')+' · '+p.host+' · 序列号尾号 '+p.serial.slice(-6)));
  if (!config.bambuPrinters.length) { io.say('请先用选项 2 配置一台设备。'); return null; }
  const value=await io.ask(prompt);
  if (!value) return null;
  if (!/^[1-9][0-9]*$/.test(value)||!config.bambuPrinters[Number(value)-1]) throw new GatewayError('INVALID_SELECTION','设备序号无效。');
  return config.bambuPrinters[Number(value)-1];
}

const statusNames = {idle:'空闲',preparing:'准备中',printing:'打印中',paused:'已暂停',completed:'已完成',failed:'打印失败',unknown:'尚未回报可识别的打印阶段'};
const statusErrors = {
  BAMBU_AUTH_REQUIRED:'打印机拒绝授权。核对本机 LAN 访问码，以及此固件的局域网读取权限。',
  BAMBU_CERTIFICATE_MISMATCH:'证书身份或可信链校验失败。请核对打印机序列号、IP、时钟以及已配置的固定指纹。',
  BAMBU_TRUST_REQUIRED:'缺少受信的设备证书。请从同一版本的完整项目包恢复厂商证书。',
  BAMBU_STATUS_UNAVAILABLE:'订阅已获准，但本次没有收到新的打印状态。请稍后再试。',
  BAMBU_CONNECTION_FAILED:'连接中断或超时。检查两台设备所在网络、打印机电源和局域网服务。',
  BAMBU_PROTOCOL_ERROR:'当前返回的状态协议无法识别，请记录设备型号和固件版本。'
};
async function checkStatus(config,io,readStatus) {
  const printer=await chooseConfigured(config,io,'试读哪台设备（回车取消）：');
  if (!printer) return;
  try {
    const report=await readStatus(printer);
    const progress=Number.isInteger(report.progressPercent)?' · '+report.progressPercent+'%':'';
    io.say('本次设备回报：'+(statusNames[report.printState]??statusNames.unknown)+progress);
  } catch (error) {
    io.say(statusErrors[error.code] || '本次试读未取得设备状态。');
  }
}

export async function gatewayMenu({file=defaultGatewayFile(),io,readStatus=readBambuStatus,discover=async()=>{
  const {discoverBambuLan}=await import('../services/device-gateway/bambu-discovery.mjs');
  return discoverBambuLan();
}}) {
  let config=await existingConfig(file);
  if (!config) {
    const imported=await importPairing(null,io);
    if (!imported) return false;
    config=await saveGatewayConfig(file,imported,null);
  }
  for (;;) {
    io.say('\n'+config.platformUrl+' · 已配置 '+config.bambuPrinters.length+' 台拓竹设备的读取凭据');
    io.say('1 启动网关    2 添加/更新设备授权    3 更换网关配对    4 移除设备授权    5 站点服务令牌    6 试读设备状态    0 退出');
    const choice=await io.ask('请选择（回车启动）：');
    if (!choice || choice==='1') return true;
    if (choice==='0') return false;
    let next;
    try {
      if (choice==='2') next=await authorizePrinter(config,io,discover);
      else if (choice==='3') next=await importPairing(config,io);
      else if (choice==='4') {
        const printer=await chooseConfigured(config,io,'移除本机访问码的设备序号（回车取消）：');
        if (!printer) continue;
        next={...config,bambuPrinters:config.bambuPrinters.filter(p=>p.serial!==printer.serial)};
      } else if (choice==='5') {
        const token=await io.ask('私有托管站点服务令牌（隐藏输入，本地部署留空）：',true);
        next={...config}; if(token) next.siteAccessToken=token; else delete next.siteAccessToken;
      } else if (choice==='6') { await checkStatus(config,io,readStatus); continue; }
      else { io.say('请选择菜单中的编号。'); continue; }
      if (next!==config) config=await saveGatewayConfig(file,next,config);
    } catch(error) {
      if (error.name==='AbortError'||error.code==='CANCELLED'||error.code==='GATEWAY_CONFIG_CHANGED') throw error;
      io.say(error instanceof GatewayError ? error.message : '未保存。请核对本地文件及输入后重试。');
    }
  }
}

async function main() {
  if (process.argv.includes('--help')||!process.stdin.isTTY||!process.stdout.isTTY) { console.log(help); return; }
  console.log(help);
  const io=terminal(), file=defaultGatewayFile();
  let start;
  try { start=await gatewayMenu({file,io}); } finally { io.close(); }
  if (start) process.exitCode=await runCli(['--config',file]);
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{
    if(error.name==='AbortError'||error.code==='CANCELLED') return;
    console.error(error instanceof GatewayError ? error.message : '未能载入本地网关配置。请核对下载的文件和当前用户的目录权限。');
    process.exitCode=1;
  });
}
