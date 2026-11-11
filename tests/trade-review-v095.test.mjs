import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createPlatformServer } from '../services/platform/local.mjs';
import { createTradeStore, readTradeReadiness } from '../services/platform/trade-store.mjs';
import { D1Store } from '../services/platform/store-d1.mjs';
import { createWorkspace } from '../services/platform/core.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

const cube = await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url));
const fixedNow = Date.UTC(2026, 10, 11, 3);
const tradeApi = '/api/v2/trade';

function expectOK(result) {
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data?.error));
  return result.data;
}

async function livePlatform(t) {
  const app = createPlatformServer({ dbPath:':memory:', integrationConfig:{}, authConfig:{}, clock:() => fixedNow });
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    app.store.close();
  });
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  async function call(user, path, body, key = randomUUID()) {
    const headers = { ...(user?.cookie && { Cookie:user.cookie }) };
    if (user?.context) headers['X-Gongzao-Workspace'] = user.context;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = key;
    }
    const response = await fetch(origin + path, { method:body === undefined ? 'GET' : 'POST', headers, body:body === undefined ? undefined : JSON.stringify(body) });
    const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return {status:response.status, data, headers:response.headers};
  }
  async function account(adopt = false) {
    const guest = adopt ? (await call(null,'/api/v2/session')).headers.getSetCookie()[0].split(';')[0] : undefined;
    const registration = await call({cookie:guest},'/api/auth/register',{ email:randomUUID()+'@example.test', password:randomUUID(), adoptLegacyWorkspace:adopt });
    expectOK(registration);
    const cookie = registration.headers.getSetCookie().find(value => value.startsWith('coforge_account=')).split(';')[0];
    const session = expectOK(await call({cookie},'/api/v2/session'));
    return {cookie, context:session.workspaceContext};
  }
  async function publish(user, name) {
    expectOK(await call(user,'/api/v2/merchant/enroll',{name}));
    return expectOK(await call(user,tradeApi+'/shop',{enabled:true}));
  }
  async function upload(user) {
    const r = await fetch(origin + '/api/v2/models', { method:'POST',headers:{Cookie:user.cookie,'X-Gongzao-Workspace':user.context,
      'Content-Type':'application/octet-stream','Idempotency-Key':randomUUID(),'X-File-Name':'review-cube.stl'},body:cube });
    assert.equal(r.status,201);
    return (await r.json()).model;
  }
  return {account,call,publish,upload};
}

async function setProfitFloor(h, seller, minimumOrderProfitCents) {
  const endpoint = '/api/v2/merchant/pricing';
  const { profiles } = expectOK(await h.call(seller, endpoint));
  const { farmId, farmName, revision, updatedAt, mode, ...profile } = profiles[0];
  expectOK(await h.call(seller, endpoint, { farmId, expectedRevision:revision,
    profile:{...profile,minimumOrderProfitCents}, demoAcknowledged:true }));
}

