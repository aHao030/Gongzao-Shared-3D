import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Real local HTTP and disposable SQLite. No production machine, payment or provider calls.
async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coforge-workflow-v8-'));
  let instance, base, now = Date.now();
  async function start() {
    instance = createPlatformServer({ dbPath: path.join(directory, 'platform.sqlite'), clock: () => now });
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
  async function request(cookie, pathname, body, key = randomUUID(), headers = {}) {
    const response = await fetch(base + pathname, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  async function account(merchant = true) {
    const registration = await request(null, '/api/auth/register', { email: `workflow-${randomUUID()}@example.invalid`, password: 'Fixture-workflow-password-v8', displayName: '测试制造流程' });
    ok(registration);
    const cookie = registration.headers.getSetCookie().find(value => !value.includes('Max-Age=0')).split(';')[0];
    ok(await request(cookie, '/api/v2/customer/profile', customerProfileFixture()));
    if (merchant) ok(await request(cookie, '/api/v2/merchant/enroll', { name: '模型询价测试工坊' }));
    return cookie;
  }
  async function upload(cookie) {
    const bytes = await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url));
    const response = await fetch(base + '/api/v2/models', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'Idempotency-Key': randomUUID(), 'X-File-Name': 'inquiry-cube-20mm.stl' }, body: bytes });
    const data = ok({ status: response.status, data: await response.json() });
    assert.deepEqual(data.model.dimensions, [20, 20, 20]); assert.equal(data.model.closed, true);
    return data.model;
  }
  const capabilities = async cookie => ok(await request(cookie, '/api/v2/capabilities')).capabilities;
  const workspace = async cookie => ok(await request(cookie, '/api/v2/workspace')).workspace;
  async function inquiry(cookie, extra = {}) {
    const model = await upload(cookie), capability = (await capabilities(cookie))[0];
    const payload = { modelId: model.id, unit: 'mm', qty: 3, material: 'AUTO', capabilityId: capability.id, requirements: { purpose: '安装配合测试', color: '黑色', toleranceMm: 0.3, note: '请确认装配可行性' }, dimensionsConfirmed: true, demoAcknowledged: true, ...extra };
    return { inquiry: ok(await request(cookie, '/api/v2/inquiries', payload)).inquiry, model, capability, payload };
  }
  function proposalPayload(inquiry, extra = {}) {
    return { inquiryId: inquiry.id, expectedInquiryRevision: inquiry.revision, material: 'PLA', quality: 'standard', manufacturingCents: 100000, shippingCents: 1200, estimatedCostCents: 10000, productionHours: 2, dispatchDays: [2, 3], transitDays: [1, 2], note: '按确认模型制造，尺寸公差需人工验收。', demoAcknowledged: true, ...extra };
  }
  const propose = (cookie, inquiry, extra = {}, key) => request(cookie, '/api/v2/merchant/proposals', proposalPayload(inquiry, extra), key);
  const accept = (cookie, inquiry, revision = inquiry.currentProposalRevision, extra = {}, key) => request(cookie, '/api/v2/inquiries/accept', { inquiryId: inquiry.id, proposalRevision: revision, demoAcknowledged: true, customerAccepted: true, ...extra }, key);
  return { request, account, upload, capabilities, workspace, inquiry, propose, accept, proposalPayload, restart: async () => { await stop(); await start(); }, advance: ms => { now += ms; } };
}
function ok(response) { assert.ok([200, 201].includes(response.status), JSON.stringify(response.data)); return response.data; }
function refused(response, allowed = [400, 409]) { assert.ok(allowed.includes(response.status), JSON.stringify(response)); assert.ok(response.data.error?.code); assert.equal(response.data.workspace, undefined); }
function customerSafe(value) {
  assert.doesNotMatch(JSON.stringify(value), /"(?:pricingProfiles|pricingEvidence|proposalEconomics|privateEvidence|estimatedCostCents|estimatedProfitCents|estimatedMarginBps|targetMarginBps|profitFloorCents|minimumProfitCentsPerMachineHour|materialCostCentsPerKg|costBreakdown|profileSnapshot)"\s*:/);
}
function editableCapability(capability) {
  return Object.fromEntries(['id', 'name', 'farmId', 'process', 'materials', 'maxDimensions', 'qualities', 'enabled', 'quoteMode', 'deviceIds', 'note'].filter(key => capability[key] !== undefined).map(key => [key, structuredClone(capability[key])]));
}

