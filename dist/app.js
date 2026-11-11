import {createBudgetController, renderBudget} from './budget-ui.js';
import { tradeReturnPath, tradeInboxHref, hasPlatformRoutes } from './trade-return.js';
import { createWorkflowUI } from './workflow-ui.js';
import { createMerchantUI } from './merchant-ui.js';
import { createOperationsUI } from './operations-ui.js';
import { createAuthUI } from './auth-ui.js';
import { showFieldErrors, updateFieldError, hasFieldError } from './form-feedback.js';
import { createInternationalUI } from './international-ui.js';
import { get, postQuery, prepareMutation, takeWorkspaceChangeNotice } from './api-client.js';
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
const state={page:'home',inquiryMode:true,material:'PLA',quality:'standard',qty:1,quantityDraft:null,unit:'mm',destination:null,customerProfile:null,customerProfileLoaded:false,sort:'recommended',orders:[],devices:[],models:[],quotes:[],networkFilter:'all',catalogFilter:'all',search:'',menuOpen:false,model:null,connection:'loading',session:null,busy:false,busyLabel:'',error:null,quoteLoading:false,quoteError:null,legacyCount,revision:0};
const sampleModel={id:'sample-bracket',name:'桌面设备固定支架.stl',size:284672,dimensions:[72,48,58],volume:22.4,triangles:[],isSample:true,review:false,faceCount:3248};
state.model={...sampleModel};
let mesh=[], yaw=-.64,pitch=.37,zoom=1,animation=0,toastTimer, focusBeforeModal=null;
const money=n=>'¥'+Number(n).toFixed(2);
function displayTime(value){const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):String(value||'');}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{e.classList.remove('show');e.textContent='';},3400);}
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
async function openCustomerProfile({required=false,onboarding=false,onSaved=null}={}){
 if(customerSaving||state.busy)return;
 if(state.connection==='loading'||!state.customerProfileLoaded){toast(state.connection==='offline'?'请重新连接服务端后打开账号资料。':'账号资料正在加载，请稍候。');return;}
 if(state.connection!=='online'){toast('请重新连接服务端后打开账号资料。');return;}
 try{await international.load();}catch(error){toast(error.message||'地区配置加载失败，请重试。');return;}
 const profile=state.customerProfile||{},address=profile.shippingAddress||{};
 const title=required?'填写收货地址':onboarding?'完善账号资料':'账号资料';
 const description=required?'测算配送费用与交付时间前，请补充收货地址。保存后会继续本次需求或费用测算。':onboarding?'欢迎来到共造。填写资料与收货地址，后续测算将自动使用。也可以稍后再填。':'收货资料仅在账号中显示。选择国家 / 地区后，地址格式与支付方案会自动调整。';
 const body='<p class="customer-form-intro">'+description+'</p><form id="customer-profile-form" class="customer-profile-form" novalidate><div id="customer-form-error" class="form-error-summary" role="alert" aria-live="polite" hidden></div>'+customerInput('customer-display-name','称呼（选填）',profile.displayName||'',{autocomplete:'nickname',max:80,required:false,placeholder:'如何称呼你'})+'<div class="customer-form-heading"><h3>收货资料</h3><span>仅用于配送与费用测算</span></div><div id="customer-address-fields">'+international.fieldsHTML(address)+'</div><p class="customer-privacy-note">首页不会展示收货地址。海外及未覆盖地区进入工程询价，交期、运费与税费需确认。</p></form>';
 const skip=!required&&!address.recipient?'<button class="btn" data-action="customer-skip">稍后填写</button>':'<button class="btn" data-action="close">取消</button>';
 modal(title,body,skip+'<button class="btn primary" data-action="customer-save">'+(required?'保存并继续':'保存资料')+I('arrow')+'</button>',true);
 customerModal={required,onboarding,onSaved};customerSaveTask=null;$('.modal')?.classList.add('customer-profile-modal');
}
const customerFieldIds={displayName:'customer-display-name',recipient:'customer-recipient',phone:'customer-phone',countryCode:'customer-country',province:'customer-province',city:'customer-city',district:'customer-district',addressLine:'customer-address-line',postalCode:'customer-postal-code'};
function customerValidation(){
 const errors=international.validateAddressFields(international.readAddress());
 const name=$('#customer-display-name')?.value||'';
 if(name.trim().length>80||/[\u0000-\u001f\u007f]/.test(name))errors['customer-display-name']='称呼请使用不超过 80 个字符的普通文字。';
 return errors;
}
function customerServerErrors(error){
 const errors={};for(const [key,message] of Object.entries(error.fieldErrors||{})){
  const id=key==='countryCode'&&$('#customer-country')?.value==='OTHER'?'customer-country-code':customerFieldIds[key];
  if(id&&typeof message==='string')errors[id]=message;
 }return errors;
}
function updateCustomerField(target,blur=false){
 const form=$('#customer-profile-form');if(!form||!target.id||!form.contains(target)||customerSaving)return;
 if(blur||hasFieldError(form,target.id))updateFieldError(form,target.id,customerValidation()[target.id],{summaryId:'customer-form-error'});
}
async function saveCustomerProfile(skip=false){
 if(customerSaving||!customerModal||!$('#customer-profile-form'))return;
 const context=customerModal,form=$('#customer-profile-form');
 const value=id=>$('#'+id).value.trim();
 let address=state.customerProfile?.shippingAddress||null;
 if(!skip){
  if(showFieldErrors(form,customerValidation(),{summaryId:'customer-form-error'}))return;
  address=international.readAddress();
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
  if(hasShippingAddress()&&context.onSaved)context.onSaved();
  else if(hasShippingAddress()&&(context.required||['home','create'].includes(state.page)))refreshQuotes();
 }catch(error){
  state.busy=false;customerSaving=false;
  if(['NETWORK_ERROR','TIMEOUT','INVALID_RESPONSE'].includes(error.code))state.connection='offline';
  render();
  if(customerModal===context&&$('#customer-profile-form')){setModalBusy(false);showFieldErrors($('#customer-profile-form'),customerServerErrors(error),{summaryId:'customer-form-error',message:error.message+' 输入的内容已保留，请修改后再保存。'});}
 }finally{customerSaving=false;state.busy=false;setModalBusy(false);$('.modal [data-action="close"]')?.removeAttribute('disabled');}
}

