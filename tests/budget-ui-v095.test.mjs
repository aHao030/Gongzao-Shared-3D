import test from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetController, renderBudget} from '../dist/budget-ui.js';

const selection = {model:{id:'sample-bracket', isSample:true},qty:3,unit:'mm',material:'AUTO',quality:'standard',connection:'online',workspace:'test'};
const result = {status:'ESTIMATED',currency:'CNY',lowCents:3000,highCents:3660,unitLowCents:1000,unitHighCents:1220,basis:'GEOMETRY',
  source:'PLATFORM_REFERENCE',materialsCompared:['PLA','PETG'],includes:['制造','平台服务费'],excludes:['运费','税费']};
const waitTurn = () => new Promise(resolve => setTimeout(resolve,5));

test('typing coalesces requests and changes invalidate all older prices and errors', async () => {
  const calls = [], views = [];
  const budget = createBudgetController({delay:0,changed:view=>views.push(view),request:payload => new Promise((resolve,reject) => calls.push({payload,resolve,reject}))});
  budget.select({...selection,qty:1});
  budget.select(selection);
  await waitTurn();
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].payload,{modelId:'sample-bracket',qty:3,unit:'mm',material:'AUTO',quality:'standard'});
  budget.select({...selection,qty:4});
  await waitTurn();
  calls[1].resolve({estimate:result});
  await waitTurn();
  calls[0].reject(new Error('old'));
  await waitTurn();
  assert.deepEqual(views.map(v=>[v.phase,v.payload.qty]),[['ready',4]]);
  assert.equal(budget.select({...selection,qty:4}).phase,'ready');
  assert.equal(calls.length,2);
  assert.equal(budget.select({...selection,qty:''}).phase,'quantity');
  assert.equal(budget.select({...selection,qty:51}).phase,'quantity');
  assert.equal(budget.select({...selection,model:{localOnly:true}}).phase,'upload');
  assert.equal(budget.select({...selection,connection:'offline'}).phase,'offline');
  await waitTurn();
  assert.equal(calls.length,2);
});

test('abandoned model threads and workspace changes retire in-flight results; errors permit retries',async()=>{
  const calls=[], views=[];
  const budget=createBudgetController({request:payload=>new Promise(resolve=>calls.push(resolve)),changed:v=>views.push(v),delay:0});
  budget.select(selection);
  await waitTurn();
  budget.select({...selection,workspace:'other'});
  await waitTurn();
  calls[0]({estimate:result});
  calls[1]({estimate:{...result,highCents:null}});
  await waitTurn();
  assert.deepEqual(views.map(v=>v.phase),['error']);
  budget.select({...selection,workspace:'other'},true);
  await waitTurn();
  calls[2]({estimate:{...result,status:'REVIEW_REQUIRED',lowCents:null,highCents:null}});
  await waitTurn();
  assert.equal(views.at(-1).phase,'review');
  budget.select(selection);
  await waitTurn();
  budget.reset();
  calls[3]({estimate:result});
  await waitTurn();
  assert.equal(views.length,2);
});

test('budget labels both prices, same endpoints, scope, contact configuration and manual review',()=>{
  const payload={modelId:'mdl_sample#1',qty:3,unit:'inch',material:'AUTO',quality:'fine'};
  const view={phase:'ready',payload,estimate:result,sample:true};
  const html=renderBudget(view,true);
  assert.match(html,/示例模型预算/);
  assert.match(html,/¥30\.00 – ¥36\.60/);
  assert.match(html,/每件 ¥10\.00 – ¥12\.20/);
  assert.match(html,/自动比较 PLA \/ PETG/);
  assert.match(html,/平台参考费率/);
  const href=html.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&');
  const url=new URL(href,'http://example.test');
  assert.equal(url.pathname,'/messages');
  assert.deepEqual(Object.fromEntries(url.searchParams),{...payload,qty:'3'});
  assert.match(html,/<details class="budget-details" open>/);
  assert.doesNotMatch(renderBudget({...view,estimate:{...result,highCents:3000,unitHighCents:1000}}),/ – /);
  assert.doesNotMatch(renderBudget({...view,phase:'review',estimate:{...result,lowCents:null,highCents:null}}),/¥/);
  assert.doesNotMatch(renderBudget({...view,phase:'quantity'}),/联系商家/);
  assert.match(renderBudget({...view,phase:'error',message:'<bad>'}),/&lt;bad&gt;/);
});
