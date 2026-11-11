import { get, prepareMutation } from './api-client.js';

export function createMerchantUI({ icon, escape, render, modal, closeModal, toast, legacyOrders, connection, reconnect, session }) {
  const state = { profile:null, loaded:false, loading:false, busy:false, error:null, view:'overview', devices:[], gateways:[], counts:{total:0,real:0,online:0,offline:0,demo:0}, scan:null, selected:new Set(), lastRefreshed:null, pollTimer:null, freshnessTimer:null, clockOffset:0, retry:null };
  let pairing = null;
  const esc=escape, I=icon;
  const $=s=>document.querySelector(s);
  const statusLabels={online:'已识别',offline:'待检查',authorization_required:'待授权',revoked:'已撤销'};
  const connectionReasons={PROTOCOL_OBSERVED:'只读协议最近有响应',GATEWAY_OFFLINE:'网关未在线，需重新查询',OBSERVATION_EXPIRED:'设备观察已过期，请重新检测',STATUS_REFRESH_REQUIRED:'状态缓存已过期，请查询最新状态',AUTHORIZATION_REQUIRED:'设备需要本地授权',DEVICE_UNREACHABLE:'最近检测未连接',IDENTITY_CONFLICT:'地址与设备标识冲突',SCAN_FAILED:'最近检测失败，状态待核实',DEMO:'演示数据'};
  const verificationLabels={DEMO:'演示数据',PROTOCOL_PROBE_REPORTED:'网关已回报协议探针',LEGACY_PROTOCOL_REPORTED:'旧版协议回报，建议重新检测'};
  const displayDevice=d=>d.source==='real'&&d.connectionState==='online'&&(!Number.isFinite(d.freshUntil)||Date.now()+state.clockOffset>=d.freshUntil)?{...d,connectionState:'offline',connectionReason:'STATUS_REFRESH_REQUIRED'}:d;
  const displayGateway=g=>g.status==='online'&&(!Number.isFinite(g.freshUntil)||Date.now()+state.clockOffset>=g.freshUntil)?{...g,status:'offline'}:g;
  const currentCounts=()=>{const real=state.devices.filter(d=>d.source==='real').map(displayDevice);return {...state.counts,online:real.filter(d=>d.connectionState==='online').length,offline:real.filter(d=>d.connectionState!=='online').length};};
  function scheduleFreshness(){
    clearTimeout(state.freshnessTimer);if(!isRoute())return;
    const time=Date.now()+state.clockOffset,expires=[...state.devices.filter(d=>d.source==='real'&&d.connectionState==='online'&&d.freshUntil>time),...state.gateways.filter(g=>g.status==='online'&&g.freshUntil>time)].map(d=>d.freshUntil);
    if(state.scan?.expiresAt>time)expires.push(state.scan.expiresAt);
    if(expires.length)state.freshnessTimer=setTimeout(()=>{if(isRoute())render();scheduleFreshness();},Math.min(2147483647,Math.max(1,Math.min(...expires)-time+10)));
  }
  const date=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'尚未同步';
  const isRoute=()=>/^\/merchant(?:\/|$)/.test(location.pathname);
  const heading=(eyebrow,title,description,actions='')=>'<div class="page-intro merchant-intro"><div><div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+description+'</p></div><div class="intro-actions">'+actions+'</div></div>';
  const button=(action,label,primary=false,extra='')=>'<button class="btn '+(primary?'primary':'')+'" data-merchant-action="'+action+'" '+extra+(state.busy?' disabled':'')+'>'+label+'</button>';
  const canImport=c=>state.scan?.status==='complete'&&state.scan.importable!==false&&new Date(state.scan.expiresAt).getTime()>Date.now()+state.clockOffset&&!c.registered&&c.connectionState==='online'&&['moonraker','octoprint'].includes(c.protocol);
  const onlineGateways=()=>state.gateways.map(displayGateway).filter(g=>g.status==='online'&&!g.revokedAt);
  function notice(){return state.error?'<div class="request-notice error" role="alert">'+I('info')+'<span>'+esc(state.error.message)+'</span>'+button('retry','重试')+'</div>':'';}
  function go(view){state.view=view;const hash=view==='overview'?'':'#'+view;history.replaceState(null,'','/merchant'+hash);render();window.scrollTo({top:0,behavior:'instant'});}
  function applyDevices(result){state.devices=result.devices||[];state.counts=result.counts||state.counts;if(result.gateways)state.gateways=result.gateways;state.lastRefreshed=Date.now();state.clockOffset=Number.isFinite(result.serverNow)?result.serverNow-Date.now():0;scheduleFreshness();}
  async function load(show=true){
    if(state.loading)return;state.loading=true;if(show)render();
    try{
      const session=await get('/merchant/session');state.profile=session.profile;state.error=null;
      if(state.profile){
        const [devices,gateways,scan]=await Promise.all([get('/merchant/devices'),get('/merchant/gateways'),get('/merchant/scan-result')]);
        applyDevices(devices);state.gateways=gateways.gateways||[];state.scan=scan.scan||null;
      }
      state.loaded=true;
    }catch(error){state.error=error;}
    finally{state.loading=false;render();scheduleFreshness();if(state.scan?.status==='pending')schedulePoll();}
  }
  async function mutation(path,payload,success){
    if(state.busy)return;
    const task=await prepareMutation('/merchant/'+path,payload);
    return execute(task,success);
  }
  async function execute(task,success){
    state.busy=true;state.error=null;state.retry={task,success};render();
    try{const result=await task.execute();state.retry=null;state.busy=false;await success(result);}
    catch(error){state.error=error;state.busy=false;const errorNode=$('#merchant-modal-error');if(errorNode){errorNode.textContent=error.message;errorNode.setAttribute('role','alert');}}
    finally{state.busy=false;render();}
  }
  function summary(){
    const pending=state.scan?.scope==='real'&&state.scan.status==='complete'?state.scan.candidates.filter(canImport).length:0;
    const counts=currentCounts();
    return '<div class="summary-grid merchant-summary">'+[['已添加设备',counts.real,'真实登记'],['最近已识别',counts.online,'协议可读，不代表可开打'],['待检查设备',counts.offline,'离线、过期或待授权'],['待添加设备',pending,'最近一次真实检测']].map(([label,count,note])=>'<div class="summary-card"><span>'+label+'</span><strong>'+Number(count||0)+'</strong><p>'+note+'</p></div>').join('')+'</div>';
  }
  function loginPage(){
    return '<div class="merchant-login"><div class="login-story"><div class="eyebrow">COFORGE FOR BUSINESS</div><h1>制造的每一步，<br/>井然有序。</h1><p>管理你的设备。接收新的订单。<br/>让工作台回归简单。</p><div class="login-benefits"><span>'+I('devices')+'设备一目了然</span><span>'+I('search')+'发现并批量添加</span><span>'+I('orders')+'跟进生产与交付</span></div></div><section class="login-card"><div class="login-symbol">'+I('factory')+'</div><h2>商家登录</h2><p class="login-description">使用当前平台账号，进入独立的商家工作台。</p>'+notice()+
    (connection()==='offline'?'<p>请先恢复平台登录连接。</p><a class="btn primary full" href="/signin-with-chatgpt?return_to=%2Fmerchant">通过 ChatGPT 登录</a>'+button('reconnect','重新检查连接',false,'style="width:100%;margin-top:12px"'):
      !state.loaded||state.loading?'<div class="login-loading" role="status">'+I('clock')+'正在检查商家身份…</div>':
      state.profile?'<div class="merchant-profile-ready">'+I('check')+'<div><strong>'+esc(state.profile.name)+'</strong><span>商家空间已创建</span></div></div>'+button('enter','进入商家工作台 '+I('arrow'),true,'style="width:100%"'):
      '<label class="field-label" for="merchant-name">店铺或工作室名称</label><input id="merchant-name" class="input" maxlength="60" placeholder="例如：我的制造工作室" autocomplete="organization"/><div id="merchant-name-error" class="error-text" role="alert"></div>'+button('enroll','使用当前账号开通 '+I('arrow'),true,'style="width:100%;margin-top:20px"'))+
    '<p class="login-footnote">当前为商家功能沙盒。开通将保存商家资料，不代表完成商家资质认证。</p><a class="text-link" href="/">返回个人创作空间 '+I('arrow')+'</a></section></div>';
  }
  function overview(){
    const connected=onlineGateways();
    return heading('BUSINESS WORKSPACE','专注制造。','欢迎回来，'+esc(state.profile.name)+'。你的设备与工作，都在这里。',button('devices','管理设备 '+I('arrow'),true))+summary()+
      '<div class="merchant-overview-grid"><section class="card overview-feature"><div class="overview-feature-icon">'+I('printer')+'</div><div class="eyebrow">YOUR MACHINES</div><h2>设备接入，简单一点。</h2><p>已有设备联网，却还没添加到平台？<br/>连接本地网关，一次检测，批量添加。</p><div class="overview-feature-actions">'+button('discover','检测并添加设备 '+I('plus'),true)+button('refresh','查询已接入设备')+'</div></section><section class="card gateway-overview"><div class="section-heading"><h2>本地网关</h2><span class="badge">'+connected.length+' 个在线</span></div><div class="gateway-graphic">'+I('network')+'</div><h3>'+(connected.length?'已连接到你的制造空间':'连接你的第一台网关')+'</h3><p>在商家的电脑上运行网关，<br/>平台就能读取已授权设备的状态。</p>'+button('pair','连接本地网关 '+I('arrow'))+'</section></div>'+
      '<div class="merchant-bottom-note">'+I('shield')+'<span>已开放只读协议识别；具体机型、打印状态与生产能力仍需验证。</span><button class="text-link" data-merchant-action="demo">先体验添加流程 '+I('arrow')+'</button></div>';
  }
  function registry(){
    const real=state.devices.filter(d=>d.source!=='demo'),demo=state.devices.filter(d=>d.source==='demo');
    return heading('YOUR MACHINES','设备，尽在掌握。','查看已接入设备，或找到尚未添加的设备。',button('refresh',I('rotate')+'查询已接入设备')+button('discover',I('plus')+'检测并添加设备',true))+summary()+
    '<section class="card equipment-section"><div class="card-head"><h2>我的设备 <span class="small muted">'+real.length+'</span></h2><span class="small muted">'+(state.loading?'正在查询…':'最近查询 '+date(state.lastRefreshed))+'</span></div>'+
    (real.length?'<div class="equipment-list">'+real.map(deviceRow).join('')+'</div>':'<div class="empty-state device-empty"><div class="empty-printer">'+I('printer')+'</div><h3>添加第一台设备</h3><p>联网设备不会自动出现在平台。<br/>连接本地网关后，即可检测并批量添加。</p>'+button('discover','检测并添加设备 '+I('arrow'),true)+'</div>')+'</section>'+
    (state.scan?scanPanel():'')+
    '<section class="gateway-section"><div class="section-heading"><h2>网关连接</h2>'+button('pair','连接网关 '+I('plus'))+'</div>'+(state.gateways.length?'<div class="gateway-list">'+state.gateways.map(displayGateway).map(g=>'<div class="gateway-row"><span class="gateway-icon">'+I('network')+'</span><div><strong>'+esc(g.name)+'</strong><p>'+esc(g.id)+' · '+date(g.lastSeenAt)+'</p></div><span class="badge">'+(g.status==='online'?'在线':g.status==='revoked'?'已撤销':'离线')+'</span>'+(g.status==='revoked'?'':button('revoke','撤销连接',false,'data-gateway-id="'+esc(g.id)+'"'))+'</div>').join('')+'</div>':'<div class="gateway-empty"><span>还没有连接本地网关。</span><button class="text-link" data-merchant-action="pair">查看连接方式 '+I('arrow')+'</button></div>')+'</section>'+
    (demo.length?'<details class="demo-devices"><summary>演示设备 · '+demo.length+' 台<span>不计入真实设备</span></summary><div class="equipment-list">'+demo.map(deviceRow).join('')+'</div></details>':'')+
    '<div class="merchant-bottom-note"><span>支持 Moonraker / OctoPrint 发现与读取。其他品牌按实际开放接口接入。</span><button class="text-link" data-merchant-action="demo">体验演示检测 '+I('arrow')+'</button></div>';
  }
  function deviceRow(record){const d=displayDevice(record);return '<article class="equipment-row"><span class="equipment-icon">'+I('printer')+'</span><div class="equipment-name"><strong>'+esc(d.name)+'</strong><span>'+esc(d.protocol)+' · 型号待确认</span></div><div class="equipment-address"><span>'+esc(d.endpoint||'演示地址')+'</span><small>'+esc(connectionReasons[d.connectionReason]||'最近观察 '+date(d.lastSeenAt))+'</small></div><span class="status-pill '+(d.connectionState==='online'?'status-online':'')+'"><i></i>'+esc(statusLabels[d.connectionState]||'待检查')+'</span><button class="text-link equipment-capability" data-merchant-action="device-details" data-device-id="'+esc(d.id)+'">识别详情 '+I('arrow')+'</button></article>';}
  function deviceDetails(id){
    const record=state.devices.find(d=>d.id===id);if(!record)return;const d=displayDevice(record),e=d.probeEvidence;
    const fields=[['协议',d.protocol],['服务状态',connectionReasons[d.connectionReason]||'待重新检测'],['识别层级',verificationLabels[d.verification?.level]||'旧版登记，建议重新检测'],['最近观察',date(d.lastSeenAt)],['只读探针',e?e.method+' '+e.endpoint:d.source==='demo'?'演示数据，无真实探针':'旧版回报未提供'],['服务版本',e?.serviceVersion||'未提供'],['控制器连接',e?.controllerConnected===true?'已连接（不代表当前可打印）':e?.controllerConnected===false?'未连接':'本次协议接口未验证'],['控制器状态',e?.controllerState||'未读取'],['具体机型','尚未确认'],['现场与工艺认证','尚未验收']];
    modal('设备识别详情','<p><strong>'+esc(d.name)+'</strong></p><div class="setup-steps">'+fields.map(([label,value])=>'<div><span><strong>'+esc(label)+'</strong><small>'+esc(value)+'</small></span></div>').join('')+'</div><p class="inline-note">当前只读取协议信息。文件上传、启动打印与取消任务均未开放。'+(d.source==='demo'?'这是演示设备。':'网关心跳不代表打印机状态已刷新；观察超过 5 分钟需要重新检测。')+'</p>','<button class="btn" data-action="close">关闭</button>'+button('refresh','查询最新状态',true));
  }
  function scanPanel(){
    const s=state.scan,scope=s.scope==='demo'?'演示检测':'设备检测',candidates=s.candidates||[],available=candidates.filter(canImport),selected=available.filter(c=>state.selected.has(c.id));
    const effectiveStatus=s.status==='complete'&&new Date(s.expiresAt).getTime()<=Date.now()+state.clockOffset?'expired':s.status==='complete'&&s.importable===false?'unavailable':s.status;
    const stateText={pending:'正在等待网关检测',complete:'检测完成',failed:'检测未完成',expired:'检测已过期',unavailable:'暂时无法添加'}[effectiveStatus]||effectiveStatus;
    return '<section class="card scan-panel" aria-live="polite"><div class="card-head"><h2>'+scope+' <span class="badge">'+stateText+'</span></h2>'+button('refresh-scan',I('rotate')+'刷新结果')+'</div>'+
    (s.scope==='demo'?'<div class="scan-demo-note">这是演示数据，不来自你的网络，也不会计入真实设备。</div>':'')+
    (s.status==='pending'?'<div class="scan-pending">'+I('search')+'<h3>正在寻找你的设备</h3><p>网关会读取局域网广播和你配置的设备地址。<br/>通常需要数秒；你可以继续浏览，结果会自动更新。</p></div>':
      ['failed','expired','unavailable'].includes(effectiveStatus)?'<div class="empty-state"><h3>'+stateText+'</h3><p>'+esc(effectiveStatus==='expired'?'本次检测结果已过期，请重新检测后添加设备。':effectiveStatus==='unavailable'?'网关已离线或结果不可用，请恢复连接后重新检测。':s.error?.message||s.error||'请确认网关仍在运行，然后重新检测。')+'</p>'+button(s.scope==='demo'?'demo':'discover','重新检测')+'</div>':
      candidates.length?'<div class="scan-select-bar"><label class="check-line"><input type="checkbox" data-merchant-select-all '+(selected.length===available.length&&available.length?'checked':'')+' '+(!available.length?'disabled':'')+'/>选择可添加设备</label><span>'+candidates.length+' 台已发现 · '+available.length+' 台可添加</span></div><div class="candidate-list">'+candidates.map(c=>{
        const eligible=canImport(c);return '<label class="candidate-row"><input type="checkbox" data-candidate-id="'+esc(c.id)+'" '+(eligible?'':'disabled')+' '+(state.selected.has(c.id)&&eligible?'checked':'')+'/><span class="equipment-icon">'+I('printer')+'</span><span class="candidate-name"><strong>'+esc(c.name)+'</strong><small>'+esc(c.protocol)+' · '+esc(c.endpoint||'演示设备')+'</small></span><span class="badge">'+(c.registered?(c.registrationConflict==='OTHER_GATEWAY'?'已在另一网关登记':c.registrationConflict==='IDENTITY_CHANGED'?'设备标识冲突':'已添加'):!['moonraker','octoprint'].includes(c.protocol)?'暂不支持':c.connectionState==='authorization_required'?'需要设备授权':c.connectionState==='online'?'可添加':'未连接')+'</span></label>';}).join('')+'</div><div class="scan-footer"><span>添加设备不会启动打印。</span>'+button('import','添加所选设备'+(selected.length?' · '+selected.length:''),true,selected.length?'':'disabled')+'</div>':
      '<div class="empty-state"><h3>没有发现可用设备</h3><p>请确认设备与网关位于同一局域网。<br/>不支持自动发现的设备，可在网关配置中填写局域网地址。</p>'+button('discover','再次检测')+'</div>')+'</section>';
  }
  function renderContent(){
    if(!state.profile||location.pathname.replace(/\/$/,'')==='/merchant/login')return loginPage();
    return notice()+(state.view==='devices'?registry():state.view==='orders'?'<div class="merchant-legacy-label">订单履约沙盒 · 以下生产、物流与结算为模拟操作，与真实设备清单分开。</div>'+legacyOrders():overview());
  }
  function nav(){return !state.profile?'<a href="/" class="portal-switch">个人创作 '+I('arrow')+'</a>':'<nav class="header-nav" aria-label="商家导航">'+[['overview','概览'],['devices','设备'],['orders','订单演示']].map(([id,label])=>'<button class="'+(state.view===id?'active':'')+'" data-merchant-action="view" data-view="'+id+'">'+label+'</button>').join('')+'</nav><a href="/" class="portal-switch">个人创作 '+I('arrow')+'</a>';}
  function discover(){
    const gateways=onlineGateways();
    if(!gateways.length){modal('连接后，一键发现','<div class="connect-explainer">'+I('network')+'<h3>需要一个在线的本地网关</h3><p>网页无法直接查找你局域网里的打印机。<br/>在连接设备的电脑上运行共造网关，即可完成检测。</p></div><div class="setup-steps"><div><b>1</b><span>创建并下载网关配置</span></div><div><b>2</b><span>在商家电脑上运行网关</span></div><div><b>3</b><span>回到这里检测并添加设备</span></div></div>','<button class="btn" data-action="close">稍后</button>'+button('pair','连接本地网关',true));return;}
    modal('检测并添加设备','<p>检测只读取所选网关可发现、且允许访问的设备，不会启动生产。</p><label class="field-label" for="discovery-gateway">选择网关</label><select id="discovery-gateway" class="select">'+gateways.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('')+'</select><div id="merchant-modal-error" class="error-text"></div>','<button class="btn" data-action="close">取消</button>'+button('start-real-scan','开始检测',true));
  }
  function demoPrompt(){modal('体验设备添加流程','<p>使用 3 台明确标记的演示设备，体验检测、选择与添加。演示数据与真实设备分开，不代表在你的网络中发现了设备。</p>','<button class="btn" data-action="close">取消</button>'+button('start-demo-scan','使用演示数据体验',true));}
  function pairPrompt(){pairing=null;modal('连接本地网关','<p>在连接打印机的电脑上运行网关。平台只读取获授权设备，不会自动开启打印。</p><label class="field-label" for="gateway-name">网关名称</label><input id="gateway-name" class="input" maxlength="60" placeholder="例如：工作室电脑" value="工作室网关"/><div id="merchant-modal-error" class="error-text"></div>','<button class="btn" data-action="close">取消</button>'+button('create-pairing','生成网关配置',true));}
  function pairedDialog(result){
    if(!result.token){pairing=null;modal('连接已创建','<p>为了保护授权信息，网关密钥只显示一次。本次为重复请求，没有再次返回密钥；如未保存配置，请撤销该连接后重新创建。</p>','<button class="btn" data-action="close">知道了</button>');return;}
    pairing={platformUrl:result.platformOrigin||location.origin,token:result.token,mdns:true,targets:[]};
    modal('网关已准备好','<p>在你的商家电脑上下载配置，并使用项目中的网关程序启动。无需向公网开放打印机端口。</p>'+(session()?.persistence==='d1'?'<div class="pairing-hosted-note">此私有预览还需要配置站点服务访问权限。请按源码中的网关接入说明补充站点访问配置；本地版本可直接配对。</div>':'')+'<div class="setup-steps"><div><b>1</b><span><strong>下载连接配置</strong><small>配置包含设备读取权限，请仅保存于你的电脑。</small></span></div><div><b>2</b><span><strong>在项目根目录运行</strong><code>node services/device-gateway/cli.mjs --config gateway.private.json</code></span></div><div><b>3</b><span><strong>回到平台查询连接</strong><small>自动发现 Moonraker / OctoPrint；其他设备可按说明填写本地地址。</small></span></div></div><p class="inline-note">授权文件仅在本次窗口中可下载。文件移动后，请在命令中使用实际路径。</p>','<button class="btn" data-merchant-action="finish-pairing">完成并查询</button>'+button('download-config','下载网关配置 '+I('down'),true),true);
  }
  async function scan(scope,gatewayId){
    await mutation('scan',{scope,...(gatewayId?{gatewayId}:{})},async result=>{state.scan=result.scan;state.selected=new Set((result.scan.candidates||[]).filter(canImport).map(c=>c.id));closeModal();go('devices');scheduleFreshness();if(state.scan.status==='pending')schedulePoll();});
  }
  function schedulePoll(){clearTimeout(state.pollTimer);if(state.scan?.status!=='pending')return;state.pollTimer=setTimeout(()=>refreshScan(false),2500);}
  async function refreshScan(announce=true){
    if(!state.scan)return;
    try{const result=await get('/merchant/scan-result?scanId='+encodeURIComponent(state.scan.id));state.scan=result.scan;state.error=null;if(state.scan?.status==='complete'&&!state.selected.size)state.selected=new Set(state.scan.candidates.filter(canImport).map(c=>c.id));if(state.scan?.status==='complete')applyDevices(await get('/merchant/devices'));if(announce)toast('检测结果已更新');}
    catch(error){state.error=error;clearTimeout(state.pollTimer);render();return;}
    render();schedulePoll();scheduleFreshness();
  }
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-merchant-action]');if(!target||!isRoute())return;
    event.preventDefault();const action=target.dataset.merchantAction;if(state.busy)return;
    if(action==='view')return go(target.dataset.view);
    if(action==='devices')return go('devices');
    if(action==='device-details')return deviceDetails(target.dataset.deviceId);
    if(action==='enter'){history.replaceState(null,'','/merchant');return go('overview');}
    if(action==='enroll'){const name=$('#merchant-name')?.value.trim();if(!name){$('#merchant-name-error').textContent='请填写店铺或工作室名称。';return;}return mutation('enroll',{name},async result=>{state.profile=result.profile;history.replaceState(null,'','/merchant');await load(false);toast('商家空间已创建');});}
    if(action==='retry'){if(state.retry)return execute(state.retry.task,state.retry.success);return load();}
    if(action==='reconnect')return reconnect();
    if(action==='refresh'){closeModal();await load();toast(state.error?'查询未完成，请重试':'已查询最新设备状态');return;}
    if(action==='discover')return discover();
    if(action==='demo')return demoPrompt();
    if(action==='start-demo-scan')return scan('demo');
    if(action==='start-real-scan')return scan('real',$('#discovery-gateway')?.value);
    if(action==='refresh-scan')return refreshScan();
    if(action==='import'){const candidates=(state.scan?.candidates||[]).filter(c=>state.selected.has(c.id)&&canImport(c));if(!candidates.length){toast('检测结果已失效或没有可添加设备，请刷新后重新检测。');render();return;}return mutation('devices/import',{scanId:state.scan.id,candidateIds:candidates.map(c=>c.id)},async result=>{state.selected.clear();await load(false);toast('设备已添加。重复设备会自动跳过。');});}
    if(action==='pair')return pairPrompt();
    if(action==='create-pairing'){const name=$('#gateway-name')?.value.trim();if(!name){$('#merchant-modal-error').textContent='请填写网关名称。';return;}return mutation('pairing',{name},async result=>{state.gateways.push(result.gateway);pairedDialog(result);});}
    if(action==='download-config'){if(!pairing){toast('配置已失效，请重新创建连接。');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(pairing,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='gateway.private.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('配置已下载，请在商家电脑上运行网关');return;}
    if(action==='finish-pairing'){pairing=null;closeModal();await load();go('devices');return;}
    if(action==='revoke'){const gateway=state.gateways.find(g=>g.id===target.dataset.gatewayId);if(!gateway)return;modal('撤销网关连接','<p>撤销后，'+esc(gateway.name)+' 将不能继续同步设备信息。已添加设备保留在清单中。</p>','<button class="btn" data-action="close">保留连接</button>'+button('confirm-revoke','撤销连接',true,'data-gateway-id="'+esc(gateway.id)+'"'));return;}
    if(action==='confirm-revoke')return mutation('gateways/revoke',{gatewayId:target.dataset.gatewayId},async()=>{pairing=null;closeModal();await load(false);toast('网关连接已撤销');});
  });
  document.addEventListener('change',event=>{
    if(!isRoute()||state.busy)return;
    if(event.target.matches('[data-candidate-id]')){const id=event.target.dataset.candidateId;if(event.target.checked)state.selected.add(id);else state.selected.delete(id);render();}
    if(event.target.matches('[data-merchant-select-all]')){state.selected=new Set(event.target.checked?(state.scan?.candidates||[]).filter(canImport).map(c=>c.id):[]);render();}
  });
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="close"]')||event.target.matches('[data-dismiss]'))pairing=null;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')pairing=null;});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isRoute()){render();scheduleFreshness();}});
  window.addEventListener('pageshow',()=>scheduleFreshness());
  window.addEventListener('pagehide',()=>{pairing=null;clearTimeout(state.pollTimer);clearTimeout(state.freshnessTimer);});
  state.view=['devices','orders'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
  return { isRoute, load, renderContent, nav, state, discover, pairPrompt };
}
