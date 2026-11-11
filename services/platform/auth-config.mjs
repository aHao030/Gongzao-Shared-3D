// Safe to bundle into the hosted Worker: no credentials, Node imports or local sessions.
export const AUTH_PROVIDERS = Object.freeze([
  {id:'wechat',label:'微信'}, {id:'alipay',label:'支付宝'}, {id:'x',label:'X'},
  {id:'apple',label:'Apple'}, {id:'qq',label:'QQ'}, {id:'google',label:'Google'}
]);

export function authJSON(value, status=200, extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra
  }});
}

export function publicAuthConfig(mode, oidc=null) {
  const hosted=mode==='HOSTED_PLATFORM';
  const keycloak=!hosted&&oidc?.adapter==='keycloak'&&Boolean(oidc?.providers?.keycloak);
  const providers=keycloak?[...AUTH_PROVIDERS,{id:'keycloak',label:'统一账号'}]:AUTH_PROVIDERS;
  return {
    mode,
    emailPassword:{enabled:!hosted,registrationEnabled:!hosted,emailVerification:false,passwordReset:false,minPasswordLength:12,maxPasswordLength:128},
    platform:{enabled:hosted,signInUrl:hosted?'/signin-with-chatgpt':null,signOutUrl:hosted?'/signout-with-chatgpt':null},
    identityService:{enabled:keycloak,provider:keycloak?'keycloak':null,accountRecovery:keycloak?'IDENTITY_PROVIDER':'NOT_CONFIGURED',mfa:keycloak?'IDENTITY_PROVIDER_POLICY':'NOT_CONFIGURED'},
    accessBoundary:{mode:'OWNER_WORKSPACE',crossMerchantMarketplace:false,merchantEnrollmentRequired:true},
    providers:providers.map(provider=>{
      const enabled=!hosted&&Boolean(oidc?.providers?.[provider.id]);
      return {...provider,enabled,status:enabled?'CONFIGURED':'NOT_CONFIGURED',
        authorizationPath:enabled?'/api/auth/oidc/start?provider='+provider.id:null};
    }),
    notice:hosted
      ?'此托管站点通过平台身份验证。微信、支付宝、X、Apple、QQ、Google 独立账号登录需要在独立部署中配置官方应用与身份服务，目前未开通。'
      :keycloak
        ?'统一账号由已配置的身份服务管理；其邮件验证、密码找回和多因素认证按管理员策略执行。本机邮箱账号仍独立保存，尚未接入邮件验证和找回。第三方渠道需单独配置。'
        :'本地沙盒账号使用邮箱与密码登录；QQ 邮箱、Gmail 和其他邮箱均可注册。邮箱尚未验证，找回密码和邮件验证尚未配置。第三方账号仅在管理员完成身份服务配置后可用。'
  };
}

export function hostedAuthSession(request) {
  const id=request.headers.get('oai-authenticated-user-id');
  return {mode:'HOSTED_PLATFORM',authenticated:Boolean(id),user:id?{
    id,email:null,displayName:'平台已验证用户',provider:'hosted-platform',emailVerified:false
  }:null,legacyWorkspaceAvailable:false};
}

export function handleHostedAuth(request) {
  const pathname=new URL(request.url).pathname;
  if(!pathname.startsWith('/api/auth/'))return null;
  if(request.method==='GET'&&pathname==='/api/auth/config')return authJSON(publicAuthConfig('HOSTED_PLATFORM'));
  if(request.method==='GET'&&pathname==='/api/auth/session')return authJSON(hostedAuthSession(request));
  if(request.method==='POST'&&pathname==='/api/auth/logout'){
    const origin=request.headers.get('Origin');
    if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')
      return authJSON({error:{code:'CROSS_ORIGIN_DENIED',message:'拒绝跨站请求'}},403);
    return authJSON({...hostedAuthSession(request),logoutRequired:true,signOutUrl:'/signout-with-chatgpt',message:'请通过平台退出入口完成退出。'});
  }
  return authJSON({error:{code:'HOSTED_AUTH_MANAGED',message:'此站点由托管平台管理身份，请使用平台登录；独立邮箱及第三方登录未在此环境开通。'}},403);
}
