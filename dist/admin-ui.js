import { authRequest, authFieldErrors, safeAuthPath } from './auth-ui.js';
import { showFieldErrors, hasFieldError, updateFieldError } from './form-feedback.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
const roles = { owner:'首位管理员', operator:'运维管理员', auditor:'只读审计员' };
const states = { NEVER_CONNECTED:'等待首次心跳', ONLINE:'在线', OFFLINE:'离线', DISABLED:'已暂停', REVOKED:'已撤销' };
const actionLabels = {'member.grant':'授予或更新权限','member.revoke':'撤销权限','node.create':'登记服务器','node.rotate':'轮换接入凭据','node.disable':'暂停接入','node.revoke':'撤销接入','intake.set':'调整新订单受理'};
const tabNames = { overview:'概览', nodes:'服务器', members:'权限', audit:'操作记录' };
const date = value => Number.isFinite(value) ? new Intl.DateTimeFormat('zh-CN', {dateStyle:'short',timeStyle:'medium'}).format(value) : '无记录';
const button = (action, label, kind = '', attrs = '') => '<button type="button" data-op="'+esc(action)+'" class="'+esc(kind)+'" '+attrs+'>'+esc(label)+'</button>';
const field = (id, label, control) => '<div class="field"><label for="'+id+'">'+label+'</label>'+control+'</div>';
const summary = '<div role="alert" id="form-errors" class="form-error-summary" hidden></div>';
const help = text => '<p class="help">'+esc(text)+'</p>';
const idText = id => '<code class="mono" dir="ltr">'+esc(id)+'</code>';
const stat = (label, value) => '<div><span class="meta">'+esc(label)+'</span><strong>'+esc(Number.isSafeInteger(value) ? value : '—')+'</strong></div>';

export function permittedTabs(session) {
  return ['overview', 'nodes', ...(session?.permissions?.manageMembers ? ['members'] : []), ...(session?.permissions?.viewAudit ? ['audit'] : [])];
}

export function formErrors(action, values) {
  if (action === 'login') return authFieldErrors(values);
  const out = {};
  const label = (id, value, max, name) => {
    if (!value || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) out[id] = name+'需要 1–'+max+' 个可显示字符。';
  };
  if (action === 'node.create') {
    label('node-name', values.name, 64, '服务器名称');
    label('node-purpose', values.purpose, 100, '用途');
  }
  if (action === 'member.grant') {
    label('subject', values.subject, 200, '账号标识');
    if (/\s/u.test(values.subject || '')) out.subject = '账号标识不能含空格。';
    if (!['operator','auditor'].includes(values.role)) out.role = '请选择运维管理员或只读审计员。';
  }
  if (action === 'intake.set' && values.paused) label('reason', values.reason, 160, '暂停原因');
  return out;
}

function logoutControl(config, label) {
  if (config?.platform?.enabled && safeAuthPath(config.platform.signOutUrl)) {
    return '<a class="secondary" target="_top" href="'+esc(config.platform.signOutUrl)+'?return_to=%2Fadmin%2Flogin">'+esc(label)+'</a>';
  }
  return button('logout',label,'quiet');
}

function authLinks(config) {
  if (config?.platform?.enabled) {
    const path = safeAuthPath(config.platform.signInUrl);
    return path ? '<div class="providers"><a class="primary" target="_top" href="'+esc(path)+'?return_to=%2Fadmin">通过平台账号登录</a></div>' : '';
  }
  const enabled = (config?.providers || []).filter(p => p.enabled && safeAuthPath(p.authorizationPath));
  if (!enabled.length) return '';
  return '<div class="providers">'+enabled.map(provider => '<a class="secondary" href="'+esc(provider.authorizationPath)+'&amp;returnTo=%2Fadmin">'+esc(provider.label)+'登录</a>').join('')+'</div>';
}

