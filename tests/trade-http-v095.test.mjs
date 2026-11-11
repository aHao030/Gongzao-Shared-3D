import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPlatformServer } from '../services/platform/local.mjs';
import { readinessResponse } from '../services/platform/readiness.mjs';

const basePath = '/api/v2/trade';
const fixture = await readFile(new URL('./fixtures/cube-20mm.stl',import.meta.url));

test('hosted readiness stays unavailable until the trade migration exists in D1', async t=>{
  const sqlite = new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  const migration = name=>readFile(new URL('../drizzle/'+name,import.meta.url),'utf8');
  sqlite.exec(await migration('0000_small_the_liberteens.sql'));
  sqlite.exec(await migration('0001_platform_admin_control.sql'));
  const db = {prepare(sql) {
    const statement=sqlite.prepare(sql);
    return {first:async()=>statement.get(),bind:(...args)=>({first:async()=>statement.get(...args)})};
  }};
  const store = {kind:'d1',db,bucket:{head:async()=>null}};
  const control = {intakeStatus:async()=>({paused:false})};
  const check = method=>readinessResponse(new Request('https://test.invalid/ready',{method}),store,control);
  const pending = await check('GET');
  assert.equal(pending.status,503);
  assert.deepEqual(await pending.json(),{ready:false});
  sqlite.exec(await migration('0002_trade_conversations.sql'));
  const ready = await check('GET');
  assert.equal(ready.status,200);
  assert.deepEqual(await ready.json(),{ready:true});
  sqlite.exec('DROP TABLE platform_trade_threads');
  const partial = await check('HEAD');
  assert.equal(partial.status,503);
  assert.equal(await partial.text(),'');
});

