import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createInternationalUI} from '../dist/international-ui.js';
import {authFieldErrors} from '../dist/auth-ui.js';
import {showFieldErrors,updateFieldError,hasFieldError} from '../dist/form-feedback.js';
import {getMarketCatalog} from '../services/platform/market.mjs';

const appSource=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const profileSource=appSource.slice(appSource.indexOf('const customerFieldIds='),appSource.indexOf('async function connectWorkspace()'));
const authSource=(await readFile(new URL('../dist/auth-ui.js',import.meta.url),'utf8')).replaceAll('export function ','function ').replaceAll('export async function ','async function ');
const address={recipient:'测试收件人',phone:'+86 12345',countryCode:'CN',province:'浙江省',city:'杭州市',district:'西湖区',addressLine:'测试街道 1 号',postalCode:''};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formDOM(){
  const nodes=new Map(),document={activeElement:null};
  class Node {
    constructor(tag='input',id=''){this.tagName=tag.toUpperCase();this.id=id;this.value='';this.attrs={};this.children=[];this.events={};this.ownerDocument=document;this.hidden=false;this.textContent='';this.dataset={};if(id)nodes.set(id,this);}
    setAttribute(name,value){this.attrs[name]=String(value);}
    getAttribute(name){return this.attrs[name]??null;}
    removeAttribute(name){delete this.attrs[name];}
    append(node){this.children.push(node);if(node.id)nodes.set(node.id,node);}
    replaceChildren(...children){this.children=children;}
    insertAdjacentElement(position,node){assert.equal(position,'afterend');nodes.set(node.id,node);}
    addEventListener(name,fn){this.events[name]=fn;}
    focus(){document.activeElement=this;}
    scrollIntoView(){this.scrolled=true;}
    querySelector(selector){if(selector==='[aria-invalid="true"]')return [...nodes.values()].find(node=>node.getAttribute('aria-invalid')==='true')||null;return selector.startsWith('#')?nodes.get(selector.slice(1))||null:null;}
    contains(node){return [...nodes.values()].includes(node);}
    querySelectorAll(selector){return [...nodes.values()].filter(node=>node.getAttribute('aria-invalid')==='true');}
  }
  document.createElement=tag=>new Node(tag);
  const form=new Node('form','customer-profile-form'),summary=new Node('div','customer-form-error');summary.hidden=true;
  const close=new Node('button');
  for(const [id,value] of Object.entries({'customer-display-name':'我的称呼','customer-recipient':address.recipient,'customer-phone':address.phone,'customer-country':address.countryCode,'customer-province':address.province,'customer-city':address.city,'customer-district':address.district,'customer-address-line':address.addressLine,'customer-postal-code':address.postalCode})){const node=new Node('input',id);node.value=value;}
  return{form,summary,document,nodes,Node,close,$:selector=>selector==='.modal [data-action="close"]'?close:form.querySelector(selector)};
}
async function profileHarness({execute}={}){
  const dom=formDOM(),requests=[],busy=[],notices=[];let closed=0,prepared=0,renders=0;
  const intl=createInternationalUI({get:async()=>getMarketCatalog(),escape});await intl.load();
  const state={customerProfile:{shippingAddress:{...address},addressRevision:1},busy:false,connection:'online',page:'orders'};
  const context=vm.createContext({
    ...dom,console,JSON,Object,state,customerSaving:false,customerModal:{required:false,onboarding:false},customerSaveTask:null,onboardingPrompted:false,retryOperation:null,
    international:{readAddress:()=>intl.readAddress(dom.form),validateAddressFields:intl.validateAddressFields},showFieldErrors,updateFieldError,hasFieldError,
    prepareMutation:async(path,payload)=>{prepared++;requests.push({path,payload:structuredClone(payload)});return{execute:execute||(async()=>({profile:{...payload,addressRevision:2}}))};},
    render:()=>{renders++;},setModalBusy:value=>{busy.push(value);},applyWorkspace:()=>{},clearQuotes:()=>{},closeModal:()=>{closed++;},toast:message=>notices.push(message),hasShippingAddress:()=>!!state.customerProfile?.shippingAddress,refreshQuotes:()=>{}
  });
  vm.runInContext(profileSource,context);
  return{...dom,context,state,requests,busy,notices,get closed(){return closed;},get prepared(){return prepared;},get renders(){return renders;},save:skip=>context.saveCustomerProfile(skip),map:error=>context.customerServerErrors(error)};
}