test('HTTP v0.8: uploaded model → merchant plan → exact customer confirmation persists one immutable sandbox order', async t => {
  const h = await harness(t), cookie = await h.account();
  const { inquiry: submitted, model } = await h.inquiry(cookie);
  assert.equal(submitted.status, 'AWAITING_MERCHANT');
  assert.equal((await h.workspace(cookie)).orders.length, 0);
  const proposed = ok(await h.propose(cookie, submitted));
  const plan = proposed.inquiry;
  assert.equal(plan.status, 'AWAITING_CUSTOMER');
  assert.equal((await h.workspace(cookie)).orders.length, 0);
  const publicPlans = ok(await h.request(cookie, '/api/v2/inquiries'));
  customerSafe(publicPlans); customerSafe(await h.workspace(cookie));
  const key = randomUUID();
  const accepted = await Promise.all(Array.from({ length: 5 }, () => h.accept(cookie, plan, plan.currentProposalRevision, {}, key)));
  const results = accepted.map(ok), order = results[0].order;
  for (const result of results) {
    assert.equal(result.order.id, order.id);
    assert.equal(result.moneyTransferred, 0); assert.equal(result.physicalCommandsSent, 0);
    customerSafe(result);
  }
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.equal(order.modelId, model.id); assert.equal(order.modelHash, model.sha256);
  assert.equal(order.paymentState, 'SIMULATED_FROZEN'); assert.equal(order.payable, false);
  assert.equal(order.productionState, 'REVIEW_REQUIRED', 'merchant review does not authorize real or automatic printing');
  assert.equal(order.approvedPlan, true);
  assert.equal(order.totalCents, 100000 + 7000 + 1200);
  assert.equal((await h.workspace(cookie)).orders.length, 1);
  refused(await h.propose(cookie, results[0].inquiry, { manufacturingCents: 120000 }));
  await h.restart();
  const restored = await h.workspace(cookie);
  assert.deepEqual(restored.orders.find(item => item.id === order.id), order);
  assert.equal(ok(await h.accept(cookie, plan, plan.currentProposalRevision, {}, key)).replayed, true);
  assert.equal((await h.workspace(cookie)).orders.length, 1);
});

test('HTTP v0.8: proposal revisions invalidate old acceptance and concurrent double acceptance cannot duplicate orders', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  const first = ok(await h.propose(cookie, inquiry)).inquiry;
  const second = ok(await h.propose(cookie, first, { material: 'PETG', manufacturingCents: 110000, dispatchDays: [3, 5], note: '改用 PETG，价格与交期更新，请重新确认。' })).inquiry;
  assert.ok(second.currentProposalRevision > first.currentProposalRevision);
  refused(await h.accept(cookie, first));
  assert.equal((await h.workspace(cookie)).orders.length, 0);
  const responses = await Promise.all([h.accept(cookie, second), h.accept(cookie, second)]);
  assert.equal(responses.filter(response => [200, 201].includes(response.status)).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 1);
  const order = (await h.workspace(cookie)).orders[0];
  assert.equal(order.material, 'PETG'); assert.equal(order.totalCents, 110000 + 7700 + 1200);
  assert.equal((await h.workspace(cookie)).orders.length, 1);
});

test('HTTP v0.8: a saved address change prevents acceptance at the old delivery terms', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  const plan = ok(await h.propose(cookie, inquiry)).inquiry;
  ok(await h.request(cookie, '/api/v2/customer/profile', customerProfileFixture({ shippingAddress: { city: '宁波市', district: '海曙区', addressLine: '测试路2号' } })));
  refused(await h.accept(cookie, plan));
  assert.equal((await h.workspace(cookie)).orders.length, 0);
  const refreshed = ok(await h.propose(cookie, plan, { shippingCents: 1500, note: '新地址已重新确认运费与交付窗口。' })).inquiry;
  assert.ok(refreshed.currentProposalRevision > plan.currentProposalRevision);
  const accepted = ok(await h.accept(cookie, refreshed)).order;
  assert.equal(accepted.shippingAddress.city, '宁波市');
  assert.equal(accepted.totalCents, 108500);
});

