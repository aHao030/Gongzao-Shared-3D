import { tradeInboxHref, hasPlatformRoutes } from '../dist/trade-return.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createInternationalUI} from '../dist/international-ui.js';
import {getMarketCatalog} from '../services/platform/market.mjs';
import {safeAuthPath} from '../dist/auth-ui.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const authSource=(await readFile(new URL('../dist/auth-ui.js',import.meta.url),'utf8')).replaceAll('export function ','function ').replaceAll('export async function ','async function ');
const merchantSource=(await readFile(new URL('../dist/merchant-ui.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export function ','function ');
async function international(){const ui=createInternationalUI({get:async path=>{assert.equal(path,'/markets');return getMarketCatalog();},escape:esc});await ui.load();return ui;}
const inputTag=(html,id)=>html.match(new RegExp('<(?:input|select)[^>]*id="'+id+'"[^>]*>'))?.[0];

test('international form uses country metadata: US ZIP, SG postal only, HK no postal and JP ordered postal',async()=>{
  const ui=await international();
  const us=ui.fieldsHTML({countryCode:'US'});
  assert.match(us,/州 \/ State/);assert.match(inputTag(us,'customer-postal-code'),/required/);
  assert.equal(inputTag(us,'customer-district'),undefined);
  const sg=ui.fieldsHTML({countryCode:'SG'});
  for(const id of ['customer-province','customer-city','customer-district'])assert.equal(inputTag(sg,id),undefined);
  assert.match(inputTag(sg,'customer-postal-code'),/required/);
  assert.equal(ui.validateAddress({countryCode:'SG',recipient:'A',phone:'+6561234567',addressLine:'1 Bayfront Avenue',postalCode:'018956'}),'');
  assert.match(ui.validateAddress({countryCode:'SG',recipient:'A',phone:'+6561234567',addressLine:'1 Bayfront Avenue',postalCode:''}),/Postal code/);
  const hk=ui.fieldsHTML({countryCode:'HK'});assert.equal(inputTag(hk,'customer-postal-code'),undefined);assert.match(inputTag(hk,'customer-province'),/required/);
  assert.equal(inputTag(ui.fieldsHTML({countryCode:'MO'}),'customer-city'),undefined);
  const jp=ui.fieldsHTML({countryCode:'JP'});assert.ok(jp.indexOf('id="customer-postal-code"')<jp.indexOf('id="customer-province"'));
});

test('switch country clears incompatible regional values and retains contact and street, with payments changed',async()=>{
  const ui=await international();let html='',focused=false;
  const values={'customer-country':'US','customer-recipient':'张三','customer-phone':'+8613812345678','customer-province':'浙江省','customer-city':'杭州','customer-district':'西湖区','customer-address-line':'Building 7','customer-postal-code':'310000'};
  const root={querySelector:id=>id==='#customer-address-fields'?{set innerHTML(value){html=value;}}:id==='#customer-country'?{value:'US',focus(){focused=true;}}:values[id.slice(1)]!==undefined?{value:values[id.slice(1)]}:null};
  ui.changeCountry('US',root);
  assert.ok(focused);for(const value of ['浙江省','杭州','西湖区','310000'])assert.equal(html.includes(value),false);
  for(const value of ['张三','+8613812345678','Building 7'])assert.ok(html.includes(value));
  assert.match(html,/USD/);assert.match(html,/PayPal/);assert.doesNotMatch(html,/微信支付/);
  assert.match(html,/无汇率换算/);assert.match(html,/尚未开通/);
  assert.match(ui.paymentHTML('CN'),/微信支付/);assert.match(ui.paymentHTML('US'),/不可付款/);
});

test('unknown country uses explicit ISO code and rendered text is escaped',async()=>{
  const ui=await international();const html=ui.fieldsHTML({countryCode:'IT',recipient:'<script>bad</script>'});
  assert.match(html,/id="customer-country-code"[^>]*value="IT"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(ui.paymentHTML('OTHER'),/参考币种 待确认/);
});

function authUI({authenticated=false,hosted=false,legacy=false,query=''}={}){
  const events={},nodes={},requests=[],navigations=[];let reset=0;
  const context=vm.createContext({URLSearchParams,AbortController,setTimeout,clearTimeout,URL,console,
    document:{querySelector:id=>nodes[id]||null,querySelectorAll:()=>Object.values(nodes).map(node=>{node.dataset??={};return node;}),addEventListener:(name,handler)=>(events[name]??=[]).push(handler)},
    location:{pathname:'/merchant/login',search:query,assign:path=>navigations.push(path)},
    fetch:async(url,init)=>{requests.push({url,init});return{ok:true,json:async()=>({authenticated:true,user:{email:'test@example.com'}})};},
    dependencies:{render(){},resetWorkspace(){reset++;}}
  });
  vm.runInContext(authSource+'\nglobalThis.ui=createAuthUI(dependencies);',context);
  Object.assign(context.ui.state,{loaded:true,config:{mode:hosted?'HOSTED_PLATFORM':'LOCAL_SANDBOX',emailPassword:{enabled:!hosted,registrationEnabled:true},platform:{enabled:hosted,signInUrl:'/signin-with-chatgpt',signOutUrl:'/signout'},providers:['wechat','alipay','x','apple','qq','google'].map(id=>({id,label:id,enabled:false,authorizationPath:null})),notice:'尚未配置的渠道不能登录。'},session:{authenticated,legacyWorkspaceAvailable:legacy,user:authenticated?{email:'test@example.com',displayName:'Test'}:null}});
  return{ui:context.ui,context,nodes,events,requests,navigations,get reset(){return reset;}};
}

test('local login provides real email/password form and six disabled providers; hosted shows verified account',()=>{
  const local=authUI({legacy:true});let html=local.ui.renderPanel({merchant:true});
  assert.match(html,/type="password" minlength="12" maxlength="128"/);assert.match(html,/QQ 邮箱、Gmail/);assert.match(html,/不是 QQ 或 Gmail 邮箱密码/);
  assert.equal((html.match(/class="auth-provider" disabled/g)||[]).length,6);assert.doesNotMatch(html,/使用当前账号开通|href="\/api\/auth\/oidc/);
  local.ui.state.mode='register';html=local.ui.renderPanel({merchant:true});assert.match(html,/id="auth-adopt" type="checkbox"\//);assert.doesNotMatch(html,/id="auth-adopt"[^>]*checked/);assert.match(html,/注册无需等待邮件/);
  const hosted=authUI({authenticated:true,hosted:true}).ui.renderPanel({merchant:true});assert.match(hosted,/已通过平台登录/);assert.doesNotMatch(hosted,/id="auth-password"/);
  assert.match(authUI({query:'?auth_error=OIDC_FAILED'}).ui.renderPanel(),/第三方登录未完成或已过期/);
  assert.doesNotMatch(authUI({query:'?auth_error=%3Cscript%3E'}).ui.renderPanel(),/<script>/);
});

test('register sends adoption only by explicit selection, then clears password and reloads merchant workspace',async()=>{
  const h=authUI({legacy:true});h.ui.state.mode='register';
  Object.assign(h.nodes,{'#auth-form':{reportValidity:()=>true},'#auth-email':{value:' user@gmail.com '},'#auth-password':{value:'new-platform-password'},'#auth-password-confirm':{value:'new-platform-password'},'#auth-name':{value:'Workshop'},'#auth-adopt':{checked:false},'#auth-error':{textContent:''}});
  // Event listener returns no promise, so call the lexical handler through the VM.
  h.events.submit[0]({target:{id:'auth-form'},preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.requests[0].url,'/api/auth/register');const payload=JSON.parse(h.requests[0].init.body);
  assert.equal(payload.email,'user@gmail.com');assert.equal(payload.password,'new-platform-password');assert.equal('adoptLegacyWorkspace' in payload,false);
  assert.equal(h.nodes['#auth-password'].value,'');assert.equal(h.nodes['#auth-password-confirm'].value,'');assert.equal(h.reset,1);assert.deepEqual(h.navigations,['/merchant']);
  assert.equal(h.requests[0].init.headers['Idempotency-Key'],undefined);assert.doesNotMatch(authSource,/localStorage|sessionStorage|prepareMutation/);
});

test('auth navigation accepts only same-site paths',()=>{
  for(const value of ['https://example.org','//example.org','/\\example.org','/\nother'])assert.equal(safeAuthPath(value),null);
  assert.equal(safeAuthPath('/api/auth/oidc/start?provider=google'),'/api/auth/oidc/start?provider=google');
});

test('anonymous merchant cannot load protected APIs or see one-click enrollment',async()=>{
  let calls=0;
  const context=vm.createContext({tradeInboxHref,hasPlatformRoutes,Date,Intl,Number,Set,Object,Math,location:{pathname:'/merchant/login',hash:''},document:{querySelector:()=>null,addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{replaceState(){}},setTimeout,clearTimeout,get:async()=>{calls++;throw new Error('must not be called');},dependencies:{icon:()=>'',escape:esc,render(){},modal(){},closeModal(){},toast(){},legacyOrders:()=>'',connection:()=> 'online',session:()=>({}),auth:{state:{loaded:true},authenticated:()=>false,renderPanel:()=>'<h2>邮箱登录</h2>'}}});
  vm.runInContext(merchantSource+'\nglobalThis.ui=createMerchantUI(dependencies);',context);await context.ui.load(false);
  assert.equal(calls,0);const html=context.ui.renderContent();assert.match(html,/邮箱登录/);assert.doesNotMatch(html,/merchant-name|data-merchant-action="enroll"/);
});
