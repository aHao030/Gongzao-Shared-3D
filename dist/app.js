import { createMerchantUI } from './merchant-ui.js';
import { get, prepareMutation } from './api-client.js';
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
 PLA:{label:'PLA',color:'#e5e5e5',rate:.45,process:'FDM',tip:'适合外观原型与轻载结构。尺寸与强度要求请在下单前确认。'},
 PETG:{label:'PETG',color:'#d8d8d8',rate:.58,process:'FDM',tip:'适合韧性较高的功能样件。自动生产仅使用已验证的设备工艺模板。'},
 ABS:{label:'ABS',color:'#dcdcdc',rate:.68,process:'FDM',tip:'需要具备封闭腔体与通风条件的认证设备，当前仅演示审核报价。'},
 RESIN:{label:'工程树脂',color:'#dedede',rate:.96,process:'树脂',tip:'树脂工艺还包括清洗、固化和后处理，需商家审核生产计划。'},
 ALUMINUM:{label:'铝合金',color:'#c4c4c4',rate:3.6,process:'金属',tip:'金属零件需确认材料牌号、公差、支撑和后处理，由工程人员审核。'},
 CNC:{label:'CNC 铝件',color:'#cfcfcf',rate:4.5,process:'CNC',tip:'请上传 STEP 与必要的工程图；装夹、刀路和加工参数需工程审核。'}
};
const destinations={east:'中国大陆 · 华东',south:'中国大陆 · 华南',north:'中国大陆 · 华北',other:'其他地区 · 询价确认'};
let legacyCount=0;
try{legacyCount=JSON.parse(localStorage.getItem('coforge.demo.v1')||'{}').orders?.length||0;}catch{}
const state={page:'home',material:'PLA',quality:'standard',qty:1,unit:'mm',destination:null,customerProfile:null,customerProfileLoaded:false,sort:'recommended',orders:[],devices:[],models:[],quotes:[],networkFilter:'all',catalogFilter:'all',search:'',menuOpen:false,model:null,connection:'loading',session:null,busy:false,busyLabel:'',error:null,quoteLoading:false,quoteError:null,legacyCount,revision:0};
const sampleModel={id:'sample-bracket',name:'桌面设备固定支架.stl',size:284672,dimensions:[72,48,58],volume:22.4,triangles:[],isSample:true,review:false,faceCount:3248};
state.model={...sampleModel};
let mesh=[], yaw=-.64,pitch=.37,zoom=1,animation=0,toastTimer, focusBeforeModal=null;
const money=n=>'¥'+Number(n).toFixed(2);
function displayTime(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):String(value||'');}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),3400);}
function quote(f){return state.quotes.find(q=>q.farm.id===f.id);}
let retryOperation=null,quoteTask=null,quoteSequence=0,quoteTimer=null;
function applyWorkspace(workspace){if(!workspace||Number(workspace.revision)<state.revision)return;state.orders=workspace.orders||[];state.devices=workspace.devices||[];state.models=workspace.models||[];state.revision=workspace.revision||0;if(Object.hasOwn(workspace,'customerProfile')){state.customerProfileLoaded=true;state.customerProfile=workspace.customerProfile;state.destination=workspace.customerProfile?.destination||null;}}
function connectionLabel(){return state.connection==='online'?'服务端保存 · 沙盒演示':state.connection==='loading'?'正在连接服务端':'离线演示 · 只读';}
function requestNotice(){
 let text='';
 if(state.busy)text+='<div class="request-notice busy" role="status">'+I('clock')+'<span>'+esc(state.busyLabel)+'，请稍候。以服务端确认结果为准。</span></div>';
 if(state.error)text+='<div class="request-notice error" role="alert">'+I('info')+'<span>'+esc(state.error.message)+(state.error.requestId?'<small>请求编号 '+esc(state.error.requestId)+'</small>':'')+'</span><button class="btn tiny" data-action="'+(retryOperation?'retry-operation':'reconnect')+'" '+(state.busy?'disabled':'')+'>重试</button></div>';
 if(state.connection==='offline')text+='<div class="request-notice">'+I('info')+'<span>当前仅可浏览或本地预览。没有创建本地订单，也不会自动补做下单或生产操作。</span></div>';
 if(state.legacyCount)text+='<div class="legacy-notice">检测到旧版浏览器中有 '+state.legacyCount+' 条演示订单。旧数据仍保留在本机，不会自动导入服务端。</div>';
 return text;
}
let customerModal=null,customerSaving=false,onboardingPrompted=false,customerSaveTask=null;
const customerProvinces=['北京市','天津市','河北省','山西省','内蒙古自治区','辽宁省','吉林省','黑龙江省','上海市','江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','广西壮族自治区','海南省','重庆市','四川省','贵州省','云南省','西藏自治区','陕西省','甘肃省','青海省','宁夏回族自治区','新疆维吾尔自治区'];
const customerCountries={CN:'中国大陆',HK:'中国香港',MO:'中国澳门',TW:'中国台湾',US:'美国',CA:'加拿大',GB:'英国',DE:'德国',FR:'法国',AU:'澳大利亚',NZ:'新西兰',JP:'日本',KR:'韩国',SG:'新加坡',MY:'马来西亚',TH:'泰国',OTHER:'其他国家 / 地区'};
function hasShippingAddress(){return Boolean(state.customerProfile?.shippingAddress);}
function clearQuotes(){quoteSequence++;state.quotes=[];state.quoteLoading=false;state.quoteError=null;quoteTask=null;clearTimeout(quoteTimer);}
async function reloadCustomerProfile(){
 try{const result=await get('/workspace');applyWorkspace(result.workspace);return true;}
 catch(error){state.connection='offline';state.error=error;return false;}
}
function quotePlaceholder(){
 const offline=state.connection==='offline',needsAddress=!hasShippingAddress();
 const title=state.quoteLoading?'正在测算费用':state.connection==='loading'?'正在连接服务端':offline?'连接后即可测算费用':state.quoteError?'报价未获取成功':needsAddress?'准备好，开始测算。':'测算你的制造费用';
 const note=state.quoteError?.message||(offline?'恢复连接后再获取报价与下单。':needsAddress?'选择模型与工艺，点击测算获取制造报价与交付预估。':'根据作品配置与已保存的收货资料计算。');
 return '<div class="card quote-placeholder" role="status">'+I(state.quoteLoading?'clock':'info')+'<div><strong>'+title+'</strong><p>'+esc(note)+'</p></div>'+(!state.quoteLoading?'<button class="btn primary" data-action="'+(offline?'reconnect':state.quoteError?'retry-quotes':'measure-cost')+'" '+(state.connection==='loading'?'disabled':'')+'>'+(offline?'重新连接':state.quoteError?'重试测算':'测算费用')+I('arrow')+'</button>':'')+'</div>';
}
function requestCostEstimate(){
 if(state.connection!=='online'){toast('请先连接服务端，再测算费用。');return;}
 if(!hasShippingAddress()){openCustomerProfile({required:true});return;}
 refreshQuotes();
}
function customerInput(id,label,value,{autocomplete='',max=120,required=true,type='text',placeholder=''}={}){
 return '<div class="field"><label class="field-label" for="'+id+'">'+label+'</label><input class="input" id="'+id+'" name="'+id+'" type="'+type+'" value="'+esc(value)+'" maxlength="'+max+'" '+(required?'required':'')+' '+(autocomplete?'autocomplete="'+autocomplete+'"':'')+' placeholder="'+esc(placeholder)+'"/></div>';
}
function customerProvinceField(country,value){
 if(country!=='CN')return '<label class="field-label" for="customer-province">省 / 州</label><input class="input" id="customer-province" name="customer-province" autocomplete="address-level1" maxlength="80" required value="'+esc(value)+'" placeholder="填写省、州或行政区"/>';
 const options=customerProvinces.includes(value)||!value?customerProvinces:[value,...customerProvinces];
 return '<label class="field-label" for="customer-province">省 / 直辖市 / 自治区</label><select class="select" id="customer-province" name="customer-province" autocomplete="address-level1" required><option value="">请选择</option>'+options.map(v=>'<option '+(v===value?'selected':'')+' value="'+esc(v)+'">'+esc(v)+'</option>').join('')+'</select>';
}
function openCustomerProfile({required=false,onboarding=false}={}){
 if(customerSaving||state.busy)return;
 if(state.connection==='loading'||!state.customerProfileLoaded){toast(state.connection==='offline'?'请重新连接服务端后打开账号资料。':'账号资料正在加载，请稍候。');return;}
 if(state.connection!=='online'){toast('请重新连接服务端后打开账号资料。');return;}
 const profile=state.customerProfile||{},address=profile.shippingAddress||{},countryCode=address.countryCode||'CN',country=Object.hasOwn(customerCountries,countryCode)?countryCode:'OTHER';
 const title=required?'填写收货地址':onboarding?'完善账号资料':'账号资料';
 const description=required?'测算配送费用与交付时间前，请补充收货地址。保存后会继续本次费用测算。':onboarding?'欢迎来到共造。为当前账号填写资料与收货地址，后续测算将自动使用。也可以稍后再填。':'收货地址保存在你的账号资料中，后续费用测算自动使用。修改后会重新获取报价。';
 const body='<p class="customer-form-intro">'+description+'</p><form id="customer-profile-form" class="customer-profile-form">'+customerInput('customer-display-name','称呼（选填）',profile.displayName||'',{autocomplete:'nickname',max:80,required:false,placeholder:'如何称呼你'})+'<div class="customer-form-heading"><h3>收货资料</h3><span>仅用于配送与费用测算</span></div><div class="customer-form-grid">'+customerInput('customer-recipient','收货人',address.recipient||'',{autocomplete:'shipping name',max:80})+customerInput('customer-phone','联系电话',address.phone||'',{autocomplete:'shipping tel',max:40,type:'tel',placeholder:'可包含国家区号'})+'<div class="field"><label class="field-label" for="customer-country">国家 / 地区</label><select class="select" id="customer-country" name="customer-country" autocomplete="shipping country">'+Object.entries(customerCountries).map(([k,v])=>'<option value="'+k+'" '+(k===country?'selected':'')+'>'+v+'</option>').join('')+'</select></div><div class="field" id="customer-province-field">'+customerProvinceField(countryCode,address.province||'')+'</div><div class="field" id="customer-other-country-field" '+(country==='OTHER'?'':'hidden')+'><label class="field-label" for="customer-country-code">国家 / 地区代码</label><input class="input" id="customer-country-code" maxlength="2" pattern="[A-Za-z]{2}" '+(country==='OTHER'?'required':'')+' value="'+esc(country==='OTHER'?countryCode:'')+'" placeholder="两位字母，如 IT"/></div>'+customerInput('customer-city','城市',address.city||'',{autocomplete:'shipping address-level2',max:80})+'<div class="field"><label class="field-label" id="customer-district-label" for="customer-district">'+(countryCode==='CN'?'区 / 县':'区 / 县（选填）')+'</label><input class="input" id="customer-district" autocomplete="shipping address-level3" maxlength="80" '+(countryCode==='CN'?'required':'')+' value="'+esc(address.district||'')+'"/></div></div>'+customerInput('customer-address-line','详细地址',address.addressLine||'',{autocomplete:'shipping address-line1',max:240,placeholder:'街道、门牌号、楼层等'})+customerInput('customer-postal-code','邮政编码（选填）',address.postalCode||'',{autocomplete:'shipping postal-code',max:20,required:false})+'<p class="customer-privacy-note">首页不会展示你的收货地址。超出当前配送估价范围的地区将转为工程询价。</p><div id="customer-form-error" class="error-text" role="alert"></div></form>';
 const skip=!required&&!address.recipient?'<button class="btn" data-action="customer-skip">稍后填写</button>':'<button class="btn" data-action="close">取消</button>';
 modal(title,body,skip+'<button class="btn primary" data-action="customer-save">'+(required?'保存并测算费用':'保存资料')+I('arrow')+'</button>',true);
 customerModal={required,onboarding};customerSaveTask=null;$('.modal')?.classList.add('customer-profile-modal');
}
async function saveCustomerProfile(skip=false){
 if(customerSaving||!customerModal||!$('#customer-profile-form'))return;
 const context=customerModal,form=$('#customer-profile-form'),errorNode=$('#customer-form-error');errorNode.textContent='';
 const value=id=>$('#'+id).value.trim();
 let address=state.customerProfile?.shippingAddress||null;
 if(!skip){
  if(!form.reportValidity())return;
  const country=value('customer-country'),countryCode=(country==='OTHER'?value('customer-country-code'):country).toUpperCase(),phone=value('customer-phone');
  if(!/^[A-Z]{2}$/.test(countryCode)){errorNode.textContent='请填写两位字母的国家 / 地区代码。';$('#customer-country-code').focus();return;}
  if(!/^[+0-9 ()-]+$/.test(phone)||phone.replace(/\D/g,'').length<5||phone.replace(/\D/g,'').length>20){errorNode.textContent='请填写有效的联系电话，可包含国家区号、空格和短横线。';$('#customer-phone').focus();return;}
  address={recipient:value('customer-recipient'),phone,countryCode,province:value('customer-province'),city:value('customer-city'),district:value('customer-district'),addressLine:value('customer-address-line'),postalCode:value('customer-postal-code')};
  if([address.recipient,address.province,address.city,address.addressLine,...(countryCode==='CN'?[address.district]:[])].some(v=>!v)){errorNode.textContent='请填写完整的收货资料。';return;}
 }
 const payload={displayName:value('customer-display-name'),shippingAddress:address,setupCompleted:true},signature=JSON.stringify(payload);
 const previousRevision=state.customerProfile?.addressRevision;
 customerSaving=true;state.busy=true;state.busyLabel='正在保存账号资料';render();setModalBusy(true);$('.modal [data-action="close"]')?.setAttribute('disabled','');
 try{
  if(customerSaveTask?.signature!==signature)customerSaveTask={signature,task:await prepareMutation('/customer/profile',payload)};
  const result=await customerSaveTask.task.execute();applyWorkspace(result.workspace);
  // Workspace revision prevents a late replay from replacing a more recent address.
  if(!result.workspace){state.customerProfile=result.profile;state.destination=result.profile?.destination||null;}
  customerSaveTask=null;onboardingPrompted=true;state.connection='online';state.error=null;retryOperation=null;
  if(previousRevision!==state.customerProfile?.addressRevision)clearQuotes();
  customerSaving=false;state.busy=false;closeModal();render();
  toast(skip?'可在账号资料中补充收货地址。':'账号资料已保存。');
  if(hasShippingAddress()&&(context.required||['home','create'].includes(state.page)))refreshQuotes();
 }catch(error){
  state.busy=false;customerSaving=false;
  if(['NETWORK_ERROR','TIMEOUT','INVALID_RESPONSE'].includes(error.code))state.connection='offline';
  render();
  if(customerModal===context&&$('#customer-form-error'))$('#customer-form-error').textContent=error.message+' 请检查后再次保存；输入的内容已保留。';
 }finally{customerSaving=false;state.busy=false;setModalBusy(false);$('.modal [data-action="close"]')?.removeAttribute('disabled');}
}

