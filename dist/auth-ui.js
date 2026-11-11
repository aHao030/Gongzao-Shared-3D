const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providerMarks = {wechat:'微',alipay:'支',x:'𝕏',apple:'A',qq:'QQ',google:'G'};
export function safeAuthPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : null;
}

/** Authentication requests deliberately bypass the persisted mutation queue. */
export async function authRequest(path, payload) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/auth/' + path, {method:payload === undefined ? 'GET' : 'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(payload === undefined ? {} : {'Content-Type':'application/json'})},...(payload === undefined ? {} : {body:JSON.stringify(payload)})});
    let result;
    try { result = await response.json(); } catch { throw new Error('登录服务暂不可用，请重试。'); }
    if (!response.ok || result.error) throw new Error(result.error?.message || '登录未成功，请重试。');
    return result;
  } catch (error) {
    if(error.name === 'AbortError') throw new Error('登录请求超时，请重试。');
    if(error instanceof TypeError) throw new Error('无法连接登录服务，请检查连接。');
    throw error;
  } finally {clearTimeout(timer);}
}

export function createAuthUI({render, resetWorkspace = () => {}}) {
  const state = {config:null,session:null,loaded:false,loading:false,error:'',mode:'login',busy:false};
  const $ = selector => document.querySelector(selector);
  const isRoute = () => /^\/(?:login|account\/login)\/?$/.test(location.pathname);
  const merchantRoute = () => /^\/merchant(?:\/|$)/.test(location.pathname);
  const authenticated = () => state.session?.authenticated === true;
  const callbackError=['OIDC_FAILED','OIDC_FLOW_INVALID','AUTH_UNAVAILABLE'].includes(new URLSearchParams(location.search||'').get('auth_error'))?'第三方登录未完成或已过期，请重新开始。':'';
  let loadTask;
  async function load() {
    if(loadTask)return loadTask;
    state.loading=true;
    loadTask=(async()=>{
      try { [state.config,state.session]=await Promise.all([authRequest('config'),authRequest('session')]);state.loaded=true;state.error=''; }
      catch(error){state.error=error.message;}
      finally{state.loading=false;loadTask=null;render();}
    })();
    return loadTask;
  }
  function providerList() {
    return '<div class="auth-provider-heading">其他登录方式</div><div class="auth-providers">'+(state.config?.providers||[]).map(provider=>{
      const path=provider.enabled&&safeAuthPath(provider.authorizationPath),label=escape(provider.label);
      const content='<span class="auth-provider-mark" aria-hidden="true">'+escape(providerMarks[provider.id]||'↗')+'</span><span>'+label+'</span>'+(path?'':'<small>待开通</small>');
      return path?'<a class="auth-provider" href="'+escape(path+(path.includes('?')?'&':'?')+'returnTo='+encodeURIComponent(merchantRoute()?'/merchant':'/'))+'" aria-label="使用'+label+'登录">'+content+'</a>':'<button type="button" class="auth-provider" disabled aria-label="'+label+'登录尚未开通">'+content+'</button>';
    }).join('')+'</div>';
  }
  function identity() {
    if(!authenticated())return '';
    const hosted=state.config?.mode==='HOSTED_PLATFORM';
    return '<div class="auth-identity"><span class="auth-identity-check" aria-hidden="true">✓</span><div><strong>'+escape(hosted?'已通过平台登录':state.session.user?.displayName||state.session.user?.email||'已登录')+'</strong><span>'+escape(hosted?'当前身份由平台验证':state.session.user?.email||'账号身份已验证')+'</span></div><button class="text-link" data-auth-action="logout">退出</button></div>';
  }
  function renderPanel({merchant=false}={}) {
    const title=merchant?'商家登录':'登录共造';
    if(!state.loaded)return '<div class="auth-panel"><h2>'+title+'</h2><p class="login-description">'+(state.error?escape(state.error):'正在连接账号服务…')+'</p>'+(state.error?'<button class="btn primary full" data-auth-action="retry">重新连接</button>':'')+'</div>';
    if(authenticated())return '<div class="auth-panel"><h2>你的账号</h2>'+identity()+(state.error?'<p class="error-text" role="alert">'+escape(state.error)+'</p>':'')+'<p class="login-description">'+(merchant?'已完成账号登录。店铺资料与商家资质独立管理。':'账号资料与作品保存在当前工作空间。')+'</p>'+(merchant?'':'<a class="btn primary full" href="/">进入创作空间</a>')+'<details class="auth-alternatives"><summary>其他登录方式</summary>'+providerList()+'<p class="auth-help">'+escape(state.config.notice||'第三方渠道配置后开放。')+'</p></details></div>';
    const registering=state.mode==='register',emailEnabled=state.config.emailPassword?.enabled;
    let body='<div class="auth-panel">'+(callbackError?'<p class="error-text" role="alert">'+callbackError+'</p>':'')+'<h2>'+title+'</h2><p class="login-description">'+(merchant?'一个账号，连接你的制造工作。':'从你的下一个想法开始。')+'</p>';
    if(emailEnabled){
      body+='<div class="auth-tabs" role="group" aria-label="登录或注册"><button type="button" data-auth-action="login-mode" aria-pressed="'+(!registering)+'">邮箱登录</button><button type="button" data-auth-action="register-mode" aria-pressed="'+registering+'" '+(state.config.emailPassword.registrationEnabled?'':'disabled')+'>创建账号</button></div><form id="auth-form" class="auth-form">'+(registering?'<label for="auth-name">称呼（选填）</label><input class="input" id="auth-name" maxlength="64" autocomplete="nickname"/>':'')+'<label for="auth-email">邮箱地址</label><input class="input" id="auth-email" name="username" type="email" required maxlength="254" autocomplete="username" placeholder="QQ 邮箱、Gmail 或其他邮箱"/><label for="auth-password">共造账号密码</label><input class="input" id="auth-password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="'+(registering?'new-password':'current-password')+'" aria-describedby="auth-password-note"/><p class="auth-help" id="auth-password-note">'+(registering?'设置 12–128 个字符的共造密码，请勿使用邮箱密码。':'填写注册共造时设置的密码，不是 QQ 或 Gmail 邮箱密码。')+'</p>'+(registering?'<label for="auth-password-confirm">确认密码</label><input class="input" id="auth-password-confirm" type="password" required minlength="12" maxlength="128" autocomplete="new-password"/>':'')+(registering&&state.session.legacyWorkspaceAvailable?'<label class="auth-adopt"><input id="auth-adopt" type="checkbox"/><span>将此浏览器原有的沙盒订单、设备和店铺资料归入新账号。仅在这些资料属于你时选择；不勾选将创建新空间。</span></label>':'')+'<div id="auth-error" class="error-text" role="alert"></div><button type="submit" class="btn primary full">'+(registering?'创建账号并登录':'登录')+' <span aria-hidden="true">→</span></button></form><p class="auth-help auth-mail-note">当前未接入邮件验证与密码找回。注册无需等待邮件。</p>';
    }else if(state.config.platform?.enabled){
      const path=safeAuthPath(state.config.platform.signInUrl);
      body+='<p class="auth-hosted-note">此在线预览使用平台身份登录。独立部署版支持邮箱密码与配置后的第三方账号。</p>'+(path?'<a class="btn primary full" href="'+escape(path)+'">通过平台登录</a>':'<p>请重新打开平台登录入口。</p>');
    }
    body+='<details class="auth-alternatives"><summary>其他登录方式</summary>'+providerList()+'<p class="auth-help auth-provider-note">'+escape(state.config.notice||'第三方登录需配置并审核后开通。')+'</p></details></div>';
    return body;
  }
  function renderPage(){return '<div class="merchant-login account-login"><div class="login-story"><div class="eyebrow">YOUR COFORGE ACCOUNT</div><h1>让创意，成真。</h1><p>保存作品，查看订单。<br/>连接与你合拍的制造者。</p></div><section class="login-card">'+renderPanel()+'<a class="text-link auth-return" href="/">返回创作空间 →</a></section></div>';}
  function captureForm(){
    const form=$('#auth-form');if(!form)return null;
    return ['auth-email','auth-password','auth-password-confirm','auth-name','auth-adopt'].map(id=>{const node=$('#'+id);return node?{id,value:node.value,checked:node.checked,focused:document.activeElement===node}:null;}).filter(Boolean);
  }
  function restoreForm(fields){for(const field of fields||[]){const node=$('#'+field.id);if(node){node.value=field.value;node.checked=field.checked;if(field.focused)node.focus({preventScroll:true});}}}
  function setBusy(busy){state.busy=busy;document.querySelectorAll('#auth-form input,#auth-form button,[data-auth-action]').forEach(node=>{if(busy){node.dataset.authWasDisabled=node.disabled?'true':'false';node.disabled=true;}else if(node.dataset.authWasDisabled!==undefined){node.disabled=node.dataset.authWasDisabled==='true';delete node.dataset.authWasDisabled;}});}
  async function submit(){
    if(state.busy)return;const form=$('#auth-form');if(!form?.reportValidity())return;
    const email=$('#auth-email').value.trim(),password=$('#auth-password').value,registering=state.mode==='register',errorNode=$('#auth-error');errorNode.textContent='';
    if(registering&&password!==$('#auth-password-confirm').value){errorNode.textContent='两次输入的密码不一致。';$('#auth-password-confirm').focus();return;}
    const payload={email,password,...(registering?{displayName:$('#auth-name').value.trim(),...($('#auth-adopt')?.checked?{adoptLegacyWorkspace:true}:{})}:{})};
    setBusy(true);
    try{state.session=await authRequest(registering?'register':'login',payload);$('#auth-password').value='';if($('#auth-password-confirm'))$('#auth-password-confirm').value='';resetWorkspace();location.assign(merchantRoute()?'/merchant':'/');}
    catch(error){errorNode.textContent=error.message;setBusy(false);}
  }
  async function logout(){
    if(state.busy)return;
    if(state.config?.mode==='HOSTED_PLATFORM'){
      const path=safeAuthPath(state.config.platform?.signOutUrl);if(path){resetWorkspace();location.assign(path);}return;
    }
    setBusy(true);
    try{await authRequest('logout',{});state.session=null;resetWorkspace();location.assign('/login');}
    catch(error){state.error=error.message;setBusy(false);render();}
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-auth-action]');if(!target||state.busy)return;event.preventDefault();
    const action=target.dataset.authAction;
    if(action==='retry')return load();if(action==='logout')return logout();
    if(action==='login-mode'||action==='register-mode'){if(action==='register-mode'&&!state.config?.emailPassword?.registrationEnabled)return;state.mode=action==='register-mode'?'register':'login';const form=$('#auth-form');if(form)form.remove();render();}
  });
  document.addEventListener('submit',event=>{if(event.target.id==='auth-form'){event.preventDefault();submit();}});
  return {state,load,isRoute,authenticated,renderPanel,renderPage,identity,captureForm,restoreForm,logout};
}
