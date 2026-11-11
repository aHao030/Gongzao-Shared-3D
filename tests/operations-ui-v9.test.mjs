import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createOperationsUI, availableSpoolGrams, canCancelOperation, operationModeLabel } from '../dist/operations-ui.js';

const snapshot=()=>({schemaVersion:1,spools:[],profiles:[],jobs:[],productions:[],models:[{id:'m1',name:'cube.stl',format:'stl',isSample:false}],orders:[],devices:[{id:'p1',name:'演示打印机',source:'demo',farmId:'f1'}],summary:{},realDispatchEnabled:false});
function harness({data=snapshot(),getRequest,prepareRequest}={}) {
  const nodes={},events={},requests=[],modals=[],toasts=[];
  const document={querySelector(selector){const id=selector.match(/^\[id="(.+)"\]$/)?.[1]||selector.slice(1);return nodes[id]||null;},querySelectorAll:()=>[],addEventListener(name,fn){(events[name]??=[]).push(fn);}};
  const ui=createOperationsUI({document,render(){},getRequest:getRequest||(async()=>data),prepareRequest:prepareRequest||(async(path,payload)=>({execute:async()=>{requests.push({path,payload});return {};}})),modal:(title,body,footer)=>modals.push({title,body,footer}),closeModal(){},toast:message=>toasts.push(message)});
  function form(id,values,dataset={}){nodes[id]={reportValidity:()=>true,dataset};for(const [key,v] of Object.entries(values))nodes[key]=typeof v==='object'?v:{value:String(v)};}
  return {ui,nodes,events,requests,modals,toasts,form,act:(action,dataset={})=>ui.handleAction(action,{dataset})};
}

test('production studio distinguishes actual worker evidence and sandbox; user text is escaped',async()=>{
  const data=snapshot();data.spools=[{id:'s1',name:'<img src=x onerror=alert(1)>',remainingGrams:100,reservedGrams:40,material:'PLA',mode:'LIVE_INVENTORY',revision:1,costCentsPerKg:8000}];
  const h=harness({data});await h.ui.load();h.ui.state.tab='inventory';const html=h.ui.page();
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/实际库存登记/);assert.match(html,/生产与款项仍为沙盒/);assert.match(html,/60 g/);
  assert.equal(availableSpoolGrams(data.spools[0]),60);assert.equal(availableSpoolGrams({remainingGrams:10,reservedGrams:40}),0);
  assert.equal(operationModeLabel({mode:'WORKER'}),'制造服务处理');assert.equal(operationModeLabel({mode:'SIMULATED'}),'模拟演练');
  assert.equal(canCancelOperation({status:'LEASED'}),false);
});

test('real model task binds model, units and quantity without inventing a result',async()=>{
  const h=harness();await h.ui.load();h.form('ops-job-form',{'ops-job-kind':'SLICE_MODEL','ops-job-mode':'WORKER','ops-job-model':'m1','ops-job-profile':'profile-1','ops-job-qty':4,'ops-job-unit':'inch'});
  await h.act('save-job');assert.deepEqual(h.requests[0],{path:'/merchant/operations/commands',payload:{type:'queue-job',payload:{kind:'SLICE_MODEL',modelId:'m1',quantity:4,unit:'inch',mode:'WORKER',profileId:'profile-1'}}});
  assert.equal(h.ui.state.data.jobs.length,0);
});

test('sample models require explicit sandbox selection and cannot queue fake real computation',async()=>{
  const data=snapshot();data.models[0].isSample=true;const h=harness({data});await h.ui.load();h.form('ops-job-form',{'ops-job-kind':'ANALYZE_MODEL','ops-job-mode':'WORKER','ops-job-model':'m1','ops-job-qty':1,'ops-job-unit':'mm'});
  await h.act('save-job');assert.equal(h.requests.length,0);assert.match(h.ui.state.error.message,/示例模型没有实际文件/);
  h.nodes['ops-job-mode'].value='SANDBOX';await h.act('save-job');assert.equal(h.requests[0].payload.payload.demoAcknowledged,true);
});

test('network failure retains the original task and retry does not create a second command',async()=>{
  let prepared=0,attempts=0;const h=harness({prepareRequest:async(path,payload)=>{prepared++;return{key:'same-request',execute:async()=>{attempts++;if(attempts===1)throw new Error('请求超时，状态待核对');return {};}};}});
  await h.ui.load();await h.act('schedule');assert.ok(h.ui.state.retry);assert.equal(prepared,1);assert.match(h.ui.page(),/重试原操作/);
  await h.act('retry');assert.equal(prepared,1);assert.equal(attempts,2);assert.equal(h.ui.state.retry,null);
});