test('a buyer compares two independent shops without sharing the other grant, address, rates or later price changes', async t => {
  const h = await livePlatform(t);
  const buyer = await h.account(true);
  const [sellerA,sellerB] = await Promise.all([h.account(),h.account()]);
  const [{shop:shopA},{shop:shopB}] = await Promise.all([h.publish(sellerA,'评审甲店'),h.publish(sellerB,'评审乙店')]);
  const model = await h.upload(buyer);
  const budgetInput = {modelId:model.id,qty:3,unit:'mm',material:'PLA',quality:'standard'};
  const {estimate:reference} = expectOK(await h.call(buyer,'/api/v2/budget-estimate',budgetInput));
  assert.equal(reference.source,'PLATFORM_REFERENCE');
  assert.equal(reference.status,'ESTIMATED');
  assert.equal(reference.payable,false);
  assert.equal(reference.shippingCents,null);
  assert.equal(reference.taxCents,null);
  assert.equal(reference.unitLowCents,Math.round(reference.lowCents/reference.qty));

  const privateMarker = '私有地址信息-仅客户可见';
  expectOK(await h.call(buyer,'/api/v2/customer/profile',customerProfileFixture({shippingAddress:{addressLine:privateMarker}})));
  await setProfitFloor(h,sellerA,30000);
  const input = {modelId:model.id,quantity:3,unit:'mm',material:'PLA',quality:'standard',body:'请按三件整单估算。'};
  const open = (shop,shareFile) => h.call(buyer,tradeApi+'/threads',{...input,shopId:shop.id,shareFile});
  const preview = async shop => expectOK(await h.call(buyer,'/api/v2/budget-estimate',{...budgetInput,shopId:shop.id})).estimate;
  const [previewA,previewB] = await Promise.all([preview(shopA),preview(shopB)]);
  const [first,second] = await Promise.all([open(shopA,true),open(shopB,false)]);
  const a = tradeApi+'/threads/'+expectOK(first).threadId;
  const b = tradeApi+'/threads/'+expectOK(second).threadId;
  const [detailA,detailB] = await Promise.all([h.call(sellerA,a),h.call(sellerB,b)]);
  const threadA = expectOK(detailA).thread, threadB = expectOK(detailB).thread;
  // The preview selects the same shop, currency, inclusions, material and
  // plate pricing as the immutable opening snapshot. The fixture clock is fixed.
  assert.deepEqual(previewA,threadA.estimate);
  assert.deepEqual(previewB,threadB.estimate);
  assert.equal(threadA.estimate.source,'SHOP_CONFIG');
  assert.equal(threadB.estimate.source,'PLATFORM_REFERENCE');
  assert.equal(threadB.estimate.highCents,reference.highCents);
  assert.ok(threadA.estimate.lowCents > threadB.estimate.highCents);
  for (const {data} of [detailA,detailB]) {
    const json = JSON.stringify(data);
    assert.ok(!json.includes(privateMarker));
    assert.doesNotMatch(json,/"(pricingProfiles|minimumOrderProfitCents|targetMarginBps|costBreakdown|buyer_owner|merchant_id)"\s*:/);
  }
  assert.deepEqual(expectOK(await h.call(sellerA,a+'/file')),cube);
  assert.equal((await h.call(sellerB,b+'/file')).status,403);
  assert.equal((await h.call(sellerB,a+'/file')).status,404);
  assert.equal((await h.call(sellerA,b)).status,404);
  const revokeKey = randomUUID();
  const revoke = {shared:false,expectedRevision:threadA.model.shareRevision};
  expectOK(await h.call(buyer,a+'/sharing',revoke,revokeKey));
  assert.equal(expectOK(await h.call(buyer,a+'/sharing',revoke,revokeKey)).replayed,true);
  assert.equal((await h.call(sellerA,a+'/file')).status,403);
  assert.equal((await h.call(buyer,a+'/sharing',{...revoke,shared:true})).status,409);
  const revoked = expectOK(await h.call(buyer,a)).thread.model;
  assert.equal(revoked.shared,false);
  assert.equal((await h.call(sellerA,a+'/sharing',{shared:true,expectedRevision:revoked.shareRevision})).status,403);
  expectOK(await h.call(buyer,a+'/sharing',{shared:true,expectedRevision:revoked.shareRevision}));
  assert.deepEqual(expectOK(await h.call(sellerA,a+'/file')),cube);
  assert.equal((await h.call(sellerB,b+'/file')).status,403);
  for (const [seller,thread] of [[sellerA,threadA],[sellerB,threadB]]) {
    const {threads} = expectOK(await h.call(seller,tradeApi+'/threads?role=merchant'));
    assert.deepEqual(threads.map(item => item.id),[thread.id]);
  }

  // Two shops can submit the same client key in their own conversations.
  const key = randomUUID();
  const replies = [[sellerA,a,'甲店专属回复'],[sellerB,b,'乙店专属回复']];
  for (const [seller,url,body] of replies) {
    const [original,retry] = await Promise.all([h.call(seller,url+'/messages',{body},key),h.call(seller,url+'/messages',{body},key)]);
    assert.equal(expectOK(original).seq,expectOK(retry).seq);
  }
  for (const [index,[,url,body]] of replies.entries()) {
    const {messages} = expectOK(await h.call(buyer,url));
    assert.equal(messages.filter(m => m.body===body).length,1);
    assert.ok(messages.every(m => m.body!==replies[1-index][2]));
  }
  await setProfitFloor(h,sellerA,50000);
  const freshPreview = await preview(shopA);
  const later = tradeApi+'/threads/'+expectOK(await open(shopA,true)).threadId;
  const revised = expectOK(await h.call(buyer,later)).thread.estimate;
  assert.deepEqual(revised,freshPreview);
  assert.ok(revised.lowCents > threadA.estimate.lowCents);
  assert.deepEqual(expectOK(await h.call(buyer,a)).thread.estimate,threadA.estimate);
  expectOK(await h.call(sellerA,tradeApi+'/shop',{enabled:false,expectedRevision:shopA.revision}));
  assert.equal((await h.call(buyer,'/api/v2/budget-estimate',{...budgetInput,shopId:shopA.id})).status,404);
  assert.deepEqual(expectOK(await h.call(buyer,a)).thread.estimate,threadA.estimate);
});

