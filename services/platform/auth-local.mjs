import { tradeReturnPath } from '../../dist/trade-return.js';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {authJSON,publicAuthConfig} from './auth-config.mjs';
import {createOIDCAdapter} from './auth-oidc.mjs';

export const ACCOUNT_COOKIE='coforge_account';
export const LEGACY_COOKIE='coforge_sandbox';
const FLOW_COOKIE='coforge_oidc_flow';
const SESSION_MS=7*86400000,FLOW_MS=10*60000;
const scrypt=promisify(scryptCallback);
const digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const DUMMY_SALT=Buffer.alloc(32,17),DUMMY_HASH=Buffer.alloc(64,29);
const PASSWORD_OPTIONS={N:32768,r:8,p:1,maxmem:128*1024*1024};
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});

export function readCookie(headers,name) {
  const values=(headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));
  if(values.length!==1)return null;
  const value=values[0].slice(name.length+1);
  return /^[a-f0-9]{64}$/.test(value)?value:null;
}

export function loadAuthConfig(supplied) {
  if(supplied!==undefined)return supplied;
  const filename=process.env.GONGZAO_AUTH_CONFIG;
  if(!filename)return {};
  try {
    const bytes=readFileSync(filename);
    if(bytes.length>64*1024)throw new Error('config too large');
    return JSON.parse(bytes.toString('utf8'));
  }catch {return {configurationInvalid:true};}
}

function originFrom(value) {
  if(!value)return null;
  try {
    const url=new URL(value);
    if((url.origin!==value && url.origin+'/'!==value)||url.username||url.password||url.search||url.hash)return null;
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))return null;
    return url.origin;
  }catch {return null;}
}

async function readJSON(request) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
    throw fail(415,'JSON_REQUIRED','请使用 JSON 提交账号信息');
  const length=Number(request.headers.get('content-length')||0);
  if(length>16384)throw fail(413,'AUTH_BODY_TOO_LARGE','账号请求内容过长');
  const reader=request.body?.getReader();
  if(!reader)throw fail(400,'INVALID_AUTH_INPUT','请填写账号信息');
  const parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>16384){await reader.cancel();throw fail(413,'AUTH_BODY_TOO_LARGE','账号请求内容过长');}parts.push(value);}
  try {
    const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
    if(!data||Array.isArray(data)||typeof data!=='object')throw new Error();
    return data;
  }catch {throw fail(400,'INVALID_AUTH_INPUT','账号信息格式不正确');}
}

function emailValue(value) {
  if(typeof value!=='string')return null;
  const email=value.trim().toLowerCase();
  return email.length<=254&&/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)?email:null;
}
function passwordValid(value) {return typeof value==='string'&&value.length>=12&&value.length<=128&&Buffer.byteLength(value)<=512;}
function displayNameValue(value) {
  if(value===undefined||value==='')return '共造用户';
  if(typeof value!=='string'||value.trim().length>64||/[\u0000-\u001f\u007f]/.test(value))throw fail(400,'INVALID_AUTH_INPUT','昵称请使用 1–64 个可见字符');
  return value.trim()||'共造用户';
}
function returnPath(value) {
  const allowed=new Set(['/','/merchant','/merchant/','/merchant/login','/account/login','/login','/admin','/admin/login']);
  return tradeReturnPath(value) || (typeof value==='string'&&allowed.has(value)?value:'/merchant');
}