export function loginContent(session, config, statusMessage = '') {
  const signedIn = session?.authenticated === true;
  const title = signedIn ? (session.configured ? '需要管理员授权' : '开通平台管理') : '管理员登录';
  let body = '<section class="login"><h1>'+title+'</h1>';
  if (statusMessage) body += '<p class="notice" role="alert">'+esc(statusMessage)+'</p>';
  if (signedIn) {
    body += help(session.configured ? '将你的账号标识交给首位管理员，由对方在「权限」中授予访问权。' : '当前部署尚未配置首位管理员。')+'<p class="caption">你的账号标识</p>'+idText(session.actorId);
    if (!session.configured) body += config?.platform?.enabled
      ? help('请部署负责人将此账号标识设为站点的 GONGZAO_ADMIN_OWNER 环境变量，并按部署流程使配置生效。')
      : help('在平台所在电脑打开项目目录，Windows 双击 ADMIN-WINDOWS.cmd，macOS 或 Linux 执行 npm run admin:setup，按向导绑定已注册账号，然后刷新本页。');
    body += '<div class="actions">'+button('refresh','重新核对权限','primary')+logoutControl(config,'切换账号')+'</div>';
  } else if (config) {
    body += help('使用已获平台管理权限的账号登录。');
    if (config.emailPassword?.enabled) body += '<form data-form="login" novalidate>'+summary+
      field('auth-email','邮箱地址','<input id="auth-email" name="email" type="email" maxlength="254" autocomplete="username" required>')+
      field('auth-password','共造账号密码','<input id="auth-password" name="password" type="password" maxlength="128" autocomplete="current-password" required>')+
      '<button class="primary" type="submit">登录管理中心</button></form>';
    body += authLinks(config);
    if (!session.configured) body += '<details><summary>首次开通管理中心</summary>'+help(config.platform?.enabled ? '登录后可查看自己的账号标识，再由部署负责人完成首位管理员配置。' : '先在普通用户入口注册并登录账号。Windows 在平台主机双击 ADMIN-WINDOWS.cmd，macOS 或 Linux 运行 npm run admin:setup。')+'</details>';
  } else {
    body += help('登录方式暂时无法读取。')+button('refresh','重新连接');
  }
  return body+'</section>';
}

function businessPanel(business, error) {
  let body = '<section class="panel"><div class="panel-head"><h2>业务运行</h2></div>';
  if (error || !business?.summary) return body+help(error || '正在读取业务统计…')+(error ? button('refresh','重新读取') : '')+'</section>';
  const { summary:s, coverage:c, asOf } = business;
  return body+'<div class="stats">'+stat('订单',s.orders)+stat('待发货',s.awaitingShipment)+stat('待处理退款',s.pendingRefunds)+stat('未结争议',s.openDisputes)+'</div><p class="note">'+
    esc(c?.partial ? '部分统计，已覆盖 '+c.scanned+' 个工作区。' : '已统计 '+s.workspaces+' 个工作区。')+' 沙盒订单 · '+esc(date(asOf))+'</p></section>';
}

function intakePanel(data, session) {
  const intake = data?.intake;
  if (!intake) return '';
  const paused = intake.paused === true;
  return '<section class="panel"><div class="title"><div><h2>新订单受理</h2><p class="help">'+(paused ? '已暂停新下单和新方案确认，已有订单继续履约及售后。' : '正在接受新订单与新方案确认。')+'</p></div>'+
    (session.permissions?.manageIntake ? button('intake.set',paused ? '恢复受理' : '暂停受理') : '')+'</div>'+
    (paused && intake.reason ? '<p class="note">暂停原因 · '+esc(intake.reason)+'</p>':'')+'</section>';
}

