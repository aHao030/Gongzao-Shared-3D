import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { applyCommand, createWorkspace } from '../services/platform/core.mjs';
import { applyMerchantCommand } from '../services/platform/merchant.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { getMerchantPricing, savePricingProfile } from '../services/platform/pricing.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const merchantSource = (await readFile(new URL('../dist/merchant-ui.js', import.meta.url), 'utf8')).replace(/^import .*\n/, '').replace('export function createMerchantUI', 'function createMerchantUI');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '¥' + Number(n).toFixed(2);
function customerUI(workspace) {
  const context = vm.createContext({ state: workspace, Date, Intl, Number, esc, money, I: () => '', displayTime: v => new Date(v).toISOString(), destinations: { east: '华东' } });
  vm.runInContext(appSource.slice(appSource.indexOf('const stageNames='), appSource.indexOf('function networkPage(')) + appSource.slice(appSource.indexOf('function quoteExpired('), appSource.indexOf('function uploadModal(')), context);
  return expression => vm.runInContext(expression, context);
}
async function sandbox() {
  let workspace = createWorkspace({ now: Date.now() }), seq = 0;
  saveCustomerProfile(workspace, customerProfileFixture(), Date.now());
  workspace = (await applyMerchantCommand(workspace, { type: 'enroll', payload: { name: '测试制造工坊' }, idempotencyKey: 'pricing-ui-enroll' }, { ownerId: 'pricing-ui-owner', now: Date.now() })).workspace;
  const run = async (type, payload) => {
    const result = await applyCommand(workspace, { type, payload, idempotencyKey: `pricing-ui-${++seq}` });
    workspace = result.workspace; return result.result;
  };
  return { run, get workspace() { return workspace; } };
}
function merchantUI(workspace) {
  const events = {}, requests = [];
  const context = vm.createContext({
    Date, Intl, Number, Set, Object, Math, location: { pathname: '/merchant', hash: '#pricing' },
    document: { querySelector: selector => selector === '#merchant-pricing-form' ? { reportValidity: () => true } : null, addEventListener: (name, handler) => (events[name] ??= []).push(handler) },
    window: { addEventListener() {}, scrollTo() {} }, history: { replaceState() {} }, setTimeout, clearTimeout,
    get: async path => { assert.equal(path, '/merchant/pricing'); return getMerchantPricing(workspace); },
    prepareMutation: async (path, payload) => ({ execute: async () => { assert.equal(path, '/merchant/pricing'); requests.push(payload); return savePricingProfile(workspace, payload, Date.now()); } }),
    dependencies: { icon: () => '', escape: esc, render() {}, modal() {}, closeModal() {}, toast() {}, legacyOrders: () => '', connection: () => 'online', session: () => ({}) },
  });
  vm.runInContext(merchantSource + '\nglobalThis.ui=createMerchantUI(dependencies);', context);
  context.ui.state.profile = workspace.merchant.profile;
  context.ui.state.loaded = true;
  context.ui.state.pricing = getMerchantPricing(workspace);
  const input = async (key, value) => { for (const listener of events.input) await listener({ target: { matches: selector => selector === '[data-pricing-field]', dataset: { pricingField: key }, value } }); };
  const click = async action => events.click[0]({ target: { closest: () => ({ dataset: { merchantAction: action } }) }, preventDefault() {} });
  return { ui: context.ui, input, click, requests };
}

test('customer batch quote shows sales prices and unverified plate count without private costs', async () => {
  const s = await sandbox();
  const q = (await s.run('quote', { qty: 30 })).quotes[0];
  const html = customerUI({ ...s.workspace, quotes: [q] })('qDetails(state.quotes[0])');
  assert.match(html, /预计每板最多/);
  assert.ok(html.includes(q.batch.plateCount + ' 板 · 30 件'));
  assert.match(html, /未实际排版或切片/);
  assert.match(html, /平均每件制造价约/);
  for (const cents of [q.pricingSummary.manufacturingCents, q.pricingSummary.platformFeeCents, q.pricingSummary.shippingCents, q.totalCents]) assert.ok(html.includes(money(cents / 100)));
  assert.doesNotMatch(html, /已配置成本估算|采购价|预测制造利润|目标毛利率|每设备小时最低预测利润/);
});

test('merchant financial view separates merchant receivable from full-customer refund and preserves legacy history', async () => {
  const s = await sandbox(), q = (await s.run('quote', { qty: 2 })).quotes[0];
  const order = (await s.run('order', { quoteId: q.quoteId, demoAcknowledged: true })).order;
  const view = customerUI(s.workspace), breakdown = order.settlementBreakdown;
  const details = view('settlementAmountDetails(state.orders[0])');
  assert.match(details, /商家应收合计/);
  assert.match(details, /平台服务费（不归商家）/);
  assert.ok(details.includes(money(breakdown.merchantReceivableCents / 100)));
  assert.ok(details.includes(money(order.totalCents / 100)));
  await s.run('action', { action: 'request-refund', id: order.id, reason: '测试全款退款', demoAcknowledged: true });
  const refund = customerUI(s.workspace)('merchantFinancialTasks()');
  assert.match(refund, /客户全额退款/);
  assert.ok(refund.includes(money(order.totalCents / 100)));
  assert.doesNotMatch(refund, /商家应收合计/);
  const historical = structuredClone(order); delete historical.settlementBreakdown;
  historical.settlementState = 'SIMULATED_SETTLED';
  assert.match(customerUI({ orders: [historical] })('settlementAmountDetails(state.orders[0])'), /按历史记录保留/);
  historical.settlementState = 'REQUESTED';
  assert.match(customerUI({ orders: [historical] })('settlementAmountDetails(state.orders[0])'), /先模拟失败，再重新申请/);
});

