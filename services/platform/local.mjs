import http from 'node:http';
import project from '../../package.json' with { type: 'json' };
import { Readable } from 'node:stream';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SQLiteStore } from './store-sqlite.mjs';
import { handleApi, jsonResponse, isAppEntryPath, staticAssetResponse } from './http.mjs';
import { createLocalAuth, LEGACY_COOKIE } from './auth-local.mjs';
import { loadWorkerAccess, readPrivateJSON } from './local-services.mjs';
import { createIntegrationHub } from '../integrations/index.mjs';

const defaultAssets=fileURLToPath(new URL('../../dist/',import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createPlatformServer({dbPath=process.env.DATA_PATH||'data/platform.sqlite',assetsDir=defaultAssets,clock=Date.now,authConfig,authFetch,workerAccessConfig,integrationConfig,integrationHub,integrationFetch}={}) {
  const workerAccess=loadWorkerAccess(workerAccessConfig);
  const externalPath=process.env.GONGZAO_INTEGRATIONS_CONFIG||process.env.INTEGRATIONS_CONFIG;
  const externalConfig=integrationConfig??readPrivateJSON(externalPath||'integrations.config.json',{optional:!externalPath})??{};
  const integrations=integrationHub??createIntegrationHub({config:externalConfig,fetchImpl:integrationFetch});
  const store=new SQLiteStore(dbPath);
  const auth=createLocalAuth(store,{clock,authConfig,authFetch});
  const server=http.createServer({maxHeaderSize:16384,requestTimeout:30000},async(req,res)=>{
    const reply=async response=>{
      const headers=Object.fromEntries(response.headers),cookies=response.headers.getSetCookie();
      if(cookies.length)headers['set-cookie']=cookies;
      res.writeHead(response.status,headers);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    };
    try {
      const requested=new URL('http://'+(req.headers.host||''));
      if(requested.username||requested.password||requested.host!==req.headers.host)return reply(jsonResponse({error:{code:'INVALID_HOST',message:'访问地址不正确'}},403));
      const configured=auth.publicOrigin?new URL(auth.publicOrigin):null;
      const configuredHost=configured&&requested.host===configured.host;
      if(!configuredHost&&!['127.0.0.1','localhost','terminal.local'].includes(requested.hostname))return reply(jsonResponse({error:{code:'INVALID_HOST',message:'请从本机或管理员配置的地址访问'}},403));
      const base=configuredHost?configured.origin:requested.origin,url=new URL(req.url,base);
      if(url.origin!==base)return reply(jsonResponse({error:{code:'INVALID_TARGET',message:'请求地址不正确'}},403));
      // A linked page returns a static shell. Reading account data still requires a
      // same-origin API request. OAuth callbacks additionally verify browser-bound state.
      const publicPage = ['GET','HEAD'].includes(req.method) && isAppEntryPath(url.pathname);
      const oauthCallback=req.method==='GET'&&url.pathname==='/api/auth/oidc/callback';
      if(!publicPage&&!oauthCallback&&((req.headers.origin&&req.headers.origin!==base)||req.headers['sec-fetch-site']==='cross-site'))return reply(jsonResponse({error:{code:'CROSS_ORIGIN_DENIED',message:'拒绝跨站请求'}},403));
      if(url.pathname.startsWith('/api/')||url.pathname==='/health'){
        const headers=new Headers();for(const [key,value] of Object.entries(req.headers)){if(value&&!key.startsWith('oai-authenticated-user-'))headers.set(key,Array.isArray(value)?value.join(','):value);}
        const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
        if(url.pathname.startsWith('/api/auth/'))return reply(await auth.handle(request,{clientIP:req.socket.remoteAddress||'local'}));
        const account=auth.identity(request);
        let ownerId=account?.owner||auth.legacyOwner(request),setCookie;
        if(url.pathname==='/api/v2/session'&&req.method==='GET'&&!ownerId&&!headers.has('authorization')){
          const fresh=randomBytes(32).toString('hex');ownerId='local_'+randomUUID();store.saveSession(hash(fresh),ownerId,clock()+30*86400000);
          setCookie=LEGACY_COOKIE+'='+fresh+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000'+(base.startsWith('https:')?'; Secure':'');
        }
        const response=await handleApi(request,{store,ownerId,userLabel:account?.display_name||'本地沙盒账户',clock,accountAuthenticated:Boolean(account),workerAccess,integrations});if(setCookie)response.headers.set('Set-Cookie',setCookie);return reply(response);
      }
      if(!['GET','HEAD'].includes(req.method))return reply(new Response('Method not allowed',{status:405}));
      const name=isAppEntryPath(url.pathname)?'index.html':decodeURIComponent(url.pathname).slice(1);
      if(name.includes('/')||name.includes('\\')||!MIME[path.extname(name)])return reply(new Response('Not found',{status:404}));
      const bytes=await fs.readFile(path.join(assetsDir,name));
      return reply(staticAssetResponse(req.method==='HEAD' ? null : bytes, MIME[path.extname(name)]));
    }catch(error){return reply(jsonResponse({error:{code:error.code==='ENOENT'?'NOT_FOUND':'INTERNAL_ERROR',message:error.code==='ENOENT'?'未找到资源':'本地服务错误'}},error.code==='ENOENT'?404:500));}
  });
  return {server,store};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const port=Number(option('--port')||process.env.PORT||3000),host=option('--host')||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535||!['127.0.0.1','0.0.0.0'].includes(host))throw new Error('Invalid local host/port');
  const {server,store}=createPlatformServer();server.listen(port,host,()=>console.log(`共造 v${project.version} 沙盒 http://127.0.0.1:${port} · 模型询价、制造计算与生产中心 · 不执行真实打印或付款`));
  const stop=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
