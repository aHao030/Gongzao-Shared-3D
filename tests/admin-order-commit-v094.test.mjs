import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { D1Store } from '../services/platform/store-d1.mjs';
import { createAdminControl } from '../services/platform/admin-control.mjs';
import { handleApi } from '../services/platform/http.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

async function createStore(t, kind, migrate = true) {
  if (kind === 'sqlite') {
    const store = new SQLiteStore(':memory:');
    t.after(() => store.close());
    return store;
  }
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const name of ['0000_small_the_liberteens', ...(migrate ? ['0001_platform_admin_control'] : [])]) {
    sqlite.exec(await readFile(new URL('../drizzle/' + name + '.sql', import.meta.url), 'utf8'));
  }
  const db = {
    withSession(consistency) { assert.equal(consistency, 'first-primary'); return this; },
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const bound = args => ({
        bind: (...values) => bound(values),
        first: async () => stmt.get(...args) ?? null,
        run: async () => ({ meta: { changes: stmt.run(...args).changes } })
      });
      return bound([]);
    }
  };
  return new D1Store(db, {});
}
function request(store, control, path, body, id) {
  return handleApi(new Request('http://local.test/api/v2/' + path, {
    method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':id}, body:JSON.stringify(body)
  }), {store,ownerId:'buyer',adminControl:control});
}
function pauseAtCommit(store) {
  let arrived, resume;
  const waiting = new Promise(resolve => { arrived = resolve; });
  const barrier = new Promise(resolve => { resume = resolve; });
  const wrapped = Object.create(store);
  let first=true;
  wrapped.transact = (owner, operation, file, options) => store.transact(owner, async workspace => {
    const outcome = await operation(workspace);
    if (first) {
      first = false;
      arrived();
      await barrier;
    }
    return outcome;
  }, file, options);
  return { wrapped, waiting, resume };
}

for (const kind of ['sqlite','d1']) {
  test(kind + ' atomically refuses an already-priced order when the pause commits first, then accepts the same key after resume', async t => {
    const store=await createStore(t,kind), control=createAdminControl({store,bootstrapOwnerId:'admin'});
    assert.equal((await request(store,control,'customer/profile',customerProfileFixture(),'buyer-address')).status,200);
    const prices=await (await request(store,control,'quotes',{},'buyer-quote')).json();
    const payload={quoteId:prices.quotes[0].quoteId,demoAcknowledged:true};
    const { wrapped,waiting,resume }=pauseAtCommit(store);
    const pending=request(wrapped,control,'orders',payload,'order-once');
    await waiting;
    await control.execute('admin',{action:'intake.set',paused:true,reason:'例行维护',requestId:'pause-atomic',expectedRevision:0});
    resume();
    const blocked=await pending; assert.equal(blocked.status,503);
    assert.equal((await blocked.json()).error.code,'ORDER_INTAKE_PAUSED');
    const after=await store.load('buyer');
    assert.equal(after.orders.length,0); assert.equal(Object.hasOwn(after.idempotency,'order-once'),false);
    // An empty legacy user workspace uses the INSERT branch of the same guard.
    await assert.rejects(store.transact('empty-owner', prior=>({workspace:{...prior,revision:1}}), null, {requireOpenIntake:true}), {code:'ORDER_INTAKE_PAUSED'});
    await control.execute('admin',{action:'intake.set',paused:false,requestId:'resume-atomic',expectedRevision:1});
    assert.equal((await request(store,control,'orders',payload,'order-once')).status,201);
    assert.equal((await store.load('buyer')).orders.length,1);
  });
  test(kind + ' replays an order that already won the race even if intake paused before the second attempt committed', async t => {
    const store=await createStore(t,kind), control=createAdminControl({store,bootstrapOwnerId:'admin'});
    await request(store,control,'customer/profile',customerProfileFixture(),'buyer-address');
    const prices=await (await request(store,control,'quotes',{},'buyer-quote')).json();
    const payload={quoteId:prices.quotes[0].quoteId,demoAcknowledged:true};
    const { wrapped,waiting,resume }=pauseAtCommit(store);
    const pending=request(wrapped,control,'orders',payload,'duplicate-order');
    await waiting;
    const winner=await request(store,control,'orders',payload,'duplicate-order');
    assert.equal(winner.status,201);
    await control.execute('admin',{action:'intake.set',paused:true,reason:'量具校验',requestId:'pause-after',expectedRevision:0});
    resume();
    const replay=await pending;assert.equal(replay.status,201);
    const data=await replay.json();assert.equal(data.replayed,true);assert.equal(data.order.id,(await winner.json()).order.id);
    assert.equal((await store.load('buyer')).orders.length,1);
  });
}

test('a hosted database missing its control migration serves old data, withholds new checkout, and never inserts a phantom receipt', async t => {
  const store=await createStore(t,'d1',false), control=createAdminControl({store,bootstrapOwnerId:'admin'});
  await request(store,control,'customer/profile',customerProfileFixture(),'buyer-address');
  const prices=await (await request(store,control,'quotes',{},'buyer-quote')).json();
  const payload={quoteId:prices.quotes[0].quoteId,demoAcknowledged:true};
  const error=await request(store,control,'orders',payload,'blocked-order');
  assert.equal(error.status,503);assert.equal((await error.json()).error.code,'ORDER_INTAKE_UNAVAILABLE');
  assert.equal((await store.load('buyer')).orders.length,0);
  // Historic callers that do not supply the admin/checkout feature continue
  // to use the original table contract. Production HTTP always supplies it.
  assert.equal((await request(store,undefined,'orders',payload,'historic-order')).status,201);
  const replay=await request(store,control,'orders',payload,'historic-order');
  assert.equal(replay.status,201);assert.equal((await replay.json()).replayed,true);
});
