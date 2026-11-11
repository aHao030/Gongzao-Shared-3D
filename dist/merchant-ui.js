import { tradeInboxHref, hasPlatformRoutes } from './trade-return.js';
import { get, prepareMutation } from './api-client.js';

export function createMerchantUI({ operationsFactory, workflow, icon, escape, render, modal, closeModal, toast, legacyOrders, connection, reconnect, session, auth }) {
  const state = { profile:null, loaded:false, loading:false, busy:false, error:null, view:'overview', devices:[], gateways:[], counts:{total:0,real:0,online:0,offline:0,demo:0}, scan:null, selected:new Set(), lastRefreshed:null, pollTimer:null, freshnessTimer:null, clockOffset:0, retry:null, pricing:null, pricingLoading:false, pricingFarm:'f1', pricingDrafts:{}, pricingDraftRevisions:{} };
  let pairing = null;
  let inventoryTimer = null;
  const operations=operationsFactory?.({icon,escape,render,modal,closeModal,toast,isActive:()=>isRoute()&&state.view==='operations'&&!!state.profile&&(!auth||auth.authenticated())});
  const esc=escape, I=icon;
  const $=s=>document.querySelector(s);
  const statusLabels={online:'已识别',offline:'待检查',authorization_required:'待授权',revoked:'已撤销'};
  const connectionReasons={PROTOCOL_OBSERVED:'只读协议最近有响应',GATEWAY_OFFLINE:'网关未在线，需重新查询',OBSERVATION_EXPIRED:'设备观察已过期，请重新检测',STATUS_REFRESH_REQUIRED:'状态缓存已过期，请查询最新状态',AUTHORIZATION_REQUIRED:'设备需要本地授权',DEVICE_UNREACHABLE:'最近检测未连接',IDENTITY_CONFLICT:'地址与设备标识冲突',SCAN_FAILED:'最近检测失败，状态待核实',DEMO:'演示数据'};
  const verificationLabels={BAMBU_ADVERTISED:'局域网广播已识别',BAMBU_READONLY_REPORTED:'加密只读订阅已验证',BAMBU_UNVERIFIED:'尚未读取设备状态',DEMO:'演示数据',PROTOCOL_PROBE_REPORTED:'网关已回报协议探针',LEGACY_PROTOCOL_REPORTED:'旧版协议回报，建议重新检测'};
  const displayDevice=d=>d.source==='real'&&(d.connectionState==='online'||(d.protocol==='bambu'&&d.connectionState==='authorization_required'))&&(!Number.isFinite(d.freshUntil)||Date.now()+state.clockOffset>=d.freshUntil)?{...d,connectionState:'offline',connectionReason:'STATUS_REFRESH_REQUIRED'}:d;
  const displayGateway=g=>g.status==='online'&&(!Number.isFinite(g.freshUntil)||Date.now()+state.clockOffset>=g.freshUntil)?{...g,status:'offline'}:g;
  const currentCounts=()=>{const real=state.devices.filter(d=>d.source==='real').map(displayDevice);return {...state.counts,online:real.filter(d=>d.connectionState==='online').length,offline:real.filter(d=>d.connectionState!=='online').length};};
  // Inventory queries read the server's latest observation. They never send a scan or printer command.
  function scheduleInventoryRead(){
    clearTimeout(inventoryTimer);
    if(!isRoute()||state.view!=='devices'||document.hidden||!state.profile||!state.devices.some(d=>d.protocol==='bambu'))return;
    inventoryTimer=setTimeout(async()=>{
      const previous=state.lastRefreshed,profile=state.profile;
      try{
        if(!document.hidden&&!state.busy&&!state.loading){
          const inventory=await get('/merchant/devices');
          if(profile===state.profile&&previous===state.lastRefreshed&&state.view==='devices'){
            applyDevices(inventory);render();
          }
        }
      }catch{/* The existing freshness deadline still expires when the server is unreachable. */}
      finally{scheduleInventoryRead();}
    },30000);
  }
  function scheduleFreshness(){
    clearTimeout(state.freshnessTimer);if(!isRoute())return;
    const time=Date.now()+state.clockOffset,expires=[...state.devices.filter(d=>d.source==='real'&&(d.connectionState==='online'||(d.protocol==='bambu'&&d.connectionState==='authorization_required'))&&d.freshUntil>time),...state.gateways.filter(g=>g.status==='online'&&g.freshUntil>time)].map(d=>d.freshUntil);
    if(state.scan?.expiresAt>time)expires.push(state.scan.expiresAt);
    if(expires.length)state.freshnessTimer=setTimeout(()=>{if(isRoute())render();scheduleFreshness();},Math.min(2147483647,Math.max(1,Math.min(...expires)-time+10)));
  }
  const date=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'尚未同步';
  const isRoute=()=>/^\/merchant(?:\/|$)/.test(location.pathname);
  const heading=(eyebrow,title,description,actions='')=>'<div class="page-intro merchant-intro"><div><div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+description+'</p></div><div class="intro-actions">'+actions+'</div></div>';
  const button=(action,label,primary=false,extra='')=>'<button class="btn '+(primary?'primary':'')+'" data-merchant-action="'+action+'" '+extra+(state.busy?' disabled':'')+'>'+label+'</button>';
  function canImport(c) {
    if(state.scan?.status!=='complete'||state.scan.importable===false||new Date(state.scan.expiresAt).getTime()<=Date.now()+state.clockOffset||c.registered||c.registrationConflict)return false;
    if(typeof c.canRegister==='boolean')return c.canRegister;
    return ['moonraker','octoprint'].includes(c.protocol)&&c.connectionState==='online';
  }
  const printStates={IDLE:'空闲',PREPARE:'准备中',RUNNING:'打印中',PAUSE:'已暂停',FINISH:'打印已完成',FAILED:'打印失败'};
  function bambuStatus(d) {
    if(d.connectionReason==='IDENTITY_CONFLICT')return '标识冲突';
    if(d.connectionState==='authorization_required')return '待本地授权';
    if(d.connectionState!=='online')return '离线或观察已过期';
    const e=d.probeEvidence;
    if(e?.method!=='MQTT_TLS')return '状态待核实';
    const status=printStates[e.printState]||'已连接 · 状态未知';
    return ['RUNNING','PAUSE'].includes(e.printState)&&Number.isInteger(e.progressPercent)&&e.progressPercent>=0&&e.progressPercent<=100?status+' · '+e.progressPercent+'%':status;
  }
  const protocolName=p=>p==='bambu'?'拓竹 LAN':p;
  const bambuLocalHelp='在打印机所在局域网的电脑打开 BAMBU-GATEWAY-WINDOWS.cmd，选择只读授权。macOS / Linux 运行 node tools/bambu-gateway.mjs。';

  const onlineGateways=()=>state.gateways.map(displayGateway).filter(g=>g.status==='online'&&!g.revokedAt);
  function notice(){return state.error?'<div class="request-notice error" role="alert">'+I('info')+'<span>'+esc(state.error.message)+'</span>'+button('retry','重试')+'</div>':'';}
  function go(view){state.view=['overview','devices','capabilities','inquiries','pricing','orders','operations'].includes(view)?view:'overview';const hash=state.view==='overview'?'':'#'+state.view;history.replaceState(null,'','/merchant'+hash);render();scheduleInventoryRead();window.scrollTo({top:0,behavior:'instant'});if(state.view==='pricing')loadPricing();if(state.view==='operations')operations?.load();if(['capabilities','inquiries'].includes(state.view))workflow?.load(true);}
  function applyDevices(result){state.devices=result.devices||[];state.counts=result.counts||state.counts;if(result.gateways)state.gateways=result.gateways;state.lastRefreshed=Date.now();state.clockOffset=Number.isFinite(result.serverNow)?result.serverNow-Date.now():0;scheduleFreshness();scheduleInventoryRead();}
  async function load(show=true){
    if(state.loading)return;state.loading=true;if(show)render();
    try{
      if(auth&&!auth.state.loaded)await auth.load();
      if(auth&&!auth.authenticated()){state.profile=null;state.loaded=true;state.error=null;return;}
      const session=await get('/merchant/session');state.profile=session.profile;state.error=null;
      if(state.profile){
        const [devices,gateways,scan]=await Promise.all([get('/merchant/devices'),get('/merchant/gateways'),get('/merchant/scan-result')]);
        applyDevices(devices);state.gateways=gateways.gateways||[];state.scan=scan.scan||null;if(state.view==='pricing')await loadPricing(false);if(state.view==='operations')await operations?.load({quiet:true});if(['capabilities','inquiries'].includes(state.view))await workflow?.load(true,{quiet:true});
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
    return '<div class="summary-grid merchant-summary">'+[['已添加设备',counts.real,'真实登记'],['状态可读',counts.online,'最近一次网关检测'],['待检查设备',counts.offline,'离线、过期或待授权'],['待添加设备',pending,'最近一次真实检测']].map(([label,count,note])=>'<div class="summary-card"><span>'+label+'</span><strong>'+Number(count||0)+'</strong><p>'+note+'</p></div>').join('')+'</div>';
  }
  function loginPage(){
    const account=auth?.renderPanel({merchant:true})||'<p>正在连接账号服务…</p>';
    const enrollment=auth?.authenticated()?'<div class="merchant-enrollment">'+notice()+
      (connection()==='offline'?'<p class="auth-help">店铺资料暂时无法加载，请检查连接后重试。</p>'+button('reconnect','重新连接',true):!state.loaded||state.loading?'<div class="login-loading" role="status">'+I('clock')+'正在检查店铺资料…</div>':
      state.profile?'<h3>你的制造空间</h3><div class="merchant-profile-ready">'+I('check')+'<div><strong>'+esc(state.profile.name)+'</strong><span>店铺资料已创建</span></div></div>'+button('enter','进入商家工作台 '+I('arrow'),true,'style="width:100%"'):
      '<h3>开通店铺资料</h3><p class="auth-help">登录完成后，为你的制造空间起一个名字。</p><label class="field-label" for="merchant-name">店铺或工作室名称</label><input id="merchant-name" class="input" maxlength="60" placeholder="例如：我的制造工作室" autocomplete="organization"/><div id="merchant-name-error" class="error-text" role="alert"></div>'+button('enroll','创建店铺资料 '+I('arrow'),true,'style="width:100%;margin-top:20px"'))+'<p class="login-footnote">当前为商家功能沙盒。创建店铺资料不代表完成商家资质认证。</p></div>':'';
    return '<div class="merchant-login"><div class="login-story"><div class="eyebrow">COFORGE FOR BUSINESS</div><h1>让制造，更简单。</h1><p>管理你的设备。接收新的订单。<br/>让工作台回归简单。</p><div class="login-benefits"><span>'+I('devices')+'设备一目了然</span><span>'+I('search')+'发现并批量添加</span><span>'+I('orders')+'跟进生产与交付</span></div></div><section class="login-card">'+account+enrollment+'<a class="text-link auth-return" href="/">返回个人创作空间 '+I('arrow')+'</a></section></div>';
  }
  function overview(){
    const connected=onlineGateways();
    return heading('BUSINESS WORKSPACE','工作台','欢迎回来，'+esc(state.profile.name)+'。','<a class="btn" href="'+esc(tradeInboxHref('merchant',undefined,hasPlatformRoutes() && connection()!=='offline'))+'">买家消息</a>'+button('operations','生产中心')+button('inquiries','查看需求 '+I('arrow'),true))+summary()+
      '<div class="merchant-overview-grid"><section class="card overview-feature"><div class="overview-feature-icon">'+I('printer')+'</div><h2>接入设备</h2><p>在农场电脑连接网关后，即可发现并登记局域网里的设备。</p><div class="overview-feature-actions">'+button('bambu-connect','一键接入拓竹 '+I('plus'),true)+button('discover','检测其他设备')+'</div></section><section class="card gateway-overview"><div class="section-heading"><h2>本地网关</h2><span class="badge">'+connected.length+' 个在线</span></div><div class="gateway-graphic">'+I('network')+'</div><h3>'+(connected.length?'网关已连接':'连接第一台网关')+'</h3><p>在设备所在电脑运行网关，读取设备状态。</p>'+button('pair','连接网关 '+I('arrow'))+'</section></div>'+
      '<div class="merchant-bottom-note">'+I('shield')+'<span>拓竹设备可先登记，再在本地授权读取打印状态。</span><button class="text-link" data-merchant-action="demo">先体验添加流程 '+I('arrow')+'</button></div>';
  }
  function registry(){
    const real=state.devices.filter(d=>d.source!=='demo'),demo=state.devices.filter(d=>d.source==='demo');
    return heading('YOUR MACHINES','设备','查看设备状态，检测并添加新设备。',button('refresh',I('rotate')+'查询已接入设备')+button('discover','选择设备添加')+button('bambu-connect',I('plus')+'一键接入拓竹',true))+summary()+
    '<section class="card equipment-section"><div class="card-head"><h2>我的设备 <span class="small muted">'+real.length+'</span></h2><span class="small muted">'+(state.loading?'正在查询…':'最近查询 '+date(state.lastRefreshed))+'</span></div>'+
    (real.length?'<div class="equipment-list">'+real.map(deviceRow).join('')+'</div>':'<div class="empty-state device-empty"><div class="empty-printer">'+I('printer')+'</div><h3>还没有设备</h3><p>首次使用请先连接农场电脑上的网关。已配对后，可一键登记该局域网发现的拓竹设备。</p></div>')+'</section>'+
    (state.scan?scanPanel():'')+
    '<section class="gateway-section"><div class="section-heading"><h2>网关连接</h2>'+button('pair','连接网关 '+I('plus'))+'</div>'+(state.gateways.length?'<div class="gateway-list">'+state.gateways.map(displayGateway).map(g=>'<div class="gateway-row"><span class="gateway-icon">'+I('network')+'</span><div><strong>'+esc(g.name)+'</strong><p>'+esc(g.id)+' · '+date(g.lastSeenAt)+'</p></div><span class="badge">'+(g.status==='online'?'在线':g.status==='revoked'?'已撤销':'离线')+'</span>'+(g.status==='revoked'?'':button('revoke','撤销连接',false,'data-gateway-id="'+esc(g.id)+'"'))+'</div>').join('')+'</div>':'<div class="gateway-empty"><span>还没有连接本地网关。</span><button class="text-link" data-merchant-action="pair">查看连接方式 '+I('arrow')+'</button></div>')+'</section>'+
    (demo.length?'<details class="demo-devices"><summary>演示设备 · '+demo.length+' 台<span>不计入真实设备</span></summary><div class="equipment-list">'+demo.map(deviceRow).join('')+'</div></details>':'')+
    '<div class="merchant-bottom-note"><span>支持拓竹局域网发现、Moonraker 和 OctoPrint。接入仅登记和读取状态。</span><button class="text-link" data-merchant-action="demo">体验演示检测 '+I('arrow')+'</button></div>';
  }
  function deviceRow(record) {
    const d=displayDevice(record),bambu=d.protocol==='bambu';
    const label=bambu?bambuStatus(d):(statusLabels[d.connectionState]||'待检查');
    const model=bambu?(d.model||'型号待确认'):'型号待确认';
    const detail=bambu&&d.connectionState==='online'?'状态读取于 '+date(d.lastSeenAt):connectionReasons[d.connectionReason]||'最近观察 '+date(d.lastSeenAt);
    return '<article class="equipment-row"><span class="equipment-icon">'+I('printer')+'</span><div class="equipment-name"><strong>'+esc(d.name)+'</strong><span>'+esc(protocolName(d.protocol))+' · '+esc(model)+'</span></div><div class="equipment-address"><span>'+esc(d.endpoint||'演示地址')+'</span><small>'+esc(detail)+'</small></div><span class="status-pill '+(d.connectionState==='online'?'status-online':'')+'"><i></i>'+esc(label)+'</span><button class="text-link equipment-capability" data-merchant-action="device-details" data-device-id="'+esc(d.id)+'">识别详情 '+I('arrow')+'</button></article>';
  }
  function deviceDetails(id){
    const record=state.devices.find(d=>d.id===id);if(!record)return;
    const d=displayDevice(record),e=d.probeEvidence,bambu=d.protocol==='bambu';
    const fields=[['协议',protocolName(d.protocol)],['识别依据',verificationLabels[d.verification?.level]||'旧版登记，建议重新检测'],['最近观察',date(d.lastSeenAt)]];
    if(bambu)fields.push(['机型',d.model||'未识别，请核对打印机屏幕'],['打印状态',bambuStatus(d)],['现场与工艺验收','尚未验收']);
    else fields.push(['服务状态',connectionReasons[d.connectionReason]||'待重新检测'],['只读探针',e?e.method+' '+e.endpoint:d.source==='demo'?'演示数据，无真实探针':'旧版回报未提供'],['服务版本',e?.serviceVersion||'未提供'],['控制器连接',e?.controllerConnected===true?'已连接（不代表当前可打印）':e?.controllerConnected===false?'未连接':'本次协议接口未验证'],['控制器状态',e?.controllerState||'未读取'],['具体机型','尚未确认'],['现场与工艺认证','尚未验收']);
    const hint=bambu?(d.connectionState==='authorization_required'?bambuLocalHelp:'网关会定期更新已登记拓竹设备的状态，也可以立即重新检测。'):'观察超过有效期后需要重新检测。';
    const gateway=onlineGateways().find(g=>g.id===d.gatewayId);
    modal('设备识别详情','<p><strong>'+esc(d.name)+'</strong></p><div class="setup-steps">'+fields.map(([label,value])=>'<div><span><strong>'+esc(label)+'</strong><small>'+esc(value)+'</small></span></div>').join('')+'</div><p class="inline-note">'+(d.source==='demo'?'这是演示设备。':esc(hint))+' 文件上传与自动开打尚未开放。</p>','<button class="btn" data-action="close">关闭</button>'+(gateway?button('rescan-gateway','重新检测本地状态',true,'data-gateway-id="'+esc(gateway.id)+'"'):''));
  }
  function candidateBadge(c) {
    if(c.registrationConflict==='OTHER_GATEWAY')return '已在另一网关登记';
    if(c.registrationConflict==='IDENTITY_CHANGED')return '设备标识冲突';
    if(c.registered)return '已添加';
    if(c.protocol==='bambu')return (canImport(c)?'可登记 · ':'')+bambuStatus(c);
    if(c.connectionState==='authorization_required')return '需要设备授权';
    if(canImport(c))return '可添加';
    return c.connectionState==='offline'?'未连接':'暂不可添加';
  }
  function candidateRow(c,selectable) {
    const eligible=selectable&&canImport(c);
    const checkbox=selectable?'<input type="checkbox" data-candidate-id="'+esc(c.id)+'" '+(eligible?'':'disabled')+' '+(eligible&&state.selected.has(c.id)?'checked':'')+'/>':'';
    const tag=selectable?'label':'div';
    return '<'+tag+' class="candidate-row">'+checkbox+'<span class="equipment-icon">'+I('printer')+'</span><span class="candidate-name"><strong>'+esc(c.name)+'</strong><small>'+esc(protocolName(c.protocol))+' · '+esc(c.endpoint||'演示设备')+'</small></span><span class="badge">'+esc(candidateBadge(c))+'</span></'+tag+'>';
  }
  function partialScanNotice(codes) {
    if(!Array.isArray(codes)||!codes.length)return '';
    const messages=[];
    if(codes.some(x=>['DISCOVERY_TARGET_LIMIT','BAMBU_DISCOVERY_LIMIT','BAMBU_PACKET_LIMIT'].includes(x)))messages.push('本次达到扫描上限，可按网关划分设备。');
    if(codes.some(x=>['BAMBU_LISTEN_UNAVAILABLE','BAMBU_MULTICAST_UNAVAILABLE','NO_LOCAL_IPV4_INTERFACE','MDNS_SOCKET_UNAVAILABLE','MDNS_SEND_FAILED'].includes(x)))messages.push('请核对网关网络、局域网广播及本地 UDP 1990/2021 端口。');
    if(codes.includes('BAMBU_LISTEN_DISABLED'))messages.push('拓竹广播监听已关闭，可在农场电脑的向导中调整配置。');
    if(codes.some(x=>['BAMBU_DISCOVERY_IDENTITY_CONFLICT','BAMBU_CONFIG_ADDRESS_CHANGED','INVALID_DISCOVERY_ADDRESS'].includes(x)))messages.push('请在农场电脑上核对设备地址和身份后重新检测。');
    return '<p class="inline-note" role="status">本次检测可能不完整。'+(messages.join('')||'请检查网关并重试。')+'</p>';
  }
  function scanPanel(){
    const s=state.scan,auto=s.autoRegister==='bambu',result=s.registrationResult;
    const candidates=(s.candidates||[]).filter(c=>!auto||c.protocol==='bambu');
    const available=candidates.filter(canImport),selected=available.filter(c=>state.selected.has(c.id));
    const effectiveStatus=s.status==='complete'&&new Date(s.expiresAt).getTime()<=Date.now()+state.clockOffset?'expired':s.status==='complete'&&s.importable===false?'unavailable':s.status;
    const stateText={pending:'正在等待网关检测',complete:'检测完成',failed:'检测未完成',expired:'检测已过期',unavailable:'暂时无法添加'}[effectiveStatus]||'请重新检测';
    const title=s.scope==='demo'?'演示检测':auto?'拓竹接入':'设备检测';
    const retry=s.scope==='demo'?'demo':auto?'bambu-connect':'discover';
    let content='';
    if(auto&&result)content+='<p class="scan-demo-note" role="status">新增 '+Number(result.added)+' 台 · 此前已登记 '+Number(result.existing)+' 台 · 未添加 '+Number(result.blocked)+' 台。'+(result.blocked?'请核对候选设备的状态、网关和登记容量。':'')+'</p>';
    content+=partialScanNotice(s.partialDiagnostics);
    if(s.scope==='demo')content+='<div class="scan-demo-note">这是演示数据，不来自你的网络，也不会计入真实设备。</div>';
    if(effectiveStatus==='pending'){
      content+='<div class="scan-pending">'+I('search')+'<h3>正在寻找你的设备</h3><p>'+(auto?'网关将在检测完成后批量登记本次发现的拓竹设备。':'网关会读取局域网广播和已配置的设备地址。')+'<br/>结果会自动更新。</p></div>';
    }else if(effectiveStatus!=='complete'){
      const reason=effectiveStatus==='expired'?'请重新检测以获取当前清单。':effectiveStatus==='unavailable'?'请确认网关仍在线，并重新检测。':s.error?.message||'请检查网关和本地网络后重试。';
      content+='<div class="empty-state"><h3>'+stateText+'</h3><p>'+esc(reason)+'</p>'+button(retry,'重新检测')+'</div>';
    }else if(!candidates.length){
      const hint=auto?'请确认网关与打印机位于同一局域网，并允许本地 UDP 1990/2021。若网络不转发广播，可在农场电脑使用拓竹网关向导指定设备地址。':'请确认设备与网关位于同一局域网。也可以在网关配置中指定设备地址。';
      content+='<div class="empty-state"><h3>'+(auto?'没有发现拓竹设备':'没有发现可用设备')+'</h3><p>'+hint+'</p>'+button(retry,'再次检测')+'</div>';
    }else{
      if(!auto)content+='<div class="scan-select-bar"><label class="check-line"><input type="checkbox" data-merchant-select-all '+(selected.length===available.length&&available.length?'checked':'')+' '+(!available.length?'disabled':'')+'/>选择可添加设备</label><span>'+candidates.length+' 台已发现 · '+available.length+' 台可添加</span></div>';
      const rows='<div class="candidate-list">'+candidates.map(c=>candidateRow(c,!auto)).join('')+'</div>';
      if(auto){
        const previous=$('.bambu-scan-list');
        const opened=previous?.open&&previous.dataset.scanId===s.id;
        content+='<details class="bambu-scan-list" data-scan-id="'+esc(s.id)+'"'+(opened?' open':'')+'><summary>查看本次发现的 '+candidates.length+' 台设备</summary>'+rows+'</details>';
      }else content+=rows;
      if(!auto)content+='<div class="scan-footer"><span>添加设备不会启动打印。</span>'+button('import','添加所选设备'+(selected.length?' · '+selected.length:''),true,selected.length?'':'disabled')+'</div>';
      if(auto&&candidates.some(c=>c.connectionState==='authorization_required'))content+='<p class="inline-note">'+esc(bambuLocalHelp)+' 授权后重新检测即可读取打印状态。</p>';
    }
    return '<section class="card scan-panel" aria-live="polite"><div class="card-head"><h2>'+title+' <span class="badge">'+stateText+'</span></h2>'+button('refresh-scan',I('rotate')+'刷新结果')+'</div>'+content+'</section>';
  }
  const pricingFields=[
    ['targetMarginBps','目标毛利率','%',100,0,80,.01],
    ['minimumOrderProfitCents','每单最低预测利润','元 / 单',100,0,10000,.01],
    ['minimumProfitCentsPerMachineHour','每设备小时最低预测利润','元 / 设备小时',100,0,1000,.01],
    ['PLA','PLA 材料采购价','元 / 千克',100,.01,100000,.01],
    ['PETG','PETG 材料采购价','元 / 千克',100,.01,100000,.01],
    ['machineCostCentsPerHour','设备折旧与维护','元 / 设备小时',100,0,1000,.01],
    ['laborCentsPerHour','人工单价','元 / 人工小时',100,0,1000,.01],
    ['estimatedThroughputGramsPerHour','演示出料估速','克 / 设备小时',1,.1,1000,.01],
    ['warmupMinutesPerPlate','每板预热时间','分钟 / 板',1,0,120,.01],
    ['electricityCentsPerKwh','电价','元 / 千瓦时',100,0,100,.01],
    ['averagePowerWatts','设备平均功率','瓦',1,0,10000,1],
    ['orderSetupMinutes','每单准备时间','分钟 / 单',1,0,600,.01],
    ['plateSetupMinutes','每板换板与准备','分钟 / 板',1,0,600,.01],
    ['finishingMinutesPerPart','每件清理与后处理','分钟 / 件',1,0,600,.01],
    ['packagingCentsPerOrder','每单包装成本','元 / 单',100,0,1000,.01],
    ['riskReserveBps','成本风险预留比例','%',100,0,100,.01]
  ];
  const priceMoney=cents=>'¥'+(Number(cents)/100).toFixed(2);
  const margin=bps=>(Number(bps)/100).toFixed(2)+'%';
  function pricingProfile(){return state.pricing?.profiles.find(p=>p.farmId===state.pricingFarm);}
  function pricingDraft(){
    const profile=pricingProfile();if(!profile)return {};
    state.pricingDraftRevisions[profile.farmId]??=profile.revision;
    return state.pricingDrafts[profile.farmId]??=Object.fromEntries(pricingFields.map(([key,,,scale])=>[key,String((['PLA','PETG'].includes(key)?profile.materialCostCentsPerKg[key]:profile[key])/scale)]));
  }
  async function loadPricing(show=true,resetDrafts=false){
    if(state.pricingLoading)return;state.pricingLoading=true;if(show)render();
    try{state.pricing=await get('/merchant/pricing');state.error=null;if(resetDrafts){state.pricingDrafts={};state.pricingDraftRevisions={};state.retry=null;}if(!pricingProfile())state.pricingFarm=state.pricing.profiles[0]?.farmId||'f1';}
    catch(error){state.error=error;}
    finally{state.pricingLoading=false;if(show)render();}
  }
  async function savePricing(){
    const profile=pricingProfile(),form=$('#merchant-pricing-form');if(!profile||state.pricingLoading||!form?.reportValidity())return;
    const draft=pricingDraft(),values={materialCostCentsPerKg:{}};
    for(const [key,,,scale,min,max,step] of pricingFields){
      const raw=Number(draft[key]),value=scale===100?Math.round(raw*scale):raw;
      if(draft[key]===''||!Number.isFinite(raw)||raw<min||raw>max||Math.abs(raw/step-Math.round(raw/step))>.000001){state.error={message:'请检查计价参数的范围和小数位。'};render();return;}
      if(['PLA','PETG'].includes(key))values.materialCostCentsPerKg[key]=value;else values[key]=value;
    }
    return mutation('pricing',{farmId:profile.farmId,expectedRevision:state.pricingDraftRevisions[profile.farmId],profile:values,demoAcknowledged:true},async()=>{
      delete state.pricingDrafts[profile.farmId];delete state.pricingDraftRevisions[profile.farmId];await loadPricing(false);toast('演示计价已保存。新报价使用新设置，已有订单金额保持不变。');
    });
  }
  function pricingInput(field){
    const [key,label,unit,,min,max,step]=field;
    return '<label class="pricing-field" for="pricing-'+key+'"><span>'+label+'</span><div><input class="input" id="pricing-'+key+'" data-pricing-field="'+key+'" type="number" inputmode="decimal" required min="'+min+'" max="'+max+'" step="'+step+'" value="'+esc(pricingDraft()[key])+'" '+(state.busy?'disabled':'')+'/><small>'+unit+'</small></div></label>';
  }
  function economicsDetails(e){
    if(!e)return '<p class="pricing-muted">旧订单没有成本快照，无法反推真实利润。</p>';
    const costs = e.costBreakdown;
    let parts;
    if (costs) {
      const labor = Number.isFinite(costs.laborCents) ? [['准备与后处理人工', costs.laborCents]] : [['每单准备人工', costs.orderSetupCents], ['换板准备人工', costs.plateSetupCents], ['逐件后处理人工', costs.finishingCents]];
      parts = [['材料', costs.materialCents], ['设备折旧与维护', costs.machineCents], ['电费', costs.electricityCents], ...labor, ['包装', costs.packagingCents], ['成本风险预留', costs.riskReserveCents]].filter(([, value]) => Number.isFinite(value));
    } else {
      const label = e.source === 'MERCHANT_COST_DECLARATION' ? '确认方案中的商家申报成本' : '确认方案中的成本合计（含估算下限）';
      parts = [[label, e.estimatedCostCents]];
    }
    return '<div class="pricing-economics-summary"><div><span>已配置成本估算</span><strong>'+priceMoney(e.estimatedCostCents)+'</strong></div><div><span>预测制造利润</span><strong>'+priceMoney(e.estimatedProfitCents)+'</strong></div><div><span>预测利润率（未计税费等）</span><strong>'+margin(e.estimatedMarginBps)+'</strong></div></div><details class="pricing-cost-details"><summary>查看内部成本估算</summary>'+parts.map(([name,value])=>'<div class="detail-row"><span>'+name+'</span><strong>'+priceMoney(value)+'</strong></div>').join('')+'<p class="pricing-muted">预计设备机时 '+Number(e.productionHours??e.durationSeconds/3600).toFixed(2)+' 小时 · 计价版本 '+e.pricingRevision+'。利润按制造应收减上述成本预测，未计入税费、支付渠道费及未录入的经营开销，不是实际净利润。</p></details>';
  }
  function merchantReceivable(breakdown){
    if(!breakdown)return '<p class="pricing-muted">缺少可核验分账快照，暂不展示应收。</p>';
    return '<div class="pricing-receivable">'+[['制造应收',breakdown.manufacturingCents],['运费补偿',breakdown.shippingCents],['平台服务费（不归商家）',breakdown.platformFeeCents],['商家应收合计',breakdown.merchantReceivableCents]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+priceMoney(value)+'</strong></div>').join('')+'</div>'+(breakdown.source==='LEGACY_DERIVED'?'<p class="pricing-muted">按旧订单的原报价拆分，不按当前设置重新计价。</p>':'');
  }
  function pricingPage(){
    const profile=pricingProfile();
    let content=heading('BATCH PRICING','批量制造，也要有好收益。','按整板摊薄准备成本，逐件保留耗材、机时与后处理。收益底线由商家设置。',button('refresh-pricing','重新读取',false,state.pricingLoading?'disabled':''));
    if(!profile)return content+'<section class="card empty-state"><p>'+(state.pricingLoading?'正在读取演示计价…':'暂未读取计价设置。请重试。')+'</p></section>';
    const quotes=(state.pricing.quoteEconomics||[]).filter(q=>q.farmId===profile.farmId&&!q.usedByOrderId).slice(0,1),orders=(state.pricing.orderEconomics||[]).filter(o=>o.farmId===profile.farmId);
    content+='<div class="pricing-demo-note">演示参数 · 以下 3 家工场是当前账号中的沙盒实例。默认目标毛利率 30% 仅用于试算，不是行业正常利润或收益保证；不会更改真实商家的计价。</div><section class="card pricing-settings"><div class="pricing-settings-head"><div><h2>设置你的计价底线</h2><p>制造报价取三者的最高值：目标毛利率、每单利润下限、每设备小时利润下限。</p></div><div class="pricing-farm-select"><label for="pricing-farm">演示工场</label><select class="select" id="pricing-farm" '+(state.busy?'disabled':'')+'>'+state.pricing.profiles.map(p=>'<option value="'+esc(p.farmId)+'" '+(p.farmId===profile.farmId?'selected':'')+'>'+esc(p.farmName)+' · 演示</option>').join('')+'</select></div></div><form id="merchant-pricing-form"><div class="pricing-field-grid pricing-protection">'+pricingFields.slice(0,3).map(pricingInput).join('')+'</div><div class="pricing-field-grid">'+pricingFields.slice(3,7).map(pricingInput).join('')+'</div><details class="pricing-advanced"><summary>更多成本参数</summary><div class="pricing-field-grid">'+pricingFields.slice(7).map(pricingInput).join('')+'</div></details><div class="pricing-save-row"><p>保存仅影响新报价；已下单金额保持原快照。重新读取会放弃未保存的修改。</p>'+button('save-pricing',state.busy?'正在保存…':'保存演示计价',true,state.pricingLoading?'disabled':'')+'</div></form></section><div class="pricing-method-note"><strong>一板多件，不是同样时间无限复制。</strong><p>材料、挤出机时和逐件后处理随数量增加，每单准备与换板成本按订单和板数分摊。未有匹配的切片结果时，使用包围盒与演示参数估算；有有效结果的新报价采用切片耗材和机时，再按商家底线计价。不与其他客户拼单，也不等待凑满一板。</p></div>';
    if(quotes.length){const q=quotes[0];content+='<section class="card pricing-preview"><div class="pricing-settings-head"><div><h2>最近一次报价预览</h2><p>'+esc(q.modelName)+' · '+q.quantity+' 件 · '+q.batch.plateCount+(q.batch.method==='SLICER_OUTPUT_ESTIMATE'?' 板（已切片估算）':' 板（包围盒估算）')+(q.pricingRevision!==profile.revision?' · 旧计价版本，请重新询价':Date.now()>=q.expiresAt?' · 报价已过期':'')+'</p></div><span class="badge">商家内部测算</span></div>'+merchantReceivable(q.pricingSummary)+economicsDetails(q)+'</section>';}
    content+='<section class="pricing-orders"><div class="section-heading"><h2>订单收益估算 <span class="small">'+orders.length+' 笔 · 当前演示工场</span></h2></div><p class="pricing-muted">展示下单时的成本和金额快照。取消、退款及未完成订单的预测利润不代表已实现收入。</p>'+(orders.length?orders.map(o=>'<article class="card pricing-order"><div class="pricing-order-title"><div><h3>'+esc(o.modelName)+' · '+o.quantity+' 件</h3><p>'+esc(o.orderId)+'</p></div><span class="badge">'+(o.refundState==='SIMULATED_REFUNDED'?'已模拟退款':o.legacyUnsplit?'历史结算':o.settlementState==='SIMULATED_SETTLED'?'模拟已结算':'尚未结算')+'</span></div>'+(o.legacyUnsplit?'<p class="pricing-muted">旧版已结算记录按原金额保留，不套用新费率或重新计算商家应收。</p>':merchantReceivable(o.settlementBreakdown)+economicsDetails(o.economics))+'</article>').join(''):'<div class="card empty-state"><p>还没有此工场的订单。完成演示询价后，可在这里核对收益。</p></div>')+'</section>';
    return content;
  }
  function renderContent(){
    if((auth&&!auth.authenticated())||!state.profile||location.pathname.replace(/\/$/,'')==='/merchant/login')return loginPage();
    return notice()+(state.view==='operations'&&operations?operations.page():state.view==='devices'?registry():state.view==='capabilities'?workflow.capabilitiesPage():state.view==='inquiries'?workflow.merchantInquiries():state.view==='pricing'?pricingPage():state.view==='orders'?'<div class="merchant-legacy-label">订单履约沙盒 · 以下生产、物流与结算为模拟操作，与真实设备清单分开。</div>'+legacyOrders():overview());
  }
  function nav(){
    if(!state.profile)return '<a href="/" class="portal-switch">个人创作 '+I('arrow')+'</a>';
    const item=([id,label])=>'<button class="'+(state.view===id?'active':'')+'" data-merchant-action="view" data-view="'+id+'"'+(state.view===id?' aria-current="page"':'')+'>'+label+'</button>';
    return '<nav class="header-nav" aria-label="商家导航">'+[['overview','概览'],['inquiries','模型需求'],['orders','订单'],['devices','设备'],['operations','生产中心']].map(item).join('')+'<details class="nav-more'+(['capabilities','pricing'].includes(state.view)?' active':'')+'"><summary aria-label="商家设置">设置</summary><div class="nav-more-panel">'+[['capabilities','制造配置'],['pricing','计价']].map(item).join('')+'<button data-auth-action="logout">退出登录</button></div></details></nav><a href="/" class="portal-switch">个人创作 '+I('arrow')+'</a>';
  }
  function gatewayDownload() {
    if(!hasPlatformRoutes(document)||connection()!=='online')return '<p class="inline-note">请从已连接平台的商家网页下载网关程序和配对配置。</p>';
    return '<p><a class="btn" href="/downloads/gongzao-bambu-gateway.zip" download>下载 Windows 网关 '+I('down')+'</a></p><p class="inline-note">农场电脑需安装 Node.js 24 或更高版本。解压网关程序包后，双击 BAMBU-GATEWAY-WINDOWS.cmd。</p>';
  }
  function discover(autoRegister=false){
    const gateways=onlineGateways();
    if(!gateways.length&&state.gateways.some(g=>displayGateway(g).status==='offline')){
      modal('恢复本地网关连接','<p>已配对的网关当前离线。请在原农场电脑启动网关，随后重新查询。</p><p class="inline-note">Windows 可双击 BAMBU-GATEWAY-WINDOWS.cmd 并选择启动。macOS / Linux 运行 node tools/bambu-gateway.mjs。</p>','<button class="btn" data-action="close">关闭</button>'+button('refresh','查询连接状态',true));return;
    }
    if(!gateways.length){
      modal('连接本地网关','<div class="connect-explainer">'+I('network')+'<h3>需要一个在线的本地网关</h3><p>网关运行在打印机所在局域网的电脑上。</p></div>'+gatewayDownload()+'<div class="setup-steps"><div><b>1</b><span>点击“连接本地网关”生成并下载这家店的配对配置。</span></div><div><b>2</b><span>在农场电脑的网关向导导入配置并启动。</span></div><div><b>3</b><span>回到设备页，点击“一键接入拓竹”。</span></div></div>','<button class="btn" data-action="close">稍后</button>'+button('pair','连接本地网关',true));return;
    }
    if(gateways.length===1)return scan('real',gateways[0].id,autoRegister);
    modal(autoRegister?'一键接入拓竹':'检测并添加设备','<p>'+ (autoRegister?'选择农场网关，自动登记本次检测到的拓竹设备。':'选择要检测的农场网关。')+'</p><label class="field-label" for="discovery-gateway">选择网关</label><select id="discovery-gateway" class="select">'+gateways.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('')+'</select><div id="merchant-modal-error" class="error-text"></div>','<button class="btn" data-action="close">取消</button>'+button(autoRegister?'start-bambu-scan':'start-real-scan',autoRegister?'检测并登记拓竹':'开始检测',true));
  }
  function demoPrompt(){modal('体验设备添加流程','<p>使用 3 台明确标记的演示设备，体验检测、选择与添加。演示数据与真实设备分开，不代表在你的网络中发现了设备。</p>','<button class="btn" data-action="close">取消</button>'+button('start-demo-scan','使用演示数据体验',true));}
  function pairPrompt(){pairing=null;modal('连接本地网关','<p>在连接打印机的电脑上运行网关。平台只读取获授权设备，不会自动开启打印。</p><label class="field-label" for="gateway-name">网关名称</label><input id="gateway-name" class="input" maxlength="60" placeholder="例如：工作室电脑" value="工作室网关"/><div id="merchant-modal-error" class="error-text"></div>','<button class="btn" data-action="close">取消</button>'+button('create-pairing','生成网关配置',true));}
  function pairedDialog(result){
    if(!result.token){pairing=null;modal('连接已创建','<p>为了保护授权信息，网关密钥只显示一次。本次为重复请求，没有再次返回密钥；如未保存配置，请撤销该连接后重新创建。</p>','<button class="btn" data-action="close">知道了</button>');return;}
    pairing={platformUrl:result.platformOrigin||location.origin,token:result.token,mdns:true,bambuLan:true,bambuPrinters:[],targets:[]};
    modal('网关已准备好','<p>在农场电脑保存配对配置，用网关向导导入后启动。</p>'+gatewayDownload()+(session()?.persistence==='d1'?'<div class="pairing-hosted-note">此私有预览还需要配置站点服务访问权限。请按源码中的网关接入说明补充站点访问配置；本地版本可直接配对。</div>':'')+'<div class="setup-steps"><div><b>1</b><span><strong>下载配对配置</strong><small>配置包含设备读取权限，请仅保存于你的电脑。</small></span></div><div><b>2</b><span><strong>在农场电脑启动网关</strong><small>Windows 双击 BAMBU-GATEWAY-WINDOWS.cmd，导入下载的配置并选择启动网关。macOS / Linux 运行 node tools/bambu-gateway.mjs。</small></span></div><div><b>3</b><span><strong>回到平台查询连接</strong><small>点击“一键接入拓竹”批量登记。要读取状态，请先在本地向导完成只读授权，再重新检测。</small></span></div></div><p class="inline-note">授权文件仅在本次窗口中可下载。文件移动后，请在命令中使用实际路径。</p>','<button class="btn" data-merchant-action="finish-pairing">完成并查询</button>'+button('download-config','下载配对配置 '+I('down'),true),true);
  }
  async function scan(scope,gatewayId,autoRegister=false){
    await mutation('scan',{scope,...(gatewayId?{gatewayId}:{}),...(autoRegister?{autoRegister:'bambu'}:{})},async result=>{state.scan=result.scan;state.selected=new Set((result.scan.candidates||[]).filter(canImport).map(c=>c.id));closeModal();go('devices');scheduleFreshness();if(state.scan.status==='pending')schedulePoll();});
  }
  function schedulePoll(){clearTimeout(state.pollTimer);if(state.scan?.status!=='pending')return;state.pollTimer=setTimeout(()=>refreshScan(false),2500);}
  async function refreshScan(announce=true){
    if(!state.scan)return;
    const scanId=state.scan.id;
    try{
      const result=await get('/merchant/scan-result?scanId='+encodeURIComponent(scanId));
      if(state.scan?.id!==scanId)return;
      const pending=state.scan.status==='pending';
      state.scan=result.scan;state.error=null;
      if(state.scan?.status==='complete'){
        if(pending)state.selected=new Set(state.scan.candidates.filter(canImport).map(c=>c.id));
        applyDevices(await get('/merchant/devices'));
      }
      if(announce)toast('检测结果已更新');
    }
    catch(error){if(state.scan?.id===scanId){state.error=error;clearTimeout(state.pollTimer);render();}return;}
    render();schedulePoll();scheduleFreshness();
  }
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-merchant-action]');if(!target||!isRoute())return;
    event.preventDefault();const action=target.dataset.merchantAction;if(state.busy)return;
    if(action==='view')return go(target.dataset.view);
    if(action==='devices')return go('devices');
    if(action==='capabilities'||action==='inquiries'||action==='operations')return go(action);
    if(action==='pricing')return go('pricing');
    if(action==='refresh-pricing')return loadPricing(true,true);
    if(action==='save-pricing')return savePricing();
    if(action==='device-details')return deviceDetails(target.dataset.deviceId);
    if(action==='enter'){history.replaceState(null,'','/merchant');return go('overview');}
    if(action==='enroll'){if(auth&&!auth.authenticated()){toast('请先登录共造账号。');return;}const name=$('#merchant-name')?.value.trim();if(!name){$('#merchant-name-error').textContent='请填写店铺或工作室名称。';return;}return mutation('enroll',{name},async result=>{state.profile=result.profile;history.replaceState(null,'','/merchant');await load(false);toast('商家空间已创建');});}
    if(action==='retry'){if(state.retry)return execute(state.retry.task,state.retry.success);return state.view==='pricing'?loadPricing():load();}
    if(action==='reconnect')return reconnect();
    if(action==='refresh'){closeModal();await load();toast(state.error?'查询未完成，请重试':'已查询最新设备状态');return;}
    if(action==='discover')return discover();
    if(action==='bambu-connect')return discover(true);
    if(action==='rescan-gateway')return scan('real',target.dataset.gatewayId);
    if(action==='demo')return demoPrompt();
    if(action==='start-demo-scan')return scan('demo');
    if(action==='start-real-scan'||action==='start-bambu-scan')return scan('real',$('#discovery-gateway')?.value,action==='start-bambu-scan');
    if(action==='refresh-scan')return refreshScan();
    if(action==='import'){const candidates=(state.scan?.candidates||[]).filter(c=>state.selected.has(c.id)&&canImport(c));if(!candidates.length){toast('检测结果已失效或没有可添加设备，请刷新后重新检测。');render();return;}return mutation('devices/import',{scanId:state.scan.id,candidateIds:candidates.map(c=>c.id)},async result=>{state.selected.clear();await load(false);toast('设备已添加。重复设备会自动跳过。');});}
    if(action==='pair')return pairPrompt();
    if(action==='create-pairing'){const name=$('#gateway-name')?.value.trim();if(!name){$('#merchant-modal-error').textContent='请填写网关名称。';return;}return mutation('pairing',{name},async result=>{state.gateways.push(result.gateway);pairedDialog(result);});}
    if(action==='download-config'){if(!pairing){toast('配置已失效，请重新创建连接。');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(pairing,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='gateway.private.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('配置已下载，请在商家电脑上运行网关');return;}
    if(action==='finish-pairing'){pairing=null;closeModal();await load();go('devices');return;}
    if(action==='revoke'){const gateway=state.gateways.find(g=>g.id===target.dataset.gatewayId);if(!gateway)return;modal('撤销网关连接','<p>撤销后，'+esc(gateway.name)+' 将不能继续同步设备信息。已添加设备保留在清单中。</p>','<button class="btn" data-action="close">保留连接</button>'+button('confirm-revoke','撤销连接',true,'data-gateway-id="'+esc(gateway.id)+'"'));return;}
    if(action==='confirm-revoke')return mutation('gateways/revoke',{gatewayId:target.dataset.gatewayId},async()=>{pairing=null;closeModal();await load(false);toast('网关连接已撤销');});
  });
  document.addEventListener('submit',event=>{
    if(!isRoute()||event.target.id!=='merchant-pricing-form')return;
    event.preventDefault();if(!state.busy)savePricing();
  });
  document.addEventListener('input',event=>{
    if(!isRoute()||state.busy||!event.target.matches('[data-pricing-field]'))return;
    pricingDraft()[event.target.dataset.pricingField]=event.target.value;
  });
  document.addEventListener('change',event=>{
    if(!isRoute()||state.busy)return;
    if(event.target.matches('#pricing-farm')){state.pricingFarm=event.target.value;render();return;}
    if(event.target.matches('[data-candidate-id]')){const id=event.target.dataset.candidateId;if(event.target.checked)state.selected.add(id);else state.selected.delete(id);render();}
    if(event.target.matches('[data-merchant-select-all]')){state.selected=new Set(event.target.checked?(state.scan?.candidates||[]).filter(canImport).map(c=>c.id):[]);render();}
  });
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="close"]')||event.target.matches('[data-dismiss]'))pairing=null;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')pairing=null;});
  document.addEventListener('visibilitychange',()=>{scheduleInventoryRead();if(!document.hidden&&isRoute()){render();scheduleFreshness();}});
  window.addEventListener('pageshow',()=>{scheduleFreshness();scheduleInventoryRead();});
  window.addEventListener('pagehide',()=>{pairing=null;clearTimeout(inventoryTimer);clearTimeout(state.pollTimer);clearTimeout(state.freshnessTimer);});
  state.view=['devices','capabilities','inquiries','pricing','orders','operations'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
  return { isRoute, load, renderContent, nav, state, discover, pairPrompt, resetOperations:()=>operations?.reset() };
}
