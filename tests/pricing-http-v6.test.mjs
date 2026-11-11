import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Disposable real HTTP/SQLite integration, not mock pricing or production authorization.
async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coforge-pricing-v6-'));
  let instance, base;
  const owners = new Map();
  async function start() {
    instance = createPlatformServer({ dbPath: path.join(directory, 'platform.sqlite') });
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
  async function request(cookie, pathname, body, key = randomUUID()) {
    const response = await fetch(base + pathname, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function session(merchant = false) {
    const registered = await request(null, '/api/auth/register', { email: `pricing-${randomUUID()}@example.invalid`, password: 'Fixture-pricing-password-v7', displayName: 'Fixture pricing merchant' });
    ok(registered);
    const cookie = registered.headers.getSetCookie().find(value => !value.includes('Max-Age=0')).split(';')[0];
    const response = await request(cookie, '/api/v2/session');
    owners.set(cookie, ok(response).user.id);
    ok(await request(cookie, '/api/v2/customer/profile', customerProfileFixture()));
    if (merchant) ok(await request(cookie, '/api/v2/merchant/enroll', { name: '测试沙盒工坊' }));
    return cookie;
  }
  async function model(cookie) {
    const source = await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url), 'utf8');
    const stl = source.replace(/vertex\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/gi, (_, x, y, z) => `vertex ${Number(x) * 2} ${Number(y) * 1.75} ${Number(z) * 0.5}`);
    const response = await fetch(base + '/api/v2/models', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'Idempotency-Key': randomUUID(), 'X-File-Name': 'batch-box-40x35x10.stl' }, body: stl });
    const data = ok({ status: response.status, data: await response.json() });
    assert.deepEqual(data.model.dimensions, [40, 35, 10]); assert.equal(data.model.closed, true);
    return data.model.id;
  }
  const workspace = async cookie => ok(await request(cookie, '/api/v2/workspace')).workspace;
  const pricing = async cookie => ok(await request(cookie, '/api/v2/merchant/pricing'));
  const quotes = async (cookie, modelId, qty = 1, extra = {}) => ok(await request(cookie, '/api/v2/quotes', { modelId, material: 'PLA', qty, quality: 'standard', unit: 'mm', ...extra }));
  const order = async (cookie, quoteId) => ok(await request(cookie, '/api/v2/orders', { quoteId, demoAcknowledged: true })).order;
  const action = (cookie, action, id, extra = {}, key) => request(cookie, '/api/v2/actions', { action, id, demoAcknowledged: true, ...extra }, key);
  const save = (cookie, profile, changes = {}, extra = {}) => request(cookie, '/api/v2/merchant/pricing', { farmId: profile.farmId, expectedRevision: profile.revision, profile: { ...editable(profile), ...changes }, demoAcknowledged: true, ...extra });
  // Only test fixture setup touches the store. All assertions/actions then use HTTP.
  async function seedLegacy(cookie, edit) {
    await instance.store.transact(owners.get(cookie), workspace => { edit(workspace); workspace.revision++; return { workspace, result: {}, replayed: false }; });
  }
  return { request, session, model, workspace, pricing, quotes, order, action, save, seedLegacy, owner: cookie => owners.get(cookie), restart: async () => { await stop(); await start(); } };
}
const editable = profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !['farmId', 'farmName', 'revision', 'updatedAt', 'mode'].includes(key)));
function ok(response) { assert.ok([200, 201].includes(response.status), JSON.stringify(response.data)); return response.data; }
function denied(response, status, code) { assert.equal(response.status, status, JSON.stringify(response.data)); if (code) assert.equal(response.data.error.code, code); }
function publicOnly(value) {
  assert.doesNotMatch(JSON.stringify(value), /"(?:pricingProfiles|pricingEvidence|profileSnapshot|costBreakdown|estimatedCostCents|estimatedProfitCents|estimatedMarginBps|targetMarginBps|profitFloorCents|minimumProfitCentsPerMachineHour|materialCostCentsPerKg)"\s*:/);
}
function balanced(summary) {
  for (const key of ['manufacturingCents', 'platformFeeCents', 'shippingCents', 'merchantReceivableCents', 'customerTotalCents']) assert.ok(Number.isSafeInteger(summary[key]) && summary[key] >= 0, key);
  assert.equal(summary.manufacturingCents + summary.shippingCents, summary.merchantReceivableCents);
  assert.equal(summary.merchantReceivableCents + summary.platformFeeCents, summary.customerTotalCents);
}
const clearance = { partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true };
async function accepted(h, cookie, order) {
  ok(await h.action(cookie, 'complete-print', order.deviceId));
  ok(await h.action(cookie, 'collect-and-qc', order.id, clearance));
  ok(await h.action(cookie, 'ship', order.id, { carrier: '模拟快递', trackingNumber: 'DEMO-PRICING-V6' }));
  ok(await h.action(cookie, 'deliver', order.id));
  return ok(await h.action(cookie, 'accept', order.id, { customerAccepted: true })).order;
}