function nodesPanel(data, session) {
  const nodes = data.nodes || [], manage = session.permissions?.manageNodes;
  let out = '<section class="panel"><div class="panel-head"><div><h2>接入服务器</h2><p class="help">节点主动报送心跳，90 秒内收到心跳显示在线。</p></div>'+
    (manage ? button('node.create','登记服务器','primary') : '')+'</div>';
  if (!nodes.length) out += '<p class="empty">尚未登记服务器。</p>';
  for (const n of nodes) {
    const idAttr = 'data-node="'+esc(n.id)+'"';
    out += '<article class="record"><div><strong>'+esc(n.name)+'</strong><p>'+esc(n.purpose)+'</p><p class="meta"><span class="state" data-status="'+esc(n.status)+'">'+esc(states[n.status]||'状态待核实')+'</span> · 最近心跳 '+esc(date(n.lastSeenAt))+'</p>'+
      '<p class="meta">节点 ID</p>'+idText(n.id)+button('copy-node','复制节点 ID','quiet',idAttr)+(n.agentVersion ? '<span class="meta">代理 '+esc(n.agentVersion)+'</span>' : '')+'</div>';
    if (manage && n.state !== 'REVOKED') out += '<div class="row-actions">'+button('node.rotate',n.state==='DISABLED' ? '重新接入' : '轮换凭据','',idAttr)+
      (n.state==='ACTIVE' ? button('node.disable','暂停','',idAttr) : '')+button('node.revoke','撤销','quiet',idAttr)+'</div>';
    out += '</article>';
  }
  if (nodes.length && manage) out += help('配置制造计算服务时，可用 --server-node 绑定对应的节点 ID。');
  return out+'</section>';
}

function membersPanel(data) {
  let out = '<section class="panel"><div class="panel-head"><div><h2>管理权限</h2>'+help('运维管理员可管理服务器和订单受理。只读审计员可查看运行状态与操作记录。')+'</div>'+button('member.grant','授予权限','primary')+'</div>';
  for (const m of data.members || []) {
    out += '<article class="record"><div><strong>'+esc(roles[m.role] || m.role)+'</strong>'+idText(m.subject)+'</div>';
    if (m.role !== 'owner') {
      const attrs = 'data-subject="'+esc(m.subject)+'" data-role="'+esc(m.role)+'"';
      out += '<div class="row-actions">'+button('member.grant','调整权限','',attrs)+button('member.revoke','撤销权限','quiet',attrs)+'</div>';
    }
    out += '</article>';
  }
  return out+'</section>';
}

function auditPanel(data) {
  let out = '<section class="panel"><div class="panel-head"><div><h2>操作记录</h2>'+help('按时间倒序，最多保留 '+data.auditLimit+' 条。'+(data.auditDropped ? '已有 '+data.auditDropped+' 条更早记录超出保留范围。':''))+'</div></div>';
  if (!data.audit?.length) out += '<p class="empty">暂无管理操作记录。</p>';
  for (const e of data.audit || []) {
    out += '<article class="record"><div><strong>'+esc(actionLabels[e.action] || e.action)+'</strong><p class="meta">操作账号 · '+esc(e.actor)+'</p><p class="meta">对象 · '+esc(e.target)+(e.role ? ' · '+esc(roles[e.role]||e.role) : '')+(e.intake ? ' · '+(e.intake.paused ? '暂停受理' : '恢复受理')+(e.intake.reason ? ' · '+esc(e.intake.reason):''):'')+'</p></div><time class="audit-time meta">'+esc(date(e.at))+'</time></article>';
  }
  return out+'</section>';
}

export function dashboardContent(state) {
  const {session, overview, business, businessError, tab, message} = state;
  const tabs = permittedTabs(session), current = tabs.includes(tab) ? tab : 'overview';
  const nodes = overview.nodes || [];
  let body = '<div class="title"><div><h1>平台管理</h1><p class="meta">'+esc(roles[session.role] || session.role)+'</p></div><div class="title-actions">'+button('refresh','刷新')+logoutControl(state.config,'退出')+'</div></div>';
  body += '<nav class="tabs" aria-label="平台管理栏目">'+tabs.map(key=>button('tab',tabNames[key],'','data-tab="'+key+'" '+(current===key?'aria-current="page"':''))).join('')+'</nav>';
  if (message) body += '<p class="notice" role="status">'+esc(message)+(state.retry ? ' '+button('retry','核对上次提交') : '')+'</p>';
  if (current==='overview') {
    body += businessPanel(business,businessError)+intakePanel(overview,session)+'<section class="panel"><div class="panel-head"><h2>服务器状态</h2>'+button('tab','查看服务器','quiet','data-tab="nodes"')+'</div><div class="stats">'+
      stat('已登记',nodes.length)+stat('在线',nodes.filter(n=>n.status==='ONLINE').length)+stat('离线',nodes.filter(n=>n.status==='OFFLINE').length)+stat('待接入',nodes.filter(n=>n.status==='NEVER_CONNECTED').length)+'</div></section>';
  } else if (current==='nodes') body += nodesPanel(overview,session);
  else if (current==='members') body += membersPanel(overview);
  else body += auditPanel(overview);
  return body;
}

