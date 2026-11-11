import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

function sandbox() {
  let workspace = createWorkspace({ now: 1000000 }), sequence = 0, clock = 1000000;
  saveCustomerProfile(workspace, customerProfileFixture(), clock);
  const run = async (type, payload, key = `request-${++sequence}`) => {
    const response = await applyCommand(workspace, { type, payload, idempotencyKey: key }, { now: clock++, idFactory: () => `id-${++sequence}` });
    workspace = response.workspace; return response;
  };
  const quote = async (config = {}) => (await run('quote', config)).result.quotes[0];
  const order = async (config = {}) => (await run('order', { quoteId: (await quote(config)).quoteId, demoAcknowledged: true })).result.order;
  const action = (action, id, extra = {}, key) => run('action', { action, id, demoAcknowledged: true, ...extra }, key);
  return { run, quote, order, action, get workspace() { return workspace; }, set workspace(value) { workspace = value; }, current(id) { return workspace.orders.find(order => order.id === id); } };
}
const clear = { partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true };
async function manufactured(s) {
  const order = await s.order();
  await s.action('complete-print', 'p1');
  await s.action('collect-and-qc', order.id, clear);
  return order.id;
}
async function delivered(s) {
  const id = await manufactured(s);
  await s.action('ship', id, { carrier: '测试快递 · 模拟', trackingNumber: 'DEMO-TEST123' });
  await s.action('deliver', id);
  return id;
}
async function accepted(s) {
  const id = await delivered(s);
  await s.action('accept', id, { customerAccepted: true });
  return id;
}
const refundId = (s, id) => s.current(id).refundRequest.id;
const settlementId = (s, id) => s.current(id).settlementAttempt.id;

test('acceptance, settlement request and settlement result are independent durable steps', async () => {
  const s = sandbox(), id = await delivered(s);
  const accepted = await s.action('accept', id, { customerAccepted: true }, 'accept-once');
  assert.equal(accepted.result.order.acceptanceState, 'ACCEPTED');
  assert.equal(accepted.result.order.settlementState, 'READY');
  assert.equal(accepted.result.order.paymentState, 'SIMULATED_FROZEN');
  assert.equal(accepted.result.order.status, 'accepted');
  const requested = await s.action('request-settlement', id, {}, 'settle-once');
  assert.equal(requested.result.order.settlementState, 'REQUESTED');
  assert.equal(requested.result.order.paymentState, 'SIMULATED_FROZEN');
  assert.equal(requested.result.order.settlementAttempt.amountCents, s.current(id).settlementBreakdown.merchantReceivableCents);
  const attemptId = settlementId(s, id);
  s.workspace = JSON.parse(JSON.stringify(s.workspace));
  const before = s.workspace.revision;
  assert.equal((await s.action('request-settlement', id, {}, 'settle-once')).replayed, true);
  assert.equal(s.workspace.revision, before);
  await assert.rejects(s.action('resolve-settlement', id, { attemptId: 'foreign', outcome: 'succeeded' }), { code: 'SETTLEMENT_ATTEMPT_MISMATCH' });
  const resolved = await s.action('resolve-settlement', id, { attemptId, outcome: 'succeeded' }, 'settlement-result-once');
  assert.equal(resolved.result.order.settlementState, 'SIMULATED_SETTLED');
  assert.equal(resolved.result.order.paymentState, 'SIMULATED_RELEASED');
  assert.equal(resolved.result.order.status, 'settled');
  assert.equal(resolved.result.moneyTransferred, 0);
  assert.equal(resolved.result.physicalCommandsSent, 0);
  const settledRevision = s.workspace.revision;
  await s.action('resolve-settlement', id, { attemptId, outcome: 'succeeded' }, 'settlement-result-once');
  assert.equal(s.workspace.revision, settledRevision);
  await assert.rejects(s.action('resolve-settlement', id, { attemptId, outcome: 'succeeded' }), { code: 'SETTLEMENT_NOT_PENDING' });
});