test('profile save exposes all local field errors, retains other inputs and sends no mutation',async()=>{
  const h=await profileHarness();h.nodes.get('customer-phone').value='12+345';h.nodes.get('customer-city').value='';
  await h.save(false);
  assert.equal(h.prepared,0);assert.equal(h.closed,0);assert.equal(h.renders,0);assert.equal(h.state.busy,false);
  assert.equal(h.nodes.get('customer-address-line').value,address.addressLine);
  assert.equal(h.nodes.get('customer-display-name').value,'我的称呼');
  assert.equal(h.nodes.get('customer-phone').getAttribute('aria-invalid'),'true');
  assert.equal(h.nodes.get('customer-city').getAttribute('aria-invalid'),'true');
  assert.match(h.nodes.get('customer-phone-error').textContent,/5–20/);
  assert.match(h.nodes.get('customer-city-error').textContent,/城市/);
  assert.equal(h.summary.hidden,false);assert.equal(h.document.activeElement.id,'customer-phone');
  const list=h.summary.children.find(node=>node.tagName==='UL');assert.equal(list.children.length,2);
  list.children[1].children[0].events.click();assert.equal(h.document.activeElement.id,'customer-city');
});

test('profile server rejection maps fields, keeps form contents and re-enables a correction retry',async()=>{
  let attempts=0;
  const error=Object.assign(new Error('省区市需要重新核对'),{code:'INVALID_ADDRESS',fieldErrors:{province:'请选择有效的省区市'}});
  const h=await profileHarness({execute:async()=>{attempts++;if(attempts===1)throw error;return{profile:{shippingAddress:{...address,province:'江苏省'},addressRevision:2}};}});
  await h.save(false);
  assert.equal(h.prepared,1);assert.equal(h.closed,0);assert.equal(h.state.busy,false);assert.equal(h.context.customerSaving,false);
  assert.equal(h.nodes.get('customer-province').value,'浙江省');assert.equal(h.nodes.get('customer-address-line').value,address.addressLine);
  assert.equal(h.nodes.get('customer-province').getAttribute('aria-invalid'),'true');
  assert.equal(h.nodes.get('customer-province-error').textContent,'请选择有效的省区市');
  assert.match(h.summary.children[0].textContent,/输入的内容已保留/);
  assert.equal(h.document.activeElement.id,'customer-province');assert.equal(h.busy.at(-1),false);
  h.nodes.get('customer-province').value='江苏省';await h.save(false);
  assert.equal(h.prepared,2);assert.equal(h.closed,1);assert.equal(h.requests[1].payload.shippingAddress.province,'江苏省');
  assert.equal(h.nodes.get('customer-province').getAttribute('aria-invalid'),null);
  assert.equal(h.notices.at(-1),'账号资料已保存。');
});

test('message-only network failure keeps input and focuses the visible summary; unchanged retry reuses its request',async()=>{
  let attempts=0;const h=await profileHarness({execute:async()=>{attempts++;throw Object.assign(new Error('连接失败，请重试'),{code:'NETWORK_ERROR'});}});
  await h.save(false);
  assert.equal(h.state.connection,'offline');assert.equal(h.nodes.get('customer-phone').value,address.phone);
  assert.equal(h.nodes.get('customer-address-line').value,address.addressLine);assert.equal(h.document.activeElement,h.summary);assert.equal(h.summary.scrolled,true);
  assert.match(h.summary.children[0].textContent,/连接失败/);assert.equal(h.closed,0);
  await h.save(false);assert.equal(h.prepared,1);assert.equal(attempts,2);assert.equal(h.state.busy,false);
});

