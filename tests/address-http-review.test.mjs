import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';

// Independent loopback HTTP + SQLite review. All addresses are synthetic fixtures.
// No external address provider, payment provider, real printer or hosted edge is used.
const profilePath = '/api/v2/customer/profile';
const quotePath = '/api/v2/quotes';
const configuration = { modelId: 'sample-bracket', material: 'PLA', quality: 'standard', qty: 1, unit: 'mm' };
const fixture = (shipping = {}, profile = {}) => ({
  displayName: 'HTTP 评审用户', setupCompleted: true,
  shippingAddress: { recipient: '测试收件人', phone: '+86 13800000000', countryCode: 'CN', province: '浙江省', city: '杭州市', district: '西湖区', addressLine: '仅用于测试的示例路1号', postalCode: '', ...shipping },
  ...profile
});

async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gongzao-address-review-'));
  const dbPath = path.join(directory, 'test.sqlite');
  let instance, base;
  async function start() {
    instance = createPlatformServer({ dbPath });
    await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${instance.server.address().port}`;
  }
  async function stop() {
    if (!instance) return;
    await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    instance.store.close(); instance = null;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(route, { cookie, body, key = randomUUID(), headers = {} } = {}) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, data: JSON.parse(text) };
  }
  async function session() {
    const response = await request('/api/v2/session');
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], owner: response.data.user.id };
  }
  const get = (user, route) => request(route, { cookie: user.cookie });
  const post = (user, route, body, key) => request(route, { cookie: user.cookie, body, key });
  async function save(user, body = fixture(), key) {
    const result = await post(user, profilePath, body, key);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result;
  }
  async function quotes(user, body = configuration) {
    const result = await post(user, quotePath, body);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.quotes;
  }
  return { request, session, get, post, save, quotes, restart: async () => { await stop(); await start(); } };
}

test('address HTTP review: missing or skipped address never receives a default-region quote', async t => {
  const h = await harness(t), user = await h.session();
  assert.equal((await h.get(user, profilePath)).data.profile, null);
  const first = await h.post(user, quotePath, { ...configuration, destination: 'east' });
  assert.equal(first.status, 409); assert.equal(first.data.error.code, 'ADDRESS_REQUIRED');
  await h.save(user, fixture({}, { shippingAddress: null }));
  await h.restart();
  const skipped = (await h.get(user, profilePath)).data.profile;
  assert.equal(skipped.setupCompleted, true); assert.equal(skipped.shippingAddress, null); assert.equal(skipped.destination, null);
  const second = await h.post(user, quotePath, configuration);
  assert.equal(second.status, 409); assert.equal(second.data.error.code, 'ADDRESS_REQUIRED');
  assert.equal((await h.get(user, '/api/v2/workspace')).data.workspace.orders.length, 0);
});

test('address HTTP review: server derives region and rejects destination overrides', async t => {
  const h = await harness(t), user = await h.session();
  await h.save(user, fixture({ province: '广东', city: '深圳市', district: '南山区' }));
  const profile = (await h.get(user, profilePath)).data.profile;
  assert.equal(profile.shippingAddress.province, '广东省'); assert.equal(profile.destination, 'south');
  const quotes = await h.quotes(user); assert.ok(quotes.every(q => q.destination === 'south'));
  const forged = await h.post(user, quotePath, { ...configuration, destination: 'east' });
  assert.equal(forged.status, 409); assert.equal(forged.data.error.code, 'DESTINATION_MISMATCH');
  await h.save(user, fixture({ countryCode: 'JP', province: '東京都', city: '千代田区', district: '' }));
  const foreignQuotes = await h.quotes(user);
  assert.ok(foreignQuotes.every(q => q.destination === 'other' && q.review && q.reviewReasons.includes('DESTINATION_REVIEW')));
  assert.ok(foreignQuotes.every(q => !('shippingAddress' in q)), 'quote terms contain no full address snapshot');
});

test('address HTTP review: profile writes are idempotent under concurrency without address revision inflation', async t => {
  const h = await harness(t), user = await h.session(), key = randomUUID(), body = fixture();
  const writes = await Promise.all(Array.from({ length: 8 }, () => h.post(user, profilePath, body, key)));
  assert.ok(writes.every(r => r.status === 200));
  assert.ok(writes.every(r => r.data.profile.addressRevision === 1));
  const before = (await h.get(user, '/api/v2/workspace')).data.workspace;
  const conflict = await h.post(user, profilePath, fixture({ addressLine: '变更的测试地址2号' }), key);
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error.code, 'IDEMPOTENCY_CONFLICT');
  const after = (await h.get(user, '/api/v2/workspace')).data.workspace;
  assert.equal(after.revision, before.revision); assert.deepEqual(after.customerProfile, before.customerProfile);
  const renamed = await h.save(user, fixture({ province: '浙江' }, { displayName: '更改显示名称' }));
  assert.equal(renamed.data.profile.addressRevision, 1, 'canonical-equivalent address and name-only edits retain address revision');
});

test('address HTTP review: address changes invalidate pending quotes but preserve created-order delivery snapshots', async t => {
  const h = await harness(t), user = await h.session();
  await h.save(user);
  const [quote, pendingQuote] = await h.quotes(user);
  const orderResult = await h.post(user, '/api/v2/orders', { quoteId: quote.quoteId, demoAcknowledged: true });
  assert.equal(orderResult.status, 201);
  const originalAddress = orderResult.data.order.shippingAddress;
  await h.save(user, fixture({ addressLine: '修改后的测试路2号' }));
  const stale = await h.post(user, '/api/v2/orders', { quoteId: pendingQuote.quoteId, demoAcknowledged: true });
  assert.equal(stale.status, 409); assert.equal(stale.data.error.code, 'ADDRESS_CHANGED');
  const workspace = (await h.get(user, '/api/v2/workspace')).data.workspace;
  assert.deepEqual(workspace.orders[0].shippingAddress, originalAddress);
  assert.notDeepEqual(workspace.customerProfile.shippingAddress, originalAddress);
  const [freshQuote] = await h.quotes(user);
  const fresh = await h.post(user, '/api/v2/orders', { quoteId: freshQuote.quoteId, demoAcknowledged: true, shippingAddress: originalAddress });
  assert.equal(fresh.status, 201); assert.equal(fresh.data.order.shippingAddress.addressLine, '修改后的测试路2号', 'client snapshot cannot replace server address');
});

test('address HTTP review: removing then restoring an address cannot revive an earlier quote', async t => {
  const h = await harness(t), user = await h.session();
  await h.save(user); const [quote] = await h.quotes(user);
  await h.save(user, fixture({}, { shippingAddress: null }));
  const removed = await h.post(user, '/api/v2/orders', { quoteId: quote.quoteId, demoAcknowledged: true });
  assert.equal(removed.status, 409); assert.equal(removed.data.error.code, 'ADDRESS_REQUIRED');
  const restored = await h.save(user);
  assert.equal(restored.data.profile.addressRevision, 3);
  const stale = await h.post(user, '/api/v2/orders', { quoteId: quote.quoteId, demoAcknowledged: true });
  assert.equal(stale.status, 409); assert.equal(stale.data.error.code, 'ADDRESS_CHANGED');
});

test('address HTTP review: owner sessions and cross-origin checks protect full delivery details', async t => {
  const h = await harness(t), a = await h.session(), b = await h.session();
  await h.save(a, fixture({ addressLine: '仅归A用户的测试地址9号' }));
  assert.equal((await h.get(b, profilePath + '?ownerId=' + a.owner)).data.profile, null);
  assert.equal((await h.get(b, '/api/v2/workspace')).data.workspace.customerProfile, null);
  const forged = await h.request(profilePath, { cookie: b.cookie, headers: { 'oai-authenticated-user-id': a.owner } });
  assert.equal(forged.data.profile, null);
  const anonymous = await h.request(profilePath); assert.equal(anonymous.status, 401); assert.ok(!anonymous.text.includes('测试地址'));
  const crossSite = await h.request(profilePath, { cookie: a.cookie, body: fixture({ addressLine: '拒绝的变更' }), headers: { Origin: 'https://foreign.invalid' } });
  assert.equal(crossSite.status, 403); assert.equal((await h.get(a, profilePath)).data.profile.shippingAddress.addressLine, '仅归A用户的测试地址9号');
});

test('address HTTP review: malformed and incomplete profiles reject atomically without echoing private values', async t => {
  const h = await harness(t), user = await h.session();
  const initial = await h.save(user);
  for (const shipping of [{ countryCode: 'China' }, { province: '不存在省' }, { city: '' }, { district: '' }, { addressLine: '私密标记\n注入' }, { phone: '+86+123456' }]) {
    const invalid = await h.post(user, profilePath, fixture(shipping));
    assert.equal(invalid.status, 400); assert.equal(invalid.data.error.code, 'INVALID_ADDRESS');
    assert.ok(!invalid.text.includes('私密标记'));
  }
  assert.deepEqual((await h.get(user, profilePath)).data.profile, initial.data.profile);
});

test('address HTTP review: profile survives SQLite restart and demo reset; stale replay does not overwrite newer saved data', async t => {
  const h = await harness(t), user = await h.session(), firstKey = randomUUID(), firstBody = fixture();
  await h.save(user, firstBody, firstKey);
  const latest = await h.save(user, fixture({ addressLine: '应保留的测试路8号' }));
  const replay = await h.post(user, profilePath, firstBody, firstKey);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.profile.addressRevision, 1, 'idempotency retains original command result');
  assert.equal(replay.data.workspace.customerProfile.addressRevision, 2, 'workspace reports the actual current profile');
  assert.deepEqual((await h.get(user, profilePath)).data.profile, latest.data.profile);
  await h.post(user, '/api/v2/actions', { action: 'reset', confirm: 'RESET_DEMO', demoAcknowledged: true });
  await h.restart();
  assert.deepEqual((await h.get(user, profilePath)).data.profile, latest.data.profile);
});