test('HTTP v0.8: capability revisions and disabling prevent stale terms from becoming an order', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry, capability } = await h.inquiry(cookie);
  const plan = ok(await h.propose(cookie, inquiry)).inquiry;
  const changed = await h.request(cookie, '/api/v2/merchant/capabilities', { capability: { ...editableCapability(capability), enabled: false }, expectedRevision: capability.revision, demoAcknowledged: true });
  ok(changed);
  refused(await h.accept(cookie, plan));
  assert.equal((await h.workspace(cookie)).orders.length, 0);
  const model = await h.upload(cookie);
  refused(await h.request(cookie, '/api/v2/inquiries', { modelId: model.id, capabilityId: capability.id, unit: 'mm', qty: 1, material: 'PLA', requirements: {}, dimensionsConfirmed: true, demoAcknowledged: true }));
  refused(await h.request(cookie, '/api/v2/merchant/capabilities', { capability: { ...editableCapability(capability), name: '过期覆盖' }, expectedRevision: capability.revision, demoAcknowledged: true }));
});

test('HTTP v0.8: anonymous and unenrolled accounts cannot set merchant capabilities or create manufacturing proposals', async t => {
  const h = await harness(t), enrolled = await h.account(), customer = await h.account(false), { inquiry, capability } = await h.inquiry(enrolled);
  refused(await h.request(null, '/api/v2/merchant/capabilities'), [401]);
  refused(await h.request(null, '/api/v2/merchant/proposals', h.proposalPayload(inquiry)), [401]);
  refused(await h.request(customer, '/api/v2/merchant/capabilities'), [403]);
  refused(await h.request(customer, '/api/v2/merchant/capabilities', { capability: editableCapability(capability), expectedRevision: capability.revision, demoAcknowledged: true }), [403]);
  refused(await h.propose(customer, inquiry), [403]);
});

test('HTTP v0.8: owner boundaries protect uploaded files, inquiries, proposals and customer confirmation', async t => {
  const h = await harness(t), a = await h.account(), b = await h.account();
  const { inquiry, model } = await h.inquiry(a);
  const plan = ok(await h.propose(a, inquiry)).inquiry;
  const beforeA = await h.workspace(a), beforeB = await h.workspace(b);
  const listedB = ok(await h.request(b, '/api/v2/inquiries'));
  assert.equal(listedB.inquiries.length, 0);
  refused(await h.propose(b, plan), [404]);
  refused(await h.accept(b, plan), [404]);
  const capability = (await h.capabilities(b))[0];
  refused(await h.request(b, '/api/v2/inquiries', { modelId: model.id, capabilityId: capability.id, unit: 'mm', qty: 1, material: 'AUTO', requirements: {}, dimensionsConfirmed: true, demoAcknowledged: true }), [404]);
  assert.deepEqual(await h.workspace(a), beforeA); assert.deepEqual(await h.workspace(b), beforeB);
});

test('HTTP v0.8: uploaded-model requirements reject unconfirmed dimensions, invalid quantities, material and tolerance', async t => {
  const h = await harness(t), cookie = await h.account(), model = await h.upload(cookie), capability = (await h.capabilities(cookie))[0];
  const valid = { modelId: model.id, capabilityId: capability.id, unit: 'mm', qty: 1, material: 'AUTO', requirements: {}, dimensionsConfirmed: true, demoAcknowledged: true };
  for (const bad of [{ dimensionsConfirmed: false }, { qty: 0 }, { qty: 51 }, { qty: 1.2 }, { unit: 'cm' }, { material: 'NOT_A_MATERIAL' }, { requirements: { toleranceMm: -0.1 } }, { requirements: { toleranceMm: '0.2' } }]) {
    refused(await h.request(cookie, '/api/v2/inquiries', { ...valid, ...bad }));
  }
  assert.equal(ok(await h.request(cookie, '/api/v2/inquiries')).inquiries.length, 0);
});

test('HTTP v0.8: merchant proposal must cover configured profit floors and cannot omit cost evidence', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  refused(await h.propose(cookie, inquiry, { manufacturingCents: 100, estimatedCostCents: 10000 }));
  refused(await h.propose(cookie, inquiry, { manufacturingCents: 12000, estimatedCostCents: 10000 }), [409]); // positive profit, but below the configured 30% target
  refused(await h.propose(cookie, inquiry, { manufacturingCents: 50000, estimatedCostCents: 10000, productionHours: 100, dispatchDays: [5, 6] }), [409]); // target margin passes, hourly profit floor does not
  refused(await h.propose(cookie, inquiry, { estimatedCostCents: null }));
  refused(await h.propose(cookie, inquiry, { productionHours: 0 }));
  refused(await h.propose(cookie, inquiry, { manufacturingCents: -100 }));
  refused(await h.propose(cookie, inquiry, { shippingCents: -1 }));
  refused(await h.propose(cookie, inquiry, { dispatchDays: [5, 2] }));
  refused(await h.propose(cookie, inquiry, { material: 'CNC' }));
  assert.equal(ok(await h.request(cookie, '/api/v2/inquiries')).inquiries[0].status, 'AWAITING_MERCHANT');
  assert.equal((await h.workspace(cookie)).orders.length, 0);
});

