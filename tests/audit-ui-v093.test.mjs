import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const section = (start, next) => source.slice(source.indexOf(start), source.indexOf(next));

test('checkout retains invalid quantity after blur without replacing it with another quantity', () => {
  const state = { qty: 12, quantityDraft: '', busy: false, inquiryMode: true };
  const field = { setAttribute(){}, reportValidity(){} }, error = {};
  const ctx = vm.createContext({state, clearQuotes(){}, $: s => s === '#quantity' ? field : s === '#quantity-error' ? error : null});
  vm.runInContext(section('function validQuantity(', 'function selectedConfiguration('), ctx);
  for(const value of ['','1.5','51']) {
    ctx.commitQuantity(value);
    assert.equal(state.qty,12);
    assert.equal(state.quantityDraft,value);
    assert.match(error.textContent,/1–50/);
  }
});

test('open ASCII STL with upper-case keywords retains its preview mesh and dimensions', () => {
  const ctx = vm.createContext({TextDecoder});
  vm.runInContext(section('function parseSTL(', 'function shipmentEvents('), ctx);
  const data = new TextEncoder().encode('SOLID test\nfacet normal 0 0 1\nouter loop\nVERTEX 0 0 0\nVERTEX 1 2 0\nVERTEX 2 0 3\nendloop\nendfacet\nENDSOLID test');
  const m = ctx.parseSTL(data.buffer);
  assert.deepEqual(Array.from(m.dimensions), [2,2,3]);
  assert.equal(m.triangles.length,1);
  assert.equal(m.closed,false);
});

test('shipment timeline excludes unrelated events and understands earlier saved shipping records', () => {
  const ctx = vm.createContext({});
  vm.runInContext(section('function shipmentEvents(', 'function changePage('),ctx);
  const events=[{label:'模拟承运商已揽收'}, {label:'客户联系承运商'}, {kind:'DELIVERY',label:'已签收'}, {kind:'REFUND',label:'整单退款'}];
  assert.deepEqual(Array.from(ctx.shipmentEvents({events}),e=>e.label),['已签收','模拟承运商已揽收']);
  assert.equal(events[0].label,'模拟承运商已揽收');
});

test('typing a listed country in Other exposes that country’s required controls immediately', async () => {
  const {createInternationalUI} = await import('../dist/international-ui.js');
  const {getMarketCatalog} = await import('../services/platform/market.mjs');
  const ui = createInternationalUI({get:async()=>getMarketCatalog(),escape:String});
  await ui.load();
  let html='';
  const root={querySelector(id){
    if(id==='#customer-address-fields') return {set innerHTML(value){html=value;}};
    if(id==='#customer-country') return {value:'OTHER',focus(){}};
    if(id==='#customer-address-line') return {value:'Sample street'};
    if(id==='#customer-country-code') return {value:'CN'};
    return null;
  }};
  assert.equal(ui.selectKnownCountry('br',root),false);
  assert.equal(ui.selectKnownCountry('c',root),false);
  assert.equal(ui.selectKnownCountry('cn',root),true);
  assert.match(html,/id="customer-district"/);
  assert.match(html,/<option value="CN" selected>/);
  assert.match(html,/Sample street/);
});

test('a queued production-center order identifies the merchant’s equipment and slice checks', () => {
 const ctx=vm.createContext({farms:[],materials:{},destinations:{},esc:String,displayTime:String,money:String,I:()=>''});
 vm.runInContext(section('const stageNames=', 'function merchantFinancialTasks('),ctx);
 const html=ctx.orderCard({id:'Q-1',farm:'f1',status:'queued',productionRoute:'PRODUCTION_CENTER',events:[]});
 assert.match(html,/核对设备与切片结果/);
 assert.ok(html.includes('href="/merchant#operations"'));
 assert.match(html,/data-action="cancel-order"/);
});