async function api(route, {context, body, key} = {}) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),20000);
  try {
    const headers = { Accept:'application/json' };
    if (context) headers['X-Gongzao-Admin-Context'] = context;
    if (body) Object.assign(headers, {'Content-Type':'application/json','Idempotency-Key':key});
    const response = await fetch('/api/admin/'+route,{method:body ? 'POST' : 'GET',headers,cache:'no-store',credentials:'same-origin',signal:controller.signal,...(body ? {body:JSON.stringify(body)} : {})});
    const value = await response.json();
    if (!response.ok || value.error) throw Object.assign(new Error(value.error?.message || '管理请求未完成。'),{status:response.status,code:value.error?.code});
    return value;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('管理服务暂时无法连接，请重新核对。'), {uncertain:true});
  } finally { clearTimeout(timer); }
}

function dialogForm(action, {node, subject, role, intake} = {}) {
  const paused = intake?.paused !== true;
  const panels = {
    'node.create':['登记服务器','登记后会显示一次接入凭据。请在这台服务器上运行心跳代理。','创建并取得凭据'],
    'node.rotate':[node?.state==='DISABLED'?'重新接入服务器':'轮换接入凭据','新凭据生成后，旧凭据立即失效。请在对应服务器上替换凭据并重启心跳代理。','生成新凭据'],
    'node.disable':['暂停服务器接入','暂停后服务器不能继续上报。重新接入时需要配置新的凭据。','确认暂停'],
    'node.revoke':['撤销服务器接入','凭据将立即失效。此条登记不能恢复接入，后续须重新登记。','确认撤销'],
    'member.grant':[subject?'调整管理权限':'授予管理权限','请核对登录页显示的账号标识和要授予的角色。','保存权限'],
    'member.revoke':['撤销管理权限','此账号将失去平台管理访问权。','确认撤销'],
    'intake.set':[paused?'暂停新订单受理':'恢复新订单受理',paused?'暂停新下单与新方案确认。原有订单继续履约、退款及售后。':'客户可以再次下单和确认新方案。','确认'+(paused?'暂停':'恢复')]
  };
  const [title, description, submit] = panels[action];
  let inner = '<h2 id="dialog-title">'+title+'</h2>'+help(description)+'<form data-form="'+action+'" novalidate>'+summary;
  if (node) inner += '<p><strong>'+esc(node.name)+'</strong></p>'+idText(node.id);
  if (action==='node.create') {
    inner += field('node-name','服务器名称','<input id="node-name" name="name" maxlength="64" required placeholder="例如 上海工场一号节点">')+
      field('node-purpose','用途','<input id="node-purpose" name="purpose" maxlength="100" required placeholder="例如 模型分析服务">');
  } else if (action==='member.grant') {
    inner += field('subject','账号标识','<input id="subject" name="subject" maxlength="200" required value="'+esc(subject||'')+'" '+(subject?'readonly':'')+'>')+
      field('role','角色','<select id="role" name="role"><option value="auditor" '+(role!=='operator'?'selected':'')+'>只读审计员</option><option value="operator" '+(role==='operator'?'selected':'')+'>运维管理员</option></select>');
  } else if (action==='member.revoke') inner += idText(subject);
  else if (action==='intake.set' && paused) inner += field('reason','暂停原因','<input id="reason" name="reason" maxlength="160" required>');
  return inner+'<div class="actions">'+button('close-dialog','取消')+'<button class="primary" type="submit">'+submit+'</button></div></form>';
}