export function createLocalAuth(store,{clock=Date.now,authConfig,authFetch}={}) {
  const db=store.db,configuration=loadAuthConfig(authConfig)||{};
  let oidc=null,configurationInvalid=Boolean(configuration.configurationInvalid);
  if(configuration.oidc&&configuration.oidc.enabled!==false){try {
    const raw={...configuration.oidc};
    if(raw.clientSecretEnv!==undefined){
      if(typeof raw.clientSecretEnv!=='string'||!/^GONGZAO_[A-Z0-9_]{1,80}$/.test(raw.clientSecretEnv)||raw.clientSecret!==undefined)throw new Error('invalid client secret reference');
      raw.clientSecret=process.env[raw.clientSecretEnv];
    }
    oidc=createOIDCAdapter(raw,{clock,...(authFetch?{fetchImpl:authFetch}:{})});
  }catch {configurationInvalid=true;}}
  const publicOrigin=originFrom(configuration.publicOrigin||oidc?.config?.publicOrigin);
  if(configuration.publicOrigin&&!publicOrigin){configurationInvalid=true;oidc=null;}
  if(oidc&&publicOrigin!==oidc.config.publicOrigin){configurationInvalid=true;oidc=null;}
  const secure=Boolean(publicOrigin?.startsWith('https:'));
  const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
  const clearCookie=name=>cookie(name,'',0);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,owner TEXT NOT NULL UNIQUE,email TEXT UNIQUE,external_email TEXT,display_name TEXT NOT NULL,
      password_salt TEXT,password_hash TEXT,provider TEXT NOT NULL,issuer TEXT,subject TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(issuer,subject)
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE IF NOT EXISTS auth_rate_limits (key TEXT PRIMARY KEY,started_at INTEGER NOT NULL,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_oidc_flows (
      state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,provider TEXT NOT NULL,nonce TEXT NOT NULL,
      verifier TEXT NOT NULL,return_path TEXT NOT NULL,redirect_uri TEXT NOT NULL,expires_at INTEGER NOT NULL
    );
  `);
  let pendingHashes=0;
  const hashPassword=async(password,salt)=>{
    if(pendingHashes>=6)throw fail(429,'AUTH_RATE_LIMITED','请求较多，请稍后重试');
    pendingHashes++;
    try{return await scrypt(password,salt,64,PASSWORD_OPTIONS);}finally{pendingHashes--;}
  };
  const identity=request=>{
    const raw=readCookie(request.headers,ACCOUNT_COOKIE);
    if(!raw)return null;
    return db.prepare('SELECT u.* FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(raw),clock())||null;
  };
  const legacyOwner=request=>{
    const raw=readCookie(request.headers,LEGACY_COOKIE);
    if(!raw)return null;
    const owner=store.getSession(digest(raw),clock());
    if(!owner||db.prepare('SELECT 1 FROM auth_users WHERE owner=?').get(owner))return null;
    return owner;
  };
  const session=(request,user=identity(request))=>({
    mode:'LOCAL_SANDBOX',authenticated:Boolean(user),user:user?{
      id:user.id,email:user.email||user.external_email||null,displayName:user.display_name,provider:user.provider,emailVerified:Boolean(user.email_verified)
    }:null,legacyWorkspaceAvailable:!user&&Boolean(legacyOwner(request))
  });
  const config=()=>{
    const result=publicAuthConfig('LOCAL_SANDBOX',oidc?.config);
    if(configurationInvalid)result.notice+=' 身份服务配置无效，第三方登录已停用。';
    return result;
  };
  const rate=(key,max,window=15*60000)=>{
    const now=clock(),hashed=digest(key);
    db.prepare('DELETE FROM auth_rate_limits WHERE started_at<?').run(now-86400000);
    const row=db.prepare('SELECT started_at,count FROM auth_rate_limits WHERE key=?').get(hashed);
    if(row&&row.started_at>now-window){
      if(row.count>=max)throw fail(429,'AUTH_RATE_LIMITED','尝试次数过多，请稍后再试');
      db.prepare('UPDATE auth_rate_limits SET count=count+1 WHERE key=?').run(hashed);
    }else db.prepare('INSERT INTO auth_rate_limits(key,started_at,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=1').run(hashed,now);
  };
  const newSession=(request,user)=>{
    const old=readCookie(request.headers,ACCOUNT_COOKIE);
    if(old)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(old));
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(clock());
    const fresh=token();db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(digest(fresh),user.id,clock()+SESSION_MS);
    return cookie(ACCOUNT_COOKIE,fresh,SESSION_MS/1000);
  };
  const responseWithSession=(request,user,status=200)=>{
    const response=authJSON(session(request,user),status);
    response.headers.append('Set-Cookie',newSession(request,user));
    return response;
  };
  async function handle(request,{clientIP='local'}={}) {
    const url=new URL(request.url),pathname=url.pathname;
    if(!pathname.startsWith('/api/auth/'))return null;
    let callbackErrorPath = '/account/login';
    let retryTarget = null;
    try {
      if(request.method==='GET'&&pathname==='/api/auth/config')return authJSON(config());
      if(request.method==='GET'&&pathname==='/api/auth/session')return authJSON(session(request));
      if(request.method==='GET'&&pathname==='/api/auth/oidc/start'){
        const provider=url.searchParams.get('provider');
        if(!oidc||!oidc.config.providers?.[provider])throw fail(503,'PROVIDER_NOT_CONFIGURED','此第三方登录尚未配置，请使用邮箱登录');
        if(publicOrigin!==url.origin)throw fail(400,'OIDC_ORIGIN_MISMATCH','请从管理员配置的网站地址开始第三方登录');
        rate('oidc:'+clientIP,20);
        const state=token(),browser=token(),nonce=token(),verifier=randomBytes(32).toString('base64url');
        const redirectUri=publicOrigin+'/api/auth/oidc/callback';
        const location=await oidc.authorizationURL({provider,state,nonce,verifier,redirectUri});
        db.prepare('DELETE FROM auth_oidc_flows WHERE expires_at<=?').run(clock());
        db.prepare('INSERT INTO auth_oidc_flows VALUES (?,?,?,?,?,?,?,?)').run(digest(state),digest(browser),provider,nonce,verifier,returnPath(url.searchParams.get('returnTo')),redirectUri,clock()+FLOW_MS);
        return new Response(null,{status:302,headers:{Location:location,'Set-Cookie':cookie(FLOW_COOKIE,browser,FLOW_MS/1000),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      }
      if(request.method==='GET'&&pathname==='/api/auth/oidc/callback'){
        if(!oidc)throw fail(503,'PROVIDER_NOT_CONFIGURED','第三方登录尚未配置');
        if(publicOrigin!==url.origin)throw fail(400,'OIDC_ORIGIN_MISMATCH','登录回调地址不匹配');
        rate('callback:'+clientIP,30);
        const state=url.searchParams.get('state'),browser=readCookie(request.headers,FLOW_COOKIE);
        if(!state||!/^[a-f0-9]{64}$/.test(state)||!browser)throw fail(400,'OIDC_FLOW_INVALID','登录请求已失效，请重新开始');
        const flow=db.prepare('DELETE FROM auth_oidc_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').get(digest(state),digest(browser),clock());
        if(!flow)throw fail(400,'OIDC_FLOW_INVALID','登录请求已失效，请重新开始');
        retryTarget = tradeReturnPath(flow.return_path);
        if (['/admin', '/admin/login'].includes(flow.return_path)) callbackErrorPath = '/admin/login';
        const code=url.searchParams.get('code');
        if(url.searchParams.has('error')||typeof code!=='string'||!code||code.length>4096)throw fail(400,'OIDC_FAILED','第三方未完成授权，请重新开始');
        const external=await oidc.verifyCallback({code,verifier:flow.verifier,nonce:flow.nonce,redirectUri:flow.redirect_uri});
        // Identity is exclusively issuer + subject. Email is never used to merge accounts.
        let user=db.prepare('SELECT * FROM auth_users WHERE issuer=? AND subject=?').get(external.issuer,external.sub);
        if(!user){
          const id='account_'+randomUUID();
          const email=emailValue(external.email);
          db.prepare("INSERT OR IGNORE INTO auth_users(id,owner,email,external_email,display_name,provider,issuer,subject,email_verified,created_at) VALUES (?,?,NULL,?,?,'oidc',?,?,?,?)")
            .run(id,'account_space_'+randomUUID(),email,displayNameValue(external.displayName?.slice(0,64)),external.issuer,external.sub,email&&external.emailVerified?1:0,clock());
          user=db.prepare('SELECT * FROM auth_users WHERE issuer=? AND subject=?').get(external.issuer,external.sub);
        }
        // Refresh verified claims without using e-mail to merge identities or
        // accepting arbitrary role claims as marketplace authorization.
        const currentEmail=emailValue(external.email);
        db.prepare('UPDATE auth_users SET external_email=?,display_name=?,email_verified=? WHERE id=? AND issuer=? AND subject=?')
          .run(currentEmail,displayNameValue(external.displayName?.slice(0,64)),currentEmail&&external.emailVerified?1:0,user.id,external.issuer,external.sub);
        user=db.prepare('SELECT * FROM auth_users WHERE id=?').get(user.id);
        const response=new Response(null,{status:302,headers:{Location:flow.return_path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
        response.headers.append('Set-Cookie',newSession(request,user));response.headers.append('Set-Cookie',clearCookie(FLOW_COOKIE));
        return response;
      }
      if(request.method!=='POST')throw fail(405,'METHOD_NOT_ALLOWED','此操作需要 POST 请求');
      if(!['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(pathname))
        throw fail(503,'AUTH_FEATURE_UNAVAILABLE','邮件验证或找回密码服务尚未配置，请联系本机管理员');
      const body=await readJSON(request);
      if(pathname==='/api/auth/logout'){
        const raw=readCookie(request.headers,ACCOUNT_COOKIE);
        if(raw)db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(raw));
        const response=authJSON(session(request,null));response.headers.append('Set-Cookie',clearCookie(ACCOUNT_COOKIE));return response;
      }
      const email=emailValue(body.email),validPassword=passwordValid(body.password);
      rate('auth-ip:'+clientIP,40);rate(pathname+':'+clientIP+':'+(email||'invalid'),8);
      if(pathname==='/api/auth/login'){
        const user=email?db.prepare("SELECT * FROM auth_users WHERE email=? AND provider='email'").get(email):null;
        const supplied=await hashPassword(validPassword?body.password:'invalid-password-input',user?Buffer.from(user.password_salt,'hex'):DUMMY_SALT);
        const matches=timingSafeEqual(supplied,user?Buffer.from(user.password_hash,'hex'):DUMMY_HASH);
        if(!user||!validPassword||!matches)throw fail(401,'INVALID_CREDENTIALS','邮箱或密码不正确');
        return responseWithSession(request,user);
      }
      if(identity(request))throw fail(409,'ALREADY_AUTHENTICATED','请先退出当前账号，再注册新账号');
      if(!email||!validPassword)throw fail(400,'INVALID_AUTH_INPUT','请输入有效邮箱，密码长度为 12–128 个字符');
      if(body.adoptLegacyWorkspace!==undefined&&typeof body.adoptLegacyWorkspace!=='boolean')throw fail(400,'INVALID_AUTH_INPUT','工作空间选择格式不正确');
      const name=displayNameValue(body.displayName),salt=randomBytes(32),hashed=await hashPassword(body.password,salt);
      // All owner claims and legacy-session revocation happen in the same transaction.
      // Recheck the browser-held token after hashing; a competing signup may have claimed it.
      db.exec('BEGIN IMMEDIATE');
      try {
        if(db.prepare('SELECT 1 FROM auth_users WHERE email=?').get(email))throw fail(409,'REGISTRATION_UNAVAILABLE','暂时无法使用这些信息注册，请尝试登录或使用其他邮箱');
        let owner='account_space_'+randomUUID();
        if(body.adoptLegacyWorkspace){
          owner=legacyOwner(request);
          if(!owner)throw fail(409,'WORKSPACE_UNAVAILABLE','原浏览器空间不可绑定，请刷新后重试或创建独立账号空间');
        }
        const id='account_'+randomUUID();
        db.prepare("INSERT INTO auth_users(id,owner,email,display_name,password_salt,password_hash,provider,created_at) VALUES (?,?,?,?,?,?,'email',?)")
          .run(id,owner,email,name,salt.toString('hex'),hashed.toString('hex'),clock());
        const user=db.prepare('SELECT * FROM auth_users WHERE id=?').get(id);
        if(body.adoptLegacyWorkspace)db.prepare('DELETE FROM local_sessions WHERE owner=?').run(owner);
        const response=responseWithSession(request,user,201);
        if(body.adoptLegacyWorkspace)response.headers.append('Set-Cookie',clearCookie(LEGACY_COOKIE));
        db.exec('COMMIT');return response;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }catch(error){
      if(pathname==='/api/auth/oidc/callback')return new Response(null,{status:302,headers:{
        Location:callbackErrorPath+'?auth_error=OIDC_FAILED'+(retryTarget?'&returnTo='+encodeURIComponent(retryTarget):''),'Set-Cookie':clearCookie(FLOW_COOKIE),
        'Cache-Control':'no-store','Referrer-Policy':'no-referrer'
      }});
      const known=error.status&&error.code;
      return authJSON({error:{code:known?error.code:'AUTH_UNAVAILABLE',message:known?error.message:'身份服务暂不可用，请稍后重试'}},known?error.status:503,
        error.status===429?{'Retry-After':'900'}:{});
    }
  }
  return {handle,identity,legacyOwner,session,config,publicOrigin};
}