test('simultaneous buyer confirmation and merchant repricing commit one outcome and leave order/device state untouched', async t => {
  const h = await livePlatform(t);
  const [buyer,seller] = await Promise.all([h.account(),h.account()]);
  const {shop} = await h.publish(seller,'评审并发店');
  const model = await h.upload(buyer);
  const {threadId} = expectOK(await h.call(buyer,tradeApi+'/threads',{shopId:shop.id,modelId:model.id,quantity:2,
    unit:'mm',shareFile:false,body:'两件，请确认。'}));
  const url = tradeApi+'/threads/'+threadId;
  const initial = {amountCents:12000,leadDays:4,terms:'两件，基础打磨',expectedVersion:0,shippingIncluded:false};
  expectOK(await h.call(seller,url+'/offers',initial));
  const workspaces = async () => Promise.all([buyer,seller].map(async actor => expectOK(await h.call(actor,'/api/v2/workspace')).workspace));
  const before = await workspaces();
  const acceptKey = randomUUID();
  const [change,accept] = await Promise.all([
    h.call(seller,url+'/offers',{...initial,amountCents:15000,expectedVersion:1}),
    h.call(buyer,url+'/accept',{version:1},acceptKey)
  ]);
  assert.deepEqual([change.status,accept.status].sort((a,b)=>a-b),[200,409]);
  let version,amountCents;
  if (change.status===200) {
    version=2;amountCents=15000;
    assert.equal(accept.data.error.code,'TRADE_OFFER_CHANGED');
    assert.equal((await h.call(buyer,url+'/accept',{version:1})).status,409);
    expectOK(await h.call(buyer,url+'/accept',{version},randomUUID()));
  } else {
    version=1;amountCents=12000;
    assert.equal(change.data.error.code,'TRADE_OFFER_ACCEPTED');
    assert.equal(expectOK(await h.call(buyer,url+'/accept',{version},acceptKey)).replayed,true);
  }
  const {thread,messages} = expectOK(await h.call(buyer,url));
  assert.equal(thread.offer.accepted,true);
  assert.equal(thread.offer.version,version);
  assert.equal(thread.offer.amountCents,amountCents);
  assert.equal(messages.filter(message => message.kind==='accepted').length,1);
  assert.deepEqual(await workspaces(),before);
});

// Execute the deployment migrations and prepared SQL with a D1-shaped local
// adapter. A held SELECT reproduces a late read acknowledgement deterministically.
async function d1Contract(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const file of ['0000_small_the_liberteens','0001_platform_admin_control','0002_trade_conversations']) {
    sqlite.exec(await readFile(new URL('../drizzle/'+file+'.sql',import.meta.url),'utf8'));
  }
  let heldRead = null, staleWrites = 0, primarySessions = 0;
  const adapter = {
    withSession(policy) {
      assert.equal(policy,'first-primary');
      primarySessions++;
      return this;
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {bind:(...args) => ({
        async first() {
          const row = statement.get(...args) ?? null;
          if (heldRead && sql.startsWith('SELECT * FROM platform_trade_threads WHERE id=')) {
            const saved = heldRead;
            heldRead = null;
            saved.seen.resolve();
            await saved.release.promise;
          }
          return row;
        },
        async all() {return {results:statement.all(...args)};},
        async run() {
          const {changes} = statement.run(...args);
          if (!changes && sql.startsWith('UPDATE platform_trade_threads SET buyer_read=')) staleWrites++;
          return {meta:{changes}};
        }
      })};
    }
  };
  const store = new D1Store(adapter, null);
  return {
    store,
    session:() => createTradeStore({store,clock:() => fixedNow}),
    holdNextThreadRead() {
      assert.equal(heldRead,null);
      const seen = Promise.withResolvers(), release = Promise.withResolvers();
      heldRead={seen,release};
      return {seen:seen.promise,release:release.resolve};
    },
    getStaleWrites:() => staleWrites,
    getPrimarySessions:() => primarySessions
  };
}