test('failed settlement retains funds and old results cannot resolve a newer attempt', async () => {
  const s = sandbox(), id = await accepted(s);
  await s.action('request-settlement', id);
  const oldId = settlementId(s, id);
  await assert.rejects(s.action('resolve-settlement', id, { attemptId: oldId, outcome: 'failed' }), { code: 'RESULT_REASON_REQUIRED' });
  await s.action('resolve-settlement', id, { attemptId: oldId, outcome: 'failed', reason: '模拟通道暂时不可用' });
  assert.equal(s.current(id).status, 'settlement_failed');
  assert.equal(s.current(id).paymentState, 'SIMULATED_FROZEN');
  await s.action('dispute', id, { open: true });
  await assert.rejects(s.action('request-settlement', id), { code: 'SETTLEMENT_BLOCKED' });
  await s.action('dispute', id, { open: false });
  await s.action('request-settlement', id);
  const newId = settlementId(s, id);
  assert.notEqual(newId, oldId); assert.equal(s.current(id).settlementAttempt.sequence, 2);
  assert.equal(s.current(id).settlementHistory[0].id, oldId);
  assert.equal(s.current(id).settlementHistory[0].status, 'FAILED');
  assert.equal(s.current(id).settlementHistory[0].reason, '模拟通道暂时不可用');
  await assert.rejects(s.action('resolve-settlement', id, { attemptId: oldId, outcome: 'succeeded' }), { code: 'SETTLEMENT_ATTEMPT_MISMATCH' });
  await s.action('resolve-settlement', id, { attemptId: newId, outcome: 'succeeded' });
});

test('unaccepted or unsettled prerequisites cannot be bypassed, and completed settlement is terminal', async () => {
  const s = sandbox(), id = await delivered(s);
  await assert.rejects(s.action('request-settlement', id), { code: 'SETTLEMENT_BLOCKED' });
  await s.action('accept', id, { customerAccepted: true });
  await s.action('request-settlement', id);
  await assert.rejects(s.action('request-refund', id, { reason: '测试退款' }), { code: 'REFUND_NOT_ALLOWED' });
  await assert.rejects(s.action('dispute', id, { open: true }), { code: 'DISPUTE_NOT_ALLOWED' });
  await s.action('resolve-settlement', id, { attemptId: settlementId(s, id), outcome: 'succeeded' });
  await assert.rejects(s.action('request-settlement', id), { code: 'SETTLEMENT_BLOCKED' });
  await assert.rejects(s.action('request-refund', id, { reason: '测试退款' }), { code: 'REFUND_NOT_ALLOWED' });
  await assert.rejects(s.action('dispute', id, { open: true }), { code: 'DISPUTE_NOT_ALLOWED' });
});

test('pending refund blocks FIFO dispatch and a rejected request can resume the same queued task', async () => {
  const s = sandbox(), first = await s.order(), second = await s.order();
  await s.action('request-refund', second.id, { reason: '暂不需要' });
  await s.action('complete-print', 'p1');
  await s.action('collect-and-qc', first.id, clear);
  assert.equal(s.workspace.devices[0].orderId, null);
  assert.equal(s.workspace.devices[0].blockedReason, 'FUNDS_BLOCKED');
  await s.action('resolve-refund', second.id, { requestId: refundId(s, second.id), approved: false, reason: '客户改为继续制作' });
  assert.equal(s.current(second.id).refundState, 'REJECTED');
  assert.equal(s.workspace.devices[0].orderId, second.id);
  assert.equal(s.current(second.id).productionState, 'PRINTING');
});

