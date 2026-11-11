import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { applyCommand, createWorkspace } from '../services/platform/core.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Exercise the actual pure HTML renderers with domain-generated states. Browser
// interaction and layout are verified separately; no fake payment API is added.
const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const renderers = source.slice(source.indexOf('const stageNames='), source.indexOf('function networkPage('));
const quoteRenderers = source.slice(source.indexOf('function quoteExpired('), source.indexOf('function uploadModal('));
function ui(workspace) {
  const context = vm.createContext({
    state: workspace, Date, Intl, Number,
    farms: [{ id: 'f1', name: '演示工场' }, { id: 'f2', name: '演示工场二' }, { id: 'f3', name: '演示工场三' }],
    materials: { PLA: { label: 'PLA', process: 'FDM' }, PETG: { label: 'PETG', process: 'FDM' } },
    destinations: { east: '华东' },
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    I: () => '', money: n => '¥' + Number(n).toFixed(2), displayTime: value => new Date(value).toISOString(),
    intro: () => '', nextQueued: d => workspace.orders.find(o => o.farm === d.farm && o.productionState === 'QUEUED'),
  });
  vm.runInContext(renderers + quoteRenderers, context);
  return { call(expression) { return vm.runInContext(expression, context); } };
}
function sandbox() {
  let workspace = createWorkspace({ now: Date.now() }), seq = 0;
  saveCustomerProfile(workspace, customerProfileFixture(), Date.now());
  const run = async (type, payload) => {
    const result = await applyCommand(workspace, { type, payload, idempotencyKey: `ui-v5-${++seq}` });
    workspace = result.workspace; return result.result;
  };
  const action = (action, id, evidence = {}) => run('action', { action, id, demoAcknowledged: true, ...evidence });
  const order = async () => {
    const q = (await run('quote', {})).quotes[0];
    return (await run('order', { quoteId: q.quoteId, demoAcknowledged: true })).order;
  };
  return { run, action, order, get workspace() { return workspace; } };
}
const clear = { partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true };
async function deliver(s, id) {
  await s.action('complete-print', 'p1');
  await s.action('collect-and-qc', id, clear);
  await s.action('ship', id, { carrier: '演示快递', trackingNumber: 'DEMO-UIV5' });
  await s.action('deliver', id);
}

test('customer and merchant views distinguish acceptance, settlement attempt, failure and success', async () => {
  const s = sandbox(), { id } = await s.order();
  await deliver(s, id);
  assert.match(ui(s.workspace).call('orderCard(state.orders[0])'), /确认收货验收/);
  await s.action('accept', id, { customerAccepted: true });
  let view = ui(s.workspace);
  assert.match(view.call('orderCard(state.orders[0])'), /验收完成 · 待结算/);
  assert.doesNotMatch(view.call('orderCard(state.orders[0])'), /data-action="settle"/);
  assert.match(view.call('merchantFinancialTasks()'), /data-action="request-settlement"/);
  let attempt = (await s.action('request-settlement', id)).order.settlementAttempt.id;
  view = ui(s.workspace);
  assert.match(view.call('orderCard(state.orders[0])'), /模拟结算处理中/);
  assert.match(view.call('merchantFinancialTasks()'), /data-action="process-settlement"/);
  await s.action('resolve-settlement', id, { attemptId: attempt, outcome: 'failed', reason: '模拟失败' });
  assert.match(ui(s.workspace).call('merchantFinancialTasks()'), /重新申请模拟结算/);
  attempt = (await s.action('request-settlement', id)).order.settlementAttempt.id;
  await s.action('resolve-settlement', id, { attemptId: attempt, outcome: 'succeeded' });
  view = ui(s.workspace);
  assert.match(view.call('orderCard(state.orders[0])'), /没有真实资金转移/);
  assert.equal(view.call('merchantFinancialTasks()'), '');
});

test('refund view keeps occupied device actions available while hiding duplicate refund requests', async () => {
  const s = sandbox(), { id } = await s.order();
  await s.action('request-refund', id, { reason: '质量需求变更' });
  let view = ui(s.workspace);
  assert.match(view.call('orderCard(state.orders[0])'), /退款申请处理中/);
  assert.doesNotMatch(view.call('orderCard(state.orders[0])'), /data-action="request-refund"/);
  assert.match(view.call('deviceCard(state.devices[0])'), /data-action="complete"/);
  assert.match(view.call('merchantFinancialTasks()'), /请先完成当前任务取件/);
  await s.action('complete-print', 'p1');
  assert.match(ui(s.workspace).call('deviceCard(state.devices[0])'), /data-action="remove"/);
  await s.action('collect-and-qc', id, clear);
  const requestId = s.workspace.orders[0].refundRequest.id;
  await s.action('resolve-refund', id, { requestId, approved: true, reason: '测试退款' });
  view = ui(s.workspace);
  assert.match(view.call('orderCard(state.orders[0])'), /模拟退款完成/);
  assert.doesNotMatch(view.call('orderCard(state.orders[0])'), /data-action="settle"|data-action="request-refund"/);
  assert.equal(view.call('merchantFinancialTasks()'), '');
});

test('dispute view disables acceptance and quotes show expiry plus unverified estimate evidence', async () => {
  const s = sandbox(), { id } = await s.order();
  await deliver(s, id);
  await s.action('dispute', id, { open: true });
  const view = ui(s.workspace), html = view.call('orderCard(state.orders[0])');
  assert.match(html, /data-action="settle"[^>]*disabled/);
  assert.match(html, /撤销演示争议/);
  const q = (await s.run('quote', {})).quotes[0];
  const current = ui({ ...s.workspace, quotes: [q] }).call('qDetails(state.quotes[0])');
  assert.match(current, /报价有效期/);
  assert.match(current, /估算依据/);
  assert.match(current, /未扣除节假日/);
  assert.doesNotMatch(current, /个工作日/);
});