test('merchant settings use cents and basis points, retain stale revision and refresh intentionally', async () => {
  const s = await sandbox();
  await s.run('quote', { qty: 30 });
  const m = merchantUI(s.workspace);
  const html = m.ui.renderContent();
  assert.match(html, /不是行业正常利润或收益保证/);
  assert.match(html, /已配置成本估算/);
  assert.match(html, /预测利润率（未计税费等）/);
  assert.match(html, /成本风险预留比例/);
  assert.match(html, /演示出料估速/);
  await m.input('PLA', '61.23'); await m.input('targetMarginBps', '35.50');
  await m.input('estimatedThroughputGramsPerHour', '21.25');
  await m.click('save-pricing');
  const sent = m.requests[0];
  assert.equal(sent.profile.materialCostCentsPerKg.PLA, 6123);
  assert.equal(sent.profile.targetMarginBps, 3550);
  assert.equal(sent.profile.estimatedThroughputGramsPerHour, 21.25);
  assert.equal(sent.expectedRevision, 1);
  assert.equal(m.ui.state.pricing.profiles[0].revision, 2);
  m.ui.renderContent(); await m.input('PLA', '66');
  const current = getMerchantPricing(s.workspace).profiles[0];
  const { farmId, farmName, revision, updatedAt, mode, ...profile } = current;
  savePricingProfile(s.workspace, { farmId, expectedRevision: revision, profile: { ...profile, targetMarginBps: 4000 }, demoAcknowledged: true }, Date.now());
  // A background refresh may update server data, but cannot bless an older draft.
  m.ui.state.pricing = getMerchantPricing(s.workspace);
  await m.click('save-pricing');
  assert.equal(m.requests[1].expectedRevision, 2);
  assert.equal(m.ui.state.error.code, 'PRICING_REVISION_CONFLICT');
  assert.equal(m.ui.state.pricingDrafts.f1.PLA, '66');
  await m.click('refresh-pricing');
  assert.equal(m.ui.state.error, null);
  assert.equal(m.ui.state.retry, null);
  assert.match(m.ui.renderContent(), /id="pricing-targetMarginBps"[^>]*value="40"/);
});

test('typing quantity updates state before blur and invalidates an in-flight one-piece quote', async () => {
  let resolveOld, signalStarted, renderCount = 0, nextTimer = 0;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const scheduled = new Map(), sent = [];
  const state = { qty: 1, quantityDraft: null, busy: false, model: { id: 'sample-bracket' }, material: 'PLA', quality: 'standard', unit: 'mm', connection: 'online', customerProfile: { addressRevision: 1 }, quotes: [], quoteLoading: false };
  const context = vm.createContext({
    state, Number, String, Math, JSON, parseInt,
    $: () => ({ outerHTML: '' }), quotePlaceholder: () => '<p>重新测算</p>',
    render: () => { renderCount++; }, hasShippingAddress: () => true, applyWorkspace() {},
    setTimeout: callback => { const id = ++nextTimer; scheduled.set(id, callback); return id; },
    clearTimeout: id => scheduled.delete(id),
    prepareMutation: async (path, config) => { sent.push({ ...config }); return { execute: () => new Promise(resolve => { resolveOld = resolve; signalStarted(); }) }; },
  });
  const helpers = appSource.slice(appSource.indexOf('function validQuantity('), appSource.indexOf('async function perform('));
  const clear = appSource.slice(appSource.indexOf('function clearQuotes('), appSource.indexOf('async function reloadCustomerProfile('));
  vm.runInContext('let quoteSequence=0,quoteTask=null,quoteTimer=null;\n' + clear + helpers, context);
  const oldRequest = vm.runInContext('refreshQuotes()', context);
  await started;
  assert.equal(sent[0].qty, 1);
  const priorRenders = renderCount;
  vm.runInContext("editQuantity('');editQuantity('3');editQuantity('30')", context);
  assert.equal(state.qty, 30);
  assert.equal(state.quantityDraft, '30');
  assert.equal(renderCount, priorRenders, 'typing must not replace the input node');
  assert.equal(scheduled.size, 1, 'only the latest quantity schedules a quote');
  resolveOld({ quotes: [{ qty: 1, addressRevision: 1 }], workspace: {} });
  await oldRequest;
  assert.equal(state.quotes.length, 0, 'late one-piece response must be discarded');
  assert.equal(renderCount, priorRenders, 'discarded response must not redraw the quantity');
  vm.runInContext("commitQuantity('30');state.quality='fine';configurationChanged()", context);
  assert.equal(state.qty, 30);
  assert.equal(state.quantityDraft, null);
  assert.equal(vm.runInContext('selectedConfiguration().qty', context), 30);
  vm.runInContext("editQuantity('')", context);
  await vm.runInContext('refreshQuotes()', context);
  assert.equal(sent.length, 1, 'empty intermediate input must not send the previous quantity');
  assert.match(state.quoteError.message, /1–50/);
});