test('account reset rejects late reads and pending mutation preparation',async()=>{
  let resolveRead;const read=harness({getRequest:()=>new Promise(resolve=>{resolveRead=resolve;})});const reading=read.ui.load();read.ui.reset();resolveRead({...snapshot(),spools:[{name:'private prior merchant'}]});await reading;assert.equal(read.ui.state.data,null);
  let resolvePrepare,executions=0;const write=harness({prepareRequest:()=>new Promise(resolve=>{resolvePrepare=resolve;})});await write.ui.load();const saving=write.act('schedule');write.ui.reset();resolvePrepare({execute:async()=>{executions++;return {};}});await saving;assert.equal(executions,0);assert.equal(write.ui.state.retry,null);
});

test('spool save carries expected revision and converts displayed currency exactly to cents',async()=>{
  const h=harness();await h.ui.load();h.form('ops-spool-form',{'ops-spool-name':'白色 PLA','ops-spool-material':'PLA','ops-spool-mode':'LIVE_INVENTORY','ops-spool-grams':'900.50','ops-spool-cost':'58.25'},{id:'spool-a',revision:'3'});
  await h.act('save-spool');assert.deepEqual(h.requests[0].payload,{type:'save-spool',payload:{id:'spool-a',expectedRevision:3,name:'白色 PLA',material:'PLA',mode:'LIVE_INVENTORY',remainingGrams:900.5,costCentsPerKg:5825}});
});

test('production adoption is explicit; preparation, simulated start, actuals and quality have separate actions',async()=>{
  const data=snapshot();data.orders=[{id:'o1',productionState:'PRINTING'}];data.productions=[{id:'p1',orderId:'o1',status:'AWAITING_READINESS',material:'PLA',mode:'SIMULATED',reservedGrams:20}];
  const h=harness({data});await h.ui.load();await h.act('production-details',{id:'p1'});assert.match(h.modals.at(-1).footer,/确认备机/);assert.doesNotMatch(h.modals.at(-1).footer,/开始模拟生产/);
  h.form('ops-production-form',{'ops-production-order':'o1','ops-production-slice':'j1','ops-production-spool':'s1','ops-adopt-confirm':{checked:false}});await h.act('save-production');assert.equal('adoptExistingSimulation' in h.requests[0].payload.payload,false);
  h.nodes['ops-adopt-confirm'].checked=true;await h.act('save-production');assert.equal(h.requests[1].payload.payload.adoptExistingSimulation,true);
  h.form('ops-readiness-form',{'ops-ready-bed':{checked:true},'ops-ready-material-check':{checked:true},'ops-ready-device':{checked:true},'ops-ready-material':'PLA'});await h.act('save-readiness',{id:'p1'});assert.deepEqual(h.requests[2].payload.payload,{productionId:'p1',bedClear:true,materialReady:true,deviceClear:true,loadedMaterial:'PLA',demoAcknowledged:true});
  h.form('ops-finish-form',{'ops-finish-grams':'21.5','ops-finish-minutes':'30.25'});await h.act('save-finish',{id:'p1'});assert.equal(h.requests[3].payload.payload.actualDurationSeconds,1815);assert.equal(h.requests[3].payload.payload.actualMaterialGrams,21.5);
  h.form('ops-qc-form',{'ops-qc-removed':{checked:true},'ops-qc-clear':{checked:true},'ops-qc-passed':'false','ops-qc-note':'表面缺陷'});await h.act('save-qc',{id:'p1'});assert.equal(h.requests[4].payload.payload.passed,false);
});

test('readiness dialog has distinct controls for material confirmation and loaded material',async()=>{
  const h=harness();await h.ui.load();await h.act('readiness-prompt',{id:'p1'});const html=h.modals.at(-1).body;
  assert.equal((html.match(/id="ops-ready-material"/g)||[]).length,1);assert.match(html,/id="ops-ready-material-check"/);
});

test('service connection states do not imply print or payment permission; probe sends only service id',async()=>{
  const h=harness();await h.ui.load();h.ui.state.tab='services';h.ui.state.services={services:[{id:'karrio',configured:false,state:'NOT_CONFIGURED',mode:'READ_ONLY',message:'缺少承运商配置'},{id:'spoolman',configured:true,state:'CONFIGURED_UNVERIFIED',mode:'READ_ONLY',message:'待测试'}]};
  let html=h.ui.page();assert.match(html,/data-service="karrio" disabled/);assert.doesNotMatch(html,/type="password"|name="apiKey"/);assert.match(html,/物流签收后仍需客户确认验收/);
  await h.act('probe-service',{service:'spoolman'});assert.deepEqual(h.requests[0],{path:'/merchant/integrations/probe',payload:{service:'spoolman'}});
});