test('HTTP v0.6: pricing requires enrollment and each owner has isolated profiles and evidence', async t => {
  const h = await harness(t);
  denied(await h.request(null, '/api/v2/merchant/pricing'), 401, 'ACCOUNT_LOGIN_REQUIRED');
  const a = await h.session(), b = await h.session(true);
  denied(await h.request(a, '/api/v2/merchant/pricing'), 403, 'MERCHANT_REQUIRED');
  const baseline = await h.pricing(b), profile = baseline.profiles[0];
  denied(await h.save(a, profile), 403, 'MERCHANT_REQUIRED');
  ok(await h.request(a, '/api/v2/merchant/enroll', { name: '甲方测试工坊' }));
  const changed = ok(await h.save(a, profile, { targetMarginBps: 4500 }));
  assert.equal(changed.profile.targetMarginBps, 4500); assert.equal(changed.profile.revision, profile.revision + 1);
  assert.deepEqual((await h.pricing(b)).profiles, baseline.profiles);
  ok(await h.save(b, profile, {}, { ownerId: h.owner(a) }));
  assert.equal((await h.pricing(a)).profiles[0].targetMarginBps, 4500);
  assert.deepEqual((await h.pricing(b)).profiles, baseline.profiles);
  const modelId = await h.model(a), quoteData = await h.quotes(a, modelId);
  const spoofed = ok(await h.request(b, '/api/v2/merchant/pricing?ownerId=' + encodeURIComponent(h.owner(a))));
  assert.equal(spoofed.quoteEconomics.length, 0); assert.equal((await h.pricing(a)).quoteEconomics.length, quoteData.quotes.length);
  denied(await h.request(b, '/api/v2/orders', { quoteId: quoteData.quotes[0].quoteId, ownerId: h.owner(a), demoAcknowledged: true }), 404, 'QUOTE_NOT_FOUND');
  await h.restart();
  assert.equal((await h.pricing(a)).profiles[0].targetMarginBps, 4500); assert.deepEqual((await h.pricing(b)).profiles, baseline.profiles);
});

test('HTTP v0.6: actual uploaded geometry crosses 30/31 plate boundary without pretending parallel zero-time copies', async t => {
  const h = await harness(t), cookie = await h.session(true), modelId = await h.model(cookie);
  const groups = await Promise.all([1, 30, 31].map(qty => h.quotes(cookie, modelId, qty)));
  for (const data of groups) publicOnly(data);
  const [one, full, overflow] = groups.map(data => data.quotes[0]);
  assert.equal(one.batch.capacityPerPlate, 30); assert.deepEqual(one.batch.partsPerPlate, [1]);
  assert.deepEqual(full.batch.partsPerPlate, [30]); assert.equal(full.batch.plateCount, 1);
  assert.deepEqual(overflow.batch.partsPerPlate, [30, 1]); assert.equal(overflow.batch.plateCount, 2);
  for (const quote of [one, full, overflow]) {
    assert.equal(quote.batch.verified, false); assert.equal(quote.batch.mixedOrders, false); assert.equal(quote.batch.waitForOtherOrders, false);
    balanced(quote.pricingSummary); assert.equal(quote.totalCents, quote.pricingSummary.customerTotalCents);
  }
  assert.ok(full.productionHours > one.productionHours * 20);
  assert.ok(overflow.productionHours > full.productionHours);
  assert.ok(full.pricingSummary.averageUnitManufacturingCents < one.pricingSummary.averageUnitManufacturingCents);
  const rows = (await h.pricing(cookie)).quoteEconomics;
  const costs = [one, full, overflow].map(quote => rows.find(row => row.quoteId === quote.quoteId).costBreakdown);
  assert.equal(costs[0].orderSetupCents, costs[1].orderSetupCents);
  assert.equal(costs[0].plateSetupCents, costs[1].plateSetupCents);
  assert.equal(costs[2].plateSetupCents, costs[1].plateSetupCents * 2);
  assert.equal(costs[1].finishingCents, costs[0].finishingCents * 30);
  assert.ok(costs[1].materialCents > costs[0].materialCents * 29);
  const order = await h.order(cookie, full.quoteId);
  publicOnly(order); publicOnly(await h.workspace(cookie));
  await h.restart(); publicOnly(await h.workspace(cookie));
});

