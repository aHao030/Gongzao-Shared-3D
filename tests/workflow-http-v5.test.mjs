import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Actual loopback HTTP with disposable SQLite persistence. No provider, machine or carrier calls.
async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coforge-workflow-v5-'));
  let instance, base;
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
  async function session() {
    const response = await request(null, '/api/v2/session'); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    ok(await request(cookie, '/api/v2/customer/profile', customerProfileFixture())); return cookie;
  }
  async function workspace(cookie) { return ok(await request(cookie, '/api/v2/workspace')).workspace; }
  async function order(cookie, config = {}) {
    const [quote] = ok(await request(cookie, '/api/v2/quotes', { material: 'PLA', qty: 1, quality: 'standard', unit: 'mm', ...config })).quotes;
    return ok(await request(cookie, '/api/v2/orders', { quoteId: quote.quoteId, demoAcknowledged: true })).order;
  }
  const action = (cookie, action, id, extra = {}, key) => request(cookie, '/api/v2/actions', { action, id, demoAcknowledged: true, ...extra }, key);
  return { session, workspace, order, action, restart: async () => { await stop(); await start(); } };
}
function ok(response) { assert.ok([200, 201].includes(response.status), JSON.stringify(response.data)); return response.data; }
function denied(response, code) { assert.equal(response.status, 409, JSON.stringify(response.data)); if (code) assert.equal(response.data.error.code, code); }
const clearance = { partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true };
async function delivered(h, cookie) {
  const order = await h.order(cookie);
  ok(await h.action(cookie, 'complete-print', order.deviceId));
  ok(await h.action(cookie, 'collect-and-qc', order.id, clearance));
  ok(await h.action(cookie, 'ship', order.id, { carrier: '模拟快递', trackingNumber: 'DEMO-HTTPV5' }));
  return ok(await h.action(cookie, 'deliver', order.id)).order;
}

test('HTTP v0.5: delivery, acceptance and settlement remain separate across SQLite restart and duplicate completion', async t => {
  const h = await harness(t), cookie = await h.session(), delivery = await delivered(h, cookie);
  assert.equal(delivery.acceptanceState, 'PENDING'); assert.equal(delivery.paymentState, 'SIMULATED_FROZEN');
  denied(await h.action(cookie, 'request-settlement', delivery.id), 'SETTLEMENT_BLOCKED');
  const acceptKey = randomUUID(), accepted = ok(await h.action(cookie, 'accept', delivery.id, { customerAccepted: true }, acceptKey)).order;
  assert.equal(accepted.acceptanceState, 'ACCEPTED'); assert.equal(accepted.settlementState, 'READY'); assert.equal(accepted.paymentState, 'SIMULATED_FROZEN');
  await h.restart();
  const restored = await h.workspace(cookie); assert.deepEqual(restored.orders[0], accepted);
  const replayAccepted = ok(await h.action(cookie, 'accept', delivery.id, { customerAccepted: true }, acceptKey)); assert.equal(replayAccepted.replayed, true);
  const pending = ok(await h.action(cookie, 'request-settlement', delivery.id)).order;
  assert.equal(pending.paymentState, 'SIMULATED_FROZEN'); assert.equal(pending.settlementState, 'REQUESTED');
  const completeKey = randomUUID(), payload = { attemptId: pending.settlementAttempt.id, outcome: 'succeeded' };
  const responses = await Promise.all(Array.from({ length: 12 }, () => h.action(cookie, 'resolve-settlement', delivery.id, payload, completeKey)));
  for (const response of responses) { const data = ok(response); assert.equal(data.order.paymentState, 'SIMULATED_RELEASED'); assert.equal(data.moneyTransferred, 0); }
  assert.equal(responses.filter(response => response.data.replayed === false).length, 1);
  const complete = await h.workspace(cookie);
  assert.equal(complete.revision, restored.revision + 2);
  assert.equal(complete.orders[0].events.filter(event => event.label.includes('模拟结算成功')).length, 1);
  await h.restart();
  assert.equal(ok(await h.action(cookie, 'resolve-settlement', delivery.id, payload, completeKey)).replayed, true);
  assert.equal((await h.workspace(cookie)).revision, complete.revision);
  denied(await h.action(cookie, 'resolve-settlement', delivery.id, payload), 'SETTLEMENT_NOT_PENDING');
  denied(await h.action(cookie, 'request-refund', delivery.id, { reason: '重复资金操作' }), 'REFUND_NOT_ALLOWED');
});

test('HTTP v0.5: failed settlement can retry; stale attempt IDs and another owner cannot release funds', async t => {
  const h = await harness(t), a = await h.session(), b = await h.session(), order = await delivered(h, a);
  ok(await h.action(a, 'accept', order.id, { customerAccepted: true }));
  const first = ok(await h.action(a, 'request-settlement', order.id)).order;
  ok(await h.action(a, 'resolve-settlement', order.id, { attemptId: first.settlementAttempt.id, outcome: 'failed', reason: '模拟渠道暂不可用' }));
  const retry = ok(await h.action(a, 'request-settlement', order.id)).order;
  assert.notEqual(retry.settlementAttempt.id, first.settlementAttempt.id);
  const beforeA = await h.workspace(a), beforeB = await h.workspace(b);
  const foreign = await h.action(b, 'resolve-settlement', order.id, { attemptId: retry.settlementAttempt.id, outcome: 'succeeded' });
  assert.equal(foreign.status, 404); assert.equal(foreign.data.error.code, 'ORDER_NOT_FOUND'); assert.equal(foreign.data.workspace, undefined);
  denied(await h.action(a, 'resolve-settlement', order.id, { attemptId: first.settlementAttempt.id, outcome: 'succeeded' }), 'SETTLEMENT_ATTEMPT_MISMATCH');
  assert.deepEqual(await h.workspace(a), beforeA); assert.deepEqual(await h.workspace(b), beforeB);
  const settled = ok(await h.action(a, 'resolve-settlement', order.id, { attemptId: retry.settlementAttempt.id, outcome: 'succeeded' })).order;
  assert.equal(settled.settlementState, 'SIMULATED_SETTLED');
});

