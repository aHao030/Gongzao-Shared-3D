import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { discoverDevices } from './discovery.mjs';
import { GatewayClient } from './client.mjs';

export async function runCli(args=process.argv.slice(2),{log=console.log,error=console.error}={}) {
  const index=args.indexOf('--config');
  if(args.includes('--help')||!args.length){log('用法: node services/device-gateway/cli.mjs --config gateway.private.json [--once]\n只读取设备状态，不上传生产文件、不启动打印。凭据仅保存在本机私有配置中。');return 0;}
  if(index<0||!args[index+1]||args.some((arg,i)=>!['--config','--once'].includes(arg)&&i!==index+1)){error('参数错误，请使用 --help');return 2;}
  let config;try{config=await loadConfig(args[index+1]);}catch(e){error('网关配置未加载：'+(e.code||'INVALID_CONFIG'));return 2;}
  const client=new GatewayClient(config);let stopped=false,timer,release;
  const stop=()=>{stopped=true;clearTimeout(timer);release?.();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  log('共造设备网关已启动 · 仅发现与状态读取 · 按 Ctrl+C 停止');
  try {
    do {
      let delay=5000;
      try {const result=await client.cycle(()=>discoverDevices(config));delay=result.pollAfterMs;for(const event of result.events)log(`发现任务已回报：${event.count} 个设备观察结果${event.diagnostics.length?'（本地发现不可用）':''}`);}
      catch(e){error('网关请求未完成：'+(e.code||'GATEWAY_REQUEST_FAILED'));if(e.code==='PLATFORM_ACCESS_REQUIRED'){error('私人托管需要站点服务访问凭据，应用网关凭据不能替代。请由操作者配置本机 siteAccessToken。');return 3;}if(e.code==='GATEWAY_AUTH_FAILED')return 3;}
      if(args.includes('--once')||stopped)break;
      await new Promise(resolve=>{release=resolve;timer=setTimeout(resolve,delay);});release=null;
    }while(!stopped);
  } finally {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await runCli();
