import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from './config.mjs';
import { discoverDevices, monitorBambuDevices } from './discovery.mjs';
import { GatewayClient } from './client.mjs';

// The local wizard can update, remove or rotate credentials while the farmer's
// original gateway window stays open. Never probe with a stale configuration.
export function createPollCycle(filename, {load=loadConfig, clientFor=config=>new GatewayClient(config), discover=discoverDevices, monitor=monitorBambuDevices}={}) {
  let current, client;
  return async () => {
    let config=await load(filename);
    if (!current || config.platformUrl!==current.platformUrl || config.token!==current.token || config.siteAccessToken!==current.siteAccessToken) client=clientFor(config);
    else if (isDeepStrictEqual(current,config)) config=current;
    else {
      // A verified DHCP address belongs to an unchanged, locally authorized
      // printer. Reuse only its original object while the access values match.
      const previous=new Map(current.bambuPrinters.map(printer=>[printer.serial,printer]));
      config.bambuPrinters=config.bambuPrinters.map(printer=>{
        const old=previous.get(printer.serial);
        return isDeepStrictEqual(old,printer)?old:printer;
      });
    }
    current=config;
    return client.cycle(command => command.kind === 'monitor-bambu'
      ? monitor(config,command.deviceKeys)
      : discover(config,{onlyBambu:command.autoRegister==='bambu'}),config);
  };
}

export async function runCli(args=process.argv.slice(2),{log=console.log,error=console.error}={}) {
  const index=args.indexOf('--config');
  if(args.includes('--help')||!args.length){log('用法: node services/device-gateway/cli.mjs --config gateway.private.json [--once]\nWindows 双击 BAMBU-GATEWAY-WINDOWS.cmd，或运行 node tools/bambu-gateway.mjs，导入网关配对配置并管理拓竹状态读取授权。');return 0;}
  if(index<0||!args[index+1]||args.some((arg,i)=>!['--config','--once'].includes(arg)&&i!==index+1)){error('参数错误，请使用 --help');return 2;}
  const file=args[index+1];
  try{await loadConfig(file);}catch(e){error('网关配置未加载：'+(e.code||'INVALID_CONFIG'));return 2;}
  const poll=createPollCycle(file);let stopped=false,timer,release;
  const stop=()=>{stopped=true;clearTimeout(timer);release?.();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  log('共造设备网关已启动 · 仅发现与状态读取 · 按 Ctrl+C 停止');
  try {
    do {
      let delay=5000;
      try {
        const result=await poll();
        delay=result.pollAfterMs;
        for(const event of result.events)log(`已回报 ${event.count} 项设备观察${event.diagnostics.length?'（部分检测未完成）':''}`);
      }
      catch(e){error('网关请求未完成：'+(e.code||'GATEWAY_REQUEST_FAILED'));if(e.code==='PLATFORM_ACCESS_REQUIRED'){error('私人托管需要站点服务访问凭据，应用网关凭据不能替代。请由操作者配置本机 siteAccessToken。');return 3;}if(e.code==='GATEWAY_AUTH_FAILED')return 3;}
      if(args.includes('--once')||stopped)break;
      await new Promise(resolve=>{release=resolve;timer=setTimeout(resolve,delay);});release=null;
    }while(!stopped);
  } finally {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await runCli();
