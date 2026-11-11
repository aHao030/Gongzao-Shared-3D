import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Independent real loopback HTTP + SQLite review. Synthetic addresses only;
// no carrier, payment provider, exchange-rate provider or overseas delivery is tested.
const profilePath = '/api/v2/customer/profile';
const config = { modelId: 'sample-bracket', material: 'PLA', quality: 'standard', qty: 1, unit: 'mm' };
const address = (countryCode, fields = {}) => ({
  recipient: 'International QA', phone: '+65 8123 4567', countryCode,
  province: '', city: '', district: '', addressLine: 'Synthetic Test Street 1', postalCode: '', ...fields
});
const profile = shippingAddress => ({ displayName: 'International QA', setupCompleted: true, shippingAddress });
const good = {
  SG: address('SG', { postalCode: '018956' }),
  HK: address('HK', { province: 'Hong Kong Island' }),
  US: address('US', { province: 'California', city: 'San Francisco', postalCode: '94105-1234' }),
  JP: address('JP', { province: '東京都', addressLine: 'Synthetic 千代田区テスト町1号', postalCode: '100-0001' })
};
function ok(r) { assert.ok([200, 201].includes(r.status), JSON.stringify(r.data)); return r.data; }

async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gongzao-international-v7-'));
  const dbPath = path.join(directory, 'platform.sqlite');
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
  await start(); t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(cookie, route, body) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, data: JSON.parse(text) };
  }
  async function session() {
    const response = await request(null, '/api/v2/session');
    return { cookie: response.headers.get('set-cookie').split(';')[0], owner: ok(response).user.id };
  }
  async function seedLegacy(user, edit) {
    await instance.store.transact(user.owner, workspace => { edit(workspace); workspace.revision++; return { workspace, result: {}, replayed: false }; });
  }
  return { request, session, seedLegacy, restart: async () => { await stop(); await start(); } };
}

test('international HTTP v0.7: authoritative country metadata keeps currencies and unconfigured payments distinct', async t => {
  const h = await harness(t), user = await h.session();
  const requirements = { SG: { province: false, city: false, postalCode: true }, HK: { province: true, city: false, postalCode: false }, US: { province: true, city: true, postalCode: true }, JP: { province: true, city: false, postalCode: true } };
  for (const [country, fields] of Object.entries(requirements)) {
    const { market, accountingCurrency } = ok(await h.request(user.cookie, '/api/v2/markets?country=' + country));
    assert.equal(accountingCurrency, 'CNY'); assert.equal(market.countryCode, country);
    for (const [field, required] of Object.entries(fields)) assert.equal(market.address.fields[field].required, required, `${country}/${field}`);
    assert.equal(market.payment.accountingCurrency, 'CNY'); assert.equal(market.payment.livePaymentsEnabled, false);
    assert.equal(market.payment.exchangeRate, null);
    assert.ok(market.payment.methods.length > 0);
    assert.ok(market.payment.methods.every(method => method.enabled === false && method.status === 'NOT_CONFIGURED'));
  }
  const catalog = ok(await h.request(user.cookie, '/api/v2/markets'));
  assert.ok(catalog.markets.some(market => market.countryCode === 'CN'));
  assert.ok(catalog.markets.some(market => market.countryCode === 'SG'));
});

test('international HTTP v0.7: Singapore and Hong Kong accept country-specific minimal addresses without invented city or state', async t => {
  const h = await harness(t), user = await h.session();
  for (const country of ['SG', 'HK', 'JP', 'US']) {
    const saved = ok(await h.request(user.cookie, profilePath, profile(good[country]))).profile;
    assert.equal(saved.shippingAddress.countryCode, country); assert.equal(saved.destination, 'other');
    assert.equal(saved.shippingAddress.postalCode, good[country].postalCode, 'postal code remains text');
    assert.equal(saved.shippingAddress.city, good[country].city);
  }
  await h.restart();
  assert.deepEqual(ok(await h.request(user.cookie, profilePath)).profile.shippingAddress, good.US);
});

test('international HTTP v0.7: required fields reject atomically and error messages do not echo private data', async t => {
  const h = await harness(t), user = await h.session();
  const saved = ok(await h.request(user.cookie, profilePath, profile(good.SG))).profile;
  for (const [country, field] of [['SG', 'postalCode'], ['HK', 'province'], ['US', 'city'], ['US', 'province'], ['US', 'postalCode'], ['JP', 'province'], ['JP', 'postalCode']]) {
    const response = await h.request(user.cookie, profilePath, profile({ ...good[country], [field]: '', recipient: 'PRIVATE_RECIPIENT_NEVER_ECHO', addressLine: 'PRIVATE_STREET_NEVER_ECHO' }));
    assert.equal(response.status, 400, `${country}/${field}: ${response.text}`);
    assert.doesNotMatch(response.text, /PRIVATE_RECIPIENT_NEVER_ECHO|PRIVATE_STREET_NEVER_ECHO/);
    assert.deepEqual(ok(await h.request(user.cookie, profilePath)).profile, saved);
  }
});

