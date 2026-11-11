import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const api = require('../shared/api-client.js');
const base = 'https://sandbox-api.example.test';

async function remoteOrders(orders) {
  const source = await readFile(new URL('../weapp/utils/service.js', import.meta.url), 'utf8');
  const modules = {
    './demo': { materials: [] },
    '../config/service': { API_BASE: base, AUTH_ADAPTER_READY: true },
    './api-client': api,
    './auth': { getAccessToken: () => 'test-only-token' },
    './transport': { wxTransport: async request => ({ status: 200, data: request.url.endsWith('/session') ? { authenticated: true, mode: 'SERVER_SANDBOX' } : { workspace: { orders } } }) }
  };
  const context = vm.createContext({ module: { exports: {} }, require: name => modules[name] });
  vm.runInContext(source, context);
  await context.module.exports.selectMode('server');
  return context.module.exports.listOrders();
}

test('customer API supports refund requests but never settlement or refund approval commands', async () => {
  let captured;
  const client = api.createApiClient({ apiBase: base, getAccessToken: () => 'test-only-token', transport: async request => { captured = request; return { status: 200, data: { ok: true } }; } });
  for (const action of ['request-settlement', 'resolve-settlement', 'resolve-refund'])
    assert.throws(() => client.customerAction(action, 'o1', {}, 'refund-client-key'), { code: 'CUSTOMER_ACTION_NOT_ALLOWED' });
  await client.customerAction('request-refund', 'o1', { reason: '尺寸待确认', action: 'resolve-refund', id: 'o2', demoAcknowledged: false }, 'refund-client-key');
  assert.deepEqual(captured.data, { reason: '尺寸待确认', action: 'request-refund', id: 'o1', demoAcknowledged: true });
  assert.equal(captured.headers['Idempotency-Key'], 'refund-client-key');
});

test('remote mini-program never equates acceptance, a pending request, or failed settlement with released funds', async () => {
  const orders = ['READY', 'REQUESTED', 'FAILED', 'SIMULATED_SETTLED'].map((settlementState, i) => ({ id: 'o' + i, status: ['accepted', 'settling', 'settlement_failed', 'settled'][i], acceptanceState: 'ACCEPTED', settlementState, total: 10, events: [] }));
  const views = await remoteOrders(orders);
  assert.equal(views[0].status, '已验收待模拟结算'); assert.equal(views[1].status, '模拟结算处理中');
  assert.match(views[0].settlement, /已验收，尚未申请/);
  assert.match(views[1].settlement, /申请处理中/);
  assert.match(views[2].settlement, /结算失败/);
  assert.match(views[3].settlement, /不代表银行到账/);
  for (const view of views) { assert.equal(view.canAdvance, false); assert.match(view.settlement, /未转移真实资金/); assert.match(view.reviewNote, /网页端/); }
});

test('refund and dispute overlays are visible even when a legacy overall status still says delivered', async () => {
  const views = await remoteOrders([
    { id: 'refund', status: 'delivered', settlementState: 'READY', refundState: 'REQUESTED' },
    { id: 'dispute', status: 'delivered', settlementState: 'READY', disputeState: 'OPEN' },
    { id: 'paid-back', status: 'refunded', refundState: 'SIMULATED_REFUNDED' },
    { id: 'review', status: 'review', paymentState: 'UNPAID', settlementState: 'NOT_REQUESTED' }
  ]);
  assert.equal(views[0].status, '退款申请处理中'); assert.match(views[0].settlement, /暂停结算/);
  assert.equal(views[1].status, '已签收待验收'); assert.equal(views[1].disputeNote, '争议处理中'); assert.match(views[1].settlement, /暂停结算/);
  assert.equal(views[2].terminal, true); assert.match(views[2].settlement, /模拟退款完成/);
  assert.match(views[3].settlement, /尚未付款/);
});

test('new local demonstration separates delivery, acceptance and settlement; completed legacy orders stay completed', async () => {
  const source = await readFile(new URL('../weapp/utils/demo.js', import.meta.url), 'utf8');
  const data = new Map([['shared_fabrication_demo_orders_v1', [{ id: 'legacy', stage: 8, requiresReview: false }]]]);
  const context = vm.createContext({ module: { exports: {} }, wx: { getStorageSync: key => structuredClone(data.get(key)), setStorageSync: (key, value) => data.set(key, structuredClone(value)), removeStorageSync: key => data.delete(key) } });
  vm.runInContext(source, context); const demo = context.module.exports;
  // The legacy flow has 9 stages; do not reinterpret its last index as a new intermediate state.
  assert.equal(demo.listOrders()[0].status, '模拟结算完成'); assert.equal(demo.listOrders()[0].canAdvance, false);
  demo.saveSpec(0, 1); const created = demo.createOrder('a');
  const flow = demo.listOrders().find(order => order.id === created.id).timeline.map(step => step.label);
  assert.ok(flow.indexOf('模拟物流签收') < flow.indexOf('模拟客户确认验收'));
  assert.ok(flow.indexOf('模拟客户确认验收') < flow.indexOf('模拟结算申请'));
  assert.ok(flow.indexOf('模拟付款成功') < flow.indexOf('模拟生产中'));
  for (let i = 0; i < flow.indexOf('模拟客户确认验收'); i++) demo.advanceOrder(created.id);
  const accepted = demo.listOrders().find(order => order.id === created.id);
  assert.equal(accepted.status, '模拟客户确认验收'); assert.match(accepted.settlement, /结算尚未完成/); assert.equal(accepted.canAdvance, true);
});