test('HTTP v0.8: acceptance requires explicit customer confirmation and unexpired proposal', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  const plan = ok(await h.propose(cookie, inquiry)).inquiry;
  refused(await h.accept(cookie, plan, plan.currentProposalRevision, { customerAccepted: false }));
  refused(await h.accept(cookie, plan, plan.currentProposalRevision, { demoAcknowledged: false }));
  refused(await h.accept(cookie, plan, 0));
  h.advance(48 * 60 * 60 * 1000);
  refused(await h.accept(cookie, plan));
  assert.equal((await h.workspace(cookie)).orders.length, 0);
});

test('HTTP v0.8: client-injected totals and production flags cannot change the accepted server plan', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  const plan = ok(await h.propose(cookie, inquiry)).inquiry;
  const result = await h.accept(cookie, plan, plan.currentProposalRevision, { totalCents: 1, material: 'CNC', productionState: 'PRINTING', paymentState: 'PAID', payable: true, approvedPlan: true, physicalCommandsSent: 1 });
  if ([400, 409].includes(result.status)) {
    refused(result); assert.equal((await h.workspace(cookie)).orders.length, 0);
  } else {
    const accepted = ok(result);
    assert.equal(accepted.order.totalCents, 108200);
    assert.equal(accepted.order.material, 'PLA');
    assert.equal(accepted.order.productionState, 'REVIEW_REQUIRED');
    assert.equal(accepted.order.paymentState, 'SIMULATED_FROZEN');
    assert.equal(accepted.order.payable, false);
    assert.equal(accepted.physicalCommandsSent, 0); assert.equal(accepted.moneyTransferred, 0);
  }
});

test('HTTP v0.8: merchant workflow endpoints retain origin protection and request-key binding', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  const payload = h.proposalPayload(inquiry), key = randomUUID();
  refused(await h.request(cookie, '/api/v2/merchant/proposals', payload, key, { Origin: 'https://unrelated.invalid' }), [403]);
  assert.equal(ok(await h.request(cookie, '/api/v2/inquiries')).inquiries[0].status, 'AWAITING_MERCHANT');
  const first = ok(await h.request(cookie, '/api/v2/merchant/proposals', payload, key));
  const revision = (await h.workspace(cookie)).revision;
  assert.equal(ok(await h.request(cookie, '/api/v2/merchant/proposals', payload, key)).replayed, true);
  refused(await h.request(cookie, '/api/v2/merchant/proposals', { ...payload, manufacturingCents: 120000 }, key));
  assert.equal((await h.workspace(cookie)).revision, revision);
  assert.equal(ok(await h.request(cookie, '/api/v2/inquiries')).inquiries[0].currentProposalRevision, first.inquiry.currentProposalRevision);
});

test('HTTP v0.8: standard supported model can estimate automatically but still requires customer confirmation', async t => {
  const h = await harness(t), cookie = await h.account();
  const { inquiry } = await h.inquiry(cookie, { material: 'PLA', qty: 1, requirements: {} });
  assert.equal(inquiry.status, 'AWAITING_CUSTOMER');
  assert.ok(inquiry.currentProposalRevision > 0);
  assert.equal((await h.workspace(cookie)).orders.length, 0);
  const order = ok(await h.accept(cookie, inquiry)).order;
  assert.equal(order.paymentState, 'SIMULATED_FROZEN'); assert.equal(order.payable, false);
  assert.ok(['PRINTING', 'QUEUED'].includes(order.productionState));
  assert.equal((await h.workspace(cookie)).orders.length, 1);
});

test('HTTP v0.8: tolerances and special requirements route to merchant review instead of assuming model validation', async t => {
  const h = await harness(t), cookie = await h.account();
  for (const requirements of [{ toleranceMm: 0.01 }, { purpose: '需承载 20 kg' }, { color: '定制色' }, { note: '表面喷砂' }]) {
    const { inquiry } = await h.inquiry(cookie, { material: 'PLA', requirements });
    assert.equal(inquiry.status, 'AWAITING_MERCHANT');
    assert.equal(inquiry.currentProposalRevision ?? 0, 0);
  }
  assert.equal((await h.workspace(cookie)).orders.length, 0);
});