test('international HTTP v0.7: overseas quotes remain unpaid engineering inquiries with no fictional currency conversion', async t => {
  const h = await harness(t), user = await h.session();
  ok(await h.request(user.cookie, profilePath, profile(good.US)));
  const quotes = ok(await h.request(user.cookie, '/api/v2/quotes', { ...config, currency: 'USD', paymentProvider: 'paypal', market: { countryCode: 'CN' }, paymentContext: { livePaymentsEnabled: true } })).quotes;
  assert.ok(quotes.length > 0);
  for (const quote of quotes) {
    assert.equal(quote.destination, 'other'); assert.equal(quote.review, true);
    assert.ok(quote.reviewReasons.includes('DESTINATION_REVIEW'));
    // v0.6-compatible numeric placeholder is never a payable/free quote.
    assert.equal(quote.total, 0); assert.equal(quote.totalCents, 0);
    assert.equal(quote.priceStatus, 'REVIEW_REQUIRED'); assert.equal(quote.payable, false);
    assert.equal(quote.market.countryCode, 'US'); assert.equal(quote.paymentContext.accountingCurrency, 'CNY');
    assert.equal(quote.paymentContext.livePaymentsEnabled, false); assert.equal(quote.paymentContext.exchangeRate, null);
    assert.ok(!('shippingAddress' in quote), 'quotes avoid exposing complete address snapshots');
  }
  const created = ok(await h.request(user.cookie, '/api/v2/orders', { quoteId: quotes[0].quoteId, demoAcknowledged: true, currency: 'USD', paymentState: 'SIMULATED_FROZEN' })).order;
  assert.equal(created.paymentState, 'UNPAID'); assert.equal(created.productionState, 'REVIEW_REQUIRED');
  assert.equal(created.totalCents, 0); assert.equal(created.total, 0);
  assert.equal(created.quoteSnapshot.priceStatus, 'REVIEW_REQUIRED'); assert.equal(created.quoteSnapshot.payable, false);
  assert.equal(created.settlementBreakdown, undefined);
  for (const action of ['request-settlement', 'request-refund']) {
    const denied = await h.request(user.cookie, '/api/v2/actions', { action, id: created.id, reason: 'Test only', demoAcknowledged: true });
    assert.equal(denied.status, 409, denied.text);
  }
  const restored = ok(await h.request(user.cookie, '/api/v2/workspace')).workspace.orders[0];
  assert.equal(restored.paymentState, 'UNPAID'); assert.equal(restored.productionState, 'REVIEW_REQUIRED');
});

test('international HTTP v0.7: country changes invalidate previous quotes and preserve existing order address/payment snapshots', async t => {
  const h = await harness(t), user = await h.session();
  ok(await h.request(user.cookie, profilePath, customerProfileFixture()));
  const domestic = ok(await h.request(user.cookie, '/api/v2/quotes', config)).quotes;
  const order = ok(await h.request(user.cookie, '/api/v2/orders', { quoteId: domestic[0].quoteId, demoAcknowledged: true })).order;
  assert.equal(order.paymentState, 'SIMULATED_FROZEN'); assert.ok(order.totalCents > 0);
  ok(await h.request(user.cookie, profilePath, profile(good.SG)));
  const stale = await h.request(user.cookie, '/api/v2/orders', { quoteId: domestic[1].quoteId, demoAcknowledged: true });
  assert.equal(stale.status, 409); assert.equal(stale.data.error.code, 'ADDRESS_CHANGED');
  const overwritten = await h.request(user.cookie, '/api/v2/quotes', { ...config, destination: 'east' });
  assert.equal(overwritten.status, 409); assert.equal(overwritten.data.error.code, 'DESTINATION_MISMATCH');
  const stored = ok(await h.request(user.cookie, '/api/v2/workspace')).workspace.orders[0];
  assert.deepEqual(stored.shippingAddress, order.shippingAddress); assert.equal(stored.shippingAddress.countryCode, 'CN');
  assert.equal(stored.totalCents, order.totalCents); assert.equal(stored.paymentState, order.paymentState);
  assert.deepEqual(stored.quoteSnapshot.paymentContext, order.quoteSnapshot.paymentContext);
});

test('international HTTP v0.7: migrated v0.6 overseas profiles remain readable and require correction before quoting', async t => {
  const h = await harness(t), user = await h.session(), stranger = await h.session();
  ok(await h.request(user.cookie, profilePath, profile(good.JP)));
  await h.seedLegacy(user, workspace => { workspace.customerProfile.shippingAddress.postalCode = ''; });
  await h.restart();
  const oldProfile = ok(await h.request(user.cookie, profilePath)).profile;
  assert.equal(oldProfile.shippingAddress.countryCode, 'JP'); assert.equal(oldProfile.shippingAddress.postalCode, '');
  assert.equal(ok(await h.request(stranger.cookie, profilePath)).profile, null);
  const blocked = await h.request(user.cookie, '/api/v2/quotes', config);
  assert.equal(blocked.status, 409); assert.equal(blocked.data.error.code, 'ADDRESS_INCOMPLETE');
  ok(await h.request(user.cookie, profilePath, profile(good.JP)));
  assert.ok(ok(await h.request(user.cookie, '/api/v2/quotes', config)).quotes.every(quote => quote.review));
});
