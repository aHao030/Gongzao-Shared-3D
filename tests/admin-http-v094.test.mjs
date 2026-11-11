import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';

async function local(t) {
  let service;
  let base;
  let now = Date.now();
  const directory = await mkdtemp(path.join(tmpdir(), 'gongzao-admin-'));
  async function stop() {
    if (!service) return;
    await new Promise(resolve => service.server.close(resolve));
    service.store.close();
    service = null;
  }
  async function start(adminBootstrapOwnerId = null) {
    await stop();
    service = createPlatformServer({
      dbPath: path.join(directory, 'platform.sqlite'), adminBootstrapOwnerId, clock: () => now,
      integrationConfig: {}, authConfig: {}
    });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + service.server.address().port;
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  const request = (url, options = {}) => fetch(base + url, options);
  const read = async (url, cookie, headers = {}) => {
    const response = await request(url, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });
    return { code: response.status, data: await response.json(), headers: response.headers };
  };
  const post = async (url, body, cookie, headers = {}) => {
    const response = await request(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers
    }, body: JSON.stringify(body) });
    return { code: response.status, data: await response.json(), headers: response.headers };
  };
  async function account(label, adopt = false) {
    let guest;
    if (adopt) guest = (await read('/api/v2/session')).headers.getSetCookie()[0].split(';')[0];
    const response = await post('/api/auth/register', { email: label + '@example.test', password: randomUUID(), adoptLegacyWorkspace: adopt }, guest);
    assert.equal(response.code, 201, response.data.error?.code);
    return { id: response.data.user.id, cookie: response.headers.getSetCookie().find(value => value.startsWith('coforge_account=')).split(';')[0] };
  }
  const session = user => read('/api/admin/session', user?.cookie);
  const overview = user => read('/api/admin/overview', user?.cookie);
  const actions = async (user, body, options = {}) => {
    const context = options.context ?? (await session(user)).data.context;
    return post('/api/admin/actions', body, user.cookie, {
      'Idempotency-Key': options.key || randomUUID(), 'X-Gongzao-Admin-Context': context, ...options.headers
    });
  };
  return { start, request, read, post, account, session, overview, actions, advance: delta => { now += delta; } };
}