test('HTTP v0.8: a paid reviewed plan can be cancelled with an explicit pending refund and separate completion', async t => {
  const h = await harness(t), cookie = await h.account(), { inquiry } = await h.inquiry(cookie);
  const plan = ok(await h.propose(cookie, inquiry)).inquiry;
  const order = ok(await h.accept(cookie, plan)).order;
  const action = (action, extra = {}) => h.request(cookie, '/api/v2/actions', { action, id: order.id, demoAcknowledged: true, ...extra });
  const cancelled = ok(await action('cancel')).order;
  assert.equal(cancelled.productionState, 'CANCELLED');
  assert.equal(cancelled.paymentState, 'SIMULATED_FROZEN');
  assert.equal(cancelled.refundState, 'REQUESTED');
  assert.equal(cancelled.refundRequest.amountCents, order.totalCents);
  assert.deepEqual(cancelled.quoteSnapshot, order.quoteSnapshot);
  const refunded = ok(await action('resolve-refund', { requestId: cancelled.refundRequest.id, approved: true }));
  assert.equal(refunded.order.paymentState, 'SIMULATED_REFUNDED');
  assert.equal(refunded.order.refundState, 'SIMULATED_REFUNDED');
  assert.equal(refunded.moneyTransferred, 0);
  assert.deepEqual(refunded.order.quoteSnapshot, order.quoteSnapshot);
  await h.restart();
  assert.deepEqual((await h.workspace(cookie)).orders[0], refunded.order);
});

test('HTTP v0.8: revised pricing invalidates an unpaid offer while paid plan and order snapshots remain unchanged', async t => {
  const h = await harness(t), cookie = await h.account();
  const first = await h.inquiry(cookie), second = await h.inquiry(cookie);
  const paidPlan = ok(await h.propose(cookie, first.inquiry)).inquiry;
  const pendingPlan = ok(await h.propose(cookie, second.inquiry)).inquiry;
  const paid = ok(await h.accept(cookie, paidPlan)).order;
  const profile = ok(await h.request(cookie, '/api/v2/merchant/pricing')).profiles.find(p => p.farmId === first.capability.farmId);
  const edited = Object.fromEntries(Object.entries(profile).filter(([key]) => !['farmId', 'farmName', 'revision', 'updatedAt', 'mode'].includes(key)));
  edited.targetMarginBps += 500;
  ok(await h.request(cookie, '/api/v2/merchant/pricing', { farmId: profile.farmId, expectedRevision: profile.revision, profile: edited, demoAcknowledged: true }));
  refused(await h.accept(cookie, pendingPlan));
  assert.deepEqual((await h.workspace(cookie)).orders.find(order => order.id === paid.id), paid);
  const freshPlan = ok(await h.propose(cookie, pendingPlan)).inquiry;
  const freshOrder = ok(await h.accept(cookie, freshPlan)).order;
  assert.equal(freshOrder.paymentState, 'SIMULATED_FROZEN');
  assert.deepEqual((await h.workspace(cookie)).orders.find(order => order.id === paid.id), paid);
});

test('HTTP v0.8: saved merchant templates support both reviewed orders and the specifically selected automatic template', async t => {
  const h = await harness(t), cookie = await h.account(), original = (await h.capabilities(cookie))[0];
  ok(await h.request(cookie, '/api/v2/merchant/capabilities', { capability: { ...editableCapability(original), quoteMode: 'MERCHANT_REVIEW' }, expectedRevision: original.revision, demoAcknowledged: true }));
  const { inquiry: manual } = await h.inquiry(cookie);
  const proposed = ok(await h.propose(cookie, manual)).inquiry;
  const manualOrder = ok(await h.accept(cookie, proposed)).order;
  assert.equal(manualOrder.productionState, 'REVIEW_REQUIRED');
  const automaticConfig = { ...editableCapability(original), name: '同一工场的标准自动估价配置', quoteMode: 'AUTO_ESTIMATE' };
  delete automaticConfig.id;
  const automatic = ok(await h.request(cookie, '/api/v2/merchant/capabilities', { capability: automaticConfig, expectedRevision: 0, demoAcknowledged: true })).capability;
  const { inquiry: standard } = await h.inquiry(cookie, { material: 'PLA', requirements: {}, capabilityId: automatic.id });
  assert.equal(standard.status, 'AWAITING_CUSTOMER');
  const standardOrder = ok(await h.accept(cookie, standard)).order;
  assert.ok(['PRINTING', 'QUEUED'].includes(standardOrder.productionState));
  assert.equal(standardOrder.capabilitySnapshot.id, automatic.id);
  assert.equal((await h.workspace(cookie)).orders.length, 2);
});