async function connectWorkspace(){
 if(state.busy)return;
 state.connection='loading';state.customerProfileLoaded=false;state.error=null;render();
 try{
  await auth.load();
  state.session=await get('/session');const result=await get('/workspace');applyWorkspace(result.workspace);state.connection='online';render();
  if(takeWorkspaceChangeNotice())toast('已载入当前工作空间，请核对账号和待办操作。');
  if(merchant.isRoute())await merchant.load(false);
  else await workflow.load(false,{quiet:true});
  if(!merchant.isRoute()&&!auth.isRoute()){await refreshQuotes();if(auth.authenticated()&&!state.customerProfile?.setupCompleted&&!onboardingPrompted&&!$('.modal')){onboardingPrompted=true;openCustomerProfile({onboarding:true});}}
 }
 catch(error){state.connection='offline';state.error=error;state.quotes=[];render();}
}
function validQuantity(value){return String(value).trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=50;}
function editQuantity(value){
 if(state.busy)return;
 state.quantityDraft=String(value);
 const valid=validQuantity(value);
 if(valid)state.qty=Number(value);
 const field=$('#quantity'),error=$('#quantity-error');
 field?.setAttribute?.('aria-invalid',String(!valid));
 if(error)error.textContent=valid?'':'数量须为 1–50 的整数。';
 clearQuotes();
 // Do not replace the focused input while a multi-digit number is being typed.
 const result=$('.quote-section .quotes, .quote-section .quote-placeholder');
 if(result)result.outerHTML=validQuantity(value)?quotePlaceholder():'<div class="card quote-placeholder" role="status"><div><strong>请填写制作数量</strong><p>数量须为 1–50 的整数。</p></div></div>';
 if(!state.inquiryMode&&validQuantity(value)&&state.connection==='online')quoteTimer=setTimeout(()=>refreshQuotes(),350);
}
function commitQuantity(value){
 if(!validQuantity(value)){editQuantity(value);$('#quantity')?.reportValidity?.();return;}
 state.quantityDraft=null;state.qty=Number(value);
}
function selectedConfiguration(){return{modelId:state.model.id,material:state.material,quality:state.quality,qty:state.qty,unit:state.unit,addressRevision:state.customerProfile?.addressRevision??0};}
function configurationChanged(){if(state.inquiryMode)workflow.modelChanged();quoteSequence++;state.quotes=[];state.quoteLoading=false;state.quoteError=null;quoteTask=null;clearTimeout(quoteTimer);render();if(state.connection==='online')quoteTimer=setTimeout(()=>refreshQuotes(),220);}
async function refreshQuotes(retry=false){
 if(state.inquiryMode)return;
 if(state.connection!=='online'||!state.model.id)return;
 if(state.quantityDraft!==null&&!validQuantity(state.quantityDraft)){state.quotes=[];state.quoteLoading=false;state.quoteError={message:'数量须为 1–50 的整数。'};render();return;}
 if(!hasShippingAddress()){state.quotes=[];state.quoteLoading=false;state.quoteError=null;render();return;}
 const sequence=++quoteSequence;const config=selectedConfiguration(),addressRevision=state.customerProfile.addressRevision;state.quotes=[];state.quoteLoading=true;state.quoteError=null;render();
 try{const task=retry&&quoteTask?quoteTask:await prepareMutation('/quotes',config);quoteTask=task;const result=await task.execute();if(sequence!==quoteSequence||addressRevision!==state.customerProfile?.addressRevision||JSON.stringify(config)!==JSON.stringify(selectedConfiguration()))return;applyWorkspace(result.workspace);quoteTask=null;if(result.quotes.some(q=>q.addressRevision!==state.customerProfile?.addressRevision)){state.quotes=[];return refreshQuotes();}state.quotes=result.quotes;}
 catch(error){if(sequence===quoteSequence){state.quotes=[];state.quoteError=error;if(['ADDRESS_REQUIRED','ADDRESS_CHANGED','ADDRESS_INCOMPLETE','DESTINATION_MISMATCH'].includes(error.code)){await reloadCustomerProfile();state.quoteError=null;if(error.code==='ADDRESS_INCOMPLETE')openCustomerProfile({required:true});}else if(['NETWORK_ERROR','TIMEOUT','INVALID_RESPONSE'].includes(error.code))state.connection='offline';}}
 finally{if(sequence===quoteSequence){state.quoteLoading=false;render();}}
}
async function perform(task,onSuccess,label){
 if(state.busy)return;
 state.busy=true;state.busyLabel=label;state.error=null;render();setModalBusy(true);
 try{const result=await task.execute();applyWorkspace(result.workspace);state.connection='online';retryOperation=null;state.busy=false;state.error=null;onSuccess?.(result);render();}
 catch(error){state.busy=false;if(['ADDRESS_REQUIRED','ADDRESS_CHANGED','ADDRESS_INCOMPLETE','DESTINATION_MISMATCH'].includes(error.code)){retryOperation=null;state.error=null;clearQuotes();await reloadCustomerProfile();closeModal();render();if(!hasShippingAddress()||error.code==='ADDRESS_INCOMPLETE')openCustomerProfile({required:true});else{toast('收货地址已更新，请使用重新测算的报价。');refreshQuotes();}}else if(error.code==='PRICING_CHANGED'){retryOperation=null;state.error=null;clearQuotes();closeModal();render();toast('商家计价设置已更新，请查看重新测算的报价。');refreshQuotes();}else{state.error=error;retryOperation={task,onSuccess,label};if(['NETWORK_ERROR','TIMEOUT','INVALID_RESPONSE'].includes(error.code))state.connection='offline';render();showModalError(error);}}
 finally{state.busy=false;setModalBusy(false);}
}
async function mutate(path,payload,onSuccess,label){
 if(state.busy)return;
 if(state.connection!=='online'){toast('请连接服务端后操作，离线模式不会创建订单。');return;}
 const task=await prepareMutation(path,payload);return perform(task,onSuccess,label);
}
function actionRequest(action,id,evidence={},success='服务端已保存操作结果'){
 return mutate('/actions',{action,id,...evidence,demoAcknowledged:true},result=>{if(result.reset){state.model={...sampleModel};state.unit='mm';state.quotes=[];workflow.reset();workflow.load(merchant.isRoute()&&auth.authenticated(),{quiet:true});}closeModal();toast(result.blockedReason?'备机已保存，任务仍等待条件满足。':success);},'正在提交操作');
}
function setModalBusy(busy){$$('.modal button:not([data-action="close"]),.modal input,.modal select,.modal textarea').forEach(e=>{if(busy){e.dataset.wasDisabled=e.disabled?'true':'false';e.disabled=true;}else if(e.dataset.wasDisabled!==undefined){e.disabled=e.dataset.wasDisabled==='true';delete e.dataset.wasDisabled;}});}
function showModalError(error){const container=$('.modal-body');if(!container)return;let node=$('#modal-request-error');if(!node){node=document.createElement('div');node.id='modal-request-error';node.className='error-text';node.setAttribute('role','alert');container.appendChild(node);}node.innerHTML=esc(error.message)+' <button class="link-btn" data-action="retry-operation">用原请求重试</button>';}
function navButton(n){return '<button data-action="nav" data-page="'+n[0]+'" class="'+(state.page===n[0]?'active':'')+'">'+I(n[1])+'<span>'+n[2]+'</span>'+(n[0]==='orders'&&state.orders.length?'<span class="count">'+state.orders.length+'</span>':'')+'</button>';}
function render(){
 const authDraft=auth.captureForm();
 const keepQuantityFocus=state.quantityDraft!==null&&document.activeElement?.id==='quantity';
 cancelAnimationFrame(animation);
 const isMerchant=merchant.isRoute(),isAuth=auth.isRoute(),pageName=isAuth?'账号登录':isMerchant?'商家工作台':state.page==='orders'?'我的订单':state.page==='inquiries'?'需求与方案':'开始创作';
 const customerAccount=auth.authenticated()?'<details class="nav-more account-menu"><summary aria-label="账号菜单">我的账号 '+I('down')+'</summary><div class="nav-more-panel"><a href="/login">用户中心</a><button data-action="customer-profile" '+(state.connection==='loading'||!state.customerProfileLoaded||state.busy?'disabled':'')+'>账号资料与地址</button><button data-auth-action="logout">退出登录</button></div></details>':'<a class="customer-login-link" href="/login">用户登录 / 注册</a>';
 const customerNav='<nav class="header-nav" aria-label="个人导航"><button data-action="nav" data-page="home" class="'+(['home','create'].includes(state.page)?'active':'')+'">开始创作</button><button data-action="nav" data-page="inquiries" class="'+(state.page==='inquiries'?'active':'')+'">需求与方案</button><button data-action="nav" data-page="orders" class="'+(state.page==='orders'?'active':'')+'">我的订单'+(state.orders.length?'<span class="nav-count">'+state.orders.length+'</span>':'')+'</button><a class="inbox-nav-link" href="'+esc(tradeInboxHref('buyer',undefined,hasPlatformRoutes() && state.connection!=='offline'))+'">消息</a>'+customerAccount+'</nav><a class="portal-switch" href="/merchant/login">商家登录 '+I('arrow')+'</a>';
 $('#app').innerHTML='<header class="site-header"><div class="site-header-inner"><a href="/" class="brand"><img src="/icons.svg" alt=""/><span class="brand-name">共造</span><span class="brand-sub">'+(isMerchant?'商家工作台':'从想法，到实物')+'</span></a><div class="header-right">'+(isAuth?'<a href="/" class="portal-switch">个人创作 '+I('arrow')+'</a>':isMerchant?merchant.nav():customerNav)+'</div></div></header>'+
 '<main id="main" class="main '+(isMerchant?'merchant-main':'customer-main')+'">'+(isAuth?auth.renderPage():isMerchant?merchant.renderContent():requestNotice()+renderPage())+'</main>'+
 '<footer class="site-footer"><span>共造 COFORGE</span><span>开发沙盒 · 不产生真实交易 <button class="text-link" data-action="payment-plan">支付与结算</button> · <button class="text-link" data-action="about">了解当前范围</button> · <a class="text-link" href="/login">用户登录与账号</a> · <a class="text-link" href="/admin/login">平台管理</a></span><button class="connection-status" data-action="reconnect"><i class="'+state.connection+'"></i>'+(state.connection==='online'?'已连接服务端':state.connection==='loading'?'正在连接':'连接已断开')+'</button></footer>';
 auth.restoreForm(authDraft);
 if(!isMerchant&&!isAuth&&(state.page==='home'||state.page==='create'))setupViewer();
 syncBudget();
 if(state.busy)$$('#main button,#main input,#main select').forEach(el=>{el.disabled=true;});
 if(keepQuantityFocus&&!state.busy)$('#quantity')?.focus({preventScroll:true});
 document.title=pageName+' · 共造';
}
function intro(eye,title,desc,actions=''){return '<div class="page-intro"><div>'+(eye?'<div class="eyebrow">'+eye+'</div>':'')+'<h1>'+title+'</h1><p>'+desc+'</p></div>'+actions+'</div>';}
function renderPage(){switch(state.page){case'inquiries':return workflow.customerInbox();case'orders':return ordersPage();case'farm':return farmPage();case'network':return networkPage();case'catalog':return catalogPage();default:return workspacePage();}}
function workspacePage(){
 const m=state.model;
 const actions='<div class="intro-actions"><button class="text-link sample-link" data-action="sample">体验示例</button><button class="btn primary" data-action="upload">'+I('upload')+'上传模型</button></div>';
 const label='模型询价';
 const unitScale=state.unit==='inch'?25.4:1;
 const hasMesh=m.isSample||Boolean(m.triangles?.length);
 const dims=hasMesh?m.dimensions.map(n=>(Number(n)*unitScale).toFixed(1)).join(' × '):'待工程确认';
 let qs=[...state.quotes];
 if(state.sort==='price'||state.sort==='fast'){
  const rank=q=>q.review?Infinity:state.sort==='price'?q.total:q.days[0];
  qs.sort((a,b)=>rank(a)-rank(b));
 }
 return intro('',label,'上传模型，查看制造预算，或联系商家确认报价。',actions)+

 '<div class="workspace-grid"><section class="card model-card"><div class="card-head"><h2>'+I('cube')+'模型预览</h2><span class="badge '+(m.review||m.localOnly?'amber':'teal')+'">'+(m.localOnly?'本地预览 · 未上传':m.review?'待工程审核':m.isSample?'示例模型':'服务端已解析 · 待制造校验')+'</span></div>'+
 '<div class="viewer"><div class="viewer-grid"></div><canvas id="model-canvas" aria-label="三维模型预览，可拖动旋转" tabindex="0"></canvas><div class="viewer-top"><span class="viewer-tag">'+(m.review?'FILE REVIEW':'PERSPECTIVE VIEW')+'</span><div class="viewer-tools"><button data-action="zoom-in" aria-label="放大模型">'+I('plus')+'</button><button data-action="zoom-out" aria-label="缩小模型">'+I('minus')+'</button><button data-action="reset-view" aria-label="复位视角">'+I('expand')+'</button></div></div><div class="viewer-note">'+I('cursor')+(hasMesh?'拖动旋转 · 滚轮缩放 · 方向键调整视角':'等待工程解析后确认尺寸')+'</div><span class="axis">X Y Z</span></div>'+
 '<div class="model-strip"><div class="file-icon">'+I('file')+'</div><div><div class="model-name">'+esc(m.name)+'</div><div class="file-meta">'+(m.size/1024).toFixed(0)+' KB · '+(hasMesh?m.faceCount.toLocaleString()+' 个三角面':'待工程审核')+'</div></div><button class="link-btn" data-action="upload">更换模型 '+I('arrow')+'</button></div>'+
 '<div class="model-metrics model-facts"><div class="metric"><span>外形尺寸 '+(hasMesh?'/ mm':'')+'</span><strong>'+dims+'</strong></div><div class="metric"><span>实体体积</span><strong>'+(m.review?'待工程确认':(m.volume*unitScale**3).toFixed(1)+' cm³')+'</strong></div></div></section>'+
 (state.inquiryMode?workflow.customerForm(budgetSlot):(
 '<section class="card"><div class="card-head"><h2>'+I('settings')+'配置你的作品</h2><span class="small muted" style="font-size:10px">演示估价</span></div><div class="form-body">'+
 '<div class="field"><div class="field-label">制造材料 <span>选择适合你的材料</span></div><div class="material-grid">'+Object.entries(materials).map(([k,v])=>'<button class="material-option '+(state.material===k?'selected':'')+'" data-action="material" data-material="'+k+'"><span class="swatch" style="background:'+v.color+'"></span>'+v.label+'</button>').join('')+'</div></div>'+
 (materials[state.material].process==='FDM'?'<div class="field"><div class="field-label">打印层高 <span>尺寸公差需单独确认</span></div><div class="segmented"><button data-action="quality" data-quality="standard" class="'+(state.quality==='standard'?'selected':'')+'">标准 · 0.20 mm</button><button data-action="quality" data-quality="fine" class="'+(state.quality==='fine'?'selected':'')+'">精细 · 0.12 mm</button></div></div>':'<div class="field"><div class="field-label">精度与工艺要求 <span>工程审核</span></div><div class="input" style="display:flex;align-items:center">按图纸公差与材料工艺确认</div></div>')+
 '<div class="form-row"><div class="field"><label class="field-label" for="quantity">制作数量</label><div class="stepper"><button data-action="qty-minus" aria-label="减少数量">−</button><input id="quantity" type="number" aria-describedby="quantity-error" required inputmode="numeric" min="1" max="50" step="1" value="'+esc(state.quantityDraft??state.qty)+'" aria-label="制作数量"/><button data-action="qty-plus" aria-label="增加数量">+</button></div><small class="field-error" id="quantity-error" role="status">'+(state.quantityDraft!==null&&!validQuantity(state.quantityDraft)?'数量须为 1–50 的整数。':'')+'</small></div><div class="field"><label class="field-label" for="unit">文件尺寸单位</label><select class="select" id="unit"><option value="mm" '+(state.unit==='mm'?'selected':'')+'>毫米 mm</option><option value="inch" '+(state.unit==='inch'?'selected':'')+'>英寸 inch</option></select></div></div>'+
 '<div class="field"><span class="field-label">表面处理</span><div class="input" style="display:flex;align-items:center;color:#9e9e9e">去支撑与基础清理</div></div>'+
 '<div class="hint">'+I('info')+'<span>'+materials[state.material].tip+'</span></div>'+budgetSlot+'</div></section>'))+'</div>'+
 (!state.inquiryMode?(
 '<section class="quote-section"><div class="section-heading"><h2>为你匹配的制造伙伴 <span class="small">3 家演示商家</span></h2><select class="sort-select" id="quote-sort" aria-label="报价排序"><option value="recommended" '+(state.sort==='recommended'?'selected':'')+'>综合推荐排序</option><option value="price" '+(state.sort==='price'?'selected':'')+'>报价从低到高</option><option value="fast" '+(state.sort==='fast'?'selected':'')+'>预计交付更快</option></select></div>'+(qs.length?'<div class="quotes">'+qs.map(quoteCard).join('')+'</div>':quotePlaceholder())+'<p class="inline-note">各家报价的估算依据、费用及预计到货时间可在费用明细中查看。</p></section>'):workflow.customerInbox({compact:true}))+
 '<div class="workflow-mode-switch"><button class="text-link" data-action="toggle-estimate-mode">'+(state.inquiryMode?'查看原有快速估价演示':'返回模型需求流程')+' '+I('arrow')+'</button></div>';
}
function quoteCard(q){
 const f=q.farm;return '<article class="quote-card '+(f.id==='f1'?'recommended':'')+'">'+(f.id==='f1'?'<span class="recommend-label">综合推荐 · 演示</span>':'')+
 '<div class="farm-heading"><div class="farm-avatar '+f.tone+'">'+f.initial+'</div><div><div class="farm-name">'+f.name+'</div><div class="farm-location">'+f.city+' <span>· 示例档案</span></div></div></div>'+
 '<div class="quote-price">'+(q.review?'<strong style="font-size:21px">工程询价</strong>':'<span class="currency">¥</span><strong>'+q.total.toFixed(2)+'</strong><span class="suffix">含运费</span>')+'</div>'+
 '<div class="quote-delivery">'+(q.review?'工程确认后提供交付窗口':'预计 <strong>'+q.days[0]+'–'+q.days[1]+' 天</strong> 收到 · 示例')+'</div>'+
 '<div class="quote-features"><span>'+materials[state.material].process+'</span><span>'+(q.review?'工艺人工审核':'模拟工艺模板')+'</span></div>'+
 '<div class="quote-footer"><button class="link-btn" data-action="quote-detail" data-farm="'+f.id+'">费用明细</button><button class="btn '+(f.id==='f1'?'primary':'')+'" data-action="choose" data-farm="'+f.id+'">'+(q.review?'提交演示询价':'选择此商家')+I('arrow')+'</button></div></article>';
}
const stageNames={review:'工程审核中',queued:'等待设备就绪',printing:'正在打印',awaiting_pickup:'打印完成待取件',qc_failed:'质检异常',ready_to_ship:'质检通过待发货',shipped:'运输途中',delivered:'已签收待验收',accepted:'验收完成 · 待结算',settling:'模拟结算处理中',settlement_failed:'模拟结算失败',settled:'模拟结算完成',refund_pending:'退款申请处理中',refunded:'模拟退款完成',cancelled:'已取消'};
const openSettlementStates=['NOT_REQUESTED','READY','FAILED'];
function isFundsHeld(o){return o.paymentState==='SIMULATED_FROZEN';}
function refundPending(o){return o.refundState==='REQUESTED';}
function canRaiseDispute(o){return o.disputeState==='OPEN'||isFundsHeld(o)&&openSettlementStates.includes(o.settlementState)&&o.productionState!=='CANCELLED';}
function canRequestRefund(o){return isFundsHeld(o)&&openSettlementStates.includes(o.settlementState)&&!['REQUESTED','SIMULATED_REFUNDED'].includes(o.refundState)&&o.productionState!=='CANCELLED';}
function fulfillmentBlocked(o){return o.disputeState==='OPEN'||refundPending(o)||o.refundState==='SIMULATED_REFUNDED';}
function canAccept(o){return o.productionState==='QC_PASSED'&&o.logisticsState==='DELIVERED'&&o.acceptanceState==='PENDING'&&o.settlementState==='NOT_REQUESTED'&&isFundsHeld(o)&&!fulfillmentBlocked(o);}
function merchantSettlementAmounts(o){
 if(o.settlementBreakdown)return o.settlementBreakdown;
 if(o.settlementState==='SIMULATED_SETTLED')return null;
 const q=o.quoteSnapshot,total=o.totalCents,fee=q?.serviceCents,shipping=q?.shippingCents;
 if(![total,fee,shipping].every(n=>Number.isSafeInteger(n)&&n>=0)||total<=fee||total<fee+shipping||q?.review)return null;
 return {manufacturingCents:total-fee-shipping,platformFeeCents:fee,shippingCents:shipping,merchantReceivableCents:total-fee,customerTotalCents:total,source:'LEGACY_DERIVED'};
}
function legacySettlementAttempt(o){return o.settlementState==='REQUESTED'&&!o.settlementBreakdown;}
function settlementAmountDetails(o){
 const b=merchantSettlementAmounts(o);
 if(!b)return '<p class="inline-note">'+(o.settlementState==='SIMULATED_SETTLED'?'旧版已结算金额按历史记录保留，不使用新计价重算。':'缺少可核验的分账快照，暂不能确认商家应收。')+'</p>';
 return [['客户订单总额',b.customerTotalCents],['制造应收',b.manufacturingCents],['运费补偿',b.shippingCents],['平台服务费（不归商家）',b.platformFeeCents],['商家应收合计',b.merchantReceivableCents]].map(([label,cents])=>'<div class="detail-row"><span>'+label+'</span><strong>'+money(cents/100)+'</strong></div>').join('')+(b.source==='LEGACY_DERIVED'?'<p class="inline-note">按原订单报价拆分，不按当前设置重新计价。</p>':'')+(legacySettlementAttempt(o)?'<p class="inline-note">旧版结算申请尚未拆分平台费。请先模拟失败，再重新申请结算。</p>':'');
}
function fundsSummary(o){
 const paid={UNPAID:'尚未付款',SIMULATED_FROZEN:'模拟已付款',SIMULATED_RELEASED:'模拟已释放',SIMULATED_REFUNDED:'模拟已退款'}[o.paymentState]||'待核验';
 const settled={NOT_REQUESTED:'尚未申请',READY:'等待申请',REQUESTED:'模拟处理中',FAILED:'模拟失败 · 可重试',SIMULATED_SETTLED:'模拟已完成',CANCELLED:'已取消'}[o.settlementState]||'待核验';
 return '<div class="funds-summary">'+[['付款',paid],['客户验收',o.acceptanceState==='ACCEPTED'?'已确认':'待确认'],['商家结算',settled]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('')+'</div>';
}
function ordersPage(){
 return intro('YOUR PROJECTS','每一件作品，都有迹可循。','订单与状态由服务端保存；打印、物流及结算仍为沙盒模拟。','<div class="intro-actions"><button class="btn primary" data-action="nav" data-page="create">'+I('plus')+'新建项目</button></div>')+
 (state.orders.length?'<div class="order-list">'+[...state.orders].reverse().map(orderCard).join('')+'</div>':'<div class="card empty-state">'+I('orders')+'<h3>你的第一件作品，从这里开始</h3><p>选择一个示例模型和制造伙伴，体验完整的演示订单流程。</p><button class="btn primary" data-action="nav" data-page="home">开始体验 '+I('arrow')+'</button></div>');
}
function orderCard(o){
 const f=farms.find(f=>f.id===o.farm),material=materials[o.material];
 const idx={review:0,queued:1,printing:1,awaiting_pickup:2,qc_failed:2,ready_to_ship:2,shipped:3,delivered:4,accepted:5,settling:5,settlement_failed:5,settled:6,cancelled:-1,refund_pending:-1,refunded:-1}[o.status];
 const stages=['下单','生产','质检','物流','验收','结算'];
 let action='<a class="btn tiny" href="/merchant#orders">商家履约演示 '+I('arrow')+'</a>';
 let note='服务端已保存文件、配置与报价快照。尚未生成真实切片文件。';
 if(o.status==='review'){note=o.approvedPlan?'制造方案已确认，款项仅模拟冻结。等待生产校验，未生成真实机器指令。':'文件、工艺或配送地区需审核，尚未付款或生成生产指令。';action=o.approvedPlan?'':'<button class="btn tiny" data-action="cancel-order" data-id="'+esc(o.id)+'">撤回询价</button>';}
 if(o.status==='queued'){note='等待前序任务完成、设备清台或按本单材料备机。';action='<button class="btn tiny" data-action="cancel-order" data-id="'+esc(o.id)+'">取消演示订单</button>'+action;}
 if(o.productionRoute==='PRODUCTION_CENTER'&&(o.status==='queued'||(o.status==='review'&&o.approvedPlan))){
  note='等待商家在生产中心核对设备与切片结果，确认备机后开始模拟生产。';
  action=(o.status==='queued'?'<button class="btn tiny" data-action="cancel-order" data-id="'+esc(o.id)+'">取消演示订单</button>':'')+'<a class="btn tiny" href="/merchant#operations">查看生产中心 '+I('arrow')+'</a>';
 }
 if(o.productionState==='WAITING_REMOVAL')note='打印完成，等待农场主取件、清台和质检。';
 if(o.productionState==='QC_FAILED')note='质检未通过，暂停发货与结算，可提交退款申请。';
 if(o.status==='ready_to_ship')note='质检已通过，等待农场主填写模拟运单。';
 if(o.status==='shipped'){note='模拟物流 '+esc(o.tracking)+' · 不对应真实快递。';action='<button class="btn tiny" data-action="tracking" data-id="'+esc(o.id)+'">物流详情</button><button class="btn tiny soft" data-action="deliver" data-id="'+esc(o.id)+'">模拟物流签收</button>';}
 if(o.status==='delivered'){note='请确认产品符合要求后验收。物流签收不会自动结算。';action='<button class="btn tiny primary" data-action="settle" data-id="'+esc(o.id)+'" '+(canAccept(o)?'':'disabled')+'>确认收货验收</button>';}
 if(o.status==='accepted'){note='已记录客户验收，款项仍处于模拟冻结状态，等待商家申请结算。';}
 if(o.status==='settling'){note='模拟结算申请已提交，等待处理结果；尚未完成结算。';}
 if(o.status==='settlement_failed'){note='模拟结算失败，款项未释放。商家可检查后重新申请。';}
 if(o.status==='settled'){note='模拟结算已完成。本版本未接入银行到账查询，没有真实资金转移。';action='';}
 if(o.status==='cancelled'){note='演示询价已取消，没有实际扣款。';action='';}
 if(o.status==='refund_pending'){note='退款申请待处理，已阻止新派单、发货和结算。进行中的设备任务仍须完成取件。';}
 if(o.status==='refunded'){note='模拟退款已完成；该订单不会再向商家结算，没有真实退款交易。';action='';}
 if(o.tracking&&o.status!=='shipped')action+=' <button class="btn tiny" data-action="tracking" data-id="'+esc(o.id)+'">物流详情</button>';
 if(canRaiseDispute(o))action+='<button class="btn tiny" data-action="dispute" data-id="'+esc(o.id)+'">'+(o.disputeState==='OPEN'?'撤销演示争议':'发起演示争议')+'</button>';
 if(canRequestRefund(o)&&o.productionState!=='QUEUED')action+='<button class="btn tiny" data-action="request-refund" data-id="'+esc(o.id)+'">'+(o.refundState==='REJECTED'?'重新申请退款':'申请退款')+'</button>';
 action+='<button class="btn tiny" data-action="order-history" data-id="'+esc(o.id)+'">订单记录</button>';
 const disputeBadge=o.disputeState==='OPEN'?'<span class="badge">争议处理中</span>':'';
 const label=o.status==='review'&&o.approvedPlan?'方案已确认 · 待生产校验':stageNames[o.status]||'状态待核验';
 return '<article class="card"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub">'+esc(f?.name||o.farm)+' · '+esc(material?.label||o.material)+' · '+o.qty+' 件'+(material?.process==='FDM'?' · '+(o.quality==='fine'?'0.12':'0.20')+' mm 层高':'')+'</div><div class="order-sub">'+esc(destinations[o.destination]||'旧演示订单未记录地区')+(o.quoteSnapshot?.days?.length===2?' · 下单时估计 '+o.quoteSnapshot.days[0]+'–'+o.quoteSnapshot.days[1]+' 天收到（演示）':'')+'</div><div class="order-sub mono">'+esc(o.id)+' · '+esc(displayTime(o.created))+'</div></div><div><span class="badge">'+label+'</span>'+disputeBadge+'<div class="order-price">'+(o.total?money(o.total):'待报价')+'</div></div></div><div class="order-body">'+(idx>=0?'<div class="timeline">'+stages.map((s,i)=>'<div class="timeline-item '+(i<idx?'done':i===idx?'current':'')+'">'+s+'</div>').join('')+'</div>':'')+fundsSummary(o)+'<div class="order-bottom"><span>'+note+'</span><div class="order-actions">'+action+'</div></div></div></article>';
}
function merchantFinancialTasks(){
 const orders=state.orders.filter(o=>refundPending(o)||['READY','REQUESTED','FAILED'].includes(o.settlementState));
 if(!orders.length)return '';
 return '<section class="financial-section"><div class="section-heading"><h2>结算与售后 <span class="small">'+orders.length+' 项待处理 · 模拟</span></h2></div><div class="order-list">'+orders.map(o=>{
  let buttons='',note='';
  if(refundPending(o)){buttons='<button class="btn primary" data-action="process-refund" data-id="'+esc(o.id)+'">处理退款申请</button>';note='退款待处理，暂不发货或结算。'+(['PRINTING','WAITING_REMOVAL'].includes(o.productionState)?'请先完成当前任务取件，再模拟退款。':'');}
  else if(['READY','FAILED'].includes(o.settlementState)){buttons='<button class="btn primary" data-action="request-settlement" data-id="'+esc(o.id)+'" '+(fulfillmentBlocked(o)?'disabled':'')+'>'+(o.settlementState==='FAILED'?'重新申请模拟结算':'申请模拟结算')+'</button>';note=o.disputeState==='OPEN'?'争议仍未解决，暂不能申请结算。':'客户已确认验收，申请后还需等待结算结果。';}
  else if(o.settlementState==='REQUESTED'){buttons='<button class="btn primary" data-action="process-settlement" data-id="'+esc(o.id)+'">演示处理结果</button>';note='结算申请已提交，尚未获得处理结果。';}
  return '<article class="card financial-task"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub mono">'+esc(o.id)+'</div></div><div class="financial-task-amount"><span>'+(refundPending(o)?'客户全额退款':legacySettlementAttempt(o)?'旧版待核验申请':'商家应收')+'</span><strong>'+(refundPending(o)?money(o.total):legacySettlementAttempt(o)?money(o.settlementAttempt.amountCents/100):merchantSettlementAmounts(o)?money(merchantSettlementAmounts(o).merchantReceivableCents/100):'待核验')+'</strong></div></div><div class="order-body">'+fundsSummary(o)+(refundPending(o)?'':settlementAmountDetails(o))+'<div class="order-bottom"><span>'+note+'</span><div class="order-actions">'+buttons+'<button class="btn tiny" data-action="order-history" data-id="'+esc(o.id)+'">订单记录</button></div></div></div></article>';
 }).join('')+'</div></section>';
}
function farmPage(){
 const working=state.devices.filter(d=>d.state==='printing').length, waiting=state.devices.filter(d=>d.state==='waiting').length;
 return intro('ORDER FULFILLMENT','生产与交付。','体验从生产、质检到发货的订单流程。以下设备和操作均为模拟。','<div class="intro-actions"><button class="btn" data-merchant-action="devices">设备清单 '+I('arrow')+'</button></div>')+
 '<div class="summary-grid">'+[['可接单设备',state.devices.filter(d=>d.state==='ready').length,'已备机 · 演示'],['正在生产',working,'已锁定生产任务 · 演示'],['等待取件',waiting,'清空打印板后恢复就绪'],['待发货订单',state.orders.filter(o=>o.status==='ready_to_ship').length,'质检通过后发货']].map(x=>'<div class="card summary-card"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><p>'+x[2]+'</p></div>').join('')+'</div>'+
 '<div class="section-heading"><h2>设备工作台 <span class="small">所有设备均为模拟实例</span></h2><button class="link-btn" data-action="nav" data-page="catalog">查看兼容路线 '+I('arrow')+'</button></div><div class="device-grid">'+state.devices.map(deviceCard).join('')+'</div>'+
 '<section style="margin-top:27px"><div class="section-heading"><h2>待交付任务</h2></div>'+ (state.orders.some(o=>['ready_to_ship','qc_failed'].includes(o.status))?'<div class="order-list">'+state.orders.filter(o=>['ready_to_ship','qc_failed'].includes(o.status)).map(o=>'<article class="card"><div class="order-top"><div><div class="order-title">'+esc(o.modelName)+'</div><div class="order-sub">'+o.id+' · '+o.qty+' 件 · '+stageNames[o.status]+'</div></div>'+(o.status==='ready_to_ship'?'<button class="btn primary" data-action="ship" data-id="'+o.id+'" '+(fulfillmentBlocked(o)?'disabled':'')+'>填写模拟运单</button>':'<span class="badge amber">待工程处理</span>')+'</div></article>').join('')+'</div>':'<div class="card empty-state" style="padding:30px"><p style="margin:0">暂无待交付任务。完成打印和质检后，订单会显示在这里。</p></div>')+'</section>'+merchantFinancialTasks();
}
function deviceCard(d){
 const o=state.orders.find(o=>o.id===d.orderId);
 const next=nextQueued(d);
 const status={ready:['teal','已备机 · 模拟可接单'],printing:['blue','正在打印'],waiting:['amber','完成待取件'],maintenance:['gray','维护中']};
 let action='<button class="btn full tiny" data-action="maintenance" data-id="'+d.id+'">暂停接单</button>';
 if(d.state==='ready'&&next){status.ready=['amber',d.blockedReason==='FUNDS_BLOCKED'?'前序任务售后处理中':d.blockedReason==='PROFILE_MISMATCH'?'等待工艺配置匹配':'等待按下一单备料'];action='<button class="btn full tiny primary" data-action="ready" data-id="'+d.id+'" '+(['FUNDS_BLOCKED','PROFILE_MISMATCH'].includes(d.blockedReason)?'disabled':'')+'>按下一单备料</button>';}
 if(d.state==='printing')action='<button class="btn full tiny soft" data-action="complete" data-id="'+d.id+'">模拟打印完成</button>';
 if(d.state==='waiting')action='<button class="btn full tiny primary" data-action="remove" data-id="'+d.id+'">取件与质检</button>';
 if(d.state==='maintenance')action='<button class="btn full tiny soft" data-action="ready" data-id="'+d.id+'">备机并恢复接单</button>';
 return '<article class="card device-card"><div class="device-card-top"><span class="mono small muted">'+d.id.toUpperCase()+' · 模拟</span><span class="badge '+status[d.state][0]+'">'+status[d.state][1]+'</span></div><div class="device-drawing">'+I('printer')+'</div><h3>'+esc(d.name)+'</h3><p>'+farms.find(f=>f.id===d.farm).name+' · '+d.route+'</p><div class="device-info"><span>支持材料</span><span>'+d.material+'</span></div><div class="device-info"><span>当前已装载 · 模拟</span><strong>'+materials[d.loadedMaterial].label+'</strong></div>'+(next?'<div class="device-info"><span>下一单需要</span><strong>'+materials[next.material].label+' · '+next.qty+' 件</strong></div>':'')+(o?'<p class="break" style="margin-bottom:10px;font-size:10px">'+esc(o.modelName)+' · '+o.id+'</p>':'<p style="margin-bottom:10px;font-size:10px">'+(d.state==='maintenance'?'维护期间不自动接单':'材料与工艺匹配后模拟派单')+'</p>')+action+'</article>';
}
function networkPage(){
 const fs=farms.filter(f=>(f.name+f.city).toLowerCase().includes(state.search.toLowerCase()));
 return intro('MADE BY GOOD PARTNERS','好作品，遇见好制造。','从原型到小批量生产，按工艺与交期寻找伙伴。以下商家档案均为演示。')+
 '<div class="filters"><div class="search-box">'+I('search')+'<input id="network-search" class="input" type="search" placeholder="搜索商家名称或城市" value="'+esc(state.search)+'" aria-label="搜索商家"/></div><div class="filter-chips">'+[['all','全部伙伴'],['FDM','FDM 打印'],['metal','金属与 CNC']].map(x=>'<button class="chip '+(state.networkFilter===x[0]?'active':'')+'" data-action="network-filter" data-value="'+x[0]+'">'+x[1]+'</button>').join('')+'</div></div>'+
 (state.networkFilter==='metal'?'<div class="card empty-state">'+I('factory')+'<h3>工业制造伙伴接入规划</h3><p>金属打印与 CNC 将使用工程审核报价、认证生产计划和现场准备流程。</p><button class="btn" data-action="nav" data-page="catalog">查看设备与接口路线</button></div>':fs.length?'<div class="network-grid">'+fs.map(f=>'<article class="card network-card"><div class="network-art '+f.tone+'">'+I('printer')+I('cube')+I('printer')+'</div><h3>'+f.name+'</h3><p>'+f.city+' · 演示制造伙伴</p><p style="margin-top:14px">'+f.desc+'</p><div class="quote-features">'+f.tags.map(t=>'<span>'+t+'</span>').join('')+'</div><div class="network-stat"><span>预计交付窗口</span><strong>'+f.days[0]+'–'+f.days[1]+' 天 · 示例</strong></div><button class="btn full" data-action="farm-detail" data-farm="'+f.id+'">查看制造能力 '+I('arrow')+'</button></article>').join('')+'</div>':'<div class="card empty-state"><h3>没有匹配的演示商家</h3><p>尝试搜索杭州、苏州、深圳或清空关键词。</p></div>');
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
function modal(title,body,footer='',wide=false){if(customerSaving)return;customerModal=null;focusBeforeModal=document.activeElement;$('#modal-root').innerHTML='<div class="modal-backdrop" data-dismiss="true"><section class="modal '+(wide?'wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">'+title+'</h2><button class="icon-btn" data-action="close" aria-label="关闭窗口">'+I('close')+'</button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'')+'</section></div>';document.body.style.overflow='hidden';setTimeout(()=>$('.modal button,.modal input,.modal select,.modal textarea')?.focus(),0);}
function closeModal(){if(customerSaving)return;customerModal=null;$('#modal-root').innerHTML='';document.body.style.overflow='';focusBeforeModal?.focus?.();}
async function paymentPlan(){
 try{await international.load();}catch(error){toast(error.message||'支付方案加载失败，请重试。');return;}
 const savedCountry=state.customerProfile?.shippingAddress?.countryCode||'CN',market=international.marketFor(savedCountry);
 const body='<p>确认报价后付款，确认收货后再申请向商家结算。</p><div class="hint">'+I('info')+'<span>当前为支付接入方案，尚未开通真实通道。演示操作不会收款。</span></div><label class="field-label" for="payment-market">查看国家 / 地区方案</label><select class="select payment-market-select" id="payment-market">'+international.options(market.countryCode)+'</select><div id="payment-market-preview">'+international.paymentHTML(market.countryCode)+'</div><h3 class="payment-plan-heading">一笔订单的资金流程</h3><ol class="payment-plan-steps"><li><strong>确认报价并付款</strong><p>保存金额、币种与收货资料，以支付服务商确认的付款结果为准。</p></li><li><strong>制造、质检与配送</strong><p>订单款项按通道规则延迟结算，物流签收不会自动触发放款。</p></li><li><strong>客户确认收货</strong><p>核对订单无退款或争议，再申请分账、解冻或向商家转账。</p></li><li><strong>跟踪结算与到账</strong><p>分别显示结算处理结果与银行到账状态，不将已申请当作已到账。</p></li></ol><p class="inline-note">实际可用方式取决于平台与商家的国家/地区、币种和审核结果。通道存在持款期限；超出允许周期的订单将限制该通道，并在到期前处理延期、退款等异常。</p>';
 modal('支付与结算',body,'<button class="btn primary" data-action="close">知道了</button>',true);
}
function quoteExpired(q){return !Number.isFinite(q.expiresAt)||Date.now()>=q.expiresAt;}
function expiredQuotePrompt(){modal('报价已过期','<p>价格和交付估计可能随排队情况变化，请重新测算后选择商家。</p>','<button class="btn" data-action="close">关闭</button><button class="btn primary" data-action="refresh-expired-quote">重新测算</button>');}
function quoteValidity(q){return '<div class="detail-row"><span>报价有效期</span><strong>'+ (quoteExpired(q)?'已过期，请重新测算':esc(displayTime(q.expiresAt)))+'</strong></div>';}
function quoteEvidence(q){
 const estimation=q.estimation;if(!estimation)return '';
 const arrival=estimation.estimatedArrival,formatDay=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric'}).format(date):'待确认';};
 return '<div class="quote-evidence"><strong>估算依据</strong><p>'+(q.estimateBasis==='SLICER_OUTPUT'?'已切片估算 · 尚需实机校准 · 未锁定产能':estimation.method==='MANUAL_REVIEW'?'由工程人员审核定价与交期。':'几何近似估算 · 未执行切片或实机校准 · 未锁定产能')+'</p><p>'+esc((q.estimateBasis==='SLICER_OUTPUT'?'采用匹配模型、数量、单位和工艺版本的制造服务切片结果。':estimation.analysisNote)||(estimation.method==='MANUAL_REVIEW'?'需要工程人员确认后报价。':'按模型体积与工艺参数近似计算，尚未执行真实切片或实机校准。'))+'</p>'+(Number.isInteger(estimation.queueJobs)?'<div class="detail-row"><span>前序任务</span><strong>'+estimation.queueJobs+' 项 · 模拟队列</strong></div>':'')+(arrival?'<div class="detail-row"><span>预计收到日期</span><strong>'+esc(formatDay(arrival.earliest))+' — '+esc(formatDay(arrival.latest))+'</strong></div><p class="quote-evidence-note">按日历天估算的参考窗口，尚未扣除节假日，不是商家承诺。</p>':'')+'</div>';
}
function quoteBatchDetails(q){
 const b=q.batch;if(!b)return '';
 if(b.method==='SLICER_OUTPUT_ESTIMATE')return '<div class="quote-batch"><strong>已切片估算</strong><div class="detail-row"><span>切片板数</span><strong>'+b.plateCount+' 板 · '+q.qty+' 件</strong></div><div class="detail-row"><span>切片耗材估计</span><strong>'+Number(q.weight*q.qty).toFixed(2)+' g</strong></div><div class="detail-row"><span>切片打印估时</span><strong>'+Number(q.productionHours).toFixed(2)+' 小时</strong></div><p>结果来自 '+esc(q.sliceEvidence?.engineVersion||'制造服务')+'，绑定当前文件与工艺版本。切片估算尚需实机校准，设备准备、质检与客户交期仍需独立确认。</p></div>';
 return '<div class="quote-batch"><strong>批量制造估算</strong><div class="detail-row"><span>预计每板最多</span><strong>'+b.capacityPerPlate+' 件</strong></div><div class="detail-row"><span>本单预计板数</span><strong>'+b.plateCount+' 板 · '+q.qty+' 件</strong></div><p>以 '+b.plateSizeMm.join(' × ')+' mm 演示打印板及模型包围盒估算。未实际排版或切片，不代表已验证可打印；不跨客户拼单，也不等待凑满一板。</p></div>';
}
function quotePaymentSummary(q){
 const payment=q.paymentContext;if(!payment)return '';
 return '<div class="market-payment compact"><div class="market-payment-heading"><strong>'+esc(q.market?.name||'本单地区')+' · 支付方案</strong><span>尚未开通</span></div><p class="market-currency">当地参考币种 '+esc(payment.referenceCurrency||'待确认')+' · 当前演示金额以 CNY 记账，无汇率换算</p><div class="payment-method-chips">'+(payment.methods||[]).map(method=>'<span>'+esc(method.label)+' · 待开通</span>').join('')+'</div><p class="market-payment-note">'+(q.review?'本单为工程询价。价格、跨境运费、税费与交期确认后才可付款。':'当前只能模拟付款，不会收取真实款项。')+'</p></div>';
}
function qDetails(q){
 const intro=quoteValidity(q)+quoteEvidence(q)+quotePaymentSummary(q);
 if(q.review)return intro+'<p>该文件、制造工艺或配送地区需要审核。提交后会创建一条演示询价记录，不会启动设备或产生扣款。</p><div class="detail-row"><span>收货地区</span><strong>'+esc(q.market?.name||destinations[q.destination])+'</strong></div>';
 const p=q.pricingSummary,rows=p?[['制造总价 · '+q.qty+' 件',p.manufacturingCents/100],['平均每件制造价约',p.averageUnitManufacturingCents/100],['平台服务费',p.platformFeeCents/100],['运费 · '+destinations[q.destination],p.shippingCents/100]]:[['制造总价 · '+q.qty+' 件',q.material+q.machine+q.finishing],['平台服务费',q.service],['运费 · '+destinations[q.destination],q.shipping]];
 return intro+'<p>按本单数量和预计板数测算。以下为客户支付价格，价格及交期均不是商家承诺。</p>'+quoteBatchDetails(q)+rows.map(([label,value])=>'<div class="detail-row"><span>'+label+'</span><strong>'+money(value)+'</strong></div>').join('')+'<div class="detail-row total"><span>演示总价 · '+q.qty+' 件</span><strong>'+money(q.total)+'</strong></div>'+(p?'<p class="inline-note">平均单件价经过四舍五入，支付以订单总价为准。</p>':'')+'<div class="detail-row"><span>本单估算机时</span><strong>'+q.productionHours.toFixed(1)+' 小时</strong></div><div class="detail-row"><span>前序任务估算机时</span><strong>'+q.queueHours.toFixed(1)+' 小时</strong></div><div class="detail-row"><span>区域运输估计</span><strong>'+q.transitDays[0]+'–'+q.transitDays[1]+' 天</strong></div><div class="detail-row"><span>预计收到 · 示例</span><strong>'+q.days[0]+'–'+q.days[1]+' 天</strong></div><p class="inline-note" style="font-size:10px;margin-top:15px">'+(q.estimateBasis==='SLICER_OUTPUT'?'生产机时采用切片器估算；排队、备机、后处理和地区运输仍为当前平台的参考计算，未锁定真实产能，不能保证实际交期。':'机时按材料用量、演示出料速度、层高及每板预热近似计算，按每日 8 小时产能排队；正在执行的任务保守计入完整机时，并加上备机、后处理和地区运输时间。未连接真实排产及物流，未扣除节假日，不能保证实际交期。')+'</p>';
}
function uploadModal(){modal('上传你的三维模型','<p>'+ (state.connection==='online'?'文件将发送至服务端。STL 由服务端重新计算几何信息；STEP、3MF 和图片登记后进入工程审核。':'当前离线，仅可本地预览；不会保存服务端模型或生成报价。')+'</p><div class="upload-zone" id="dropzone" role="button" tabindex="0" aria-label="选择或拖入模型文件">'+I('upload')+'<strong>拖入文件，或点击选择</strong><p>STL · STEP · STP · 3MF · PNG · JPG · WebP<br/>单文件不超过 20 MB</p><span class="btn tiny">选择文件</span></div><input type="file" id="model-file" class="file-hidden" accept=".stl,.step,.stp,.3mf,.png,.jpg,.jpeg,.webp"/><div id="upload-error" class="error-text"></div><p style="font-size:10px">STL 不保存单位。上传后请核对单位及尺寸；三维预览和几何解析不代表通过制造审核。</p>','<button class="btn" data-action="sample">使用示例模型</button>');const drop=$('#dropzone'),file=$('#model-file');drop.onclick=()=>file.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}};file.onchange=()=>file.files[0]&&loadFile(file.files[0]);drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag');};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');if(e.dataTransfer.files[0])loadFile(e.dataTransfer.files[0]);};}
async function loadFile(file){
 if(state.busy)return;
 try{
 if(!file.size)throw Error('文件为空，请重新选择。');
 if(file.size>20*1024*1024)throw Error('文件超过 20 MB，请先简化模型。');
 const ext=file.name.split('.').pop().toLowerCase();if(!['stl','step','stp','3mf','png','jpg','jpeg','webp'].includes(ext))throw Error('请选择支持的模型文件或图片。');
 const data=await file.arrayBuffer();let preview={triangles:[],dimensions:[],volume:0,faceCount:0,review:true};
 if(ext==='stl'){preview=parseSTL(data);preview.review=!preview.closed;}
 if(state.connection!=='online'){state.model={...preview,id:null,name:file.name,size:file.size,isSample:false,localOnly:true};state.unit='mm';state.quotes=[];closeModal();changePage('create');toast('仅在本地预览，恢复连接后请重新上传');return;}
 const task=await prepareMutation('/models',data,{raw:true,headers:{'X-File-Name':encodeURIComponent(file.name)}});
 await perform(task,result=>{state.model={...preview,...result.model,dimensions:result.model.dimensions||[],volume:result.model.volume||0,isSample:false,localOnly:false};state.unit='mm';state.quotes=[];closeModal();state.page='create';yaw=-.64;pitch=.37;zoom=1;workflow.modelChanged();toast('模型已保存，请核对尺寸并填写需求。');refreshQuotes();},'正在上传并分析模型');
 }catch(e){const node=$('#upload-error');if(node)node.textContent=e.message;else toast(e.message);}
}
function parseSTL(buf){
 let tris=[];const view=new DataView(buf);const n=buf.byteLength>=84?view.getUint32(80,true):0;
 if(n>0&&84+n*50===buf.byteLength){if(n>50000)throw Error('模型超过 5 万个三角面，请简化后上传。');for(let i=0;i<n;i++){let at=84+i*50+12,t=[];for(let j=0;j<3;j++){t.push([view.getFloat32(at,true),view.getFloat32(at+4,true),view.getFloat32(at+8,true)]);at+=12;}tris.push(t);}}
 else{
  if(buf.byteLength>8*1024*1024)throw Error('ASCII STL 最大 8 MiB，请转换为二进制或简化。');
  const txt=new TextDecoder().decode(buf);
  if(!/^\s*solid\b/i.test(txt)||!/endsolid\b/i.test(txt))throw Error('STL 格式不完整。');
  let face=[];
  for(const match of txt.matchAll(/\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)){
   face.push(match.slice(1,4).map(Number));
   if(face.length===3){tris.push(face);face=[];if(tris.length>50000)throw Error('模型超过 5 万个三角面，请简化后上传。');}
  }
  if(face.length||!tris.length)throw Error('无法解析此 STL，请检查文件是否完整。');
 }
 if(tris.some(t=>t.some(v=>v.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6))))throw Error('模型含无效或过大的坐标。');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let signed=0;const edges=new Map();
 for(const t of tris){for(const v of t)for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);}
 const [a,b,c]=t;signed+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
 for(let k=0;k<3;k++){const a=t[k].map(v=>v.toFixed(5)).join(','),b=t[(k+1)%3].map(v=>v.toFixed(5)).join(',');const key=a<b?a+'|'+b:b+'|'+a;edges.set(key,(edges.get(key)||0)+1);}}
 const dimensions=max.map((v,k)=>v-min[k]);if(dimensions.some(n=>n<=0)||Math.max(...dimensions)>1e6)throw Error('模型尺寸异常，请检查单位和三维几何。');
 const center=max.map((v,k)=>(v+min[k])/2);const scale=90/Math.max(...dimensions);
 const closed=[...edges.values()].every(n=>n===2)&&Math.abs(signed)>0;
 const step=Math.max(1,Math.ceil(tris.length/7000));return{triangles:tris.filter((_,i)=>i%step===0).map(t=>t.map(v=>v.map((n,k)=>(n-center[k])*scale))),dimensions,originalDimensions:[...dimensions],volume:Math.abs(signed)/1000,originalVolume:Math.abs(signed)/1000,faceCount:tris.length,closed};
}
function shipmentEvents(order){
 const legacyLabels=['模拟承运商已揽收','模拟物流签收，等待客户验收'];
 return (order.events||[]).filter(event=>event.kind==='SHIPMENT'||event.kind==='DELIVERY'||(!event.kind&&legacyLabels.includes(event.label))).reverse();
}
function changePage(p){if(p==='farm'||p==='catalog'){location.href='/merchant'+(p==='farm'?'#orders':'#devices');return;}if($('.modal'))closeModal();state.page=p;state.menuOpen=false;state.search='';history.replaceState(null,'',['orders','inquiries'].includes(p)?'/#'+p:'/');if(p==='inquiries')workflow.load(false,{quiet:true});render();window.scrollTo({top:0,behavior:'instant'});if(['home','create'].includes(p)&&state.connection==='online'&&!state.busy)refreshQuotes();}
function createOrder(farmId){const q=quote(farms.find(f=>f.id===farmId));if(!q?.quoteId){toast('请先获取有效的服务端报价。');return;}if(quoteExpired(q))return expiredQuotePrompt();return mutate('/orders',{quoteId:q.quoteId,demoAcknowledged:true},()=>{closeModal();changePage('orders');toast(q.review?'服务端已保存工程询价':'服务端已创建沙盒订单，没有实际付款');},'正在创建订单');}
function nextQueued(d){return state.orders.find(o=>o.farm===d.farm&&o.productionState==='QUEUED');}
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
 $$('.nav-more[open]').forEach(menu=>{if(e.target.closest('.nav-more-panel button,.nav-more-panel a')){menu.querySelector('summary')?.focus();menu.open=false;}else if(!menu.contains(e.target))menu.open=false;});
 const el=e.target.closest('[data-action]');if(!el){if(e.target.matches('[data-dismiss]'))closeModal();return;}e.preventDefault();const a=el.dataset.action,id=el.dataset.id;const order=state.orders.find(o=>o.id===id),device=state.devices.find(d=>d.id===id);
 if(state.busy&&!['nav','close','menu','menu-close','notifications','about'].includes(a))return;
 if(a==='toggle-estimate-mode'){state.inquiryMode=!state.inquiryMode;clearQuotes();render();if(!state.inquiryMode)refreshQuotes();return;}
 if(a==='payment-plan')return paymentPlan();
 if(a==='customer-profile')return openCustomerProfile();
 if(a==='measure-cost')return requestCostEstimate();
 if(a==='customer-save')return saveCustomerProfile(false);
 if(a==='customer-skip')return saveCustomerProfile(true);
 if(a==='reconnect')return connectWorkspace();
 if(a==='retry-operation'){if(retryOperation){const r=retryOperation;return perform(r.task,r.onSuccess,r.label);}return;}
 if(a==='refresh-expired-quote'){closeModal();return refreshQuotes();}
 if(a==='retry-quotes')return state.connection==='online'?refreshQuotes(true):connectWorkspace();
 if(a==='nav')return changePage(el.dataset.page);
 if(a==='menu'){state.menuOpen=!state.menuOpen;render();return;}
 if(a==='menu-close'){state.menuOpen=false;render();return;}
 if(a==='close')return closeModal();
 if(a==='upload')return uploadModal();
 if(a==='sample'){state.model={...sampleModel};state.unit='mm';closeModal();yaw=-.64;pitch=.37;zoom=1;configurationChanged();toast('已载入示例模型');return;}
 if(a==='material'){state.material=el.dataset.material;configurationChanged();return;}
 if(a==='quality'){state.quality=el.dataset.quality;configurationChanged();return;}
 if(a==='retry-budget'){syncBudget(true);return;}
 if(a==='qty-plus'||a==='qty-minus'){state.quantityDraft=null;state.qty=Math.min(50,Math.max(1,state.qty+(a==='qty-plus'?1:-1)));configurationChanged();return;}
 if(a==='zoom-in'){zoom=Math.min(2.5,zoom+.15);drawViewer();return;}
 if(a==='zoom-out'){zoom=Math.max(.5,zoom-.15);drawViewer();return;}
 if(a==='reset-view'){yaw=-.64;pitch=.37;zoom=1;drawViewer();return;}
 if(a==='quote-detail'){const q=quote(farms.find(f=>f.id===el.dataset.farm));if(!q)return;modal('费用明细 · '+q.farm.name,qDetails(q),'<button class="btn" data-action="close">关闭</button><button class="btn primary" data-action="choose" data-farm="'+q.farm.id+'">选择此商家</button>');return;}
 if(a==='choose'){const q=quote(farms.find(f=>f.id===el.dataset.farm));if(!q)return;if(quoteExpired(q))return expiredQuotePrompt();modal(q.review?'确认演示询价':'确认演示订单','<div class="detail-row"><span>制造伙伴</span><strong>'+q.farm.name+'</strong></div><div class="detail-row"><span>文件</span><strong class="break">'+esc(state.model.name)+'</strong></div>'+qDetails(q)+'<div class="hint">'+I('info')+'<span>订单会保存到服务端沙盒。不会收取费用，也不会向真实打印机下发生产任务。</span></div>','<button class="btn" data-action="close">再看看</button><button class="btn primary" data-action="create-order" data-farm="'+q.farm.id+'">'+(q.review?'创建演示询价':'模拟付款并下单')+'</button>');return;}
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
 if(a==='tracking'&&order){modal('物流进度 · 模拟','<p>'+esc(order.courier||'模拟快递')+'<br/><span class="mono">'+esc(order.tracking)+'</span></p><div class="tracking-list">'+shipmentEvents(order).map(v=>'<div class="tracking-item"><strong>'+esc(v.label)+'</strong><p>'+esc(displayTime(v.time))+' · 演示事件</p></div>').join('')+'</div>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='deliver'&&order?.status==='shipped')return actionRequest('deliver',order.id,{},'服务端已记录模拟签收，尚未结算');
 if(a==='order-history'&&order){modal('订单记录 · 模拟','<div class="tracking-list">'+[...order.events].reverse().map(v=>'<div class="tracking-item"><strong>'+esc(v.label)+'</strong><p>'+esc(displayTime(v.time))+' · 演示事件</p></div>').join('')+'</div>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='dispute'&&order&&canRaiseDispute(order))return actionRequest('dispute',order.id,{open:order.disputeState!=='OPEN'},order.disputeState==='OPEN'?'服务端已撤销演示争议':'已保存争议，暂停新派单、发货与结算');
 if(a==='settle'&&order&&canAccept(order)){modal('确认作品验收','<p>请确认已收到零件，且材料、数量与质量符合约定。</p><div class="detail-row"><span>演示订单金额</span><strong>'+money(order.total)+'</strong></div><p>确认后进入待结算状态，商家仍需提交结算申请并等待处理结果。本次操作不会产生实际资金转移。</p>','<button class="btn" data-action="close">稍后验收</button><button class="btn primary" data-action="confirm-settle" data-id="'+esc(id)+'">确认收货验收</button>');return;}
 if(a==='confirm-settle'&&order&&canAccept(order))return actionRequest('accept',order.id,{customerAccepted:true},'验收已保存，等待商家申请模拟结算');
 if(a==='request-refund'&&order&&canRequestRefund(order)){modal('申请退款 · 模拟','<p>提交后会阻止新派单、发货和结算。已开始的设备任务仍须完成取件，退款申请本身不会向机器发送停机命令。</p><div class="detail-row"><span>申请全额退款</span><strong>'+money(order.total)+'</strong></div><label class="field-label" for="refund-reason">退款原因</label><textarea class="input workflow-reason" id="refund-reason" maxlength="500" rows="3" placeholder="请描述原因，最多 500 字"></textarea><div id="workflow-error" class="error-text" role="alert"></div>','<button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-refund" data-id="'+esc(id)+'">提交模拟退款申请</button>');return;}
 if(a==='confirm-refund'&&order&&canRequestRefund(order)){const reason=$('#refund-reason')?.value.trim();if(!reason){$('#workflow-error').textContent='请填写退款原因。';return;}return actionRequest('request-refund',order.id,{reason},'退款申请已保存，尚未执行模拟退款');}
 if(a==='request-settlement'&&order&&['READY','FAILED'].includes(order.settlementState)&&!fulfillmentBlocked(order)){modal('申请模拟结算','<p>客户已确认验收。提交申请后，订单将进入结算处理中；处理成功与银行到账是不同状态。</p>'+settlementAmountDetails(order)+'<p>当前未连接支付服务商，不会产生真实资金转移。</p>','<button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-request-settlement" data-id="'+esc(id)+'">提交模拟结算申请</button>');return;}
 if(a==='confirm-request-settlement'&&order)return actionRequest('request-settlement',order.id,{},'已提交模拟结算申请，等待处理结果');
 if(a==='process-settlement'&&order?.settlementState==='REQUESTED'){modal('结算处理结果 · 模拟','<p>选择一个沙盒处理结果，用于验证成功、失败与重试流程。这不是支付渠道的真实回调。</p>'+settlementAmountDetails(order)+'<p>模拟成功仅代表本沙盒结算状态完成，不代表银行到账。</p>','<button class="btn" data-action="resolve-settlement" data-outcome="failed" data-id="'+esc(id)+'" data-attempt-id="'+esc(order.settlementAttempt?.id)+'">模拟结算失败</button><button class="btn primary" data-action="resolve-settlement" data-outcome="succeeded" data-id="'+esc(id)+'" data-attempt-id="'+esc(order.settlementAttempt?.id)+'" '+(legacySettlementAttempt(order)?'disabled':'')+'>模拟结算成功</button>');return;}
 if(a==='resolve-settlement'&&order?.settlementState==='REQUESTED'){const outcome=el.dataset.outcome;return actionRequest('resolve-settlement',order.id,{attemptId:el.dataset.attemptId,outcome,...(outcome==='failed'?{reason:'演示渠道处理失败，用于验证重试流程'}:{})},outcome==='succeeded'?'模拟结算完成，未发生真实转账':'模拟结算失败，可重新申请');}
 if(a==='process-refund'&&order&&refundPending(order)){const occupied=['PRINTING','WAITING_REMOVAL'].includes(order.productionState)||state.devices.some(d=>d.orderId===order.id);modal('处理退款 · 模拟','<div class="detail-row"><span>申请金额</span><strong>'+money(order.total)+'</strong></div><p><strong>申请原因</strong><br/>'+esc(order.refundRequest?.reason||'取消订单后的退款申请')+'</p>'+(occupied?'<div class="hint">'+I('info')+'<span>设备仍被本订单占用，请先完成打印、取件和清台，再批准模拟退款。</span></div>':'<p>批准后完成全额模拟退款，订单不再申请商家结算。</p>')+(order.productionState==='CANCELLED'?'<p>该订单已取消，需要退回模拟付款，不能拒绝退款。</p>':'')+'<label class="field-label" for="refund-resolution">处理说明</label><textarea class="input workflow-reason" id="refund-resolution" maxlength="500" rows="3" placeholder="填写同意或拒绝的原因"></textarea><div id="workflow-error" class="error-text" role="alert"></div>','<button class="btn" data-action="resolve-refund" data-approved="false" data-id="'+esc(id)+'" data-request-id="'+esc(order.refundRequest?.id)+'" '+(order.productionState==='CANCELLED'?'disabled':'')+'>拒绝申请</button><button class="btn primary" data-action="resolve-refund" data-approved="true" data-id="'+esc(id)+'" data-request-id="'+esc(order.refundRequest?.id)+'" '+(occupied?'disabled':'')+'>批准并模拟退款</button>');return;}
 if(a==='resolve-refund'&&order&&refundPending(order)){const reason=$('#refund-resolution')?.value.trim();if(!reason){$('#workflow-error').textContent='请填写处理说明。';return;}const approved=el.dataset.approved==='true';return actionRequest('resolve-refund',order.id,{requestId:el.dataset.requestId,approved,reason},approved?'模拟退款完成，没有真实退款交易':'已拒绝本次退款申请，处理说明已保存');}
 if(a==='cancel-order'&&order&&['review','queued'].includes(order.status))return actionRequest('cancel',order.id,{},'服务端已取消演示订单');
 if(a==='connect'){if(merchant.isRoute())return merchant.discover();location.href='/merchant/login';return;}
 if(a==='settings'){modal('沙盒空间设置','<p>当前订单、报价及设备状态由服务端保存。重置会清除当前服务端沙盒的演示记录并恢复初始设备。</p><p>旧版浏览器数据不会导入，也不会被这次重置删除。尚未连接真实设备、支付或物流。</p>','<button class="btn" data-action="close">保留数据</button><button class="btn danger" data-action="reset-demo" '+(state.connection==='online'?'':'disabled')+'>重置服务端沙盒</button>');return;}
 if(a==='reset-demo')return actionRequest('reset',undefined,{confirm:'RESET_DEMO'},'服务端沙盒已重置');
 if(a==='notifications'){const events=state.orders.flatMap(o=>o.events.map(v=>({...v,name:o.modelName}))).slice(-6).reverse();modal('工作通知',events.length?'<div class="notice-list">'+events.map(v=>'<div class="notice-item"><span class="avatar">'+I('bell')+'</span><div><strong>'+esc(v.label)+'</strong><p>'+esc(v.name)+'<br/>'+esc(displayTime(v.time))+' · 模拟</p></div></div>').join('')+'</div>':'<p>暂无通知。完成演示打印后，取件提醒会出现在这里。</p>','<button class="btn" data-action="close">关闭</button>');return;}
 if(a==='about'){modal('关于这个服务端沙盒','<p>共造连接个人创作者与制造商家，目标是实现从模型、报价、自动生产到物流和收货结算的完整流程。</p><p>模型由服务端登记与校验，报价、订单和设备状态保存于服务端。原浏览器演示数据不会自动导入。断线时只读浏览，未确认成功的操作可以使用原请求重试。</p><p>报价、打印、支付、物流及结算仍为沙盒模拟。商家设备清单可通过已授权的本地网关读取真实设备状态；设备添加不会启动生产。原生应用与微信小程序需独立构建、签名及平台审核。</p>','<button class="btn primary" data-action="close">知道了</button>');}
});
document.addEventListener('change',e=>{
 if(state.busy){render();return;}
 if(e.target.id==='quantity')commitQuantity(e.target.value);
 if(e.target.id==='quote-sort'){state.sort=e.target.value;render();}
 if(e.target.id==='unit'){state.unit=e.target.value;configurationChanged();toast('已更新尺寸单位，服务端将重新计算报价');}
 if(e.target.id==='customer-country'){international.changeCountry(e.target.value);showFieldErrors($('#customer-profile-form'),{},{summaryId:'customer-form-error',focus:false});}else updateCustomerField(e.target,true);
 if(e.target.id==='payment-market')$('#payment-market-preview').innerHTML=international.paymentHTML(e.target.value);
});
document.addEventListener('submit',e=>{if(e.target.id==='customer-profile-form'){e.preventDefault();saveCustomerProfile(false);}});
document.addEventListener('focusout',e=>updateCustomerField(e.target,true));
document.addEventListener('input',e=>{
 if(e.target.id==='customer-country-code'&&international.selectKnownCountry(e.target.value)){
  showFieldErrors($('#customer-profile-form'),{},{summaryId:'customer-form-error',focus:false});return;
 }
 updateCustomerField(e.target);if(e.target.id==='quantity'){editQuantity(e.target.value);syncBudget();return;}if(e.target.id==='network-search'){const pos=e.target.selectionStart;state.search=e.target.value;render();const input=$('#network-search');input.focus();input.setSelectionRange(pos,pos);}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const menu=$('.nav-more[open]');if(menu){menu.open=false;menu.querySelector('summary')?.focus();}else closeModal();}if(e.key==='Tab'&&$('.modal')){const nodes=$$('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',$('.modal'));const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
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
 if(!mesh?.length){ctx.fillStyle='#b2b2b2';ctx.font='500 16px sans-serif';ctx.textAlign='center';ctx.fillText(state.model.localOnly?'本地文件，等待工程解析':'文件已登记，等待工程解析',w/2,h/2-5);ctx.font='11px sans-serif';ctx.fillStyle='#a7a7a7';ctx.fillText('STL 格式可在此旋转预览',w/2,h/2+20);return;}
 const sc=Math.min(w/205,h/145)*zoom;
 const rot=p=>{const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);return[x,p[1]*Math.cos(pitch)-z*Math.sin(pitch),p[1]*Math.sin(pitch)+z*Math.cos(pitch)];};
 const project=p=>[w/2+p[0]*sc,h/2+12-p[1]*sc];
 ctx.save();ctx.translate(w/2,h*.79);ctx.scale(1,.25);const g=ctx.createRadialGradient(0,0,0,0,0,w*.25);g.addColorStop(0,'#55555523');g.addColorStop(1,'#55555500');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,w*.28,0,Math.PI*2);ctx.fill();ctx.restore();
 const tris=mesh.map(t=>{const v=t.map(rot);return {v,z:(v[0][2]+v[1][2]+v[2][2])/3};}).sort((a,b)=>a.z-b.z);
 for(const {v} of tris){const a=v[0],b=v[1],cc=v[2],u=b.map((n,k)=>n-a[k]),vv=cc.map((n,k)=>n-a[k]);const n=[u[1]*vv[2]-u[2]*vv[1],u[2]*vv[0]-u[0]*vv[2],u[0]*vv[1]-u[1]*vv[0]],len=Math.hypot(...n)||1;const shade=.56+.28*Math.abs((n[0]*-.4+n[1]*.7+n[2]*.6)/len);const r=Math.round(150*shade+45),gg=r,bb=r;ctx.beginPath();v.map(project).forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle='rgb('+r+','+gg+','+bb+')';ctx.fill();ctx.strokeStyle='rgba(70,70,70,.12)';ctx.lineWidth=.45;ctx.stroke();}
 if(state.model.isSample){for(const x of [-22,22]){const v=project(rot([x,12,25.3]));ctx.beginPath();ctx.ellipse(v[0],v[1],4.3*sc,5*sc,0,0,Math.PI*2);ctx.fillStyle='#949494';ctx.fill();ctx.strokeStyle='#d4d4d4';ctx.lineWidth=1;ctx.stroke();}}
}
window.addEventListener('resize',()=>drawViewer());
const international=createInternationalUI({get,escape:esc});
const auth=createAuthUI({render,tradeReturn:tradeReturnPath(new URLSearchParams(location.search).get('returnTo')),feedback:{show:showFieldErrors,update:updateFieldError,has:hasFieldError},resetWorkspace:()=>{workflow.reset();clearQuotes();state.model={...sampleModel};state.qty=1;state.quantityDraft=null;state.unit='mm';state.inquiryMode=true;state.orders=[];state.devices=[];state.models=[];state.customerProfile=null;state.customerProfileLoaded=false;state.revision=0;state.session=null;retryOperation=null;closeModal();if(merchant){merchant.resetOperations?.();merchant.state.profile=null;merchant.state.devices=[];merchant.state.gateways=[];merchant.state.pricing=null;merchant.state.pricingDrafts={};}}});
const workflow=createWorkflowUI({icon:I,escape:esc,render,modal,closeModal,toast,selection:()=>({model:state.model,qty:state.qty,quantityDraft:state.quantityDraft,unit:state.unit}),applyWorkspace,changePage,connection:()=>state.connection,hasAddress:hasShippingAddress,requestAddress:onSaved=>openCustomerProfile({required:true,onSaved}),merchantAuthenticated:()=>auth.authenticated(),merchantDevices:()=>merchant.state.devices});
const merchant=createMerchantUI({operationsFactory:createOperationsUI,auth,workflow,icon:I,escape:esc,render,modal,closeModal,toast,legacyOrders:farmPage,connection:()=>state.connection,reconnect:connectWorkspace,session:()=>state.session});
const budgetSlot='<section id="model-budget" class="model-budget" aria-label="模型预算"></section>';
const budget=createBudgetController({request:payload=>postQuery('/budget-estimate',payload),changed:paintBudget});
function paintBudget(view){
 const panel=$('#model-budget');
 if(!panel)return;
 const focus=panel.contains(document.activeElement)?document.activeElement.dataset.budgetFocus:null;
 panel.innerHTML=renderBudget(view,Boolean(panel.querySelector('details[open]')),hasPlatformRoutes());
 if(focus)panel.querySelector('[data-budget-focus="'+focus+'"]')?.focus({preventScroll:true});
}
function syncBudget(retry=false){
 if(!$('#model-budget')){budget.reset();return;}
 const view=budget.select({model:state.model,qty:state.quantityDraft??state.qty,unit:state.unit,
  material:state.inquiryMode?workflow.state.draft.material:state.material,quality:state.inquiryMode?'standard':state.quality,
  connection:state.connection,workspace:state.session?.workspaceContext},retry);
 paintBudget(view);
}
if(!merchant.isRoute()&&['#orders','#inquiries'].includes(location.hash))state.page=location.hash.slice(1);
render();
connectWorkspace();
if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