test('HTTP v0.6: configured margin, order-profit and machine-hour floors survive all quantities and farm factors', async t => {
  const h = await harness(t), cookie = await h.session(true), modelId = await h.model(cookie);
  for (const floor of [
    { targetMarginBps: 5500, minimumOrderProfitCents: 500, minimumProfitCentsPerMachineHour: 100 },
    { targetMarginBps: 500, minimumOrderProfitCents: 30000, minimumProfitCentsPerMachineHour: 100 },
    { targetMarginBps: 500, minimumOrderProfitCents: 0, minimumProfitCentsPerMachineHour: 5000 }
  ]) {
    const profiles = (await h.pricing(cookie)).profiles;
    const common = { ...editable(profiles[0]), ...floor };
    for (const profile of profiles) ok(await h.save(cookie, profile, common));
    for (const qty of [1, 30, 31]) {
      const { quotes } = await h.quotes(cookie, modelId, qty);
      const evidence = (await h.pricing(cookie)).quoteEconomics;
      assert.equal(new Set(quotes.map(quote => quote.pricingSummary.manufacturingCents)).size, 1, 'identical cost assumptions cannot get a final farm discount');
      for (const quote of quotes) {
        const row = evidence.find(item => item.quoteId === quote.quoteId);
        const cost = Object.values(row.costBreakdown).reduce((a, b) => a + b, 0);
        const revenue = quote.pricingSummary.manufacturingCents, profit = revenue - cost;
        assert.equal(row.estimatedCostCents, cost); assert.equal(row.estimatedProfitCents, profit);
        assert.ok(profit * 10000 >= revenue * floor.targetMarginBps, 'target margin');
        assert.ok(profit >= floor.minimumOrderProfitCents, 'order floor');
        assert.ok(profit + 1e-7 >= row.productionHours * floor.minimumProfitCentsPerMachineHour, 'machine-hour floor');
        balanced(quote.pricingSummary);
      }
    }
  }
});

test('HTTP v0.6: validated revisions prevent stale overwrites and repricing preserves existing orders', async t => {
  const h = await harness(t), cookie = await h.session(true), modelId = await h.model(cookie);
  const original = (await h.pricing(cookie)).profiles[0];
  denied(await h.save(cookie, original, {}, { demoAcknowledged: false }), 400, 'DEMO_ACK_REQUIRED');
  denied(await h.save(cookie, original, { targetMarginBps: 10000 }), 400, 'INVALID_PRICING_PROFILE');
  denied(await h.save(cookie, original, { estimatedThroughputGramsPerHour: 0 }), 400, 'INVALID_PRICING_PROFILE');
  denied(await h.save(cookie, original, { surpriseDiscount: 0.1 }), 400, 'INVALID_PRICING_PROFILE');
  const unchanged = ok(await h.save(cookie, original)).profile;
  assert.equal(unchanged.revision, original.revision);
  const first = (await h.quotes(cookie, modelId)).quotes.find(q => q.farm.id === original.farmId);
  const stale = (await h.quotes(cookie, modelId)).quotes.find(q => q.farm.id === original.farmId);
  const order = await h.order(cookie, first.quoteId);
  const changed = ok(await h.save(cookie, original, { targetMarginBps: 5000 })).profile;
  assert.equal(changed.revision, original.revision + 1);
  denied(await h.save(cookie, original, { targetMarginBps: 6000 }), 409, 'PRICING_REVISION_CONFLICT');
  const staleResponse = await h.request(cookie, '/api/v2/orders', { quoteId: stale.quoteId, demoAcknowledged: true });
  denied(staleResponse, 409, 'PRICING_CHANGED');
  const fresh = (await h.quotes(cookie, modelId)).quotes.find(q => q.farm.id === original.farmId);
  assert.equal(fresh.pricingRevision, changed.revision); assert.ok(fresh.totalCents > first.totalCents);
  assert.deepEqual((await h.workspace(cookie)).orders.find(o => o.id === order.id), order);
  await h.restart(); assert.deepEqual((await h.workspace(cookie)).orders.find(o => o.id === order.id), order);
});