async function service(t) {
  const dir = await mkdtemp(path.join(tmpdir(),'gongzao-trade-'));
  let instance, origin;
  async function start() {
    instance = createPlatformServer({dbPath:path.join(dir,'db.sqlite'),authConfig:{},integrationConfig:{}});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
    origin = 'http://127.0.0.1:'+instance.server.address().port;
  }
  async function stop() {
    if (!instance) return;
    await new Promise(resolve=>instance.server.close(resolve));
    instance.store.close();
    instance = null;
  }
  await start();
  t.after(async()=>{ await stop(); await rm(dir,{recursive:true,force:true}); });
  function call(subject, pathname, data, extras = {}) {
    const headers = new Headers(extras);
    if (subject?.cookie) headers.set('Cookie',subject.cookie);
    if (!headers.has('X-Gongzao-Workspace') && subject?.scope) headers.set('X-Gongzao-Workspace',subject.scope);
    if (data !== undefined) {
      if (!headers.has('Idempotency-Key')) headers.set('Idempotency-Key',randomUUID());
      headers.set('Content-Type','application/json');
    }
    return fetch(origin+pathname, {method:data === undefined ? 'GET':'POST',headers,body:data === undefined ? undefined : JSON.stringify(data)});
  }
  async function ok(subject, pathname, body, extras) {
    const response = await call(subject,pathname,body,extras);
    const result = await response.json();
    assert.ok(response.ok,JSON.stringify(result));
    return result;
  }
  async function register() {
    const response = await call(null,'/api/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()});
    assert.equal(response.status,201);
    const {user} = await response.json();
    const subject = {id:user.id,cookie:response.headers.getSetCookie().find(val=>val.startsWith('coforge_account=')).split(';')[0]};
    const session = await ok(subject,'/api/v2/session');
    subject.scope = session.workspaceContext;
    return subject;
  }
  async function upload(subject) {
    const response = await fetch(origin+'/api/v2/models',{method:'POST',headers:{Cookie:subject.cookie,'X-Gongzao-Workspace':subject.scope,
      'Content-Type':'application/octet-stream','X-File-Name':'trade-cube.stl','Idempotency-Key':randomUUID()},body:fixture});
    const result = await response.json();
    assert.equal(response.status,201,JSON.stringify(result));
    return result.model;
  }
  async function enroll(subject,name) {
    await ok(subject,'/api/v2/merchant/enroll',{name});
    await ok(subject,basePath+'/shop',{enabled:true});
    const {shop} = await ok(subject,basePath+'/shop');
    assert.ok(shop?.id);
    return shop;
  }
  return {call,ok,register,enroll,upload,restart:async()=>{await stop();await start();}};
}

test('two accounts discuss their model, retry without duplication, revise a CNY offer and confirm its exact version', async t=>{
  const h=await service(t), buyer=await h.register(), seller=await h.register();
  const shop=await h.enroll(seller,'试制工坊'), model=await h.upload(buyer);
  const directory=await h.ok(buyer,basePath+'/shops');
  assert.ok(directory.shops.some(entry=>entry.id===shop.id && entry.name==='试制工坊'));
  assert.ok(!JSON.stringify(directory).includes(seller.id));
  const open={shopId:shop.id,modelId:model.id,quantity:3,material:'PLA',quality:'standard',unit:'mm',shareFile:false,body:'这三个零件要配合安装。'};
  const openKey={'Idempotency-Key':randomUUID()};
  const {threadId}=await h.ok(buyer,basePath+'/threads',open,openKey);
  assert.equal((await h.ok(buyer,basePath+'/threads',open,openKey)).threadId,threadId);
  const threadUrl=basePath+'/threads/'+threadId;
  const before=await h.ok(seller,threadUrl);
  assert.equal(before.thread.role,'merchant');
  assert.equal(before.thread.quantity,3);
  assert.equal(before.thread.estimate.status,'ESTIMATED');
  assert.ok(before.thread.estimate.highCents >= before.thread.estimate.lowCents);
  assert.equal(before.thread.model.shared,false);
  assert.equal((await h.ok(seller,basePath+'/threads?role=merchant')).threads.length,1);
  assert.equal((await h.ok(seller,basePath+'/threads?role=buyer')).threads.length,0);
  await h.ok(seller,threadUrl+'/read',{through:before.thread.lastSeq});
  const noteKey={'Idempotency-Key':randomUUID()}, note={body:'可以做，请确认外形尺寸。'};
  await h.ok(seller,threadUrl+'/messages',note,noteKey);
  await h.ok(seller,threadUrl+'/messages',note,noteKey);
  assert.equal((await h.call(seller,threadUrl+'/messages',{body:'另一条消息'},noteKey)).status,409);
  const first={amountCents:12500,leadDays:5,terms:'3 件，标准后处理',shippingIncluded:false,expectedVersion:0};
  await h.ok(seller,threadUrl+'/offers',first);
  await h.ok(seller,threadUrl+'/offers',{...first,amountCents:12000,expectedVersion:1});
  assert.equal((await h.call(buyer,threadUrl+'/accept',{version:1})).status,409);
  await h.ok(buyer,threadUrl+'/accept',{version:2});
  await h.restart();
  const final=await h.ok(buyer,threadUrl);
  assert.equal(final.thread.offer.amountCents,12000);
  assert.equal(final.thread.offer.version,2);
  assert.equal(final.thread.offer.accepted,true);
  assert.equal(final.messages.filter(msg=>msg.body===note.body).length,1);
  assert.deepEqual(final.thread.estimate,before.thread.estimate);
  assert.equal((await h.ok(buyer,'/api/v2/workspace')).workspace.orders.length,0);
});

test('thread and file grants distinguish metadata sharing, selected merchant, other shops, account context, and hidden shops',async t=>{
  const h=await service(t), buyer=await h.register(), seller=await h.register(), other=await h.register();
  const shop=await h.enroll(seller,'定向询价测试店');await h.enroll(other,'其他测试店');
  const model=await h.upload(buyer), open={shopId:shop.id,modelId:model.id,quantity:1,material:'PLA',quality:'standard',unit:'mm',shareFile:false,body:'请估价'};
  assert.equal((await h.call(null,basePath+'/threads')).status,401);
  assert.equal((await h.call(buyer,basePath+'/shop',{enabled:true})).status,403);
  const wrongScope=await h.call(buyer,basePath+'/threads',open,{'X-Gongzao-Workspace':seller.scope});
  assert.equal((await wrongScope.json()).error.code,'WORKSPACE_CHANGED');
  assert.equal((await h.call(buyer,basePath+'/threads',open,{Origin:'https://unrelated.example'})).status,403);
  const missingPin=await h.call({cookie:buyer.cookie},basePath+'/threads',open);
  assert.equal(missingPin.status,409);
  const preview={shopId:shop.id,modelId:model.id,material:'PLA',quality:'standard',qty:1,unit:'mm'};
  const budgetPath='/api/v2/budget-estimate';
  assert.equal((await h.call(null,budgetPath,preview)).status,401);
  assert.equal((await h.call({cookie:buyer.cookie},budgetPath,preview)).status,409);
  assert.equal((await h.call(seller,budgetPath,preview)).status,409);
  assert.equal((await h.call(other,budgetPath,preview)).status,404);
  assert.equal((await h.call(buyer,budgetPath,{...preview,shopId:'bad ID'})).status,400);
  assert.equal((await h.call(buyer,budgetPath,{...preview,shopId:'shop_'+randomUUID()})).status,404);
  assert.equal((await h.call(buyer,budgetPath,{...preview,price:1})).status,400);
  const {estimate:shopBudget}=await h.ok(buyer,budgetPath,preview);
  assert.equal((await h.ok(buyer,basePath+'/threads')).threads.length,0);
  assert.equal((await h.call(other,basePath+'/threads',open)).status,404);
  const summary=await h.ok(buyer,basePath+'/threads',open);
  const {thread:created}=await h.ok(buyer,basePath+'/threads/'+summary.threadId);
  assert.equal(created.estimate.lowCents,shopBudget.lowCents);
  assert.equal(created.estimate.highCents,shopBudget.highCents);
  assert.ok([403,404].includes((await h.call(seller,basePath+'/threads/'+summary.threadId+'/file')).status));
  const sent=await h.ok(buyer,basePath+'/threads',{...open,shareFile:true});
  const threadUrl=basePath+'/threads/'+sent.threadId;
  for (const route of [threadUrl,threadUrl+'/file']) {
    assert.equal((await h.call({cookie:seller.cookie},route)).status,409);
    assert.equal((await h.call(seller,route,undefined,{'X-Gongzao-Workspace':buyer.scope})).status,409);
  }
  const file=await h.call(seller,threadUrl+'/file');
  assert.equal(file.status,200);
  assert.match(file.headers.get('content-type'),/octet-stream/);
  assert.match(file.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),fixture);
  const shareRevision=(await h.ok(buyer,threadUrl)).thread.model.shareRevision;
  const revoke={shared:false,expectedRevision:shareRevision};
  assert.equal((await h.call(seller,threadUrl+'/sharing',revoke)).status,403);
  assert.equal((await h.call(other,threadUrl+'/sharing',revoke)).status,404);
  const revokeKey={'Idempotency-Key':randomUUID()};
  await h.ok(buyer,threadUrl+'/sharing',revoke,revokeKey);
  await h.ok(buyer,threadUrl+'/sharing',revoke,revokeKey);
  assert.equal((await h.call(seller,threadUrl+'/file')).status,403);
  assert.equal((await h.call(buyer,threadUrl+'/sharing',{shared:true,expectedRevision:shareRevision})).status,409);
  const revoked=(await h.ok(buyer,threadUrl)).thread.model;
  assert.equal(revoked.shared,false);
  await h.ok(buyer,threadUrl+'/sharing',{shared:true,expectedRevision:revoked.shareRevision});
  assert.equal((await h.call(seller,threadUrl+'/file')).status,200);
  for (const endpoint of [threadUrl,threadUrl+'/file','/api/v2/models/'+model.id+'/download']) {
    assert.ok([403,404].includes((await h.call(other,endpoint)).status));
  }
  assert.ok([403,404].includes((await h.call(other,threadUrl+'/messages',{body:'转发'})).status));
  assert.ok([403,404].includes((await h.call(buyer,threadUrl+'/offers',{amountCents:10,leadDays:1,terms:'修改自己的方案',shippingIncluded:false,expectedVersion:0})).status));
  await h.ok(seller,basePath+'/shop',{enabled:false,expectedRevision:shop.revision});
  assert.equal((await h.call(buyer,budgetPath,preview)).status,404);
  assert.ok(!(await h.ok(buyer,basePath+'/shops')).shops.some(entry=>entry.id===shop.id));
  assert.ok([403,404,409].includes((await h.call(buyer,basePath+'/threads',open)).status));
  assert.equal((await h.ok(seller,threadUrl)).thread.role,'merchant');
});

test('model budget is read-only before a delivery address exists and rejects client price inputs',async t=>{
  const h=await service(t), buyer=await h.register();
  const model=await h.upload(buyer);
  const inputs={modelId:model.id,qty:2,unit:'mm',material:'PLA',quality:'standard'};
  const before=(await h.ok(buyer,'/api/v2/workspace')).workspace;
  const {estimate}=await h.ok(buyer,'/api/v2/budget-estimate',inputs);
  assert.equal(estimate.status,'ESTIMATED');
  assert.equal(estimate.currency,'CNY');
  assert.equal(estimate.qty,2);
  assert.equal(estimate.shippingCents,null);
  assert.equal(estimate.taxCents,null);
  assert.equal((await h.call(buyer,'/api/v2/budget-estimate',{...inputs,lowCents:1})).status,400);
  const after=(await h.ok(buyer,'/api/v2/workspace')).workspace;
  assert.deepEqual(after,before);
});