test('real optimizer queue and local quick schedule are explicit separate actions',async()=>{
  const h=harness();await h.ui.load();await h.act('queue-schedule');assert.deepEqual(h.requests[0].payload,{type:'queue-job',payload:{kind:'SCHEDULE',mode:'WORKER'}});await h.act('schedule');assert.deepEqual(h.requests[1].payload,{type:'schedule',payload:{}});
});

test('shared native client exposes merchant operations but denies worker-only commands and arbitrary service URLs',async()=>{
  const source=await readFile(new URL('../apps/shared/api-client.js',import.meta.url),'utf8'),context={};vm.runInNewContext(source,context);const calls=[];
  const client=context.SharedFabricationApi.createApiClient({apiBase:'https://example.test',getAccessToken:async()=> 'test-token',transport:async req=>{calls.push(req);return{status:200,data:req.method==='GET'?snapshot():{ok:true}};}});
  await client.getOperations();assert.equal(calls[0].url,'https://example.test/api/v2/merchant/operations');
  await assert.rejects(()=>client.operationsCommand('complete-job',{result:{}},'valid-key-1'),e=>e.code==='OPERATIONS_COMMAND_NOT_ALLOWED');
  await assert.rejects(()=>client.probeIntegration('https://private-host','valid-key-2'),e=>e.code==='INTEGRATION_NOT_ALLOWED');
  await client.operationsCommand('schedule',{},'valid-key-3');assert.equal(calls[1].headers['Idempotency-Key'],'valid-key-3');assert.equal(calls[1].data.type,'schedule');
  await client.observeShipment({carrier:'carrier-a',trackingNumber:'number-a',url:'http://unexpected'},'valid-key-4');assert.deepEqual(Object.keys(calls[2].data),['carrier','trackingNumber']);
});

test('measured slicing quotes show actual evidence and never render null plate capacity or private costs',async()=>{
  const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const context=vm.createContext({Date,Intl,Number,esc:v=>String(v??'').replaceAll('<','&lt;'),q:{estimateBasis:'SLICER_OUTPUT',batch:{method:'SLICER_OUTPUT_ESTIMATE',plateCount:2,capacityPerPlate:null},sliceEvidence:{engineVersion:'PrusaSlicer 2.9'},qty:4,weight:5.25,productionHours:2.75,estimation:{method:'MESH_ESTIMATE',analysisNote:'旧估算说明'},privateCost:100}});
  vm.runInContext(app.slice(app.indexOf('function quoteEvidence('),app.indexOf('function quotePaymentSummary(')),context);
  const html=vm.runInContext('quoteEvidence(q)+quoteBatchDetails(q)',context);
  assert.match(html,/已切片估算/);assert.match(html,/21\.00 g/);assert.match(html,/2\.75 小时/);assert.match(html,/2 板 · 4 件/);
  assert.doesNotMatch(html,/null|预计每板最多|未执行切片|未实际排版|旧估算说明|privateCost/);
});

test('merchant sliced cost details include combined labor without inventing split costs or NaN',async()=>{
  const source=await readFile(new URL('../dist/merchant-ui.js',import.meta.url),'utf8');
  const context=vm.createContext({Number,priceMoney:n=>'¥'+(n/100).toFixed(2),margin:n=>(n/100).toFixed(2)+'%',e:{costBreakdown:{materialCents:100,machineCents:80,electricityCents:5,laborCents:120,packagingCents:30,riskReserveCents:15},estimatedCostCents:350,estimatedProfitCents:150,estimatedMarginBps:3000,durationSeconds:3600,pricingRevision:1}});
  vm.runInContext(source.slice(source.indexOf('  function economicsDetails('),source.indexOf('  function merchantReceivable(')),context);
  const html=vm.runInContext('economicsDetails(e)',context);assert.match(html,/准备与后处理人工/);assert.match(html,/1\.00 小时/);assert.doesNotMatch(html,/NaN|undefined|每单准备人工|换板准备人工/);
});

test('external inventory never turns an unknown purchase price into zero and only offers cost editing',async()=>{
  const data=snapshot();data.spools=[{id:'s-live',name:'实际线材',material:'PLA',source:'SPOOLMAN',mode:'LIVE_INVENTORY',remainingGrams:500,reservedGrams:0,revision:2,costCentsPerKg:null,costConfigured:false}];
  const h=harness({data});await h.ui.load();h.ui.state.tab='inventory';const html=h.ui.page();assert.match(html,/采购价待填写/);assert.match(html,/data-ops-action="edit-spool-cost"/);assert.doesNotMatch(html,/data-ops-action="edit-spool"|¥0\.00 \/ kg/);
  h.form('ops-spool-cost-form',{'ops-spool-unit-cost':'69.95'},{id:'s-live',revision:'2'});await h.act('save-spool-cost');assert.deepEqual(h.requests[0].payload,{type:'set-spool-cost',payload:{id:'s-live',expectedRevision:2,costCentsPerKg:6995}});
});
