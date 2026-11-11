import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkspace } from '../../services/platform/core.mjs';
import { handleApi } from '../../services/platform/http.mjs';

const modules = createRequire(import.meta.url);
const api = modules('../shared/api-client.js');
const base = 'https://sandbox-api.example.test';
const calls = [];
function endpoint() {
  const workspace = createWorkspace();
  return async request => {
    calls.push(request);
    const response = await handleApi(new Request(request.url, {
      method: request.method, headers: request.headers, body: JSON.stringify(request.data)
    }), {ownerId:'test-owner', store:{load:async () => workspace}});
    return {status:response.status, data:await response.json()};
  };
}
const contents = path => readFile(new URL('../weapp/' + path, import.meta.url), 'utf8');
async function miniProgram(transport, adapterReady = true) {
  let page;
  let spec = {materialIndex:0, quantity:3, material:'PLA'};
  const wx = {getStorageSync() { return {}; }, setStorageSync() {}};
  const wired = {
    './demo':{getSpec:() => spec},
    '../config/service':{API_BASE:base, AUTH_ADAPTER_READY:adapterReady},
    './api-client':modules('../weapp/utils/api-client.js'),
    './auth':{getAccessToken: () => 'test-only-token'},
    './transport':{wxTransport:transport}
  };
  const serviceContext = vm.createContext({module:{exports:{}}, require:name=>wired[name], wx});
  vm.runInContext(await contents('utils/service.js'), serviceContext);
  const service = serviceContext.module.exports;
  vm.runInNewContext(await contents('pages/quotes/index.js'), {require:() => service, Page:value=>{page=value;}, wx});
  page.setData = updates => Object.assign(page.data, updates);
  return {page, service, setMaterial(index) { spec = {...spec,materialIndex:index}; }};
}

test('WeChat quote page estimates before asking for an address, through the shared client and actual budget API', async () => {
  calls.length = 0;
  const app = await miniProgram(endpoint());
  const {page, service} = app;
  await service.selectMode('server');
  await page.onShow();
  assert.deepEqual(calls.map(request=>new URL(request.url).pathname), ['/api/v2/session']);
  const markup = await contents('pages/quotes/index.wxml');
  assert.match(markup,/bindtap="loadBudget"/);
  await page.loadBudget();
  assert.equal(page.data.budget.estimated,true);
  assert.match(page.data.budget.totalText,/¥/);
  assert.match(page.data.budget.unitText,/¥/);
  assert.match(page.data.budget.excludes,/运费、税费/);
  assert.equal(page.data.addressRequired,false);
  assert.deepEqual(calls.map(request=>new URL(request.url).pathname), ['/api/v2/session','/api/v2/budget-estimate']);
  assert.equal(calls[1].headers['Idempotency-Key'],undefined);
  await page.loadQuotes();
  assert.equal(page.data.addressRequired,true);
  assert.equal(calls.at(-1).url,base+'/api/v2/customer/profile');
  assert.equal(page.data.budget.estimated,true);
  app.setMaterial(4);
  page.onHide(); await page.onShow(); await page.loadBudget();
  assert.equal(page.data.budget.estimated,false);
  assert.equal(page.data.budget.totalText,'');
  assert.match(page.data.budget.explanation,/商家/);
});

test('an absent adapter, an interrupted network and a late response never turn into local budgets', async () => {
  const local = await miniProgram(async () => {throw new Error('Unexpected network');},false);
  await assert.rejects(local.service.getBudgetEstimate({}),{code:'SERVER_MODE_REQUIRED'});
  await assert.rejects(local.service.selectMode('server'),{code:'AUTH_ADAPTER_NOT_READY'});
  const server = endpoint();
  let block, started;
  const pending = new Promise(resolve=>{started=resolve;});
  const {page,service} = await miniProgram(async request => {
    if (request.url.endsWith('/session')) return server(request);
    started();
    await new Promise(resolve=>{block=resolve;});
    throw new Error('connection lost');
  });
  await service.selectMode('server');
  await page.onShow();
  const budget=page.loadBudget();
  await pending;page.onHide();block();await budget;
  assert.equal(page.data.budget,null);
  assert.equal(page.data.budgetError,'');
  await page.onShow();
  const retry=page.loadBudget();
  await new Promise(resolve=>setImmediate(resolve));
  block();await retry;
  assert.equal(page.data.budget,null);
  assert.match(page.data.budgetError,/网络请求失败/);
});

test('shared read-only budget client rejects address fields and untrusted payable responses', async () => {
  let requests=0;
  const server=endpoint();
  const client=api.createApiClient({apiBase:base,getAccessToken:()=> 'test-only-token',transport:async request=>{
    requests++;
    const response=await server(request);
    response.data.estimate.payable=true;
    return response;
  }});
  await assert.rejects(client.getBudgetEstimate({modelId:'sample-bracket',addressLine:'private'}),{code:'INVALID_BUDGET_INPUT'});
  assert.equal(requests,0);
  await assert.rejects(client.getBudgetEstimate({modelId:'sample-bracket'}),{code:'INVALID_RESPONSE'});
});
