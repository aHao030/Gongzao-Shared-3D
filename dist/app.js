const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iconPaths = {
 home:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 cube:'<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5v4"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 orders:'<path d="M7 4h10l3 4v13H4V8l3-4Z"/><path d="M4 8h16M9 12h6M9 16h6M9 4V2h6v2"/>',
 network:'<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10.5 7.5-4 8m7-8 4 8M8 18h8"/>',
 printer:'<path d="M5 8V3h14v5M5 17H3V8h18v9h-2M6 14h12v7H6V14Z"/><path d="M17 11h1M9 17h6"/>',
 devices:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M8 10l3 3 5-5"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
 down:'<path d="m6 9 6 6 6-6"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 file:'<path d="M14 2H5v20h14V7l-5-5Z"/><path d="M14 2v5h5M8 12h8M8 16h6"/>',
 rotate:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.1 8a7.5 7.5 0 0 1 12.4-3L20 8M4 16l2.5 3A7.5 7.5 0 0 0 19 16"/>',
 expand:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',
 minus:'<path d="M5 12h14"/>',
 cursor:'<path d="m5 3 14 9-7 1-3 7L5 3Z"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 truck:'<path d="M2 6h12v12H2V6Zm12 4h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 external:'<path d="M14 3h7v7M21 3 11 13M10 3H3v18h18v-7"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="white"/><circle cx="16" cy="17" r="3" fill="white"/>',
 grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
 bookmark:'<path d="M6 3h12v19l-6-4-6 4V3Z"/>',
 factory:'<path d="M3 21V9l6 3V7l6 4V3h4v18H3Z"/><path d="M6 16h1M11 16h1M16 16h1"/>',
 logout:'<path d="M10 3H3v18h7M8 12h13m-4-4 4 4-4 4"/>'
};
function I(name, cls=''){return '<svg class="'+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(iconPaths[name]||iconPaths.cube)+'</svg>';}
const navItems=[['home','home','工作台'],['create','plus','开始定制'],['orders','orders','我的订单'],['network','network','制造网络'],['farm','printer','农场工作台'],['catalog','devices','设备接入']];
const farms=[
 {id:'f1',name:'青屿制造工作室',city:'杭州 · 浙江',initial:'青',tone:'',mult:1,base:12,days:[3,5],ship:10,desc:'专注精细结构件与创客原型，提供 PLA、PETG 和 ABS 打印。',tags:['FDM 精细打印','小批量定制','PrusaLink'],device:'Prusa MK4S'},
 {id:'f2',name:'造物工场',city:'苏州 · 江苏',initial:'造',tone:'blue',mult:1.14,base:15,days:[2,4],ship:12,desc:'标准工艺模板与灵活排产，让功能样件更快进入测试。',tags:['快速原型','工程塑料','Moonraker'],device:'Klipper FDM 01'},
 {id:'f3',name:'拾物 3D 实验室',city:'深圳 · 广东',initial:'拾',tone:'sand',mult:.88,base:10,days:[4,7],ship:12,desc:'为独立创作者提供经济、透明的小批量生产服务。',tags:['创意设计','批量生产','OctoPrint'],device:'FDM Production 03'}
];
const materials={
 PLA:{label:'PLA',color:'#dce8e1',rate:.45,process:'FDM',tip:'适合外观原型与轻载结构。尺寸与强度要求请在下单前确认。'},
 PETG:{label:'PETG',color:'#c7dbe6',rate:.58,process:'FDM',tip:'适合韧性较高的功能样件。自动生产仅使用已验证的设备工艺模板。'},
 ABS:{label:'ABS',color:'#d9dce4',rate:.68,process:'FDM',tip:'需要具备封闭腔体与通风条件的认证设备，当前仅演示审核报价。'},
 RESIN:{label:'工程树脂',color:'#e4ddd1',rate:.96,process:'树脂',tip:'树脂工艺还包括清洗、固化和后处理，需商家审核生产计划。'},
 ALUMINUM:{label:'铝合金',color:'#b8c6cf',rate:3.6,process:'金属',tip:'金属零件需确认材料牌号、公差、支撑和后处理，由工程人员审核。'},
 CNC:{label:'CNC 铝件',color:'#cbd0d6',rate:4.5,process:'CNC',tip:'请上传 STEP 与必要的工程图；装夹、刀路和加工参数需工程审核。'}
};
const destinations={east:'中国大陆 · 华东',south:'中国大陆 · 华南',north:'中国大陆 · 华北',other:'其他地区 · 询价确认'};
const freshDevices=()=>farms.map((f,i)=>({id:'p'+(i+1),farm:f.id,name:f.device,route:['PrusaLink','Moonraker','OctoPrint'][i],state:'ready',orderId:null,material:'PLA / PETG',loadedMaterial:'PLA'}));
let saved;
try{saved=JSON.parse(localStorage.getItem('coforge.demo.v1')||'null');}catch{}
const state={page:'home',material:'PLA',quality:'standard',qty:1,unit:'mm',destination:destinations[saved?.destination]?saved.destination:'east',sort:'recommended',orders:saved?.orders||[],devices:saved?.devices||freshDevices(),networkFilter:'all',catalogFilter:'all',search:'',menuOpen:false,model:null};
for(const d of state.devices){if(!['PLA','PETG'].includes(d.loadedMaterial)){const current=state.orders.find(o=>o.id===d.orderId);d.loadedMaterial=['PLA','PETG'].includes(current?.material)?current.material:'PLA';}}
const sampleModel={name:'桌面设备固定支架.stl',size:284672,dimensions:[72,48,58],volume:22.4,triangles:[],isSample:true,review:false,faceCount:3248};
state.model={...sampleModel};
let mesh=[], yaw=-.64,pitch=.37,zoom=1,animation=0,toastTimer, focusBeforeModal=null;
const money=n=>'¥'+Number(n).toFixed(2);
const timeString=()=>new Date().toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function save(){try{localStorage.setItem('coforge.demo.v1',JSON.stringify({orders:state.orders,devices:state.devices,destination:state.destination}));}catch{toast('浏览器存储不可用，本次演示状态仅保留到页面关闭');}}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),3400);}
function needsReview(){return state.destination==='other'||state.model.review||state.model.dimensions.some(v=>v>250)||!['PLA','PETG'].includes(state.material);}
function quote(f){
 if(needsReview())return {review:true,farm:f,total:0,days:f.days,destination:state.destination};
 const weight=state.model.volume*(state.material==='PETG'?1.27:1.24)*(state.quality==='fine'?1.1:1);
 const hours=Math.max(.6,weight/7)*(state.quality==='fine'?1.55:1);
 const material=weight*materials[state.material].rate*state.qty*f.mult;
 const machine=hours*7*state.qty*f.mult;
 const finishing=f.base+Math.max(0,state.qty-1)*2;
 const service=(material+machine+finishing)*.07;
 const origin=f.id==='f3'?'south':'east';
 const sameRegion=state.destination===origin;
 const transitDays=sameRegion?[1,2]:state.destination==='north'?[3,5]:[2,3];
 const shipping=f.ship+(sameRegion?0:state.destination==='north'?8:4);
 const productionHours=hours*state.qty;
 const queueHours=state.orders.filter(o=>o.farm===f.id&&['printing','queued'].includes(o.status)).reduce((n,o)=>n+(o.quoteSnapshot?.productionHours||4*o.qty*(o.quality==='fine'?1.55:1)),0);
 const device=state.devices.find(d=>d.farm===f.id);
 const preparationDays=device&&(['waiting','maintenance'].includes(device.state)||device.loadedMaterial!==state.material)?1:0;
 const manufacturingDays=Math.max(1,Math.ceil((productionHours+queueHours)/8));
 const handlingDays=Math.max(0,f.days[0]-2);
 const days=[handlingDays+manufacturingDays+preparationDays+transitDays[0],handlingDays+manufacturingDays+preparationDays+transitDays[1]+Math.max(1,f.days[1]-f.days[0]-1)];
 return {farm:f,weight,hours,productionHours,queueHours,preparationDays,transitDays,material,machine,finishing,shipping,service,total:material+machine+finishing+shipping+service,days,destination:state.destination};
}
function navButton(n){return '<button data-action="nav" data-page="'+n[0]+'" class="'+(state.page===n[0]?'active':'')+'">'+I(n[1])+'<span>'+n[2]+'</span>'+(n[0]==='orders'&&state.orders.length?'<span class="count">'+state.orders.length+'</span>':'')+'</button>';}
function render(){
 cancelAnimationFrame(animation);
 const pageName=navItems.find(n=>n[0]===state.page)?.[2]||'工作台';
 $('#app').innerHTML='<div class="drawer-scrim '+(state.menuOpen?'show':'')+'" data-action="menu-close"></div>'+
 '<aside class="sidebar '+(state.menuOpen?'open':'')+'"><a href="#" class="brand" data-action="nav" data-page="home"><img src="./icons.svg" alt=""/><div><div class="brand-name">共造</div><div class="brand-sub">共享制造平台</div></div></a>'+
 '<div class="workspace-label"><span class="workspace-dot"></span>个人创作空间<span class="muted" style="margin-left:auto">⌘</span></div><div class="nav-label">创作与交付</div><nav class="nav" aria-label="主要导航">'+navItems.slice(0,4).map(navButton).join('')+'<div class="nav-sep"></div><div class="nav-label">制造伙伴</div>'+navItems.slice(4).map(navButton).join('')+'</nav>'+
 '<div class="sidebar-bottom"><div class="help-tile"><h3 style="font-size:12px">让闲置产能，连接好创意</h3><p>查看设备接入方式，了解自动生产的准备条件。</p><button data-action="nav" data-page="catalog">了解如何接入 ↗</button></div><div class="profile"><span class="avatar">创</span><div><div style="font-size:12px">创作者</div><div class="small muted">个人空间 · 本地演示</div></div><button class="link-btn" style="margin-left:auto" data-action="settings" aria-label="演示设置">'+I('settings')+'</button></div></div></aside>'+
 '<div class="layout"><header class="topbar"><div class="breadcrumb"><button class="menu-toggle" data-action="menu" aria-label="展开导航">'+I('menu')+'</button><span>创作空间</span><span>/</span><strong>'+pageName+'</strong></div><div class="top-actions"><span class="demo-pill"><i></i>交互演示 · 未连接真实设备与支付</span><button class="icon-btn" data-action="notifications" aria-label="查看通知">'+I('bell')+'</button><span class="avatar">创</span></div></header>'+
 '<main id="main" class="main">'+renderPage()+'<footer class="page-footer"><span>共造 COFORGE · 从想法，到实物。</span><span>原型数据仅用于体验 <a href="#" data-action="about">了解演示范围 ↗</a></span></footer></main></div>'+
 '<nav class="mobile-nav" aria-label="移动导航">'+[navItems[0],navItems[2],navItems[3],navItems[4]].map(n=>'<button data-action="nav" data-page="'+n[0]+'" class="'+(state.page===n[0]?'active':'')+'">'+I(n[1])+n[2]+'</button>').join('')+'</nav>';
 if(state.page==='home'||state.page==='create')setupViewer();
 document.title=pageName+' · 共造共享制造';
}
function intro(eye,title,desc,actions=''){return '<div class="page-intro"><div><div class="eyebrow">'+eye+'</div><h1>'+title+'</h1><p>'+desc+'</p></div>'+actions+'</div>';}
function renderPage(){switch(state.page){case'orders':return ordersPage();case'farm':return farmPage();case'network':return networkPage();case'catalog':return catalogPage();default:return workspacePage();}}
function workspacePage(){
 const m=state.model;
 const actions='<div class="intro-actions"><button class="btn" data-action="sample">'+I('cube')+'体验示例模型</button><button class="btn primary" data-action="upload">'+I('plus')+'新建项目</button></div>';
 const label=state.page==='create'?'开始一个新的作品':'让每一个想法，成为实物。';
 const dims=m.review?'待工程确认':m.dimensions.map(n=>Number(n).toFixed(1)).join(' × ');
 let qs=farms.map(quote);if(state.sort==='price')qs.sort((a,b)=>a.total-b.total);if(state.sort==='fast')qs.sort((a,b)=>a.days[0]-b.days[0]);
 return intro('YOUR NEXT CREATION',label,'上传模型，找到合适的制造伙伴。从第一份报价，到作品送达。',actions)+
 '<div class="steps"><div class="step active"><span class="step-num">1</span>上传模型</div><div class="step"><span class="step-num">2</span>工艺与报价</div><div class="step"><span class="step-num">3</span>生产与交付</div><div class="step"><span class="step-num">4</span>收货验收</div></div>'+
 '<div class="workspace-grid"><section class="card model-card"><div class="card-head"><h2>'+I('cube')+'模型预览</h2><span class="badge '+(m.review?'amber':'teal')+'">'+(m.review?'待工程审核':m.isSample?'示例模型':'几何已解析 · 待制造校验')+'</span></div>'+
 '<div class="viewer"><div class="viewer-grid"></div><canvas id="model-canvas" aria-label="三维模型预览，可拖动旋转" tabindex="0"></canvas><div class="viewer-top"><span class="viewer-tag">'+(m.review?'FILE REVIEW':'PERSPECTIVE VIEW')+'</span><div class="viewer-tools"><button data-action="zoom-in" aria-label="放大模型">'+I('plus')+'</button><button data-action="zoom-out" aria-label="缩小模型">'+I('minus')+'</button><button data-action="reset-view" aria-label="复位视角">'+I('expand')+'</button></div></div><div class="viewer-note">'+I('cursor')+(m.review?'此文件格式仅登记，尚未生成三维预览':'拖动旋转 · 滚轮缩放 · 方向键调整视角')+'</div><span class="axis">X Y Z</span></div>'+
 '<div class="model-strip"><div class="file-icon">'+I('file')+'</div><div><div class="model-name">'+esc(m.name)+'</div><div class="file-meta">'+(m.size/1024).toFixed(0)+' KB · '+(m.review?'等待 CAD 解析':m.faceCount.toLocaleString()+' 个三角面')+'</div></div><button class="link-btn" data-action="upload">更换模型 '+I('arrow')+'</button></div>'+
 '<div class="model-metrics"><div class="metric"><span>外形尺寸 '+(m.review?'':'/ mm')+'</span><strong>'+dims+'</strong></div><div class="metric"><span>实体体积</span><strong>'+(m.review?'待解析':m.volume.toFixed(1)+' cm³')+'</strong></div><div class="metric"><span>当前用途</span><strong>原型与定制部件</strong></div></div></section>'+
 '<section class="card"><div class="card-head"><h2>'+I('settings')+'配置你的作品</h2><span class="small muted" style="font-size:10px">演示估价</span></div><div class="form-body">'+
 '<div class="field"><div class="field-label">制造材料 <span>选择适合你的材料</span></div><div class="material-grid">'+Object.entries(materials).map(([k,v])=>'<button class="material-option '+(state.material===k?'selected':'')+'" data-action="material" data-material="'+k+'"><span class="swatch" style="background:'+v.color+'"></span>'+v.label+'</button>').join('')+'</div></div>'+
 (materials[state.material].process==='FDM'?'<div class="field"><div class="field-label">打印层高 <span>尺寸公差需单独确认</span></div><div class="segmented"><button data-action="quality" data-quality="standard" class="'+(state.quality==='standard'?'selected':'')+'">标准 · 0.20 mm</button><button data-action="quality" data-quality="fine" class="'+(state.quality==='fine'?'selected':'')+'">精细 · 0.12 mm</button></div></div>':'<div class="field"><div class="field-label">精度与工艺要求 <span>工程审核</span></div><div class="input" style="display:flex;align-items:center">按图纸公差与材料工艺确认</div></div>')+
 '<div class="form-row"><div class="field"><label class="field-label" for="quantity">制作数量</label><div class="stepper"><button data-action="qty-minus" aria-label="减少数量">−</button><input id="quantity" type="number" min="1" max="50" value="'+state.qty+'" aria-label="制作数量"/><button data-action="qty-plus" aria-label="增加数量">+</button></div></div><div class="field"><label class="field-label" for="unit">文件尺寸单位</label><select class="select" id="unit"><option value="mm" '+(state.unit==='mm'?'selected':'')+'>毫米 mm</option><option value="inch" '+(state.unit==='inch'?'selected':'')+'>英寸 inch</option></select></div></div>'+
 '<div class="form-row"><div class="field"><label class="field-label" for="destination">收货地区</label><select class="select" id="destination">'+Object.entries(destinations).map(([key,label])=>'<option value="'+key+'" '+(state.destination===key?'selected':'')+'>'+label+'</option>').join('')+'</select></div><div class="field"><span class="field-label">表面处理</span><div class="input" style="display:flex;align-items:center;color:#91a1aa">去支撑与基础清理</div></div></div>'+
 '<div class="hint">'+I('info')+'<span>'+materials[state.material].tip+'</span></div></div></section></div>'+
 '<section class="quote-section"><div class="section-heading"><h2>为你匹配的制造伙伴 <span class="small">3 家演示商家</span></h2><select class="sort-select" id="quote-sort" aria-label="报价排序"><option value="recommended" '+(state.sort==='recommended'?'selected':'')+'>综合推荐排序</option><option value="price" '+(state.sort==='price'?'selected':'')+'>报价从低到高</option><option value="fast" '+(state.sort==='fast'?'selected':'')+'>预计交付更快</option></select></div><div class="quotes">'+qs.map(quoteCard).join('')+'</div><p class="inline-note">示例报价与交期会按数量、层高、排队任务和收货地区变化，未经过真实切片与商家确认，不保证实际价格或到货时间。</p></section>'+
 '<div class="assurance"><span>'+I('shield')+'设计文件按需授权</span><span>'+I('clock')+'生产进度全程可见</span><span>'+I('truck')+'收货验收后结算</span></div>';
}
function quoteCard(q){
 const f=q.farm;return '<article class="quote-card '+(f.id==='f1'?'recommended':'')+'">'+(f.id==='f1'?'<span class="recommend-label">综合推荐 · 演示</span>':'')+
 '<div class="farm-heading"><div class="farm-avatar '+f.tone+'">'+f.initial+'</div><div><div class="farm-name">'+f.name+'</div><div class="farm-location">'+f.city+' <span>· 示例档案</span></div></div></div>'+
 '<div class="quote-price">'+(q.review?'<strong style="font-size:21px">工程询价</strong>':'<span class="currency">¥</span><strong>'+q.total.toFixed(2)+'</strong><span class="suffix">含运费</span>')+'</div>'+
 '<div class="quote-delivery">'+(q.review?'工程确认后提供交付窗口':'预计 <strong>'+q.days[0]+'–'+q.days[1]+' 个工作日</strong> 收到 · 示例')+'</div>'+
 '<div class="quote-features"><span>'+materials[state.material].process+'</span><span>'+(q.review?'工艺人工审核':'认证模板自动生产')+'</span></div>'+
 '<div class="quote-footer"><button class="link-btn" data-action="quote-detail" data-farm="'+f.id+'">费用明细</button><button class="btn '+(f.id==='f1'?'primary':'')+'" data-action="choose" data-farm="'+f.id+'">'+(q.review?'提交演示询价':'选择此商家')+I('arrow')+'</button></div></article>';
}
const stageNames={review:'工程审核中',queued:'等待设备就绪',printing:'正在打印',awaiting_pickup:'打印完成待取件',qc_failed:'质检异常',ready_to_ship:'质检通过待发货',shipped:'运输途中',delivered:'已签收待验收',settled:'验收完成已结算',cancelled:'已取消'};
function ordersPage(){
 return intro('YOUR PROJECTS','每一件作品，都有迹可循。','查看报价、生产、物流与验收状态。这里的订单及物流均为本地模拟数据。','<div class="intro-actions"><button class="btn primary" data-action="nav" data-page="create">'+I('plus')+'新建项目</button></div>')+
 (state.orders.length?'<div class="order-list">'+[...state.orders].reverse().map(orderCard).join('')+'</div>':'<div class="card empty-state">'+I('orders')+'<h3>你的第一件作品，从这里开始</h3><p>选择一个示例模型和制造伙伴，体验完整的演示订单流程。</p><button class="btn primary" data-action="nav" data-page="home">开始体验 '+I('arrow')+'</button></div>');
}
function orderCard(o){
 const f=farms.find(f=>f.id===o.farm);
 const idx={review:0,queued:1,printing:1,awaiting_pickup:2,qc_failed:2,ready_to_ship:2,shipped:3,delivered:4,settled:5,cancelled:-1}[o.status];
 const stages=['下单','生产','质检','物流','验收','结算'];
 let action='<button class="btn tiny" data-action="nav" data-page="farm">前往农场演示 '+I('arrow')+'</button>';
 let note='已保存文件名、材料、数量与层高选择。未生成真实生产文件或锁定设备参数。';
 if(o.status==='review'){note='文件、工艺或配送地区需审核，尚未付款或生成生产指令。';action='<button class="btn tiny" data-action="cancel-order" data-id="'+o.id+'">撤回询价</button>';}
 if(o.status==='queued'){note='等待前序任务完成、设备清台或按本单材料备机。';action='<button class="btn tiny" data-action="cancel-order" data-id="'+o.id+'">取消演示订单</button>'+action;}
 if(o.status==='awaiting_pickup')note='打印完成，等待农场主取件、清台和质检。';
 if(o.status==='qc_failed')note='质检未通过，暂停发货与结算；演示中可模拟重新质检。';
 if(o.status==='ready_to_ship')note='质检已通过，等待农场主填写模拟运单。';
 if(o.status==='shipped'){note='模拟物流 '+esc(o.tracking)+' · 不对应真实快递。';action='<button class="btn tiny" data-action="tracking" data-id="'+o.id+'">物流详情</button><button class="btn tiny soft" data-action="deliver" data-id="'+o.id+'">模拟物流签收</button>';}
 if(o.status==='delivered'){note='物流签收不会自动结算，请在确认产品符合要求后验收。';action='<button class="btn tiny" data-action="dispute" data-id="'+o.id+'">'+(o.dispute?'撤销演示争议':'发起演示争议')+'</button><button class="btn tiny primary" data-action="settle" data-id="'+o.id+'" '+(o.dispute?'disabled':'')+'>确认验收 · 演示结算</button>';}
 if(o.status==='settled'){note='模拟结算完成。此流程没有产生任何实际收款或转账。';action='<span class="badge teal">'+I('check')+'已完成</span>';}
 if(o.status==='cancelled'){note='演示订单已取消，没有实际扣款。';action='';}
 return '<article class="card"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub">'+esc(f.name)+' · '+materials[o.material].label+' · '+o.qty+' 件'+(materials[o.material].process==='FDM'?' · '+(o.quality==='fine'?'0.12':'0.20')+' mm 层高':'')+'</div><div class="order-sub">'+esc(destinations[o.destination]||'旧演示订单未记录地区')+(o.quoteSnapshot?.days?' · 下单时估计 '+o.quoteSnapshot.days[0]+'–'+o.quoteSnapshot.days[1]+' 个工作日收到（演示）':'')+'</div><div class="order-sub mono">'+o.id+' · '+esc(o.created)+'</div></div><div><span class="badge '+(o.status==='settled'?'teal':o.dispute?'red':o.status==='review'?'amber':'blue')+'">'+(o.dispute?'争议处理中':stageNames[o.status])+'</span><div class="order-price">'+(o.total?money(o.total):'待报价')+'</div></div></div><div class="order-body"><div class="timeline">'+stages.map((s,i)=>'<div class="timeline-item '+(i<idx?'done':i===idx?'current':'')+'">'+s+'</div>').join('')+'</div><div class="order-bottom"><span>'+note+'</span><div class="order-actions">'+action+'</div></div></div></article>';
}
function farmPage(){
 const working=state.devices.filter(d=>d.state==='printing').length, waiting=state.devices.filter(d=>d.state==='waiting').length;
 return intro('MANUFACTURING CONSOLE','专注制造，其余交给流程。','设备通过本地网关接入。认证工艺自动执行，完成后通知取件、质检与发货。','<div class="intro-actions"><button class="btn primary" data-action="connect">'+I('plus')+'接入设备</button></div>')+
 '<div class="summary-grid">'+[['可接单设备',state.devices.filter(d=>d.state==='ready').length,'已备机 · 演示'],['正在生产',working,'已锁定生产任务 · 演示'],['等待取件',waiting,'清空打印板后恢复就绪'],['待发货订单',state.orders.filter(o=>o.status==='ready_to_ship').length,'质检通过后发货']].map(x=>'<div class="card summary-card"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><p>'+x[2]+'</p></div>').join('')+'</div>'+
 '<div class="section-heading"><h2>设备工作台 <span class="small">所有设备均为模拟实例</span></h2><button class="link-btn" data-action="nav" data-page="catalog">查看兼容路线 '+I('arrow')+'</button></div><div class="device-grid">'+state.devices.map(deviceCard).join('')+'</div>'+
 '<section style="margin-top:27px"><div class="section-heading"><h2>待交付任务</h2></div>'+ (state.orders.some(o=>['ready_to_ship','qc_failed'].includes(o.status))?'<div class="order-list">'+state.orders.filter(o=>['ready_to_ship','qc_failed'].includes(o.status)).map(o=>'<article class="card"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub">'+o.id+' · '+o.qty+' 件 · '+stageNames[o.status]+'</div></div><button class="btn '+(o.status==='ready_to_ship'?'primary':'soft')+'" data-action="'+(o.status==='ready_to_ship'?'ship':'recheck')+'" data-id="'+o.id+'">'+(o.status==='ready_to_ship'?'填写模拟运单':'重新质检')+'</button></div></article>').join('')+'</div>':'<div class="card empty-state" style="padding:30px"><p style="margin:0">暂无待交付任务。完成打印和质检后，订单会显示在这里。</p></div>')+'</section>';
}
function deviceCard(d){
 const o=state.orders.find(o=>o.id===d.orderId);
 const next=nextQueued(d);
 const status={ready:['teal','已备机 · 可自动开打'],printing:['blue','正在打印'],waiting:['amber','完成待取件'],maintenance:['gray','维护中']};
 let action='<button class="btn full tiny" data-action="maintenance" data-id="'+d.id+'">暂停接单</button>';
 if(d.state==='ready'&&next){status.ready=['amber','等待按下一单备料'];action='<button class="btn full tiny primary" data-action="ready" data-id="'+d.id+'">按下一单备料</button>';}
 if(d.state==='printing')action='<button class="btn full tiny soft" data-action="complete" data-id="'+d.id+'">模拟打印完成</button>';
 if(d.state==='waiting')action='<button class="btn full tiny primary" data-action="remove" data-id="'+d.id+'">取件与质检</button>';
 if(d.state==='maintenance')action='<button class="btn full tiny soft" data-action="ready" data-id="'+d.id+'">备机并恢复接单</button>';
 return '<article class="card device-card"><div class="device-card-top"><span class="mono small muted">'+d.id.toUpperCase()+' · 模拟</span><span class="badge '+status[d.state][0]+'">'+status[d.state][1]+'</span></div><div class="device-drawing">'+I('printer')+'</div><h3>'+esc(d.name)+'</h3><p>'+farms.find(f=>f.id===d.farm).name+' · '+d.route+'</p><div class="device-info"><span>支持材料</span><span>'+d.material+'</span></div><div class="device-info"><span>当前已装载 · 模拟</span><strong>'+materials[d.loadedMaterial].label+'</strong></div>'+(next?'<div class="device-info"><span>下一单需要</span><strong>'+materials[next.material].label+' · '+next.qty+' 件</strong></div>':'')+(o?'<p class="break" style="margin-bottom:10px;font-size:10px">'+esc(o.modelName)+' · '+o.id+'</p>':'<p style="margin-bottom:10px;font-size:10px">'+(d.state==='maintenance'?'维护期间不自动接单':'仅在已装载材料匹配时自动开打')+'</p>')+action+'</article>';
}
function networkPage(){
 const fs=farms.filter(f=>(f.name+f.city).toLowerCase().includes(state.search.toLowerCase()));
 return intro('MADE BY GOOD PARTNERS','好作品，遇见好制造。','从原型到小批量生产，按工艺与交期寻找伙伴。以下商家档案均为演示。')+
 '<div class="filters"><div class="search-box">'+I('search')+'<input id="network-search" class="input" type="search" placeholder="搜索商家名称或城市" value="'+esc(state.search)+'" aria-label="搜索商家"/></div><div class="filter-chips">'+[['all','全部伙伴'],['FDM','FDM 打印'],['metal','金属与 CNC']].map(x=>'<button class="chip '+(state.networkFilter===x[0]?'active':'')+'" data-action="network-filter" data-value="'+x[0]+'">'+x[1]+'</button>').join('')+'</div></div>'+
 (state.networkFilter==='metal'?'<div class="card empty-state">'+I('factory')+'<h3>工业制造伙伴接入规划</h3><p>金属打印与 CNC 将使用工程审核报价、认证生产计划和现场准备流程。</p><button class="btn" data-action="nav" data-page="catalog">查看设备与接口路线</button></div>':fs.length?'<div class="network-grid">'+fs.map(f=>'<article class="card network-card"><div class="network-art '+f.tone+'">'+I('printer')+I('cube')+I('printer')+'</div><h3>'+f.name+'</h3><p>'+f.city+' · 演示制造伙伴</p><p style="margin-top:14px">'+f.desc+'</p><div class="quote-features">'+f.tags.map(t=>'<span>'+t+'</span>').join('')+'</div><div class="network-stat"><span>预计交付窗口</span><strong>'+f.days[0]+'–'+f.days[1]+' 个工作日 · 示例</strong></div><button class="btn full" data-action="farm-detail" data-farm="'+f.id+'">查看制造能力 '+I('arrow')+'</button></article>').join('')+'</div>':'<div class="card empty-state"><h3>没有匹配的演示商家</h3><p>尝试搜索杭州、苏州、深圳或清空关键词。</p></div>');
}
const catalog=[
 {name:'Prusa CORE One / XL / MK4S',type:'FDM',badge:'可验证自动生产',level:'teal',route:'PrusaLink 本地 API',desc:'可上传文件与启动任务。需要逐台确认固件、认证参数、打印板和耗材就绪。',url:'https://help.prusa3d.com/article/prusa-connect-and-prusalink-explained_302608'},
 {name:'Klipper 设备 / OctoPrint 设备',type:'FDM',badge:'首批适配路线',level:'teal',route:'Moonraker / OctoPrint',desc:'通过农场网关进行任务上传、启动及状态订阅。品牌兼容性需要实机验证。',url:'https://moonraker.readthedocs.io/en/latest/external_api/printer/'},
 {name:'Bambu Lab A1 / P1 / X1 / H2',type:'FDM',badge:'型号与授权待验证',level:'amber',route:'LAN / Bambu Connect',desc:'支持官方云和局域网流程。第三方控制受固件及授权影响，不能承诺统一开放 API。',url:'https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/'},
 {name:'Creality K1 Max / K2 Plus',type:'FDM',badge:'需要单型号验证',level:'amber',route:'LAN / 厂商云',desc:'具备联网传输能力，通用第三方自动下发能力需逐型号、逐固件确认。',url:'https://www.creality.com/support/creality-k2-plus-cfs-combo'},
 {name:'Formlabs Form 4 / Fuse 1+ 30W',type:'industrial',badge:'自动准备 · 现场开打',level:'blue',route:'PreForm / Dashboard API',desc:'支持自动准备、估时与任务队列。官方队列流程仍需要操作员在设备端启动。',url:'https://developer.formlabs.com/core-concepts/queue/'},
 {name:'EOS / 铂力特 / 华曙',type:'industrial',badge:'工业集成与工艺审核',level:'gray',route:'EOSCONNECT / 厂商 MES',desc:'金属打印需工艺认证、粉末与气氛准备、冷却及后处理；控制接口依型号与许可而定。',url:'https://www.eos.info/enablement/software/software-releases'},
 {name:'Haas / DMG MORI 加工中心',type:'CNC',badge:'状态接入优先',level:'gray',route:'MTConnect / OPC UA',desc:'可采集设备数据。状态监控不代表允许远程开机，装夹、刀具与刀路需现场确认。',url:'https://en.dmgmori.com/products/digitization/connectivity'},
 {name:'FANUC / SINUMERIK 控制器生态',type:'CNC',badge:'核验控制器与选件',level:'gray',route:'FOCAS / FIELD / OPC UA',desc:'按机床、控制器、固件及已购选件建档。小批量定制保留工程审核和受控程序下发。',url:'https://www.fanuc.co.jp/en/product/field/basic/specification/'}
];
function catalogPage(){
 const items=catalog.filter(c=>state.catalogFilter==='all'||c.type===state.catalogFilter);
 return intro('CONNECTED MANUFACTURING','连接设备，也连接可信的工艺。','联网、上传文件和自动开打是不同能力。每一条路线都需要完成实机认证。','<div class="intro-actions"><button class="btn primary" data-action="connect">'+I('plus')+'了解接入</button></div>')+
 '<div class="card info-panel">'+I('shield')+'<div><h3>一次验证工艺，标准订单自动生产</h3><p>将机型、固件、喷嘴、材料与参数模板绑定。设备已备机且订单通过校验后自动开打，结束后等待取件与清台。当前页面是接入规划，尚未连接真实设备。</p></div></div>'+
 '<div class="filters"><div class="filter-chips">'+[['all','全部路线'],['FDM','FDM 塑料打印'],['industrial','树脂与工业打印'],['CNC','CNC 加工']].map(x=>'<button class="chip '+(state.catalogFilter===x[0]?'active':'')+'" data-action="catalog-filter" data-value="'+x[0]+'">'+x[1]+'</button>').join('')+'</div></div><div class="catalog-grid">'+items.map(c=>'<article class="card catalog-card"><div class="catalog-icon">'+I(c.type==='CNC'?'factory':'printer')+'</div><div class="catalog-content"><h3>'+c.name+'</h3><span class="badge '+c.level+'">'+c.badge+'</span><p><strong>'+c.route+'</strong><br/>'+c.desc+'</p><a href="'+c.url+'" target="_blank" rel="noopener">官方资料 ↗</a></div></article>').join('')+'</div>';
}
function modal(title,body,footer='',wide=false){focusBeforeModal=document.activeElement;$('#modal-root').innerHTML='<div class="modal-backdrop" data-dismiss="true"><section class="modal '+(wide?'wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">'+title+'</h2><button class="icon-btn" data-action="close" aria-label="关闭窗口">'+I('close')+'</button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'')+'</section></div>';document.body.style.overflow='hidden';setTimeout(()=>$('.modal button,.modal input,.modal select')?.focus(),0);}
function closeModal(){$('#modal-root').innerHTML='';document.body.style.overflow='';focusBeforeModal?.focus?.();}
function qDetails(q){return q.review?'<p>该文件、制造工艺或配送地区需要审核。提交后会创建一条演示询价记录，不会启动设备或产生扣款。</p><div class="detail-row"><span>收货地区</span><strong>'+destinations[q.destination]+'</strong></div>':'<p>按材料、数量、层高与收货地区生成演示估价，价格及交期均不是商家承诺。</p>'+[['材料与预计损耗',q.material],['预计设备机时',q.machine],['基础清理与准备',q.finishing],['包装配送 · '+destinations[q.destination],q.shipping],['平台服务',q.service]].map(x=>'<div class="detail-row"><span>'+x[0]+'</span><strong>'+money(x[1])+'</strong></div>').join('')+'<div class="detail-row total"><span>演示总价 · '+state.qty+' 件</span><strong>'+money(q.total)+'</strong></div><div class="detail-row"><span>本单估算机时</span><strong>'+q.productionHours.toFixed(1)+' 小时</strong></div><div class="detail-row"><span>前序任务估算机时</span><strong>'+q.queueHours.toFixed(1)+' 小时</strong></div><div class="detail-row"><span>区域运输估计</span><strong>'+q.transitDays[0]+'–'+q.transitDays[1]+' 个工作日</strong></div><div class="detail-row"><span>预计收到 · 示例</span><strong>'+q.days[0]+'–'+q.days[1]+' 个工作日</strong></div><p class="inline-note" style="font-size:10px;margin-top:15px">机时按体积、数量及层高近似计算，按每日 8 小时产能排队；正在执行的任务保守计入完整机时，并加上备机、后处理和地区运输时间。未连接真实排产及物流，不能保证实际交期。</p>';}
function uploadModal(){modal('上传你的三维模型','<p>STL 可在浏览器本地解析并预览。STEP、3MF 仅登记文件信息，进入工程审核。文件不会上传到远程服务器。</p><div class="upload-zone" id="dropzone" role="button" tabindex="0" aria-label="选择或拖入模型文件">'+I('upload')+'<strong>拖入模型文件，或点击选择</strong><p>STL · STEP · STP · 3MF<br/>单文件不超过 20 MB</p><span class="btn tiny">选择文件</span></div><input type="file" id="model-file" class="file-hidden" accept=".stl,.step,.stp,.3mf"/><div id="upload-error" class="error-text"></div><p style="font-size:10px">STL 不保存单位。上传后请核对毫米 / 英寸和外形尺寸；三维预览不代表已经通过可制造性检查。</p>','<button class="btn" data-action="sample">使用示例模型</button>');const drop=$('#dropzone'),file=$('#model-file');drop.onclick=()=>file.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}};file.onchange=()=>file.files[0]&&loadFile(file.files[0]);drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag');};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');if(e.dataTransfer.files[0])loadFile(e.dataTransfer.files[0]);};}
async function loadFile(file){
 try{
 if(file.size>20*1024*1024)throw Error('文件超过 20 MB，请先简化模型。');
 const ext=file.name.split('.').pop().toLowerCase();if(!['stl','step','stp','3mf'].includes(ext))throw Error('请选择 STL、STEP、STP 或 3MF 文件。');
 if(ext!=='stl'){state.model={name:file.name,size:file.size,review:true,isSample:false,triangles:[],dimensions:[],volume:0,faceCount:0};}
 else{const data=await file.arrayBuffer();const parsed=parseSTL(data);state.model={name:file.name,size:file.size,...parsed,isSample:false,review:!parsed.closed};}
 state.unit='mm';closeModal();state.page='create';yaw=-.64;pitch=.37;zoom=1;render();toast(state.model.review?'已登记文件，需工程审核后报价':'STL 已在本地解析，请核对单位和尺寸');
 }catch(e){$('#upload-error').textContent=e.message;}
}
function parseSTL(buf){
 let tris=[];const view=new DataView(buf);const n=buf.byteLength>=84?view.getUint32(80,true):0;
 if(n>0&&84+n*50===buf.byteLength){if(n>100000)throw Error('模型超过 10 万个三角面，请简化后上传。');for(let i=0;i<n;i++){let at=84+i*50+12,t=[];for(let j=0;j<3;j++){t.push([view.getFloat32(at,true),view.getFloat32(at+4,true),view.getFloat32(at+8,true)]);at+=12;}tris.push(t);}}
 else{const txt=new TextDecoder().decode(buf);const matches=[...txt.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)];if(matches.length%3||!matches.length)throw Error('无法解析此 STL，请检查文件是否完整。');if(matches.length>300000)throw Error('模型超过 10 万个三角面，请简化后上传。');for(let i=0;i<matches.length;i+=3)tris.push(matches.slice(i,i+3).map(m=>m.slice(1,4).map(Number)));}
 if(tris.some(t=>t.some(v=>v.some(n=>!Number.isFinite(n)))))throw Error('模型含无效坐标。');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let signed=0;const edges=new Map();
 for(const t of tris){for(const v of t)for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);}
 const [a,b,c]=t;signed+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
 for(let k=0;k<3;k++){const a=t[k].map(v=>v.toFixed(5)).join(','),b=t[(k+1)%3].map(v=>v.toFixed(5)).join(',');const key=a<b?a+'|'+b:b+'|'+a;edges.set(key,(edges.get(key)||0)+1);}}
 const dimensions=max.map((v,k)=>v-min[k]);if(dimensions.some(n=>n<=0)||Math.max(...dimensions)>100000)throw Error('模型尺寸异常，请检查单位和三维几何。');
 const center=max.map((v,k)=>(v+min[k])/2);const scale=90/Math.max(...dimensions);
 const closed=[...edges.values()].every(n=>n===2)&&Math.abs(signed)>0;
 const step=Math.max(1,Math.ceil(tris.length/7000));return{triangles:tris.filter((_,i)=>i%step===0).map(t=>t.map(v=>v.map((n,k)=>(n-center[k])*scale))),dimensions,originalDimensions:[...dimensions],volume:Math.abs(signed)/1000,originalVolume:Math.abs(signed)/1000,faceCount:tris.length,closed};
}
function changePage(p){if($('.modal'))closeModal();state.page=p;state.menuOpen=false;state.search='';render();window.scrollTo({top:0,behavior:'instant'});}
function createOrder(farmId){
 const f=farms.find(f=>f.id===farmId),q=quote(f);const dev=state.devices.find(d=>d.farm===farmId&&d.state==='ready'&&d.loadedMaterial===state.material&&!nextQueued(d));
 const quoteSnapshot=q.review?null:{version:'demo-v2',days:[...q.days],productionHours:q.productionHours,queueHours:q.queueHours,estimatedWeight:q.weight*state.qty,transitDays:[...q.transitDays],shipping:q.shipping,total:q.total,destination:q.destination};
 const o={id:'DEMO-'+Date.now().toString(36).toUpperCase(),created:timeString(),farm:farmId,modelName:state.model.name,material:state.material,qty:state.qty,quality:state.quality,destination:state.destination,quoteSnapshot,total:q.total,status:q.review?'review':dev?'printing':'queued',events:[],dispute:false};
 o.events.push({label:q.review?'已提交演示工程询价':'已创建演示订单',time:timeString()});
 if(dev&&!q.review){dev.state='printing';dev.orderId=o.id;o.deviceId=dev.id;o.events.push({label:'设备按认证模板开始模拟打印',time:timeString()});}
 state.orders.push(o);save();closeModal();changePage('orders');toast(q.review?'演示询价已创建，等待工程确认':'演示订单已创建，没有实际付款');
}
function nextQueued(d){return state.orders.find(o=>o.farm===d.farm&&o.status==='queued');}
function releaseDevice(d){d.state='ready';d.orderId=null;const next=nextQueued(d);if(next&&next.material===d.loadedMaterial){d.state='printing';d.orderId=next.id;next.deviceId=d.id;next.status='printing';next.events.push({label:'已确认 '+materials[d.loadedMaterial].label+' 备料，开始模拟打印',time:timeString()});}}
function readinessBody(d,removing=false){
 const next=nextQueued(d),target=next?.material||d.loadedMaterial;
 return '<p>'+(removing?'先完成取件、清台与本件质检，再为下一单备料。':'请检查打印板、已装载材料与设备状态，再恢复接单。')+'此窗口仅修改模拟状态。</p>'+
 (next?'<div class="detail-row"><span>下一单</span><strong class="break">'+esc(next.modelName)+' · '+next.qty+' 件</strong></div><div class="detail-row"><span>必须装载</span><strong>'+materials[next.material].label+(next.quoteSnapshot?.estimatedWeight?' · 估算 '+next.quoteSnapshot.estimatedWeight.toFixed(1)+' g':'')+'</strong></div>':'<p>当前没有排队任务，请选择准备好的材料。后续订单只有材料匹配才会自动开打。</p>')+
 '<div class="field"><label class="field-label" for="prepared-material">本次确认已装载的材料</label><select class="select" id="prepared-material" '+(next?'disabled':'')+'>'+['PLA','PETG'].map(k=>'<option value="'+k+'" '+(k===target?'selected':'')+'>'+materials[k].label+'</option>').join('')+'</select></div>'+
 '<div class="readiness-list"><label class="check-line"><input type="checkbox" id="clear-bed"/>'+ (removing?'已取出零件并清空打印板':'已检查打印板为空且设备无报警')+'</label><label class="check-line"><input type="checkbox" id="material-ready"/>'+ (next?'已装载 '+materials[target].label+'，并确认余量足够完成下一单':'已核对上方所选材料并确认余量充足')+'</label></div><div id="qc-error" class="error-text"></div>';
}
function confirmReadiness(d){
 if(!$('#clear-bed')?.checked||!$('#material-ready')?.checked){$('#qc-error').textContent='请确认床面与所需材料均已准备完成。';return false;}
 const chosen=$('#prepared-material').value,next=nextQueued(d);
 if(!['PLA','PETG'].includes(chosen)||(next&&chosen!==next.material)){$('#qc-error').textContent='已装载材料与下一单不匹配，请重新确认。';return false;}
 d.loadedMaterial=chosen;return true;
}
document.addEventListener('click',e=>{
 const el=e.target.closest('[data-action]');if(!el){if(e.target.matches('[data-dismiss]'))closeModal();return;}e.preventDefault();const a=el.dataset.action,id=el.dataset.id;const order=state.orders.find(o=>o.id===id),device=state.devices.find(d=>d.id===id);
 if(a==='nav')return changePage(el.dataset.page);
 if(a==='menu'){state.menuOpen=!state.menuOpen;render();return;}
 if(a==='menu-close'){state.menuOpen=false;render();return;}
 if(a==='close')return closeModal();
 if(a==='upload')return uploadModal();
 if(a==='sample'){state.model={...sampleModel};state.unit='mm';closeModal();yaw=-.64;pitch=.37;zoom=1;render();toast('已载入示例模型');return;}
 if(a==='material'){state.material=el.dataset.material;render();return;}
 if(a==='quality'){state.quality=el.dataset.quality;render();return;}
 if(a==='qty-plus'||a==='qty-minus'){state.qty=Math.min(50,Math.max(1,state.qty+(a==='qty-plus'?1:-1)));render();return;}
 if(a==='zoom-in'){zoom=Math.min(2.5,zoom+.15);drawViewer();return;}
 if(a==='zoom-out'){zoom=Math.max(.5,zoom-.15);drawViewer();return;}
 if(a==='reset-view'){yaw=-.64;pitch=.37;zoom=1;drawViewer();return;}
 if(a==='quote-detail'){const q=quote(farms.find(f=>f.id===el.dataset.farm));modal('费用明细 · '+q.farm.name,qDetails(q),'<button class="btn" data-action="close">关闭</button><button class="btn primary" data-action="choose" data-farm="'+q.farm.id+'">选择此商家</button>');return;}
 if(a==='choose'){const q=quote(farms.find(f=>f.id===el.dataset.farm));modal(q.review?'确认演示询价':'确认演示订单','<div class="detail-row"><span>制造伙伴</span><strong>'+q.farm.name+'</strong></div><div class="detail-row"><span>文件</span><strong class="break">'+esc(state.model.name)+'</strong></div>'+qDetails(q)+'<div class="hint">'+I('info')+'<span>这是本地交互演示。不会收取费用，不会发送文件到打印机，不会产生实际生产任务。</span></div>','<button class="btn" data-action="close">再看看</button><button class="btn primary" data-action="create-order" data-farm="'+q.farm.id+'">'+(q.review?'创建演示询价':'创建演示订单')+'</button>');return;}
 if(a==='create-order')return createOrder(el.dataset.farm);
 if(a==='network-filter'){state.networkFilter=el.dataset.value;render();return;}
 if(a==='catalog-filter'){state.catalogFilter=el.dataset.value;render();return;}
 if(a==='farm-detail'){const f=farms.find(f=>f.id===el.dataset.farm);modal(f.name,'<p>'+f.desc+'</p><div class="detail-row"><span>位置</span><strong>'+f.city+'</strong></div><div class="detail-row"><span>设备路线</span><strong>'+f.device+'</strong></div><div class="detail-row"><span>自动生产试点</span><strong>PLA / PETG</strong></div><p style="margin-top:15px">这是演示商家档案。正式上线前需要完成商家进件、设备校验、试打和交付能力审核。</p>','<button class="btn primary" data-action="nav" data-page="create">开始配置作品</button>');return;}
 if(a==='complete'&&device?.state==='printing'){const o=state.orders.find(o=>o.id===device.orderId);device.state='waiting';o.status='awaiting_pickup';o.events.push({label:'模拟打印完成，等待取件和质检',time:timeString()});save();render();toast('已通知取件，设备仍被占用，不能开始下一单');return;}
 if(a==='remove'&&device?.state==='waiting'){modal('取件与质检',readinessBody(device,true),'<button class="btn" data-action="qc-result" data-result="fail" data-id="'+id+'">质检未通过</button><button class="btn primary" data-action="qc-result" data-result="pass" data-id="'+id+'">质检通过并恢复设备</button>');return;}
 if(a==='qc-result'&&device?.state==='waiting'){if(!confirmReadiness(device))return;const o=state.orders.find(o=>o.id===device.orderId);o.status=el.dataset.result==='pass'?'ready_to_ship':'qc_failed';o.events.push({label:el.dataset.result==='pass'?'取件与质检通过':'质检异常，暂停交付',time:timeString()});releaseDevice(device);save();closeModal();render();toast('已核对材料并更新现场状态，未产生真实设备操作');return;}
 if(a==='maintenance'&&device?.state==='ready'){device.state='maintenance';save();render();toast('模拟设备已暂停接单');return;}
 if(a==='ready'&&device&&['maintenance','ready'].includes(device.state)){modal('确认设备已准备',readinessBody(device),'<button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-ready" data-id="'+id+'">确认备机</button>');return;}
 if(a==='confirm-ready'&&device&&['maintenance','ready'].includes(device.state)){if(!confirmReadiness(device))return;releaseDevice(device);save();closeModal();render();toast('已确认材料，匹配的排队任务可开始模拟打印');return;}
 if(a==='recheck'&&order?.status==='qc_failed'){order.status='ready_to_ship';order.events.push({label:'模拟重新质检通过',time:timeString()});save();render();toast('模拟质检通过，可以填写运单');return;}
 if(a==='ship'&&order){modal('填写模拟发货信息','<p>实际平台应在运单揽收后更新发货状态。本演示不调用任何快递接口。</p><div class="field"><label class="field-label" for="courier">承运商</label><select class="select" id="courier"><option>顺丰速运 · 模拟</option><option>中通快递 · 模拟</option><option>京东物流 · 模拟</option></select></div><div class="field"><label class="field-label" for="tracking">演示运单号</label><input class="input" id="tracking" value="DEMO'+Date.now().toString().slice(-9)+'" maxlength="32"/></div><div id="ship-error" class="error-text"></div>','<button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-ship" data-id="'+id+'">模拟揽收发货</button>');return;}
 if(a==='confirm-ship'&&order){const track=$('#tracking').value.trim();if(!/^DEMO[0-9A-Za-z-]{3,28}$/.test(track)){$('#ship-error').textContent='请输入 DEMO 开头的演示单号，避免与真实运单混淆。';return;}order.tracking=track;order.courier=$('#courier').value;order.status='shipped';order.events.push({label:'模拟快递已揽收',time:timeString()});save();closeModal();render();toast('模拟运单已保存，可在我的订单查看');return;}
 if(a==='tracking'&&order){modal('物流进度 · 模拟','<p>'+esc(order.courier||'模拟快递')+'<br/><span class="mono">'+esc(order.tracking)+'</span></p><div class="tracking-list">'+[...order.events].reverse().map(v=>'<div class="tracking-item"><strong>'+esc(v.label)+'</strong><p>'+esc(v.time)+' · 演示事件</p></div>').join('')+'</div>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='deliver'&&order?.status==='shipped'){order.status='delivered';order.events.push({label:'模拟物流已签收，等待客户验收',time:timeString()});save();render();toast('模拟签收成功；款项尚未结算');return;}
 if(a==='dispute'&&order){order.dispute=!order.dispute;save();render();toast(order.dispute?'演示争议已开启，暂停结算':'演示争议已撤销');return;}
 if(a==='settle'&&order?.status==='delivered'&&!order.dispute){modal('确认作品验收','<p>请确认已收到零件，且材料、数量与质量符合约定。正式平台将在验收条件满足后向支付机构申请结算。</p><div class="detail-row"><span>演示订单金额</span><strong>'+money(order.total)+'</strong></div><p>本次操作仅模拟结算，不会产生实际资金转移。</p>','<button class="btn" data-action="close">稍后验收</button><button class="btn primary" data-action="confirm-settle" data-id="'+id+'">确认演示验收</button>');return;}
 if(a==='confirm-settle'&&order?.status==='delivered'&&!order.dispute){order.status='settled';order.events.push({label:'模拟验收与结算完成',time:timeString()});save();closeModal();render();toast('演示闭环已完成：模型 → 生产 → 交付 → 验收');return;}
 if(a==='cancel-order'&&order&&['review','queued'].includes(order.status)){order.status='cancelled';save();render();toast('演示订单已取消');return;}
 if(a==='connect'){modal('设备接入准备','<p>正式接入通过农场内的本地网关完成。当前版本仅提供交互演示，无法绑定真实设备。</p><div class="notice-list">'+[['1','登记设备','记录机型、固件、喷嘴、材料与网络方式。'],['2','验证工艺','完成试打，将切片器与参数模板锁定版本。'],['3','授权与备机','限定可用设备与接单时段，检查打印板和耗材。'],['4','自动执行','满足条件后上传、校验并启动；完成后通知取件。']].map(x=>'<div class="notice-item"><span class="avatar">'+x[0]+'</span><div><strong>'+x[1]+'</strong><p>'+x[2]+'</p></div></div>').join('')+'</div>','<button class="btn primary" data-action="close">了解了</button>');return;}
 if(a==='settings'){modal('演示空间设置','<p>演示订单和设备状态保存在当前浏览器。重置会清除本浏览器的演示订单，并将设备恢复为已备机。</p>','<button class="btn" data-action="close">保留数据</button><button class="btn danger" data-action="reset-demo">重置演示数据</button>');return;}
 if(a==='reset-demo'){state.orders=[];state.devices=freshDevices();save();closeModal();render();toast('演示数据已重置');return;}
 if(a==='notifications'){const events=state.orders.flatMap(o=>o.events.map(v=>({...v,name:o.modelName}))).slice(-6).reverse();modal('工作通知',events.length?'<div class="notice-list">'+events.map(v=>'<div class="notice-item"><span class="avatar">'+I('bell')+'</span><div><strong>'+esc(v.label)+'</strong><p>'+esc(v.name)+'<br/>'+v.time+' · 模拟</p></div></div>').join('')+'</div>':'<p>暂无通知。完成演示打印后，取件提醒会出现在这里。</p>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='about'){modal('关于这个交互首版','<p>共造连接个人创作者与制造商家，目标是实现从模型、报价、自动生产到物流和收货结算的完整流程。</p><p>当前可体验：本地 STL 预览、演示估价、订单状态、模拟打印、取件质检、物流与验收。页面中的商家、产能和价格均为演示。</p><p>真实设备、切片校验、登录、支付与物流尚未接入。此网页适配桌面与移动浏览器；原生应用与微信小程序需独立构建、签名及平台审核。</p>','<button class="btn primary" data-action="close">知道了</button>');}
});
document.addEventListener('change',e=>{
 if(e.target.id==='quantity'){state.qty=Math.min(50,Math.max(1,parseInt(e.target.value)||1));render();}
 if(e.target.id==='quote-sort'){state.sort=e.target.value;render();}
 if(e.target.id==='unit'){const unit=e.target.value;if(unit!==state.unit){const f=unit==='inch'?25.4:1/25.4;if(!state.model.review){state.model={...state.model,dimensions:state.model.dimensions.map(n=>n*f),volume:state.model.volume*f*f*f};}state.unit=unit;render();toast('已更新尺寸换算，请核对模型实际大小');}}
 if(e.target.id==='destination'){state.destination=e.target.value;save();render();toast(state.destination==='other'?'此地区已转为询价确认':'已按收货地区更新演示运费与交期');}
});
document.addEventListener('input',e=>{if(e.target.id==='network-search'){const pos=e.target.selectionStart;state.search=e.target.value;render();const input=$('#network-search');input.focus();input.setSelectionRange(pos,pos);}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='Tab'&&$('.modal')){const nodes=$$('button:not([disabled]),input,select,a[href],[tabindex="0"]',$('.modal'));const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
function box(x,y,z,w,h,d){const v=[[x,y,z],[x+w,y,z],[x+w,y+h,z],[x,y+h,z],[x,y,z+d],[x+w,y,z+d],[x+w,y+h,z+d],[x,y+h,z+d]];const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[2,3,7],[2,7,6],[1,2,6],[1,6,5],[3,0,4],[3,4,7]];return f.map(t=>t.map(i=>v[i]));}
function sampleMesh(){return [...box(-38,-26,-25,76,8,50),...box(-38,-18,17,76,52,8),...box(-38,-18,-25,8,19,42),...box(30,-18,-25,8,19,42)];}
function setupViewer(){
 const canvas=$('#model-canvas');if(!canvas)return;mesh=state.model.isSample?sampleMesh():state.model.triangles;drawViewer();let moving=false,lastX=0,lastY=0;
 canvas.addEventListener('pointerdown',e=>{moving=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointermove',e=>{if(!moving)return;yaw+=(e.clientX-lastX)*.008;pitch=Math.max(-1,Math.min(1.2,pitch+(e.clientY-lastY)*.006));lastX=e.clientX;lastY=e.clientY;drawViewer();});
 canvas.addEventListener('pointerup',()=>moving=false);canvas.addEventListener('pointercancel',()=>moving=false);
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.5,Math.min(2.5,zoom-e.deltaY*.001));drawViewer();},{passive:false});
 canvas.addEventListener('keydown',e=>{if(e.key.startsWith('Arrow')){e.preventDefault();if(e.key==='ArrowLeft')yaw-=.1;if(e.key==='ArrowRight')yaw+=.1;if(e.key==='ArrowUp')pitch-=.1;if(e.key==='ArrowDown')pitch+=.1;drawViewer();}});
}
function drawViewer(){
 const c=$('#model-canvas');if(!c)return;const rect=c.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);c.width=rect.width*dpr;c.height=rect.height*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
 if(state.model.review){ctx.fillStyle='#a4b5be';ctx.font='500 16px sans-serif';ctx.textAlign='center';ctx.fillText('文件已登记，等待工程解析',w/2,h/2-5);ctx.font='11px sans-serif';ctx.fillStyle='#9aaab3';ctx.fillText('STL 格式可在此旋转预览',w/2,h/2+20);return;}
 const sc=Math.min(w/205,h/145)*zoom;
 const rot=p=>{const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);return[x,p[1]*Math.cos(pitch)-z*Math.sin(pitch),p[1]*Math.sin(pitch)+z*Math.cos(pitch)];};
 const project=p=>[w/2+p[0]*sc,h/2+12-p[1]*sc];
 ctx.save();ctx.translate(w/2,h*.79);ctx.scale(1,.25);const g=ctx.createRadialGradient(0,0,0,0,0,w*.25);g.addColorStop(0,'#365c6c23');g.addColorStop(1,'#365c6c00');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,w*.28,0,Math.PI*2);ctx.fill();ctx.restore();
 const tris=mesh.map(t=>{const v=t.map(rot);return {v,z:(v[0][2]+v[1][2]+v[2][2])/3};}).sort((a,b)=>a.z-b.z);
 for(const {v} of tris){const a=v[0],b=v[1],cc=v[2],u=b.map((n,k)=>n-a[k]),vv=cc.map((n,k)=>n-a[k]);const n=[u[1]*vv[2]-u[2]*vv[1],u[2]*vv[0]-u[0]*vv[2],u[0]*vv[1]-u[1]*vv[0]],len=Math.hypot(...n)||1;const shade=.56+.28*Math.abs((n[0]*-.4+n[1]*.7+n[2]*.6)/len);const r=Math.round(130*shade+48),gg=Math.round(161*shade+52),bb=Math.round(177*shade+52);ctx.beginPath();v.map(project).forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle='rgb('+r+','+gg+','+bb+')';ctx.fill();ctx.strokeStyle='rgba(111,144,160,.12)';ctx.lineWidth=.45;ctx.stroke();}
 if(state.model.isSample){for(const x of [-22,22]){const v=project(rot([x,12,25.3]));ctx.beginPath();ctx.ellipse(v[0],v[1],4.3*sc,5*sc,0,0,Math.PI*2);ctx.fillStyle='#7b99a8';ctx.fill();ctx.strokeStyle='#c7d7dd';ctx.lineWidth=1;ctx.stroke();}}
}
window.addEventListener('resize',()=>drawViewer());
render();
if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