test('HTTP v0.6: concurrent pricing edits have one winner and durable retries do not reapply changes', async t => {
  const h = await harness(t), cookie = await h.session(true);
  const original = (await h.pricing(cookie)).profiles[0];
  const payload = { farmId: original.farmId, expectedRevision: original.revision, profile: { ...editable(original), targetMarginBps: 4900 }, demoAcknowledged: true };
  const key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 8 }, () => h.request(cookie, '/api/v2/merchant/pricing', payload, key)));
  for (const response of responses) assert.equal(ok(response).profile.revision, original.revision + 1);
  assert.equal(responses.filter(response => response.data.replayed === false).length, 1);
  const revision = (await h.workspace(cookie)).revision;
  await h.restart();
  assert.equal(ok(await h.request(cookie, '/api/v2/merchant/pricing', payload, key)).replayed, true);
  assert.equal((await h.workspace(cookie)).revision, revision);
  denied(await h.request(cookie, '/api/v2/merchant/pricing', { ...payload, expectedRevision: original.revision + 1 }, key), 409, 'IDEMPOTENCY_CONFLICT');
  const updated = (await h.pricing(cookie)).profiles[0];
  const competing = await Promise.all([h.save(cookie, updated, { targetMarginBps: 5200 }), h.save(cookie, updated, { targetMarginBps: 5300 })]);
  assert.equal(competing.filter(response => response.status === 200).length, 1);
  denied(competing.find(response => response.status !== 200), 409, 'PRICING_REVISION_CONFLICT');
  assert.equal((await h.pricing(cookie)).profiles[0].revision, updated.revision + 1);
});

test('HTTP v0.6: unsupported processes and oversized units stay in manual review without invented earnings', async t => {
  const h = await harness(t), cookie = await h.session(true), modelId = await h.model(cookie);
  for (const extra of [{ material: 'CNC' }, { material: 'ALUMINUM' }, { unit: 'inch' }]) {
    const result = await h.quotes(cookie, modelId, 31, extra);
    publicOnly(result);
    for (const quote of result.quotes) {
      assert.equal(quote.review, true); assert.equal(quote.batch, undefined); assert.equal(quote.pricingSummary, undefined);
    }
    const order = await h.order(cookie, result.quotes[0].quoteId);
    assert.equal(order.productionState, 'REVIEW_REQUIRED'); assert.equal(order.paymentState, 'UNPAID');
    assert.equal(order.settlementBreakdown, undefined);
  }
  const privateView = await h.pricing(cookie);
  assert.equal(privateView.quoteEconomics.length, 0);
  for (const row of privateView.orderEconomics) { assert.equal(row.economics, null); assert.equal(row.settlementBreakdown, null); }
});

test('HTTP v0.6: settlement pays merchant amount, refund returns customer total, and snapshots survive restart', async t => {
  const h = await harness(t), cookie = await h.session(true), modelId = await h.model(cookie);
  const quote = (await h.quotes(cookie, modelId)).quotes[0], order = await h.order(cookie, quote.quoteId);
  balanced(order.settlementBreakdown); assert.equal(order.settlementBreakdown.source, 'V0_6_QUOTE');
  await accepted(h, cookie, order);
  const requested = ok(await h.action(cookie, 'request-settlement', order.id)).order;
  assert.equal(requested.settlementAttempt.amountCents, quote.pricingSummary.merchantReceivableCents);
  assert.ok(requested.settlementAttempt.amountCents < order.totalCents);
  await h.restart();
  const result = ok(await h.action(cookie, 'resolve-settlement', order.id, { attemptId: requested.settlementAttempt.id, outcome: 'succeeded' }));
  assert.equal(result.moneyTransferred, 0); assert.equal(result.order.settlementState, 'SIMULATED_SETTLED');
  const refundQuote = (await h.quotes(cookie, modelId)).quotes[0], refundOrder = await h.order(cookie, refundQuote.quoteId);
  ok(await h.action(cookie, 'complete-print', refundOrder.deviceId)); ok(await h.action(cookie, 'collect-and-qc', refundOrder.id, clearance));
  const pending = ok(await h.action(cookie, 'request-refund', refundOrder.id, { reason: '测试全额退款' })).order;
  assert.equal(pending.refundRequest.amountCents, refundQuote.pricingSummary.customerTotalCents);
  assert.ok(pending.refundRequest.amountCents > refundQuote.pricingSummary.merchantReceivableCents);
  const refunded = ok(await h.action(cookie, 'resolve-refund', refundOrder.id, { requestId: pending.refundRequest.id, approved: true }));
  assert.equal(refunded.order.paymentState, 'SIMULATED_REFUNDED'); assert.equal(refunded.moneyTransferred, 0);
  publicOnly(refunded); publicOnly(await h.workspace(cookie));
});