test('D1 migration contract paginates tied clocks and preserves new unread messages when an older acknowledgement retries', {timeout:15000}, async t => {
  const h = await d1Contract(t);
  const buyer = {id:'test-account-buyer',ownerId:'test-owner-buyer'};
  const seller = {id:'test-account-seller',ownerId:'test-owner-seller'};
  await h.store.transact(seller.ownerId, previous => {
    const workspace = {...previous,revision:previous.revision+1,merchant:{profile:{name:'分页复核店'}}};
    return {workspace,result:{},replayed:false};
  });
  const trade = h.session();
  await readTradeReadiness(h.store);
  const {shop} = await trade.publish(seller,{enabled:true},randomUUID());
  const modelId = createWorkspace().models[0].id;
  const opened = new Set();
  for (let i=0;i<27;i++) {
    const {threadId} = await trade.open(buyer,{shopId:shop.id,modelId,quantity:1,unit:'mm',shareFile:false,body:'同一时间的询盘 '+i},randomUUID());
    opened.add(threadId);
  }
  const firstPage = await trade.inbox(seller,{role:'merchant'});
  assert.ok(firstPage.nextBefore);
  const resumed = h.session();
  const lastPage = await resumed.inbox(seller,{role:'merchant',before:firstPage.nextBefore});
  assert.equal(lastPage.nextBefore,null);
  const ids = [...firstPage.threads,...lastPage.threads].map(item => item.id);
  assert.equal(ids.length,opened.size);
  assert.deepEqual(new Set(ids),opened);
  assert.ok([...firstPage.threads,...lastPage.threads].every(thread => thread.updatedAt===fixedNow));

  const id=ids[0];
  await trade.send(seller,id,{body:'预计四天发货。'},randomUUID());
  const barrier = h.holdNextThreadRead();
  const marking = trade.read(buyer,id,{through:2});
  await barrier.seen;
  try {
    await resumed.send(seller,id,{body:'新到消息，请确认。'},randomUUID());
  } finally {barrier.release();}
  assert.equal((await marking).unread,1);
  assert.ok(h.getStaleWrites()>0,'The delayed acknowledgement exercised the CAS retry.');
  assert.equal((await resumed.read(buyer,id,{through:1})).unread,1);
  const {thread,messages} = await resumed.detail(buyer,id,{after:2});
  assert.equal(thread.unread,1);
  assert.deepEqual(messages.map(message => message.body),['新到消息，请确认。']);
  assert.equal((await resumed.read(buyer,id,{through:3})).unread,0);
  assert.ok(h.getPrimarySessions()>=3);
});

test('a customer can still withdraw a shared model after a conversation fills', async t => {
  const h = await livePlatform(t);
  const [buyer,seller] = await Promise.all([h.account(),h.account()]);
  const {shop} = await h.publish(seller,'容量复核店');
  const model = await h.upload(buyer);
  const {threadId} = expectOK(await h.call(buyer,tradeApi+'/threads',{shopId:shop.id,modelId:model.id,quantity:1,
    unit:'mm',shareFile:true,body:'已有原件授权。'}));
  const url = tradeApi+'/threads/'+threadId;
  for (let seq=2;seq<=300;seq++) {
    expectOK(await h.call(seller,url+'/messages',{body:'容量复核 '+seq}));
  }
  const full = await h.call(seller,url+'/messages',{body:'普通留言已达到上限。'});
  assert.equal(full.status,409);
  assert.equal(full.data.error.code,'TRADE_THREAD_CAPACITY');
  const revoke = {shared:false,expectedRevision:0}, key=randomUUID();
  const stopped = expectOK(await h.call(buyer,url+'/sharing',revoke,key));
  assert.equal(stopped.seq,301);
  assert.equal(expectOK(await h.call(buyer,url+'/sharing',revoke,key)).replayed,true);
  assert.equal((await h.call(seller,url+'/file')).status,403);
  const latest = expectOK(await h.call(buyer,url)).thread.model;
  assert.equal(latest.shared,false);
  assert.equal((await h.call(buyer,url+'/sharing',{shared:true,expectedRevision:latest.shareRevision})).status,409);
});