test('server country-code failures target the OTHER input and unknown server keys are not selectors',async()=>{
  const h=await profileHarness();h.nodes.get('customer-country').value='OTHER';
  assert.deepEqual(JSON.parse(JSON.stringify(h.map({fieldErrors:{countryCode:'请填写两位国家代码',displayName:'称呼过长',phone:'电话错误','body script':'ignored',city:{bad:true}}}))),{'customer-country-code':'请填写两位国家代码','customer-display-name':'称呼过长','customer-phone':'电话错误'});
  h.nodes.get('customer-country').value='CN';assert.deepEqual(JSON.parse(JSON.stringify(h.map({fieldErrors:{countryCode:'国家无效'}}))),{'customer-country':'国家无效'});
});

test('field correction clears only its own error and preserves existing help descriptions',()=>{
  const h=formDOM(),phone=h.nodes.get('customer-phone');phone.setAttribute('aria-describedby','phone-format-help');
  showFieldErrors(h.form,{'customer-city':'请填写城市','customer-phone':'电话格式错误'},{summaryId:'customer-form-error'});
  assert.equal(h.document.activeElement,phone);
  assert.equal(phone.getAttribute('aria-describedby'),'phone-format-help customer-phone-error');
  updateFieldError(h.form,'customer-phone',undefined,{summaryId:'customer-form-error'});
  assert.equal(phone.getAttribute('aria-invalid'),null);assert.equal(phone.getAttribute('aria-describedby'),'phone-format-help');
  assert.equal(h.nodes.get('customer-phone-error').hidden,true);assert.equal(hasFieldError(h.form,'customer-phone'),false);
  assert.equal(hasFieldError(h.form,'customer-city'),true);assert.equal(h.summary.children.find(node=>node.tagName==='UL').children.length,1);
});

test('login and registration attribute missing or invalid values without exposing a password',()=>{
  assert.deepEqual(Object.keys(authFieldErrors({})),['auth-email','auth-password']);
  for(const email of ['a@exa_mple.com','a@-example.com','a@example..com'])assert.match(authFieldErrors({email,password:'example-password-123'})['auth-email'],/邮箱格式/);
  const invalid=authFieldErrors({email:'not-email',password:'short',confirm:'different',name:'a'.repeat(65)},{registering:true});
  assert.deepEqual(Object.keys(invalid),['auth-email','auth-password','auth-name','auth-password-confirm']);
  assert.match(invalid['auth-email'],/邮箱格式/);assert.match(invalid['auth-password-confirm'],/不一致/);
  assert.doesNotMatch(Object.values(invalid).join(' '),/different|short/);
  const valid={email:' Test+tag@Example.com ',password:'example-password-123',confirm:'example-password-123',name:'Test'};
  assert.deepEqual(authFieldErrors(valid,{registering:true}),{});
  assert.deepEqual(authFieldErrors({...valid,confirm:'ignored',name:'a'.repeat(200)}),{});
});

test('customer and merchant login render distinct visible role entries and preserve hosted identity',()=>{
  const events={};
  const context=vm.createContext({URLSearchParams,URL,AbortController,setTimeout,clearTimeout,console,location:{pathname:'/login',search:''},document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>(events[name]??=[]).push(fn)}});
  vm.runInContext(authSource+'\nglobalThis.ui=createAuthUI({render(){}});',context);
  const ui=context.ui;
  Object.assign(ui.state,{loaded:true,session:{authenticated:false},config:{emailPassword:{enabled:true,registrationEnabled:true},providers:[]}});
  const customer=ui.renderPanel();assert.match(customer,/<h2>用户登录<\/h2>/);assert.match(customer,/<a href="\/login" aria-current="page">个人用户<\/a>/);assert.match(customer,/<a href="\/merchant\/login" >商家<\/a>/);
  assert.match(customer,/<form id="auth-form"[^>]*novalidate>/);assert.match(customer,/id="auth-error"[^>]*role="alert"/);
  const merchant=ui.renderPanel({merchant:true});assert.match(merchant,/<h2>商家登录<\/h2>/);assert.match(merchant,/<a href="\/merchant\/login" aria-current="page">商家<\/a>/);
  ui.state.config.mode='HOSTED_PLATFORM';ui.state.session={authenticated:true};
  const hosted=ui.renderPage();assert.match(hosted,/<h1>用户中心<\/h1>/);assert.match(hosted,/已通过平台登录/);assert.doesNotMatch(hosted,/id="auth-password"/);
});