test('refund application never releases a running or uncleared physical task', async () => {
  const s = sandbox(), first = await s.order(), second = await s.order();
  await s.action('request-refund', first.id, { reason: '质量问题需退款' });
  assert.equal(s.current(first.id).productionState, 'PRINTING');
  assert.equal(s.workspace.devices[0].orderId, first.id);
  const body = { requestId: refundId(s, first.id), approved: true };
  await assert.rejects(s.action('resolve-refund', first.id, body), { code: 'REFUND_PRODUCTION_OCCUPIED' });
  await s.action('complete-print', 'p1');
  await assert.rejects(s.action('resolve-refund', first.id, body), { code: 'REFUND_PRODUCTION_OCCUPIED' });
  await s.action('collect-and-qc', first.id, { ...clear, qcPassed: false });
  assert.equal(s.workspace.devices[0].orderId, second.id);
  await s.action('resolve-refund', first.id, body);
  assert.equal(s.current(first.id).productionState, 'QC_FAILED');
  assert.equal(s.current(first.id).status, 'refunded');
  assert.equal(s.workspace.devices[0].orderId, second.id);
  await assert.rejects(s.action('ship', first.id, { carrier: '模拟', trackingNumber: 'DEMO-REFUNDED' }), { code: 'SHIPMENT_NOT_ALLOWED' });
  await assert.rejects(s.action('request-settlement', first.id), { code: 'SETTLEMENT_BLOCKED' });
});

test('cancellation releases queued capacity but refund remains pending until processing confirms', async () => {
  const s = sandbox(), first = await s.order({ material: 'PETG' }), second = await s.order();
  await s.action('cancel', first.id);
  assert.equal(s.current(first.id).productionState, 'CANCELLED');
  assert.equal(s.current(first.id).paymentState, 'SIMULATED_FROZEN');
  assert.equal(s.current(first.id).refundState, 'REQUESTED');
  assert.equal(s.workspace.devices[0].orderId, second.id);
  await assert.rejects(s.action('resolve-refund', first.id, { requestId: refundId(s, first.id), approved: false, reason: '拒绝' }), { code: 'CANCELLATION_REFUND_REQUIRED' });
  await s.action('resolve-refund', first.id, { requestId: refundId(s, first.id), approved: true });
  assert.equal(s.current(first.id).paymentState, 'SIMULATED_REFUNDED');
  assert.equal(s.current(first.id).status, 'refunded');
});

test('a new refund application cannot be resolved by a stale earlier request identifier', async () => {
  const s = sandbox(), id = await delivered(s);
  await s.action('request-refund', id, { reason: '尺寸不符' });
  const firstRequest = refundId(s, id);
  await assert.rejects(s.action('accept', id, { customerAccepted: true }), { code: 'SETTLEMENT_BLOCKED' });
  await s.action('resolve-refund', id, { requestId: firstRequest, approved: false, reason: '等待补充照片' });
  await s.action('request-refund', id, { reason: '已补充证据' });
  const secondRequest = refundId(s, id);
  assert.notEqual(secondRequest, firstRequest);
  assert.equal(s.current(id).refundHistory[0].id, firstRequest);
  assert.equal(s.current(id).refundHistory[0].status, 'REJECTED');
  assert.equal(s.current(id).refundHistory[0].resolutionReason, '等待补充照片');
  await assert.rejects(s.action('resolve-refund', id, { requestId: firstRequest, approved: true }), { code: 'REFUND_REQUEST_MISMATCH' });
  const result = await s.action('resolve-refund', id, { requestId: secondRequest, approved: true }, 'refund-result-once');
  const revision = s.workspace.revision;
  await s.action('resolve-refund', id, { requestId: secondRequest, approved: true }, 'refund-result-once');
  assert.equal(s.workspace.revision, revision);
  assert.equal(result.result.moneyTransferred, 0);
  assert.equal(s.current(id).logisticsState, 'DELIVERED');
  assert.equal(s.current(id).productionState, 'QC_PASSED');
});

test('post-acceptance refund cancels pending settlement eligibility but retains acceptance evidence', async () => {
  const s = sandbox(), id = await accepted(s);
  await s.action('request-refund', id, { reason: '验收后发现问题' });
  await assert.rejects(s.action('request-settlement', id), { code: 'SETTLEMENT_BLOCKED' });
  await s.action('resolve-refund', id, { requestId: refundId(s, id), approved: true });
  assert.equal(s.current(id).acceptanceState, 'ACCEPTED');
  assert.equal(s.current(id).settlementState, 'CANCELLED');
  assert.equal(s.current(id).paymentState, 'SIMULATED_REFUNDED');
  await assert.rejects(s.action('request-settlement', id), { code: 'SETTLEMENT_BLOCKED' });
});