async function connectWorkspace(){
 if(state.busy)return;
 state.connection='loading';state.customerProfileLoaded=false;state.error=null;render();
 try{state.session=await get('/session');const result=await get('/workspace');applyWorkspace(result.workspace);state.connection='online';render();if(merchant.isRoute())await merchant.load(false);else{await refreshQuotes();if(!state.customerProfile?.setupCompleted&&!onboardingPrompted&&!$('.modal')){onboardingPrompted=true;openCustomerProfile({onboarding:true});}}}
 catch(error){state.connection='offline';state.error=error;state.quotes=[];render();}
}
function selectedConfiguration(){return{modelId:state.model.id,material:state.material,quality:state.quality,qty:state.qty,unit:state.unit,addressRevision:state.customerProfile?.addressRevision??0};}
function configurationChanged(){quoteSequence++;state.quotes=[];state.quoteLoading=false;state.quoteError=null;quoteTask=null;clearTimeout(quoteTimer);render();if(state.connection==='online')quoteTimer=setTimeout(()=>refreshQuotes(),220);}
async function refreshQuotes(retry=false){
 if(state.connection!=='online'||!state.model.id)return;
 if(!hasShippingAddress()){state.quotes=[];state.quoteLoading=false;state.quoteError=null;render();return;}
 const sequence=++quoteSequence;const config=selectedConfiguration(),addressRevision=state.customerProfile.addressRevision;state.quotes=[];state.quoteLoading=true;state.quoteError=null;render();
 try{const task=retry&&quoteTask?quoteTask:await prepareMutation('/quotes',config);quoteTask=task;const result=await task.execute();if(sequence!==quoteSequence||addressRevision!==state.customerProfile?.addressRevision||JSON.stringify(config)!==JSON.stringify(selectedConfiguration()))return;applyWorkspace(result.workspace);quoteTask=null;if(result.quotes.some(q=>q.addressRevision!==state.customerProfile?.addressRevision)){state.quotes=[];return refreshQuotes();}state.quotes=result.quotes;}
 catch(error){if(sequence===quoteSequence){state.quotes=[];state.quoteError=error;if(['ADDRESS_REQUIRED','ADDRESS_CHANGED','DESTINATION_MISMATCH'].includes(error.code)){await reloadCustomerProfile();state.quoteError=null;}else if(['NETWORK_ERROR','TIMEOUT','INVALID_RESPONSE'].includes(error.code))state.connection='offline';}}
 finally{if(sequence===quoteSequence){state.quoteLoading=false;render();}}
}
async function perform(task,onSuccess,label){
 if(state.busy)return;
 state.busy=true;state.busyLabel=label;state.error=null;render();setModalBusy(true);
 try{const result=await task.execute();applyWorkspace(result.workspace);state.connection='online';retryOperation=null;state.busy=false;state.error=null;onSuccess?.(result);render();}
 catch(error){state.busy=false;if(['ADDRESS_REQUIRED','ADDRESS_CHANGED','DESTINATION_MISMATCH'].includes(error.code)){retryOperation=null;state.error=null;clearQuotes();await reloadCustomerProfile();closeModal();render();if(!hasShippingAddress())openCustomerProfile({required:true});else{toast('收货地址已更新，请使用重新测算的报价。');refreshQuotes();}}else{state.error=error;retryOperation={task,onSuccess,label};if(['NETWORK_ERROR','TIMEOUT','INVALID_RESPONSE'].includes(error.code))state.connection='offline';render();showModalError(error);}}
 finally{state.busy=false;setModalBusy(false);}
}
async function mutate(path,payload,onSuccess,label){
 if(state.busy)return;
 if(state.connection!=='online'){toast('请连接服务端后操作，离线模式不会创建订单。');return;}
 const task=await prepareMutation(path,payload);return perform(task,onSuccess,label);
}
function actionRequest(action,id,evidence={},success='服务端已保存操作结果'){
 return mutate('/actions',{action,id,...evidence,demoAcknowledged:true},result=>{if(result.reset){state.model={...sampleModel};state.unit='mm';state.quotes=[];}closeModal();toast(result.blockedReason?'备机已保存，任务仍等待条件满足。':success);},'正在提交操作');
}
function setModalBusy(busy){$$('.modal button:not([data-action="close"]),.modal input,.modal select').forEach(e=>{if(busy){e.dataset.wasDisabled=e.disabled?'true':'false';e.disabled=true;}else if(e.dataset.wasDisabled!==undefined){e.disabled=e.dataset.wasDisabled==='true';delete e.dataset.wasDisabled;}});}
function showModalError(error){const container=$('.modal-body');if(!container)return;let node=$('#modal-request-error');if(!node){node=document.createElement('div');node.id='modal-request-error';node.className='error-text';node.setAttribute('role','alert');container.appendChild(node);}node.innerHTML=esc(error.message)+' <button class="link-btn" data-action="retry-operation">用原请求重试</button>';}
function navButton(n){return '<button data-action="nav" data-page="'+n[0]+'" class="'+(state.page===n[0]?'active':'')+'">'+I(n[1])+'<span>'+n[2]+'</span>'+(n[0]==='orders'&&state.orders.length?'<span class="count">'+state.orders.length+'</span>':'')+'</button>';}
function render(){
 cancelAnimationFrame(animation);
 const isMerchant=merchant.isRoute(),pageName=isMerchant?'商家工作台':state.page==='orders'?'我的订单':'开始创作';
 const customerNav='<nav class="header-nav" aria-label="个人导航"><button data-action="nav" data-page="home" class="'+(['home','create'].includes(state.page)?'active':'')+'">开始创作</button><button data-action="nav" data-page="orders" class="'+(state.page==='orders'?'active':'')+'">我的订单'+(state.orders.length?'<span class="nav-count">'+state.orders.length+'</span>':'')+'</button><button data-action="customer-profile" '+(state.connection==='loading'||!state.customerProfileLoaded||state.busy?'disabled':'')+'>账号资料</button></nav><a class="portal-switch" href="/merchant/login">商家登录 '+I('arrow')+'</a>';
 $('#app').innerHTML='<header class="site-header"><div class="site-header-inner"><a href="/" class="brand"><img src="/icons.svg" alt=""/><span class="brand-name">共造</span><span class="brand-sub">'+(isMerchant?'商家工作台':'从想法，到实物')+'</span></a><div class="header-right">'+(isMerchant?merchant.nav():customerNav)+'</div></div></header>'+
 '<main id="main" class="main '+(isMerchant?'merchant-main':'customer-main')+'">'+(isMerchant?merchant.renderContent():requestNotice()+renderPage())+'</main>'+
 '<footer class="site-footer"><span>共造 COFORGE</span><span>开发沙盒 · 不产生真实交易 <button class="text-link" data-action="payment-plan">支付与结算</button> · <button class="text-link" data-action="about">了解当前范围</button></span><button class="connection-status" data-action="reconnect"><i class="'+state.connection+'"></i>'+(state.connection==='online'?'已连接服务端':state.connection==='loading'?'正在连接':'连接已断开')+'</button></footer>';
 if(!isMerchant&&(state.page==='home'||state.page==='create'))setupViewer();
 if(state.busy)$$('#main button,#main input,#main select').forEach(el=>{el.disabled=true;});
 document.title=pageName+' · 共造';
}
function intro(eye,title,desc,actions=''){return '<div class="page-intro"><div><div class="eyebrow">'+eye+'</div><h1>'+title+'</h1><p>'+desc+'</p></div>'+actions+'</div>';}
function renderPage(){switch(state.page){case'orders':return ordersPage();case'farm':return farmPage();case'network':return networkPage();case'catalog':return catalogPage();default:return workspacePage();}}
function workspacePage(){
 const m=state.model;
 const actions='<div class="intro-actions"><button class="btn" data-action="sample">'+I('cube')+'体验示例模型</button><button class="btn primary" data-action="upload">'+I('plus')+'新建项目</button></div>';
 const label='让想法，成为实物。';
 const unitScale=state.unit==='inch'?25.4:1;
 const dims=m.review?'待工程确认':m.dimensions.map(n=>(Number(n)*unitScale).toFixed(1)).join(' × ');
 let qs=[...state.quotes];if(state.sort==='price')qs.sort((a,b)=>a.total-b.total);if(state.sort==='fast')qs.sort((a,b)=>a.days[0]-b.days[0]);
 return intro('MAKE SOMETHING REAL',label,'上传你的设计。选择制造伙伴。等待作品送达。',actions)+

 '<div class="workspace-grid"><section class="card model-card"><div class="card-head"><h2>'+I('cube')+'模型预览</h2><span class="badge '+(m.review||m.localOnly?'amber':'teal')+'">'+(m.localOnly?'本地预览 · 未上传':m.review?'待工程审核':m.isSample?'示例模型':'服务端已解析 · 待制造校验')+'</span></div>'+
 '<div class="viewer"><div class="viewer-grid"></div><canvas id="model-canvas" aria-label="三维模型预览，可拖动旋转" tabindex="0"></canvas><div class="viewer-top"><span class="viewer-tag">'+(m.review?'FILE REVIEW':'PERSPECTIVE VIEW')+'</span><div class="viewer-tools"><button data-action="zoom-in" aria-label="放大模型">'+I('plus')+'</button><button data-action="zoom-out" aria-label="缩小模型">'+I('minus')+'</button><button data-action="reset-view" aria-label="复位视角">'+I('expand')+'</button></div></div><div class="viewer-note">'+I('cursor')+(m.review?'此文件格式仅登记，尚未生成三维预览':'拖动旋转 · 滚轮缩放 · 方向键调整视角')+'</div><span class="axis">X Y Z</span></div>'+
 '<div class="model-strip"><div class="file-icon">'+I('file')+'</div><div><div class="model-name">'+esc(m.name)+'</div><div class="file-meta">'+(m.size/1024).toFixed(0)+' KB · '+(m.review?'等待 CAD 解析':m.faceCount.toLocaleString()+' 个三角面')+'</div></div><button class="link-btn" data-action="upload">更换模型 '+I('arrow')+'</button></div>'+
 '<div class="model-metrics"><div class="metric"><span>外形尺寸 '+(m.review?'':'/ mm')+'</span><strong>'+dims+'</strong></div><div class="metric"><span>实体体积</span><strong>'+(m.review?'待解析':(m.volume*unitScale**3).toFixed(1)+' cm³')+'</strong></div><div class="metric"><span>当前用途</span><strong>原型与定制部件</strong></div></div></section>'+
 '<section class="card"><div class="card-head"><h2>'+I('settings')+'配置你的作品</h2><span class="small muted" style="font-size:10px">演示估价</span></div><div class="form-body">'+
 '<div class="field"><div class="field-label">制造材料 <span>选择适合你的材料</span></div><div class="material-grid">'+Object.entries(materials).map(([k,v])=>'<button class="material-option '+(state.material===k?'selected':'')+'" data-action="material" data-material="'+k+'"><span class="swatch" style="background:'+v.color+'"></span>'+v.label+'</button>').join('')+'</div></div>'+
 (materials[state.material].process==='FDM'?'<div class="field"><div class="field-label">打印层高 <span>尺寸公差需单独确认</span></div><div class="segmented"><button data-action="quality" data-quality="standard" class="'+(state.quality==='standard'?'selected':'')+'">标准 · 0.20 mm</button><button data-action="quality" data-quality="fine" class="'+(state.quality==='fine'?'selected':'')+'">精细 · 0.12 mm</button></div></div>':'<div class="field"><div class="field-label">精度与工艺要求 <span>工程审核</span></div><div class="input" style="display:flex;align-items:center">按图纸公差与材料工艺确认</div></div>')+
 '<div class="form-row"><div class="field"><label class="field-label" for="quantity">制作数量</label><div class="stepper"><button data-action="qty-minus" aria-label="减少数量">−</button><input id="quantity" type="number" min="1" max="50" value="'+state.qty+'" aria-label="制作数量"/><button data-action="qty-plus" aria-label="增加数量">+</button></div></div><div class="field"><label class="field-label" for="unit">文件尺寸单位</label><select class="select" id="unit"><option value="mm" '+(state.unit==='mm'?'selected':'')+'>毫米 mm</option><option value="inch" '+(state.unit==='inch'?'selected':'')+'>英寸 inch</option></select></div></div>'+
 '<div class="field"><span class="field-label">表面处理</span><div class="input" style="display:flex;align-items:center;color:#9e9e9e">去支撑与基础清理</div></div>'+
 '<div class="hint">'+I('info')+'<span>'+materials[state.material].tip+'</span></div></div></section></div>'+
 '<section class="quote-section"><div class="section-heading"><h2>为你匹配的制造伙伴 <span class="small">3 家演示商家</span></h2><select class="sort-select" id="quote-sort" aria-label="报价排序"><option value="recommended" '+(state.sort==='recommended'?'selected':'')+'>综合推荐排序</option><option value="price" '+(state.sort==='price'?'selected':'')+'>报价从低到高</option><option value="fast" '+(state.sort==='fast'?'selected':'')+'>预计交付更快</option></select></div>'+(qs.length?'<div class="quotes">'+qs.map(quoteCard).join('')+'</div>':quotePlaceholder())+'<p class="inline-note">报价由服务端按模型记录、数量、层高、排队情况和配送地区计算。当前为沙盒估算，尚未经过真实切片与商家确认，不保证实际价格或交期。</p></section>'+
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
 return intro('YOUR PROJECTS','每一件作品，都有迹可循。','订单与状态由服务端保存；打印、物流及结算仍为沙盒模拟。','<div class="intro-actions"><button class="btn primary" data-action="nav" data-page="create">'+I('plus')+'新建项目</button></div>')+
 (state.orders.length?'<div class="order-list">'+[...state.orders].reverse().map(orderCard).join('')+'</div>':'<div class="card empty-state">'+I('orders')+'<h3>你的第一件作品，从这里开始</h3><p>选择一个示例模型和制造伙伴，体验完整的演示订单流程。</p><button class="btn primary" data-action="nav" data-page="home">开始体验 '+I('arrow')+'</button></div>');
}
function orderCard(o){
 const f=farms.find(f=>f.id===o.farm);
 const idx={review:0,queued:1,printing:1,awaiting_pickup:2,qc_failed:2,ready_to_ship:2,shipped:3,delivered:4,settled:5,cancelled:-1}[o.status];
 const stages=['下单','生产','质检','物流','验收','结算'];
 let action='<a class="btn tiny" href="/merchant#orders">商家履约演示 '+I('arrow')+'</a>';
 let note=o.modelHash?'服务端已保存文件指纹、配置与报价快照。尚未生成真实切片文件。':'服务端已保存材料、数量、层高与报价快照。尚未生成真实切片文件。';
 if(o.status==='review'){note='文件、工艺或配送地区需审核，尚未付款或生成生产指令。';action='<button class="btn tiny" data-action="cancel-order" data-id="'+o.id+'">撤回询价</button>';}
 if(o.status==='queued'){note='等待前序任务完成、设备清台或按本单材料备机。';action='<button class="btn tiny" data-action="cancel-order" data-id="'+o.id+'">取消演示订单</button>'+action;}
 if(o.status==='awaiting_pickup')note='打印完成，等待农场主取件、清台和质检。';
 if(o.status==='qc_failed')note='质检未通过，暂停发货与结算，等待工程处理。';
 if(o.status==='ready_to_ship')note='质检已通过，等待农场主填写模拟运单。';
 if(o.status==='shipped'){note='模拟物流 '+esc(o.tracking)+' · 不对应真实快递。';action='<button class="btn tiny" data-action="tracking" data-id="'+o.id+'">物流详情</button><button class="btn tiny soft" data-action="deliver" data-id="'+o.id+'">模拟物流签收</button>';}
 if(o.status==='delivered'){note='物流签收不会自动结算，请在确认产品符合要求后验收。';action='<button class="btn tiny" data-action="dispute" data-id="'+o.id+'">'+(o.dispute?'撤销演示争议':'发起演示争议')+'</button><button class="btn tiny primary" data-action="settle" data-id="'+o.id+'" '+(o.dispute?'disabled':'')+'>确认验收 · 演示结算</button>';}
 if(o.status==='settled'){note='模拟结算完成。此流程没有产生任何实际收款或转账。';action='<span class="badge teal">'+I('check')+'已完成</span>';}
 if(o.status==='cancelled'){note='演示订单已取消，没有实际扣款。';action='';}
 return '<article class="card"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub">'+esc(f.name)+' · '+materials[o.material].label+' · '+o.qty+' 件'+(materials[o.material].process==='FDM'?' · '+(o.quality==='fine'?'0.12':'0.20')+' mm 层高':'')+'</div><div class="order-sub">'+esc(destinations[o.destination]||'旧演示订单未记录地区')+(o.quoteSnapshot?.days?' · 下单时估计 '+o.quoteSnapshot.days[0]+'–'+o.quoteSnapshot.days[1]+' 个工作日收到（演示）':'')+'</div><div class="order-sub mono">'+o.id+' · '+esc(displayTime(o.created))+'</div></div><div><span class="badge '+(o.status==='settled'?'teal':o.dispute?'red':o.status==='review'?'amber':'blue')+'">'+(o.dispute?'争议处理中':stageNames[o.status])+'</span><div class="order-price">'+(o.total?money(o.total):'待报价')+'</div></div></div><div class="order-body"><div class="timeline">'+stages.map((s,i)=>'<div class="timeline-item '+(i<idx?'done':i===idx?'current':'')+'">'+s+'</div>').join('')+'</div><div class="order-bottom"><span>'+note+'</span><div class="order-actions">'+action+'</div></div></div></article>';
}
function farmPage(){
 const working=state.devices.filter(d=>d.state==='printing').length, waiting=state.devices.filter(d=>d.state==='waiting').length;
 return intro('ORDER FULFILLMENT','生产与交付。','体验从生产、质检到发货的订单流程。以下设备和操作均为模拟。','<div class="intro-actions"><button class="btn" data-merchant-action="devices">设备清单 '+I('arrow')+'</button></div>')+
 '<div class="summary-grid">'+[['可接单设备',state.devices.filter(d=>d.state==='ready').length,'已备机 · 演示'],['正在生产',working,'已锁定生产任务 · 演示'],['等待取件',waiting,'清空打印板后恢复就绪'],['待发货订单',state.orders.filter(o=>o.status==='ready_to_ship').length,'质检通过后发货']].map(x=>'<div class="card summary-card"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><p>'+x[2]+'</p></div>').join('')+'</div>'+
 '<div class="section-heading"><h2>设备工作台 <span class="small">所有设备均为模拟实例</span></h2><button class="link-btn" data-action="nav" data-page="catalog">查看兼容路线 '+I('arrow')+'</button></div><div class="device-grid">'+state.devices.map(deviceCard).join('')+'</div>'+
 '<section style="margin-top:27px"><div class="section-heading"><h2>待交付任务</h2></div>'+ (state.orders.some(o=>['ready_to_ship','qc_failed'].includes(o.status))?'<div class="order-list">'+state.orders.filter(o=>['ready_to_ship','qc_failed'].includes(o.status)).map(o=>'<article class="card"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub">'+o.id+' · '+o.qty+' 件 · '+stageNames[o.status]+'</div></div>'+(o.status==='ready_to_ship'?'<button class="btn primary" data-action="ship" data-id="'+o.id+'">填写模拟运单</button>':'<span class="badge amber">待工程处理</span>')+'</div></article>').join('')+'</div>':'<div class="card empty-state" style="padding:30px"><p style="margin:0">暂无待交付任务。完成打印和质检后，订单会显示在这里。</p></div>')+'</section>';
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
function modal(title,body,footer='',wide=false){if(customerSaving)return;customerModal=null;focusBeforeModal=document.activeElement;$('#modal-root').innerHTML='<div class="modal-backdrop" data-dismiss="true"><section class="modal '+(wide?'wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">'+title+'</h2><button class="icon-btn" data-action="close" aria-label="关闭窗口">'+I('close')+'</button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'')+'</section></div>';document.body.style.overflow='hidden';setTimeout(()=>$('.modal button,.modal input,.modal select')?.focus(),0);}
function closeModal(){if(customerSaving)return;customerModal=null;$('#modal-root').innerHTML='';document.body.style.overflow='';focusBeforeModal?.focus?.();}
function paymentPlan(){
 const methods=[['微信支付 · 支付宝','面向适配地区，拟接入平台交易与分账产品。'],['Visa · Mastercard 等银行卡','通过支持平台业务的收单服务接入。'],['Apple Pay · Google Pay','按地区、设备与已开通的收单能力展示。'],['PayPal · 地区支付方式','仅在订单周期、商家地区及结算规则匹配时提供。']];
 const body='<p>确认报价后付款，确认收货后再申请向商家结算。</p><div class="hint">'+I('info')+'<span>当前为支付接入方案，以上通道尚未开通。本版本只模拟付款，不会收取真实款项。</span></div><div class="payment-method-plans">'+methods.map(([name,note])=>'<div><strong>'+name+'</strong><span>计划接入</span><p>'+note+'</p></div>').join('')+'</div><h3 class="payment-plan-heading">一笔订单的资金流程</h3><ol class="payment-plan-steps"><li><strong>确认报价并付款</strong><p>保存金额、币种与收货资料，以支付服务商确认的付款结果为准。</p></li><li><strong>制造、质检与配送</strong><p>订单款项按通道规则延迟结算，物流签收不会自动触发放款。</p></li><li><strong>客户确认收货</strong><p>核对订单无退款或争议，再申请分账、解冻或向商家转账。</p></li><li><strong>跟踪结算与到账</strong><p>分别显示结算处理结果与银行到账状态，不将已申请当作已到账。</p></li></ol><p class="inline-note">实际可用方式取决于平台与商家的国家/地区、币种和审核结果。通道存在持款期限；超出允许周期的订单将限制该通道，并在到期前处理延期、退款等异常。</p>';
 modal('支付与结算',body,'<button class="btn primary" data-action="close">知道了</button>',true);
}
function qDetails(q){return q.review?'<p>该文件、制造工艺或配送地区需要审核。提交后会创建一条演示询价记录，不会启动设备或产生扣款。</p><div class="detail-row"><span>收货地区</span><strong>'+destinations[q.destination]+'</strong></div>':'<p>按材料、数量、层高与收货地区生成演示估价，价格及交期均不是商家承诺。</p>'+[['材料与预计损耗',q.material],['预计设备机时',q.machine],['基础清理与准备',q.finishing],['包装配送 · '+destinations[q.destination],q.shipping],['平台服务',q.service]].map(x=>'<div class="detail-row"><span>'+x[0]+'</span><strong>'+money(x[1])+'</strong></div>').join('')+'<div class="detail-row total"><span>演示总价 · '+state.qty+' 件</span><strong>'+money(q.total)+'</strong></div><div class="detail-row"><span>本单估算机时</span><strong>'+q.productionHours.toFixed(1)+' 小时</strong></div><div class="detail-row"><span>前序任务估算机时</span><strong>'+q.queueHours.toFixed(1)+' 小时</strong></div><div class="detail-row"><span>区域运输估计</span><strong>'+q.transitDays[0]+'–'+q.transitDays[1]+' 个工作日</strong></div><div class="detail-row"><span>预计收到 · 示例</span><strong>'+q.days[0]+'–'+q.days[1]+' 个工作日</strong></div><p class="inline-note" style="font-size:10px;margin-top:15px">机时按体积、数量及层高近似计算，按每日 8 小时产能排队；正在执行的任务保守计入完整机时，并加上备机、后处理和地区运输时间。未连接真实排产及物流，不能保证实际交期。</p>';}
function uploadModal(){modal('上传你的三维模型','<p>'+ (state.connection==='online'?'文件将发送至服务端。STL 由服务端重新计算几何信息；STEP、3MF 和图片登记后进入工程审核。':'当前离线，仅可本地预览；不会保存服务端模型或生成报价。')+'</p><div class="upload-zone" id="dropzone" role="button" tabindex="0" aria-label="选择或拖入模型文件">'+I('upload')+'<strong>拖入文件，或点击选择</strong><p>STL · STEP · STP · 3MF · PNG · JPG · WebP<br/>单文件不超过 20 MB</p><span class="btn tiny">选择文件</span></div><input type="file" id="model-file" class="file-hidden" accept=".stl,.step,.stp,.3mf,.png,.jpg,.jpeg,.webp"/><div id="upload-error" class="error-text"></div><p style="font-size:10px">STL 不保存单位。上传后请核对单位及尺寸；三维预览和几何解析不代表通过制造审核。</p>','<button class="btn" data-action="sample">使用示例模型</button>');const drop=$('#dropzone'),file=$('#model-file');drop.onclick=()=>file.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}};file.onchange=()=>file.files[0]&&loadFile(file.files[0]);drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag');};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');if(e.dataTransfer.files[0])loadFile(e.dataTransfer.files[0]);};}
async function loadFile(file){
 if(state.busy)return;
 try{
 if(file.size>20*1024*1024)throw Error('文件超过 20 MB，请先简化模型。');
 const ext=file.name.split('.').pop().toLowerCase();if(!['stl','step','stp','3mf','png','jpg','jpeg','webp'].includes(ext))throw Error('请选择支持的模型文件或图片。');
 const data=await file.arrayBuffer();let preview={triangles:[],dimensions:[],volume:0,faceCount:0,review:true};
 if(ext==='stl'){preview=parseSTL(data);preview.review=!preview.closed;}
 if(state.connection!=='online'){state.model={...preview,id:null,name:file.name,size:file.size,isSample:false,localOnly:true};state.unit='mm';state.quotes=[];closeModal();changePage('create');toast('仅在本地预览，恢复连接后请重新上传');return;}
 const task=await prepareMutation('/models',data,{raw:true,headers:{'X-File-Name':encodeURIComponent(file.name)}});
 await perform(task,result=>{state.model={...preview,...result.model,dimensions:result.model.dimensions||[],volume:result.model.volume||0,isSample:false,localOnly:false};state.unit='mm';state.quotes=[];closeModal();state.page='create';yaw=-.64;pitch=.37;zoom=1;toast('服务端已登记文件，正在获取报价');refreshQuotes();},'正在上传并分析模型');
 }catch(e){const node=$('#upload-error');if(node)node.textContent=e.message;else toast(e.message);}
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
function changePage(p){if(p==='farm'||p==='catalog'){location.href='/merchant'+(p==='farm'?'#orders':'#devices');return;}if($('.modal'))closeModal();state.page=p;state.menuOpen=false;state.search='';history.replaceState(null,'',p==='orders'?'/#orders':'/');render();window.scrollTo({top:0,behavior:'instant'});if(['home','create'].includes(p)&&state.connection==='online'&&!state.busy)refreshQuotes();}
function createOrder(farmId){const q=quote(farms.find(f=>f.id===farmId));if(!q?.quoteId){toast('请先获取有效的服务端报价。');return;}return mutate('/orders',{quoteId:q.quoteId,demoAcknowledged:true},()=>{closeModal();changePage('orders');toast(q.review?'服务端已保存工程询价':'服务端已创建沙盒订单，没有实际付款');},'正在创建订单');}
function nextQueued(d){return state.orders.find(o=>o.farm===d.farm&&o.status==='queued');}
function readinessBody(d,removing=false){
 const next=nextQueued(d),target=next?.material||d.loadedMaterial;
 return '<p>'+(removing?'先完成取件、清台与本件质检，再为下一单备料。':'请检查打印板、已装载材料与设备状态，再恢复接单。')+'确认结果将保存到服务端沙盒。</p>'+
 (next?'<div class="detail-row"><span>下一单</span><strong class="break">'+esc(next.modelName)+' · '+next.qty+' 件</strong></div><div class="detail-row"><span>必须装载</span><strong>'+materials[next.material].label+(next.quoteSnapshot?.estimatedWeight?' · 估算 '+next.quoteSnapshot.estimatedWeight.toFixed(1)+' g':'')+'</strong></div>':'<p>当前没有排队任务，请选择准备好的材料。后续订单只有材料匹配才会自动开打。</p>')+
 '<div class="field"><label class="field-label" for="prepared-material">本次确认已装载的材料</label><select class="select" id="prepared-material" '+(next?'disabled':'')+'>'+['PLA','PETG'].map(k=>'<option value="'+k+'" '+(k===target?'selected':'')+'>'+materials[k].label+'</option>').join('')+'</select></div>'+
 '<div class="readiness-list"><label class="check-line"><input type="checkbox" id="clear-bed"/>'+ (removing?'已取出零件并清空打印板':'已检查打印板为空且设备无报警')+'</label><label class="check-line"><input type="checkbox" id="material-ready"/>'+ (next?'已装载 '+materials[target].label+'，并确认余量足够完成下一单':'已核对上方所选材料并确认余量充足')+'</label></div><div id="qc-error" class="error-text"></div>';
}
function confirmReadiness(d){
 if(!$('#clear-bed')?.checked||!$('#material-ready')?.checked){$('#qc-error').textContent='请确认床面与所需材料均已准备完成。';return false;}
 const chosen=$('#prepared-material').value,next=nextQueued(d);
 if(!['PLA','PETG'].includes(chosen)||(next&&chosen!==next.material)){$('#qc-error').textContent='已装载材料与下一单不匹配，请重新确认。';return false;}
 return {bedClear:true,materialReady:true,loadedMaterial:chosen};
}
document.addEventListener('click',e=>{
 const el=e.target.closest('[data-action]');if(!el){if(e.target.matches('[data-dismiss]'))closeModal();return;}e.preventDefault();const a=el.dataset.action,id=el.dataset.id;const order=state.orders.find(o=>o.id===id),device=state.devices.find(d=>d.id===id);
 if(state.busy&&!['nav','close','menu','menu-close','notifications','about'].includes(a))return;
 if(a==='payment-plan')return paymentPlan();
 if(a==='customer-profile')return openCustomerProfile();
 if(a==='measure-cost')return requestCostEstimate();
 if(a==='customer-save')return saveCustomerProfile(false);
 if(a==='customer-skip')return saveCustomerProfile(true);
 if(a==='reconnect')return connectWorkspace();
 if(a==='retry-operation'){if(retryOperation){const r=retryOperation;return perform(r.task,r.onSuccess,r.label);}return;}
 if(a==='retry-quotes')return state.connection==='online'?refreshQuotes(true):connectWorkspace();
 if(a==='nav')return changePage(el.dataset.page);
 if(a==='menu'){state.menuOpen=!state.menuOpen;render();return;}
 if(a==='menu-close'){state.menuOpen=false;render();return;}
 if(a==='close')return closeModal();
 if(a==='upload')return uploadModal();
 if(a==='sample'){state.model={...sampleModel};state.unit='mm';closeModal();yaw=-.64;pitch=.37;zoom=1;configurationChanged();toast('已载入示例模型');return;}
 if(a==='material'){state.material=el.dataset.material;configurationChanged();return;}
 if(a==='quality'){state.quality=el.dataset.quality;configurationChanged();return;}
 if(a==='qty-plus'||a==='qty-minus'){state.qty=Math.min(50,Math.max(1,state.qty+(a==='qty-plus'?1:-1)));configurationChanged();return;}
 if(a==='zoom-in'){zoom=Math.min(2.5,zoom+.15);drawViewer();return;}
 if(a==='zoom-out'){zoom=Math.max(.5,zoom-.15);drawViewer();return;}
 if(a==='reset-view'){yaw=-.64;pitch=.37;zoom=1;drawViewer();return;}
 if(a==='quote-detail'){const q=quote(farms.find(f=>f.id===el.dataset.farm));if(!q)return;modal('费用明细 · '+q.farm.name,qDetails(q),'<button class="btn" data-action="close">关闭</button><button class="btn primary" data-action="choose" data-farm="'+q.farm.id+'">选择此商家</button>');return;}
 if(a==='choose'){const q=quote(farms.find(f=>f.id===el.dataset.farm));if(!q)return;modal(q.review?'确认演示询价':'确认演示订单','<div class="detail-row"><span>制造伙伴</span><strong>'+q.farm.name+'</strong></div><div class="detail-row"><span>文件</span><strong class="break">'+esc(state.model.name)+'</strong></div>'+qDetails(q)+'<div class="hint">'+I('info')+'<span>订单会保存到服务端沙盒。不会收取费用，也不会向真实打印机下发生产任务。</span></div>','<button class="btn" data-action="close">再看看</button><button class="btn primary" data-action="create-order" data-farm="'+q.farm.id+'">'+(q.review?'创建演示询价':'模拟付款并下单')+'</button>');return;}
 if(a==='create-order')return createOrder(el.dataset.farm);
 if(a==='network-filter'){state.networkFilter=el.dataset.value;render();return;}
 if(a==='catalog-filter'){state.catalogFilter=el.dataset.value;render();return;}
 if(a==='farm-detail'){const f=farms.find(f=>f.id===el.dataset.farm);modal(f.name,'<p>'+f.desc+'</p><div class="detail-row"><span>位置</span><strong>'+f.city+'</strong></div><div class="detail-row"><span>设备路线</span><strong>'+f.device+'</strong></div><div class="detail-row"><span>自动生产试点</span><strong>PLA / PETG</strong></div><p style="margin-top:15px">这是演示商家档案。正式上线前需要完成商家进件、设备校验、试打和交付能力审核。</p>','<button class="btn primary" data-action="nav" data-page="create">开始配置作品</button>');return;}
 if(a==='complete'&&device?.state==='printing')return actionRequest('complete-print',device.id,{},'服务端已记录打印完成，等待取件与质检');
 if(a==='remove'&&device?.state==='waiting'){modal('取件与质检',readinessBody(device,true),'<button class="btn" data-action="qc-result" data-result="fail" data-id="'+id+'">质检未通过</button><button class="btn primary" data-action="qc-result" data-result="pass" data-id="'+id+'">质检通过并恢复设备</button>');return;}
 if(a==='qc-result'&&device?.state==='waiting'){const evidence=confirmReadiness(device);if(!evidence)return;return actionRequest('collect-and-qc',device.orderId,{...evidence,partRemoved:true,qcPassed:el.dataset.result==='pass'},'服务端已保存质检与备机结果');}
 if(a==='maintenance'&&device?.state==='ready')return actionRequest('set-device-paused',device.id,{paused:true},'服务端已暂停该沙盒设备接单');
 if(a==='ready'&&device&&['maintenance','ready'].includes(device.state)){modal('确认设备已准备',readinessBody(device),'<button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-ready" data-id="'+id+'">确认备机</button>');return;}
 if(a==='confirm-ready'&&device&&['maintenance','ready'].includes(device.state)){const evidence=confirmReadiness(device);if(!evidence)return;return actionRequest('prepare-device',device.id,evidence,'服务端已确认备机，匹配任务可开始模拟打印');}
 if(a==='ship'&&order){modal('填写模拟发货信息','<p>运单将保存至服务端沙盒。本版本不调用快递查询接口，以下为模拟揽收。</p><div class="field"><label class="field-label" for="courier">承运商</label><select class="select" id="courier"><option>顺丰速运 · 模拟</option><option>中通快递 · 模拟</option><option>京东物流 · 模拟</option></select></div><div class="field"><label class="field-label" for="tracking">演示运单号</label><input class="input" id="tracking" value="DEMO-'+Date.now().toString().slice(-9)+'" maxlength="32"/></div><div id="ship-error" class="error-text"></div>','<button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-ship" data-id="'+id+'">模拟揽收发货</button>');return;}
 if(a==='confirm-ship'&&order){const trackingNumber=$('#tracking').value.trim();if(!/^DEMO-[0-9A-Za-z-]{3,27}$/.test(trackingNumber)){$('#ship-error').textContent='请输入 DEMO- 开头的演示单号。';return;}return actionRequest('ship',order.id,{trackingNumber,carrier:$('#courier').value},'服务端已保存模拟运单');}
 if(a==='tracking'&&order){modal('物流进度 · 模拟','<p>'+esc(order.courier||'模拟快递')+'<br/><span class="mono">'+esc(order.tracking)+'</span></p><div class="tracking-list">'+[...order.events].reverse().map(v=>'<div class="tracking-item"><strong>'+esc(v.label)+'</strong><p>'+esc(displayTime(v.time))+' · 演示事件</p></div>').join('')+'</div>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='deliver'&&order?.status==='shipped')return actionRequest('deliver',order.id,{},'服务端已记录模拟签收，尚未结算');
 if(a==='dispute'&&order)return actionRequest('dispute',order.id,{open:!order.dispute},order.dispute?'服务端已撤销演示争议':'服务端已保存争议，暂停结算');
 if(a==='settle'&&order?.status==='delivered'&&!order.dispute){modal('确认作品验收','<p>请确认已收到零件，且材料、数量与质量符合约定。正式平台将在验收条件满足后向支付机构申请结算。</p><div class="detail-row"><span>演示订单金额</span><strong>'+money(order.total)+'</strong></div><p>本次操作仅模拟结算，不会产生实际资金转移。</p>','<button class="btn" data-action="close">稍后验收</button><button class="btn primary" data-action="confirm-settle" data-id="'+id+'">确认演示验收</button>');return;}
 if(a==='confirm-settle'&&order?.status==='delivered'&&!order.dispute)return actionRequest('accept',order.id,{customerAccepted:true},'服务端已记录验收及模拟结算，没有真实转账');
 if(a==='cancel-order'&&order&&['review','queued'].includes(order.status))return actionRequest('cancel',order.id,{},'服务端已取消演示订单');
 if(a==='connect'){if(merchant.isRoute())return merchant.discover();location.href='/merchant/login';return;}
 if(a==='settings'){modal('沙盒空间设置','<p>当前订单、报价及设备状态由服务端保存。重置会清除当前服务端沙盒的演示记录并恢复初始设备。</p><p>旧版浏览器数据不会导入，也不会被这次重置删除。尚未连接真实设备、支付或物流。</p>','<button class="btn" data-action="close">保留数据</button><button class="btn danger" data-action="reset-demo" '+(state.connection==='online'?'':'disabled')+'>重置服务端沙盒</button>');return;}
 if(a==='reset-demo')return actionRequest('reset',undefined,{confirm:'RESET_DEMO'},'服务端沙盒已重置');
 if(a==='notifications'){const events=state.orders.flatMap(o=>o.events.map(v=>({...v,name:o.modelName}))).slice(-6).reverse();modal('工作通知',events.length?'<div class="notice-list">'+events.map(v=>'<div class="notice-item"><span class="avatar">'+I('bell')+'</span><div><strong>'+esc(v.label)+'</strong><p>'+esc(v.name)+'<br/>'+esc(displayTime(v.time))+' · 模拟</p></div></div>').join('')+'</div>':'<p>暂无通知。完成演示打印后，取件提醒会出现在这里。</p>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='about'){modal('关于这个服务端沙盒','<p>共造连接个人创作者与制造商家，目标是实现从模型、报价、自动生产到物流和收货结算的完整流程。</p><p>模型由服务端登记与校验，报价、订单和设备状态保存于服务端。原浏览器演示数据不会自动导入。断线时只读浏览，未确认成功的操作可以使用原请求重试。</p><p>报价、打印、支付、物流及结算仍为沙盒模拟。商家设备清单可通过已授权的本地网关读取真实设备状态；设备添加不会启动生产。原生应用与微信小程序需独立构建、签名及平台审核。</p>','<button class="btn primary" data-action="close">知道了</button>');}
});
document.addEventListener('change',e=>{
 if(state.busy){render();return;}
 if(e.target.id==='quantity'){state.qty=Math.min(50,Math.max(1,parseInt(e.target.value)||1));configurationChanged();}
 if(e.target.id==='quote-sort'){state.sort=e.target.value;render();}
 if(e.target.id==='unit'){state.unit=e.target.value;configurationChanged();toast('已更新尺寸单位，服务端将重新计算报价');}
 if(e.target.id==='customer-country'){const country=e.target.value;$('#customer-other-country-field').hidden=country!=='OTHER';$('#customer-country-code').required=country==='OTHER';$('#customer-province-field').innerHTML=customerProvinceField(country==='CN'?'CN':country,'');$('#customer-district').required=country==='CN';$('#customer-district-label').textContent=country==='CN'?'区 / 县':'区 / 县（选填）';}
});
document.addEventListener('submit',e=>{if(e.target.id==='customer-profile-form'){e.preventDefault();saveCustomerProfile(false);}});
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
 if(state.model.review){ctx.fillStyle='#b2b2b2';ctx.font='500 16px sans-serif';ctx.textAlign='center';ctx.fillText('文件已登记，等待工程解析',w/2,h/2-5);ctx.font='11px sans-serif';ctx.fillStyle='#a7a7a7';ctx.fillText('STL 格式可在此旋转预览',w/2,h/2+20);return;}
 const sc=Math.min(w/205,h/145)*zoom;
 const rot=p=>{const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);return[x,p[1]*Math.cos(pitch)-z*Math.sin(pitch),p[1]*Math.sin(pitch)+z*Math.cos(pitch)];};
 const project=p=>[w/2+p[0]*sc,h/2+12-p[1]*sc];
 ctx.save();ctx.translate(w/2,h*.79);ctx.scale(1,.25);const g=ctx.createRadialGradient(0,0,0,0,0,w*.25);g.addColorStop(0,'#55555523');g.addColorStop(1,'#55555500');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,w*.28,0,Math.PI*2);ctx.fill();ctx.restore();
 const tris=mesh.map(t=>{const v=t.map(rot);return {v,z:(v[0][2]+v[1][2]+v[2][2])/3};}).sort((a,b)=>a.z-b.z);
 for(const {v} of tris){const a=v[0],b=v[1],cc=v[2],u=b.map((n,k)=>n-a[k]),vv=cc.map((n,k)=>n-a[k]);const n=[u[1]*vv[2]-u[2]*vv[1],u[2]*vv[0]-u[0]*vv[2],u[0]*vv[1]-u[1]*vv[0]],len=Math.hypot(...n)||1;const shade=.56+.28*Math.abs((n[0]*-.4+n[1]*.7+n[2]*.6)/len);const r=Math.round(150*shade+45),gg=r,bb=r;ctx.beginPath();v.map(project).forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle='rgb('+r+','+gg+','+bb+')';ctx.fill();ctx.strokeStyle='rgba(70,70,70,.12)';ctx.lineWidth=.45;ctx.stroke();}
 if(state.model.isSample){for(const x of [-22,22]){const v=project(rot([x,12,25.3]));ctx.beginPath();ctx.ellipse(v[0],v[1],4.3*sc,5*sc,0,0,Math.PI*2);ctx.fillStyle='#949494';ctx.fill();ctx.strokeStyle='#d4d4d4';ctx.lineWidth=1;ctx.stroke();}}
}
window.addEventListener('resize',()=>drawViewer());
const merchant=createMerchantUI({icon:I,escape:esc,render,modal,closeModal,toast,legacyOrders:farmPage,connection:()=>state.connection,reconnect:connectWorkspace,session:()=>state.session});
if(!merchant.isRoute()&&location.hash==='#orders')state.page='orders';
render();
connectWorkspace();
if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
