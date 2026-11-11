import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createPlatformServer} from '../services/platform/local.mjs';
import {handleHostedAuth} from '../services/platform/auth-config.mjs';

const password='Sandbox-password-2026';
const cookieOf=response=>response.headers.getSetCookie().filter(value=>!value.includes('Max-Age=0')).map(value=>value.split(';')[0]).join('; ');
async function harness(t,options={}){
  const instance=createPlatformServer({dbPath:':memory:',...options});
  await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>instance.server.close(resolve));instance.store.close();});
  const base='http://127.0.0.1:'+instance.server.address().port;
  const request=async(path,{method='GET',cookie,body,headers={}}={})=>{
    const response=await fetch(base+path,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
    return {response,data,status:response.status,cookie:cookieOf(response)};
  };
  const register=(email='user-'+randomUUID()+'@qq.com',extra={})=>request('/api/auth/register',{method:'POST',body:{email,password,...extra}});
  return {...instance,base,request,register};
}

test('email credentials create hashed sessions; anonymous merchant access and old sessions after logout fail',async t=>{
  const h=await harness(t);
  const anonymous=await h.request('/api/v2/session');assert.equal(anonymous.status,200);
  assert.equal((await h.request('/api/v2/merchant/session',{cookie:anonymous.cookie})).status,401);
  assert.equal((await h.request('/api/v2/merchant/pricing',{cookie:anonymous.cookie})).status,401);
  const registered=await h.register('Creator@GMAIL.COM');assert.equal(registered.status,201);
  assert.equal(registered.data.user.email,'creator@gmail.com');assert.equal(registered.data.user.emailVerified,false);
  assert.equal(registered.data.mode,'LOCAL_SANDBOX');assert.match(registered.cookie,/^coforge_account=[a-f0-9]{64}$/);
  assert.match(registered.response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  const user=h.store.db.prepare('SELECT * FROM auth_users').get();
  assert.notEqual(user.password_hash,password);assert.equal(user.password_hash.length,128);assert.equal(user.password_salt.length,64);
  const stored=h.store.db.prepare('SELECT token_hash FROM auth_sessions').get();
  assert.notEqual(stored.token_hash,registered.cookie.split('=')[1]);
  assert.equal(stored.token_hash,createHash('sha256').update(registered.cookie.split('=')[1]).digest('hex'));
  assert.equal((await h.request('/api/v2/merchant/session',{cookie:registered.cookie})).status,200);
  const logout=await h.request('/api/auth/logout',{cookie:registered.cookie,method:'POST',body:{}});
  assert.equal(logout.data.authenticated,false);
  assert.equal((await h.request('/api/auth/session',{cookie:registered.cookie})).data.authenticated,false);
  const login=await h.request('/api/auth/login',{method:'POST',body:{email:'creator@gmail.com',password}});
  assert.equal(login.status,200);assert.notEqual(login.cookie,registered.cookie);
  assert.equal(login.data.user.id,registered.data.user.id);
});

test('claiming a browser workspace preserves its owner and revokes every anonymous token for it',async t=>{
  const h=await harness(t),legacy=await h.request('/api/v2/session');
  const legacyOwner=legacy.data.user.id;
  const oldToken=legacy.cookie.split('=')[1];
  assert.equal((await h.request('/api/auth/session',{cookie:legacy.cookie})).data.legacyWorkspaceAvailable,true);
  const extra='a'.repeat(64);h.store.saveSession(createHash('sha256').update(extra).digest('hex'),legacyOwner,Date.now()+60000);
  const result=await h.request('/api/auth/register',{method:'POST',cookie:legacy.cookie,body:{email:'claim@qq.com',password,adoptLegacyWorkspace:true}});
  assert.equal(result.status,201);assert.equal(result.response.headers.getSetCookie().length,2);
  assert.equal(h.store.db.prepare('SELECT owner FROM auth_users').get().owner,legacyOwner);
  assert.equal(h.store.getSession(createHash('sha256').update(oldToken).digest('hex')),null);
  assert.equal(h.store.getSession(createHash('sha256').update(extra).digest('hex')),null);
  const accountSpace=await h.request('/api/v2/session',{cookie:result.cookie});assert.equal(accountSpace.data.user.id,legacyOwner);
  const oldRead=await h.request('/api/v2/workspace',{cookie:legacy.cookie});assert.equal(oldRead.status,401);
  const reClaim=await h.request('/api/auth/register',{method:'POST',cookie:legacy.cookie,body:{email:'other@qq.com',password,adoptLegacyWorkspace:true}});
  assert.equal(reClaim.status,409);assert.equal(reClaim.data.error.code,'WORKSPACE_UNAVAILABLE');
});

test('concurrent registrations cannot double-claim one legacy browser workspace',async t=>{
  const h=await harness(t),legacy=await h.request('/api/v2/session');
  const results=await Promise.all(['one@qq.com','two@qq.com'].map(email=>h.request('/api/auth/register',{method:'POST',cookie:legacy.cookie,body:{email,password,adoptLegacyWorkspace:true}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM auth_users').get().n,1);
});

test('unadopted anonymous workspace stays separate and accounts never merge by email domain',async t=>{
  const h=await harness(t),legacy=await h.request('/api/v2/session');
  const account=await h.register('isolated@qq.com');
  const authenticated=await h.request('/api/v2/session',{cookie:account.cookie});
  assert.notEqual(authenticated.data.user.id,legacy.data.user.id);
  assert.equal((await h.request('/api/v2/session',{cookie:legacy.cookie})).data.user.id,legacy.data.user.id);
  assert.equal((await h.request('/api/auth/session',{cookie:legacy.cookie})).data.authenticated,false);
  assert.equal(account.data.user.provider,'email');
});

test('expired account sessions stop authorizing merchant operations',async t=>{
  let now=Date.now();const h=await harness(t,{clock:()=>now}),account=await h.register();
  now+=8*86400000;
  assert.equal((await h.request('/api/auth/session',{cookie:account.cookie})).data.authenticated,false);
  assert.equal((await h.request('/api/v2/merchant/session',{cookie:account.cookie})).status,401);
});

test('same-origin and bounded JSON checks apply before credentials or sessions mutate',async t=>{
  const h=await harness(t),body={email:'csrf@qq.com',password};
  assert.equal((await h.request('/api/auth/register',{method:'POST',body,headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await h.request('/api/auth/register',{method:'POST',body,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await h.request('/api/auth/register',{method:'POST',body,headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await h.request('/api/auth/register',{method:'POST',body:{...body,padding:'x'.repeat(17000)}})).status,413);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM auth_users').get().n,0);
  const spoof=await h.request('/api/v2/merchant/session',{headers:{'oai-authenticated-user-id':'fake-owner'}});assert.equal(spoof.status,401);
});

test('login errors do not distinguish missing users and incorrect passwords, and attempts throttle',async t=>{
  const h=await harness(t);await h.register('known@qq.com');
  const wrong=await h.request('/api/auth/login',{method:'POST',body:{email:'known@qq.com',password:'Wrong-password-2026'}});
  const missing=await h.request('/api/auth/login',{method:'POST',body:{email:'missing@qq.com',password:'Wrong-password-2026'}});
  assert.equal(wrong.status,401);assert.equal(missing.status,401);assert.deepEqual(wrong.data,missing.data);
  for(let i=0;i<7;i++)assert.equal((await h.request('/api/auth/login',{method:'POST',body:{email:'missing@qq.com',password}})).status,401);
  const throttled=await h.request('/api/auth/login',{method:'POST',body:{email:'missing@qq.com',password}});
  assert.equal(throttled.status,429);assert.equal(throttled.response.headers.get('retry-after'),'900');
});

test('unconfigured third-party, verification and reset endpoints fail closed without secrets',async t=>{
  const h=await harness(t),config=await h.request('/api/auth/config');
  assert.equal(config.data.providers.length,6);assert.ok(config.data.providers.every(p=>!p.enabled&&p.authorizationPath===null));
  assert.equal(config.data.emailPassword.emailVerification,false);assert.equal(config.data.emailPassword.passwordReset,false);
  assert.equal((await h.request('/api/auth/oidc/start?provider=google')).status,503);
  assert.equal((await h.request('/api/auth/reset-password',{method:'POST',body:{email:'someone@qq.com'}})).status,503);
  assert.equal((await h.request('/api/auth/verify-email',{method:'POST',body:{}})).status,503);
});

test('hosted identity remains managed by the platform and logout only provides the platform action',async()=>{
  const base='https://example.chatgpt.site';
  const config=await handleHostedAuth(new Request(base+'/api/auth/config')).json();
  assert.equal(config.mode,'HOSTED_PLATFORM');assert.equal(config.emailPassword.enabled,false);assert.ok(config.providers.every(p=>!p.enabled));
  assert.equal(config.platform.signInUrl,'/signin-with-chatgpt');
  const headers={'oai-authenticated-user-id':'platform-user'};
  const logged=await handleHostedAuth(new Request(base+'/api/auth/session',{headers})).json();
  assert.equal(logged.authenticated,true);assert.equal(logged.user.id,'platform-user');
  const logout=await handleHostedAuth(new Request(base+'/api/auth/logout',{method:'POST',headers})).json();
  assert.equal(logout.authenticated,true);assert.equal(logout.logoutRequired,true);assert.equal(logout.signOutUrl,'/signout-with-chatgpt');
  assert.equal(handleHostedAuth(new Request(base+'/api/auth/login',{method:'POST'})).status,403);
  assert.equal(handleHostedAuth(new Request(base+'/api/auth/logout',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
});