test('HTTP v0.6: legacy settled history stays untouched, pending gross settlements require correction', async t => {
  const h = await harness(t), cookie = await h.session(true), modelId = await h.model(cookie);
  const quote = (await h.quotes(cookie, modelId)).quotes[0];
  const ready = await accepted(h, cookie, await h.order(cookie, quote.quoteId));
  const legacy = structuredClone(ready);
  delete legacy.settlementBreakdown;
  for (const key of ['pricingSummary', 'batch', 'pricingRevision', 'pricingVersion']) delete legacy.quoteSnapshot[key];
  const completed = { ...structuredClone(legacy), id: 'LEGACY-SETTLED', status: 'settled', settlementState: 'SIMULATED_SETTLED', paymentState: 'SIMULATED_RELEASED', settledAt: 1700000000000,
    settlementAttempt: { id: 'LEGACY-DONE', status: 'SIMULATED_SUCCEEDED', amountCents: legacy.totalCents, requestedAt: 1699999999000, resolvedAt: 1700000000000, sequence: 1 } };
  const pending = { ...structuredClone(legacy), id: 'LEGACY-PENDING', status: 'settling', settlementState: 'REQUESTED',
    settlementAttempt: { id: 'LEGACY-GROSS', status: 'REQUESTED', amountCents: legacy.totalCents, requestedAt: 1700000000000, sequence: 1 } };
  const incomplete = { ...structuredClone(legacy), id: 'LEGACY-INCOMPLETE' };
  delete incomplete.quoteSnapshot.serviceCents;
  await h.seedLegacy(cookie, ws => { ws.orders = [completed, pending, legacy, incomplete]; delete ws.pricingEvidence; delete ws.pricingProfiles; });
  await h.restart();
  const rows = (await h.pricing(cookie)).orderEconomics;
  const doneRow = rows.find(row => row.orderId === completed.id);
  assert.equal(doneRow.legacyUnsplit, true); assert.equal(doneRow.economics, null); assert.equal(doneRow.settlementBreakdown, null);
  assert.deepEqual((await h.workspace(cookie)).orders.find(o => o.id === completed.id), completed);
  const oldRow = rows.find(row => row.orderId === legacy.id);
  assert.equal(oldRow.economics, null); assert.equal(oldRow.settlementBreakdown.source, 'LEGACY_DERIVED'); balanced(oldRow.settlementBreakdown);
  denied(await h.action(cookie, 'request-settlement', incomplete.id), 409, 'LEGACY_SETTLEMENT_REVIEW_REQUIRED');
  assert.deepEqual((await h.workspace(cookie)).orders.find(o => o.id === incomplete.id), incomplete);
  denied(await h.action(cookie, 'resolve-settlement', pending.id, { attemptId: pending.settlementAttempt.id, outcome: 'succeeded' }), 409, 'LEGACY_SETTLEMENT_REVIEW_REQUIRED');
  ok(await h.action(cookie, 'resolve-settlement', pending.id, { attemptId: pending.settlementAttempt.id, outcome: 'failed', reason: '旧版含平台费总额，重新申请分账' }));
  const corrected = ok(await h.action(cookie, 'request-settlement', pending.id)).order;
  assert.equal(corrected.settlementBreakdown.source, 'LEGACY_DERIVED');
  assert.equal(corrected.settlementAttempt.amountCents, legacy.totalCents - legacy.quoteSnapshot.serviceCents);
  assert.equal(corrected.settlementHistory[0].amountCents, legacy.totalCents);
  const requested = ok(await h.action(cookie, 'request-settlement', legacy.id)).order;
  assert.equal(requested.settlementAttempt.amountCents, oldRow.settlementBreakdown.merchantReceivableCents);
  await h.restart();
  assert.deepEqual((await h.workspace(cookie)).orders.find(o => o.id === completed.id), completed);
});