test('disputes before delivery block shipment and closing one does not erase a pending refund', async () => {
  const s = sandbox(), id = await manufactured(s);
  await s.action('dispute', id, { open: true });
  const shipping = { carrier: '模拟', trackingNumber: 'DEMO-DISPUTE' };
  await assert.rejects(s.action('ship', id, shipping), { code: 'SHIPMENT_NOT_ALLOWED' });
  await s.action('request-refund', id, { reason: '质量问题' });
  await s.action('dispute', id, { open: false });
  await assert.rejects(s.action('ship', id, shipping), { code: 'SHIPMENT_NOT_ALLOWED' });
  await s.action('resolve-refund', id, { requestId: refundId(s, id), approved: false, reason: '沟通后继续发货' });
  await s.action('ship', id, shipping);
  assert.equal(s.current(id).logisticsState, 'SHIPPED');
});

test('dispute on the FIFO head prevents dispatch until the issue is explicitly closed', async () => {
  const s = sandbox(), first = await s.order(), second = await s.order();
  await s.action('dispute', second.id, { open: true });
  await s.action('complete-print', 'p1');
  await s.action('collect-and-qc', first.id, clear);
  assert.equal(s.workspace.devices[0].orderId, null);
  assert.equal(s.workspace.devices[0].blockedReason, 'FUNDS_BLOCKED');
  await s.action('dispute', second.id, { open: false });
  assert.equal(s.workspace.devices[0].orderId, second.id);
});

test('refund input errors and unsupported partial refunds leave the workspace unchanged', async () => {
  const s = sandbox(), id = await delivered(s), before = structuredClone(s.workspace);
  for (const reason of ['', '   ', 'x'.repeat(501), {}, 'bad\u0000reason']) await assert.rejects(s.action('request-refund', id, { reason }), { code: 'REFUND_REASON_REQUIRED' });
  await assert.rejects(s.action('request-refund', id, { reason: '退款', amountCents: 1 }), { code: 'PARTIAL_REFUND_UNSUPPORTED' });
  assert.deepEqual(s.workspace, before);
  await s.action('request-refund', id, { reason: '第一行说明\n第二行说明' });
  assert.equal(s.current(id).refundRequest.reason, '第一行说明\n第二行说明');
  await assert.rejects(s.action('resolve-refund', id, { requestId: refundId(s, id), approved: 'yes' }), { code: 'INVALID_REFUND_RESULT' });
  await assert.rejects(s.action('resolve-refund', id, { requestId: refundId(s, id), approved: false }), { code: 'RESULT_REASON_REQUIRED' });
});

test('unpaid engineering review cannot request a refund or settlement', async () => {
  const s = sandbox(), order = await s.order({ material: 'ALUMINUM' });
  assert.equal(order.paymentState, 'UNPAID');
  await assert.rejects(s.action('request-refund', order.id, { reason: '退款' }), { code: 'REFUND_NOT_ALLOWED' });
  await assert.rejects(s.action('request-settlement', order.id), { code: 'SETTLEMENT_BLOCKED' });
  await s.action('cancel', order.id);
  assert.equal(s.current(order.id).status, 'cancelled');
  assert.equal(s.current(order.id).refundState, 'NONE');
});

test('legacy v0.4 settled orders remain readable without invented settlement attempts', async () => {
  const s = sandbox(), id = await delivered(s), order = s.current(id);
  Object.assign(order, { status: 'settled', acceptanceState: 'ACCEPTED', settlementState: 'SIMULATED_SETTLED', paymentState: 'SIMULATED_RELEASED' });
  s.workspace = JSON.parse(JSON.stringify(s.workspace));
  const visible = getPublicWorkspace(s.workspace).orders[0];
  assert.equal(visible.status, 'settled');
  assert.equal(visible.settlementAttempt, undefined);
  await assert.rejects(s.action('request-settlement', id), { code: 'SETTLEMENT_BLOCKED' });
  await assert.rejects(s.action('request-refund', id, { reason: '退款' }), { code: 'REFUND_NOT_ALLOWED' });
});