export function startAdmin(doc = document, win = window) {
  const main = doc.querySelector('#main'), dialog = doc.querySelector('#admin-dialog');
  const state = {session:null, config:null, overview:null, business:null, businessError:'', message:'',tab:'overview', retry:null};
  let generation = 0, busy = false, visibleCheck = 0, dialogContext = null, openedFrom = null;
  let callbackError = new URLSearchParams(win.location.search).get('auth_error')==='OIDC_FAILED' ? '第三方登录未完成，请重新登录。' : '';

  function closeDialog() {
    const secret = dialog.querySelector('.secretbox'); if (secret) secret.value = '';
    if (dialog.open) dialog.close();
    dialog.replaceChildren(); dialogContext = null;
    if (openedFrom?.isConnected) openedFrom.focus();
    openedFrom = null;
  }
  function render() {
    if (state.overview && state.session?.authorized) main.innerHTML = dashboardContent(state);
    else main.innerHTML = loginContent(state.session,state.config,state.message || callbackError);
  }
  function clearPrivate() {
    closeDialog(); state.session = null; state.overview = null; state.business = null; state.businessError = ''; state.retry = null;
  }
  function failure(message) {
    clearPrivate();
    main.innerHTML = '<section class="login"><h1>暂时无法打开管理中心</h1><p class="notice" role="alert">'+esc(message)+'</p>'+button('refresh','重新连接')+'</section>';
  }
  async function refresh(message = '', keepRetry = false) {
    const current = ++generation;
    closeDialog();
    const prior = state.session?.context;
    const [sessionResult, configResult] = await Promise.allSettled([api('session'),authRequest('config')]);
    if (current !== generation) return;
    if (sessionResult.status !== 'fulfilled') { failure(sessionResult.reason.message); return; }
    const session = sessionResult.value;
    if (!session.authorized || !session.context || session.context !== prior) {
      clearPrivate();
      main.replaceChildren();
      state.tab = 'overview';
    }
    if (!keepRetry) state.retry = null;
    state.session = session;
    state.config = configResult.status==='fulfilled' ? configResult.value : null;
    state.message = message;
    if (!session.authorized) { render(); return; }
    if (!session.context) { failure('管理身份缺少会话绑定，请重新登录。'); return; }
    const [overview, business] = await Promise.allSettled([api('overview',{context:session.context}),api('business',{context:session.context})]);
    if (current !== generation) return;
    if (overview.status !== 'fulfilled') { failure(overview.reason.message); return; }
    if (overview.value.session?.actorId !== session.actorId) { failure('当前账号已切换，请重新核对身份。'); return; }
    if (business.status === 'rejected' && [401,403,409].includes(business.reason?.status)) { failure(business.reason.message); return; }
    state.overview = overview.value;
    state.session = {...session,...overview.value.session,context:session.context};
    state.business = business.status==='fulfilled' ? business.value : null;
    state.businessError = business.status==='rejected' ? '业务统计暂不可用。' : '';
    if (win.location.pathname === '/admin/login') win.history.replaceState(null,'','/admin');
    render();
  }
  function openDialog(html, context) {
    closeDialog();
    openedFrom = doc.activeElement;
    dialogContext = context;
    dialog.innerHTML = html;
    dialog.showModal();
  }
  function showCredential(result) {
    const text = result.credential;
    const node = result.node;
    const base = win.location.origin;
    const instructions = '<p class="help">将配置复制到对应服务器的项目目录，保存为仅运维人员可读的 <code>server-agent.private.json</code>。关闭后无法再次查看该凭据。</p>';
    openDialog('<h2 id="dialog-title">配置服务器接入</h2>'+instructions+'<label class="caption" for="node-secret">节点配置 · '+esc(node?.name||'')+'</label>'+
      '<textarea class="secretbox" id="node-secret" rows="5" readonly spellcheck="false" autocomplete="off"></textarea>'+
      '<p class="caption">节点 ID</p>'+idText(node?.id)+'<p class="note">制造计算服务可用 <code>--server-node</code> 绑定此 ID。</p>'+
      '<p class="help">跨机器接入时将 platformUrl 换成节点可访问的平台 HTTPS 根地址。macOS 或 Linux 上执行 <code>chmod 600 server-agent.private.json</code>。在服务器项目目录运行以下命令，验证后去掉 <code>--once</code> 持续报送。</p><code class="mono">node tools/server-agent.mjs --config server-agent.private.json --once</code>'+
      (state.config?.platform?.enabled ? help('托管私有站点还需通过环境变量 GONGZAO_SITE_ACCESS_TOKEN 配置站点服务访问。'):'')+
      '<p class="note" role="status" id="copy-note"></p><div class="actions">'+button('copy','复制配置')+button('finish-secret','已保存配置','primary')+'</div>',{secret:true});
    dialog.querySelector('#node-secret').value = JSON.stringify({platformUrl:base,token:text},null,2);
  }
  function values(form) {
    const inputs = Object.fromEntries(new FormData(form));
    const action = form.dataset.form;
    if (action === 'intake.set') inputs.paused = dialogContext?.paused === true;
    return inputs;
  }
  async function sendAction(entry) {
    if (busy || !state.session?.authorized) return;
    busy = true;
    const seq = ++generation;
    (dialog.open?dialog:main).querySelectorAll('button').forEach(b=>{b.disabled=true;});
    try {
      const result = await api('actions',{body:entry.body,key:entry.key,context:entry.context});
      if (seq !== generation) return;
      state.retry = null; closeDialog();
      if (result.credential) {
        state.message = '接入凭据已生成。'; render(); showCredential(result);
      } else {
        const msg = result.replayed && ['node.create','node.rotate'].includes(entry.body.action) ? '已核对上次提交。若未保存凭据，请在对应服务器条目轮换凭据。' : '操作已保存。';
        await refresh(msg);
      }
    } catch (error) {
      if (seq !== generation) return;
      if (error.uncertain) {
        closeDialog(); state.retry = entry; state.message = '响应未收到，提交可能已生效。请核对上次提交。'; render();
      } else if ([401,403,409].includes(error.status)) {
        await refresh(error.message+' 请核对最新状态。');
      } else if (dialog.open && dialog.querySelector('form')) {
        const form = dialog.querySelector('form');
        const serverField = ({ADMIN_SUBJECT_UNKNOWN:'subject',ADMIN_INVALID_MEMBER:'subject',ADMIN_INVALID_ROLE:'role',ADMIN_INTAKE_REASON:'reason'})[error.code];
        if (serverField && form.querySelector('#'+serverField)) showFieldErrors(form,{[serverField]:error.message},{summaryId:'form-errors'});
        else showFieldErrors(form,{},{summaryId:'form-errors',message:error.message});
        form.querySelectorAll('button').forEach(b=>{b.disabled=false;});
      } else { await refresh(error.message); }
    } finally { busy = false; }
  }
  doc.addEventListener('submit',async event=>{
    const form = event.target, action = form.dataset.form;
    if (!action) return;
    event.preventDefault();
    if (busy) return;
    const submitted = values(form), errors = formErrors(action,submitted);
    if (showFieldErrors(form,errors,{summaryId:'form-errors'})) return;
    if (action === 'login') {
      busy = true;
      form.querySelectorAll('button').forEach(b=>{b.disabled=true;});
      try {
        await authRequest('login',{email:submitted.email.trim(),password:submitted.password});
        callbackError = ''; await refresh();
      } catch (error) {
        showFieldErrors(form,{},{summaryId:'form-errors',message:error.message});
        form.querySelectorAll('button').forEach(b=>{b.disabled=false;});
      } finally { busy=false; }
      return;
    }
    if (!dialogContext || !state.session?.authorized) return;
    const body = {...submitted,action,expectedRevision:dialogContext.revision};
    if (dialogContext.nodeId) body.nodeId = dialogContext.nodeId;
    if (dialogContext.subject) body.subject = dialogContext.subject;
    await sendAction({body,context:dialogContext.context,key:crypto.randomUUID()});
  });
  doc.addEventListener('input',event=>{
    const target = event.target, form = target.form;
    if (form?.dataset.form && target.id && hasFieldError(form,target.id)) updateFieldError(form,target.id,formErrors(form.dataset.form,values(form))[target.id],{summaryId:'form-errors'});
  });
  doc.addEventListener('click',async event=>{
    const el = event.target.closest('[data-op]'); if (!el || busy) return;
    const op = el.dataset.op;
    if (op==='close-dialog') { closeDialog(); return; }
    if (op==='finish-secret') { await refresh(); return; }
    if (op==='copy') {
      const box=dialog.querySelector('#node-secret');
      if (!box) return;
      try { await win.navigator.clipboard.writeText(box.value); dialog.querySelector('#copy-note').textContent='配置已复制，请保存到对应服务器。'; }
      catch { box.select(); dialog.querySelector('#copy-note').textContent='已选中配置，请手动复制。'; }
      return;
    }
    if (op==='refresh') { await refresh(); return; }
    if (op==='logout') {
      busy = true; ++generation; clearPrivate(); main.innerHTML='<p class="loading">正在退出…</p>';
      try {
        const result = await authRequest('logout',{});
        if (result.logoutRequired && safeAuthPath(result.signOutUrl)) win.top.location.href = result.signOutUrl+'?return_to=%2Fadmin%2Flogin';
        else { win.history.replaceState(null,'','/admin/login'); await refresh(); }
      } catch (error) { failure(error.message); }
      finally { busy=false; }
      return;
    }
    if (!state.session?.authorized || !state.overview) return;
    if (op==='retry') { if (state.retry) await sendAction(state.retry); return; }
    if (op==='copy-node') {
      const node = state.overview.nodes.find(item=>item.id===el.dataset.node);
      if (!node) return;
      try { await win.navigator.clipboard.writeText(node.id); el.textContent='已复制节点 ID'; }
      catch { el.textContent='请选中上方 ID 手动复制'; }
      return;
    }
    if (op==='tab') {
      if (!permittedTabs(state.session).includes(el.dataset.tab)) return;
      state.tab = el.dataset.tab; render(); main.querySelector('[aria-current="page"]')?.focus(); return;
    }
    if (!Object.hasOwn(actionLabels,op)) return;
    const p = state.session.permissions;
    if ((op.startsWith('member.')&&!p.manageMembers)||(op.startsWith('node.')&&!p.manageNodes)||(op==='intake.set'&&!p.manageIntake)) return;
    const n = state.overview.nodes.find(node=>node.id===el.dataset.node);
    const m = state.overview.members?.find(member=>member.subject===el.dataset.subject);
    openDialog(dialogForm(op,{node:n,subject:m?.subject,role:m?.role,intake:state.overview.intake}),{context:state.session.context,revision:state.overview.revision,nodeId:n?.id,subject:m?.subject,paused:state.overview.intake?.paused !== true});
  });
  dialog.addEventListener('cancel', event=>{
    if (busy) { event.preventDefault(); return; }
    event.preventDefault();
    const secret = dialogContext?.secret; closeDialog(); if (secret) void refresh();
  });
  async function recheck() {
    if (doc.hidden || busy || !state.session) return;
    const id = ++visibleCheck, seq=generation;
    const current = state.session;
    try {
      const next = await api('session');
      if (id!==visibleCheck || seq!==generation || busy) return;
      if (current.context!==next.context || current.role!==next.role || current.authorized!==next.authorized || current.configured!==next.configured) {
        clearPrivate(); main.innerHTML='<p class="loading">正在重新核对管理权限…</p>';
        await refresh('管理身份已更新。');
      } else if (state.tab==='nodes' && state.overview && !dialog.open && !state.retry) {
        await refresh();
      }
    } catch (error) { if (id===visibleCheck && seq===generation && !busy) { ++generation; failure(error.message); } }
  }
  doc.addEventListener('visibilitychange',()=>{ if (doc.hidden && dialogContext?.secret) { closeDialog(); state.message='配置已隐藏。若未保存凭据，可在服务器列表轮换。'; render(); } else if (!doc.hidden) void recheck(); });
  win.addEventListener('pagehide',()=>{ ++generation; clearPrivate(); main.replaceChildren(); });
  win.addEventListener('pageshow',event=>{ if (event.persisted) void refresh(); });
  win.setInterval(()=>{ if (state.session?.authorized && !doc.hidden && !dialog.open) void recheck(); },30000);
  void refresh();
}

if (typeof document !== 'undefined' && document.querySelector('#admin-dialog')) startAdmin();