test('HTTP v0.5: dispute and pending refund block settlement, and parallel refund/settlement starts have one winner', async t => {
  const h = await harness(t), cookie = await h.session(), order = await delivered(h, cookie);
  ok(await h.action(cookie, 'accept', order.id, { customerAccepted: true }));
  ok(await h.action(cookie, 'dispute', order.id, { open: true }));
  const before = await h.workspace(cookie);
  denied(await h.action(cookie, 'request-settlement', order.id), 'SETTLEMENT_BLOCKED');
  assert.equal((await h.workspace(cookie)).revision, before.revision);
  ok(await h.action(cookie, 'dispute', order.id, { open: false }));
  const competing = await Promise.all([
    h.action(cookie, 'request-refund', order.id, { reason: '尺寸不满足要求' }),
    h.action(cookie, 'request-settlement', order.id)
  ]);
  assert.equal(competing.filter(response => response.status === 200).length, 1);
  assert.equal(competing.filter(response => response.status === 409).length, 1);
  const current = (await h.workspace(cookie)).orders[0];
  assert.equal(current.paymentState, 'SIMULATED_FROZEN');
  assert.notEqual(current.refundState === 'REQUESTED', current.settlementState === 'REQUESTED');
});

test('HTTP v0.5: refund during printing retains occupied device and prevents shipment until explicitly resolved', async t => {
  const h = await harness(t), cookie = await h.session(), order = await h.order(cookie);
  const pending = ok(await h.action(cookie, 'request-refund', order.id, { reason: '设计尺寸需重新确认' })).order;
  const payload = { requestId: pending.refundRequest.id, approved: true };
  denied(await h.action(cookie, 'resolve-refund', order.id, payload), 'REFUND_PRODUCTION_OCCUPIED');
  let ws = await h.workspace(cookie); assert.equal(ws.devices.find(device => device.id === order.deviceId).orderId, order.id);
  assert.equal(ws.orders[0].productionState, 'PRINTING');
  ok(await h.action(cookie, 'complete-print', order.deviceId));
  denied(await h.action(cookie, 'resolve-refund', order.id, payload), 'REFUND_PRODUCTION_OCCUPIED');
  ok(await h.action(cookie, 'collect-and-qc', order.id, clearance));
  denied(await h.action(cookie, 'ship', order.id, { carrier: '模拟快递', trackingNumber: 'DEMO-BLOCKED' }));
  const resolveKey = randomUUID(), resolved = ok(await h.action(cookie, 'resolve-refund', order.id, payload, resolveKey));
  assert.equal(resolved.order.paymentState, 'SIMULATED_REFUNDED'); assert.equal(resolved.order.productionState, 'QC_PASSED'); assert.equal(resolved.moneyTransferred, 0);
  const revision = (await h.workspace(cookie)).revision; await h.restart();
  assert.equal(ok(await h.action(cookie, 'resolve-refund', order.id, payload, resolveKey)).replayed, true);
  assert.equal((await h.workspace(cookie)).revision, revision);
  denied(await h.action(cookie, 'ship', order.id, { carrier: '模拟快递', trackingNumber: 'DEMO-REFUNDED' }));
  denied(await h.action(cookie, 'request-settlement', order.id), 'SETTLEMENT_BLOCKED');
});

test('HTTP v0.5: cancelling a paid queued order preserves pending refund rather than pretending money returned', async t => {
  const h = await harness(t), cookie = await h.session(), order = await h.order(cookie, { material: 'PETG' });
  assert.equal(order.productionState, 'QUEUED');
  const cancelled = ok(await h.action(cookie, 'cancel', order.id)).order;
  assert.equal(cancelled.productionState, 'CANCELLED'); assert.equal(cancelled.refundState, 'REQUESTED'); assert.equal(cancelled.paymentState, 'SIMULATED_FROZEN');
  await h.restart();
  assert.deepEqual((await h.workspace(cookie)).orders[0], cancelled);
  denied(await h.action(cookie, 'resolve-refund', order.id, { requestId: cancelled.refundRequest.id, approved: false, reason: '不可拒绝必需退款' }), 'CANCELLATION_REFUND_REQUIRED');
  const result = ok(await h.action(cookie, 'resolve-refund', order.id, { requestId: cancelled.refundRequest.id, approved: true }));
  assert.equal(result.order.paymentState, 'SIMULATED_REFUNDED'); assert.equal(result.order.status, 'refunded'); assert.equal(result.moneyTransferred, 0);
});
