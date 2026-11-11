import http from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SQLiteStore } from './store-sqlite.mjs';
import { handleApi, jsonResponse } from './http.mjs';

const defaultAssets=fileURLToPath(new URL('../../dist/',import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const COOKIE='coforge_sandbox';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createPlatformServer({dbPath=process.env.DATA_PATH||'data/platform.sqlite',assetsDir=defaultAssets,clock=Date.now}={}) {
  const store=new SQLiteStore(dbPath);
  const server=http.createServer({maxHeaderSize:16384,requestTimeout:30000},async(req,res)=>{
    const reply=async response=>{res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();};
    try {
      const hostname=(req.headers.host||'').split(':')[0];
      if(!['127.0.0.1','localhost','terminal.local'].includes(hostname))return reply(jsonResponse({error:{code:'INVALID_HOST',message:'本地沙盒只接受本机地址'}},403));
      const base='http://'+req.headers.host,url=new URL(req.url,base);
      if((req.headers.origin&&req.headers.origin!==base)||req.headers['sec-fetch-site']==='cross-site')return reply(jsonResponse({error:{code:'CROSS_ORIGIN_DENIED',message:'拒绝跨站请求'}},403));
      if(url.pathname.startsWith('/api/')||url.pathname==='/health'){
        const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
        let ownerId=token&&token.length===64?store.getSession(hash(token),clock()):null,setCookie;
        if(url.pathname==='/api/v2/session'&&req.method==='GET'&&!ownerId){
          const fresh=randomBytes(32).toString('hex');ownerId='local_'+randomUUID();store.saveSession(hash(fresh),ownerId,clock()+30*86400000);
          setCookie=COOKIE+'='+fresh+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000';
        }
        const headers=new Headers();for(const [key,value] of Object.entries(req.headers)){if(value&&!key.startsWith('oai-authenticated-user-'))headers.set(key,Array.isArray(value)?value.join(','):value);}
        const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
        const response=await handleApi(request,{store,ownerId,userLabel:'本地沙盒账户',clock});if(setCookie)response.headers.set('Set-Cookie',setCookie);return reply(response);
      }
      if(!['GET','HEAD'].includes(req.method))return reply(new Response('Method not allowed',{status:405}));
      const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
      if(name.includes('/')||name.includes('\\')||!MIME[path.extname(name)])return reply(new Response('Not found',{status:404}));
      const bytes=await fs.readFile(path.join(assetsDir,name));
      return reply(new Response(req.method==='HEAD'?null:bytes,{headers:{'Content-Type':MIME[path.extname(name)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}}));
    }catch(error){return reply(jsonResponse({error:{code:error.code==='ENOENT'?'NOT_FOUND':'INTERNAL_ERROR',message:error.code==='ENOENT'?'未找到资源':'本地服务错误'}},error.code==='ENOENT'?404:500));}
  });
  return {server,store};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const port=Number(option('--port')||process.env.PORT||3000),host=option('--host')||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535||!['127.0.0.1','0.0.0.0'].includes(host))throw new Error('Invalid local host/port');
  const {server,store}=createPlatformServer();server.listen(port,host,()=>console.log(`共造 v0.2 沙盒 http://127.0.0.1:${port} · SQLite 数据持久化 · 不执行真实打印或付款`));
  const stop=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