test('the admin entry has a static login shell, and an adopted guest workspace never confers platform access', async t => {
  const h = await local(t);
  const anon = await h.session();
  assert.equal(anon.data.authenticated, false);
  assert.equal(anon.data.configured, false);
  assert.equal((await h.overview()).code, 401);
  const shell = await h.request('/admin/login', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(shell.status, 200);
  assert.ok((await shell.text()).includes('管理员'));
  const owner = await h.account('owner', true);
  const guestWorkspace = await h.read('/api/v2/session', owner.cookie);
  assert.notEqual(guestWorkspace.data.user.id, owner.id);
  await h.start(guestWorkspace.data.user.id);
  assert.equal((await h.session(owner)).data.authorized, false);
  await h.start(owner.id);
  const adminSession = await h.session(owner);
  assert.equal(adminSession.data.role, 'owner');
  assert.equal(adminSession.data.actorId, owner.id);
  assert.equal(adminSession.headers.get('cache-control'), 'private, no-store');
  const ordinary = await h.account('member');
  assert.equal((await h.session(ordinary)).data.authorized, false);
  assert.equal((await h.read('/api/admin/business', ordinary.cookie)).code, 403);
  const stats = await h.read('/api/admin/business', owner.cookie);
  assert.equal(stats.code, 200);
  assert.ok(Number.isSafeInteger(stats.data.summary.orders));
  await h.post('/api/auth/logout', {}, owner.cookie);
  assert.equal((await h.overview(owner)).code, 401);
});

test('admin actions bind the authenticated tab, operator and auditor permissions, revision, and recipient', async t => {
  const h = await local(t);
  const owner = await h.account('owner');
  const operator = await h.account('operator');
  const auditor = await h.account('auditor');
  await h.start(owner.id);
  const originalContext = (await h.session(owner)).data.context;
  const grant = { action: 'member.grant', subject: operator.id, role: 'operator', expectedRevision: 0 };
  assert.equal((await h.actions(owner, grant, { headers: { Origin: 'https://other.example.test' } })).code, 403);
  assert.equal((await h.actions(owner, { ...grant, subject: 'unregistered-account' })).code, 400);
  assert.equal((await h.actions(owner, grant)).code, 200);
  assert.equal((await h.actions(owner, { ...grant, role: 'auditor', subject: auditor.id })).code, 409);
  assert.equal((await h.actions(owner, { ...grant, role: 'auditor', subject: auditor.id, expectedRevision: 1 })).code, 200);
  const node = { action: 'node.create', name: '渲染工作站', purpose: '计算服务', expectedRevision: 2 };
  assert.equal((await h.actions(operator, node, { context: originalContext })).code, 409);
  assert.equal((await h.read('/api/admin/overview', operator.cookie, { 'X-Gongzao-Admin-Context': originalContext })).code, 409);
  assert.equal((await h.actions(auditor, node)).code, 403);
  assert.equal((await h.read('/api/admin/business', auditor.cookie)).code, 200);
  assert.equal((await h.actions(operator, { action: 'member.revoke', subject: auditor.id, expectedRevision: 2 })).code, 403);
  assert.equal((await h.actions(owner, { action: 'member.revoke', subject: operator.id, expectedRevision: 2 })).code, 200);
  assert.equal((await h.overview(operator)).code, 403);
  assert.equal((await h.overview(auditor)).data.audit.length, 3);
});

test('registered server sends its own heartbeat; replay is public and rotating or revoking takes effect immediately', async t => {
  const h = await local(t);
  const owner = await h.account('owner');
  await h.start(owner.id);
  const key = randomUUID();
  const create = { action: 'node.create', name: '制造算力 01', purpose: '切片', expectedRevision: 0 };
  const created = await h.actions(owner, create, { key });
  assert.equal(created.code, 200);
  const { node, credential } = created.data;
  assert.ok(credential);
  assert.equal(node.status, 'NEVER_CONNECTED');
  const replay = await h.actions(owner, create, { key });
  assert.equal(replay.data.replayed, true);
  assert.equal(Object.hasOwn(replay.data, 'credential'), false);
  const beat = token => h.post('/api/admin/nodes/heartbeat', { agentVersion: '0.9.4' }, undefined,
    token ? { Authorization: 'Bearer ' + token } : {});
  assert.equal((await beat(null)).code, 401);
  assert.equal((await beat(credential)).data.nodeId, node.id);
  const initial = (await h.overview(owner)).data;
  assert.equal(initial.nodes[0].status, 'ONLINE');
  assert.equal(JSON.stringify(initial).includes(credential), false);
  h.advance(90001);
  assert.equal((await h.overview(owner)).data.nodes[0].status, 'OFFLINE');
  const rotate = await h.actions(owner, { action: 'node.rotate', nodeId: node.id, expectedRevision: initial.revision });
  assert.equal(rotate.code, 200);
  assert.equal((await beat(credential)).code, 401);
  assert.equal((await beat(rotate.data.credential)).code, 200);
  assert.equal((await h.actions(owner, { action: 'node.revoke', nodeId: node.id, expectedRevision: rotate.data.revision })).code, 200);
  assert.ok([401, 403].includes((await beat(rotate.data.credential)).code));
});

test('an operations pause blocks new checkout and proposal acceptance but preserves retries and after-sales', async t => {
  const h = await local(t);
  const owner = await h.account('intake-owner'), buyer = await h.account('intake-buyer');
  await h.start(owner.id);
  const purchase = (route, body, key = randomUUID()) => h.post('/api/v2/' + route, body, buyer.cookie, {'Idempotency-Key': key});
  const { customerProfileFixture } = await import('./helpers/customer-fixture.mjs');
  assert.equal((await purchase('customer/profile',customerProfileFixture())).code,200);
  const firstQuotes = await purchase('quotes',{});
  const [first, second] = firstQuotes.data.quotes;
  const payload = { quoteId:first.quoteId, demoAcknowledged:true };
  const original = await purchase('orders',payload,'intake-original-ordered');
  assert.equal(original.code,201);
  const pause = await h.actions(owner,{ action:'intake.set', paused:true, reason:'运维内部记录', expectedRevision:0 });
  assert.equal(pause.code,200);
  const blocked = await purchase('orders',{...payload,quoteId:second.quoteId},'intake-pending-order');
  assert.equal(blocked.code,503);
  assert.equal(blocked.data.error.code,'ORDER_INTAKE_PAUSED');
  assert.ok(!JSON.stringify(blocked.data).includes('运维内部记录'));
  assert.equal((await purchase('inquiries/accept',{demoAcknowledged:true})).data.error.code,'ORDER_INTAKE_PAUSED');
  const replay = await purchase('orders',payload,'intake-original-ordered');
  assert.equal(replay.data.order.id,original.data.order.id);
  assert.equal(replay.data.replayed,true);
  const refund = await purchase('actions',{action:'request-refund',id:original.data.order.id,reason:'客户测试申请',demoAcknowledged:true});
  assert.equal(refund.code,200);
  assert.equal(refund.data.order.refundState,'REQUESTED');
  const resumed = await h.actions(owner,{action:'intake.set',paused:false,expectedRevision:pause.data.revision});
  assert.equal(resumed.code,200);
  assert.equal((await purchase('orders',{...payload,quoteId:second.quoteId},'intake-pending-order')).code,201);
});

test('deployment readiness probes storage without returning account data', async t => {
  const h = await local(t);
  const ready = await h.read('/ready');
  assert.equal(ready.code,200);
  assert.deepEqual(ready.data,{ready:true});
  const {readinessResponse} = await import('../services/platform/readiness.mjs');
  const request = new Request('https://test.invalid/ready');
  const db = {prepare(){return {first:async()=>null};}};
  const unavailable = await readinessResponse(request,{kind:'d1',db,bucket:{head:async()=>{throw new Error('private storage detail');}}},{intakeStatus:async()=>({paused:false})});
  assert.equal(unavailable.status,503);
  assert.deepEqual(await unavailable.json(),{ready:false});
});
