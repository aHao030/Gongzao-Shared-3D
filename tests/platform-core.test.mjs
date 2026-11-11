import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

function sandbox() {
  let workspace = createWorkspace({ now: 1000000 }), sequence = 0, clock = 1000000;
  saveCustomerProfile(workspace, customerProfileFixture(), clock);
  const run = async (type, payload, key = `key-${++sequence}`) => {
    const response = await applyCommand(workspace, { type, payload, idempotencyKey: key }, { now: clock, idFactory: () => `id-${++sequence}` });
    workspace = response.workspace; return response;
  };
  const quote = async (config = {}) => (await run('quote', config)).result.quotes[0];
  const order = async (config = {}) => { const q = await quote(config); return (await run('order', { quoteId: q.quoteId, demoAcknowledged: true })).result.order; };
  const action = (action, id, extra = {}, key) => run('action', { action, id, demoAcknowledged: true, ...extra }, key);
  return { run, quote, order, action, get workspace() { return workspace; }, set workspace(value) { workspace = value; }, set clock(value) { clock = value; } };
}
const clear = { partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true };
async function delivered(s) {
  const order = await s.order();
  await s.action('complete-print', 'p1');
  await s.action('collect-and-qc', order.id, clear);
  await s.action('ship', order.id, { carrier: '测试快递 · 模拟', trackingNumber: 'DEMO-TEST123' });
  await s.action('deliver', order.id);
  return order.id;
}

test('quote uses server prices, integer-cent totals and immutable original geometry', async () => {
  const s = sandbox();
  const q = await s.quote({ material: 'PETG', qty: 3, quality: 'fine', totalCents: 1, volume: 0.001 });
  assert.equal(q.review, false);
  assert.equal(q.materialKey, 'PETG');
  assert.equal(q.totalCents, q.materialCents + q.machineCents + q.finishingCents + q.shippingCents + q.serviceCents);
  assert.equal(Number.isSafeInteger(q.totalCents), true);
  assert.equal(q.total, q.totalCents / 100);
  assert.notEqual(q.totalCents, 1);
  const inches = await s.quote({ unit: 'inch' });
  assert.equal(inches.review, true);
  assert.equal(inches.dimensions[0], 72 * 25.4);
  assert.deepEqual(s.workspace.models[0].dimensions, [72, 48, 58]);
});

test('expired or tampered quote and changed file identity cannot create an order', async () => {
  const s = sandbox(), q = await s.quote();
  const original = structuredClone(s.workspace);
  s.clock = q.expiresAt;
  await assert.rejects(s.run('order', { quoteId: q.quoteId, demoAcknowledged: true }), { code: 'QUOTE_EXPIRED' });
  assert.deepEqual(s.workspace, original);
  s.clock = q.issuedAt + 1;
  s.workspace.quotes[0].totalCents = 1;
  await assert.rejects(s.run('order', { quoteId: q.quoteId, demoAcknowledged: true }), { code: 'QUOTE_CHANGED' });
  s.workspace = structuredClone(original); s.workspace.models[0].sha256 = 'a'.repeat(64);
  await assert.rejects(s.run('order', { quoteId: q.quoteId, demoAcknowledged: true }), { code: 'MODEL_CHANGED' });
});

test('durable idempotency survives JSON reload, rejects conflicting payload and prevents quote reuse', async () => {
  const s = sandbox(), q = await s.quote();
  const payload = { quoteId: q.quoteId, demoAcknowledged: true };
  const first = await s.run('order', payload, 'create-once');
  const revision = s.workspace.revision;
  s.workspace = JSON.parse(JSON.stringify(s.workspace));
  const again = await s.run('order', payload, 'create-once');
  assert.equal(again.replayed, true); assert.equal(again.result.order.id, first.result.order.id);
  assert.equal(s.workspace.revision, revision); assert.equal(s.workspace.orders.length, 1);
  await assert.rejects(s.run('order', { ...payload, totalCents: 1 }, 'create-once'), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(s.run('order', payload, 'another-key'), { code: 'QUOTE_USED' });
});

test('wrong material blocks automatic start and FIFO prevents newer jobs bypassing it', async () => {
  const s = sandbox(), first = await s.order({ material: 'PETG' }), second = await s.order({ material: 'PLA' });
  assert.equal(first.status, 'queued'); assert.equal(second.status, 'queued');
  assert.equal(s.workspace.devices[0].blockedReason, 'MATERIAL_MISMATCH');
  const wrong = await s.action('prepare-device', 'p1', { bedClear: true, materialReady: true, loadedMaterial: 'PLA' });
  assert.equal(wrong.result.blockedReason, 'MATERIAL_MISMATCH');
  assert.equal(s.workspace.devices[0].orderId, null);
  await s.action('prepare-device', 'p1', { bedClear: true, materialReady: true, loadedMaterial: 'PETG' });
  assert.equal(s.workspace.devices[0].orderId, first.id);
  assert.equal(s.workspace.orders[1].status, 'queued');
});

test('completed print retains physical occupancy; failed QC cannot ship or settle', async () => {
  const s = sandbox(), first = await s.order(), second = await s.order();
  await s.action('complete-print', 'p1');
  assert.equal(s.workspace.devices[0].state, 'waiting');
  assert.equal(s.workspace.devices[0].orderId, first.id);
  assert.equal(s.workspace.orders[1].status, 'queued');
  await assert.rejects(s.action('prepare-device', 'p1', clear), { code: 'DEVICE_OCCUPIED' });
  await assert.rejects(s.action('collect-and-qc', first.id, { ...clear, partRemoved: false }), { code: 'QC_EVIDENCE_REQUIRED' });
  await s.action('collect-and-qc', first.id, { ...clear, qcPassed: false });
  assert.equal(s.workspace.orders[0].status, 'qc_failed');
  assert.equal(s.workspace.devices[0].orderId, second.id);
  await assert.rejects(s.action('ship', first.id, { carrier: '模拟', trackingNumber: 'DEMO-FAIL' }), { code: 'SHIPMENT_NOT_ALLOWED' });
  await assert.rejects(s.action('accept', first.id, { customerAccepted: true }), { code: 'SETTLEMENT_BLOCKED' });
});

test('old collection commands cannot release a device already printing a later order', async () => {
  const s = sandbox(), first = await s.order(), second = await s.order();
  await s.action('complete-print', 'p1');
  await s.action('collect-and-qc', first.id, clear, 'collect-first');
  const before = structuredClone(s.workspace.devices[0]);
  await s.action('collect-and-qc', first.id, clear, 'collect-first');
  assert.deepEqual(s.workspace.devices[0], before);
  await assert.rejects(s.action('collect-and-qc', first.id, clear), { code: 'COLLECTION_NOT_ALLOWED' });
  assert.equal(s.workspace.devices[0].orderId, second.id);
});

test('logistics delivery is independent of acceptance; dispute blocks settlement until closed', async () => {
  const s = sandbox(), id = await delivered(s);
  assert.equal(s.workspace.orders[0].status, 'delivered');
  assert.equal(s.workspace.orders[0].productionState, 'QC_PASSED');
  assert.equal(s.workspace.orders[0].acceptanceState, 'PENDING');
  assert.equal(s.workspace.orders[0].settlementState, 'NOT_REQUESTED');
  await s.action('dispute', id, { open: true });
  await assert.rejects(s.action('accept', id, { customerAccepted: true }), { code: 'SETTLEMENT_BLOCKED' });
  await s.action('dispute', id, { open: false });
  await assert.rejects(s.action('accept', id, { customerAccepted: false }), { code: 'ACCEPTANCE_REQUIRED' });
  const accepted = await s.action('accept', id, { customerAccepted: true }, 'accept-once');
  assert.equal(accepted.result.order.status, 'accepted'); assert.equal(accepted.result.order.paymentState, 'SIMULATED_FROZEN'); assert.equal(accepted.result.moneyTransferred, 0);
  const revision = s.workspace.revision;
  await s.action('accept', id, { customerAccepted: true }, 'accept-once');
  assert.equal(s.workspace.revision, revision);
  await assert.rejects(s.action('accept', id, { customerAccepted: true }), { code: 'SETTLEMENT_BLOCKED' });
});

test('cancelling a blocked queued job starts the next compatible one but cannot cancel running work', async () => {
  const s = sandbox(), first = await s.order({ material: 'PETG' }), second = await s.order();
  await s.action('cancel', first.id);
  assert.equal(s.workspace.orders[0].paymentState, 'SIMULATED_FROZEN');
  assert.equal(s.workspace.orders[0].refundState, 'REQUESTED');
  assert.equal(s.workspace.devices[0].orderId, second.id);
  await assert.rejects(s.action('cancel', second.id), { code: 'CANCELLATION_NOT_ALLOWED' });
});

test('uploaded file metadata binds orders to its hash and manual review cannot simulate payment', async () => {
  const s = sandbox();
  const model = (await s.run('register-model', { id: 'cad-file', name: 'part.step', size: 120, sha256: 'a'.repeat(64), dimensions: [], volume: 0, closed: false, review: true, format: 'step' })).result.model;
  const order = await s.order({ modelId: model.id });
  assert.equal(order.modelHash, model.sha256); assert.equal(order.status, 'review');
  assert.equal(order.paymentState, 'UNPAID'); assert.equal(s.workspace.devices[0].state, 'ready');
  await assert.rejects(s.run('register-model', { id: 'bad', name: 'bad.stl', size: 12, sha256: 'b'.repeat(64), dimensions: [1, 1, 1], volume: 100, closed: true, review: false, format: 'stl' }), { code: 'INVALID_GEOMETRY' });
});

test('input and foreign-resource rejection leave the entire workspace unchanged', async () => {
  const s = sandbox(), original = structuredClone(s.workspace);
  for (const payload of [{ qty: -1 }, { qty: 1.2 }, { qty: 51 }, { material: '__proto__' }, { destination: 'unknown' }]) await assert.rejects(s.run('quote', payload));
  await assert.rejects(s.action('deliver', 'another-owner-order'), { code: 'ORDER_NOT_FOUND' });
  await assert.rejects(s.run('quote', {}, ''), { code: 'IDEMPOTENCY_REQUIRED' });
  assert.deepEqual(s.workspace, original);
  const visible = getPublicWorkspace(s.workspace);
  assert.equal('quotes' in visible, false); assert.equal('idempotency' in visible, false); assert.equal('blobKey' in visible.models[0], false);
});

test('reset keeps durable replay protection and capacity limits fail without silent eviction', async () => {
  const s = sandbox(), q = await s.quote(), payload = { quoteId: q.quoteId, demoAcknowledged: true };
  const order = (await s.run('order', payload, 'old-order')).result.order;
  await s.run('action', { action: 'reset', demoAcknowledged: true, confirm: 'RESET_DEMO' });
  const replay = await s.run('order', payload, 'old-order');
  assert.equal(replay.result.order.id, order.id); assert.equal(s.workspace.orders.length, 0);
  s.workspace.idempotency = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`limit-${i}`, { digest: '', result: {}, at: 0 }]));
  await assert.rejects(s.run('quote', {}), { code: 'IDEMPOTENCY_CAPACITY' });
  assert.equal(Object.keys(s.workspace.idempotency).length, 2000);
});

test('maintenance cannot be cleared without readiness, and special idempotency keys survive JSON', async () => {
  const s = sandbox();
  await s.action('set-device-paused', 'p1', { paused: true });
  await assert.rejects(s.action('set-device-paused', 'p1', { paused: false }), { code: 'READINESS_REQUIRED' });
  await assert.rejects(s.action('prepare-device', 'p1', { bedClear: true, materialReady: false, loadedMaterial: 'PLA' }), { code: 'READINESS_REQUIRED' });
  const first = await s.run('quote', {}, '__proto__');
  s.workspace = JSON.parse(JSON.stringify(s.workspace));
  const replay = await s.run('quote', {}, '__proto__');
  assert.equal(replay.replayed, true); assert.equal(replay.result.quotes[0].quoteId, first.result.quotes[0].quoteId);
});

test('same file with a new upload key returns existing model; conflicting stable ID is rejected', async () => {
  const s = sandbox();
  const metadata = { id: 'stable-upload-id', name: 'same.step', size: 100, sha256: 'c'.repeat(64), dimensions: [], volume: 0, closed: false, review: true, format: 'step' };
  const first = (await s.run('register-model', metadata, 'upload-a')).result.model;
  const repeated = (await s.run('register-model', metadata, 'upload-b')).result.model;
  assert.deepEqual(repeated, first); assert.equal(s.workspace.models.length, 2);
  s.workspace.models.push(...Array.from({ length: 98 }, (_, i) => ({ ...first, id: `capacity-${i}` })));
  const atCapacity = (await s.run('register-model', metadata, 'upload-c')).result.model;
  assert.equal(atCapacity.id, first.id); assert.equal(s.workspace.models.length, 100);
  await assert.rejects(s.run('register-model', { ...metadata, sha256: 'd'.repeat(64) }), { code: 'MODEL_EXISTS' });
  await assert.rejects(s.run('register-model', { ...metadata, name: 'other.step' }), { code: 'MODEL_EXISTS' });
});

test('incorrect JSON value types and unknown actions produce controlled client errors', async () => {
  const s = sandbox();
  const rejectsClientError = operation => assert.rejects(operation, error => error.name === 'PlatformError' && error.status >= 400 && error.status < 500);
  for (const command of [null, [], { type: {}, payload: {}, idempotencyKey: 'x' }, { type: 'quote', payload: [], idempotencyKey: 'x' }, { type: 'quote', payload: null, idempotencyKey: 'x' }]) await rejectsClientError(applyCommand(s.workspace, command));
  for (const payload of [{ material: {} }, { qty: '1' }, { quality: [] }, { modelId: {} }, { unit: [] }, { destination: {} }]) await rejectsClientError(s.run('quote', payload));
  for (const payload of [{ action: 'not-an-action', id: 'missing', demoAcknowledged: true }, { action: [], id: 'p1', demoAcknowledged: true }, { action: 'deliver', id: {}, demoAcknowledged: true }, { action: 'reset', confirm: {}, demoAcknowledged: true }]) await rejectsClientError(s.run('action', payload));
  await rejectsClientError(s.run('order', { quoteId: [], demoAcknowledged: true }));
  await rejectsClientError(s.run('register-model', { name: {}, size: '100', sha256: [], format: {} }));
  assert.equal(s.workspace.revision, 0);
});

test('review quote includes defined geometry source and model version', async () => {
  const s = sandbox();
  const model = (await s.run('register-model', { id: 'review-upload', name: 'review.3mf', size: 100, sha256: 'e'.repeat(64), dimensions: [], volume: 0, closed: false, review: true, format: '3mf' })).result.model;
  const q = await s.quote({ modelId: model.id });
  assert.equal(q.review, true); assert.equal(q.modelVersion, 1); assert.equal(q.geometrySource, 'server-upload-parser');
  assert.match(q.fingerprint, /^[a-f0-9]{64}$/);
});

test('reference images register only for engineering review and never start production', async () => {
  const s = sandbox();
  for (const format of ['png', 'jpg', 'jpeg', 'webp']) {
    const metadata = { id: `image-${format}`, name: `drawing.${format}`, size: 100, sha256: 'f'.repeat(64), dimensions: [], volume: 0, closed: false, review: true, format };
    await assert.rejects(s.run('register-model', { ...metadata, review: false }), { code: 'IMAGE_REVIEW_REQUIRED' });
    const model = (await s.run('register-model', metadata)).result.model;
    const order = await s.order({ modelId: model.id });
    assert.equal(order.status, 'review'); assert.equal(order.paymentState, 'UNPAID');
  }
  assert.equal(s.workspace.devices[0].state, 'ready'); assert.equal(s.workspace.devices[0].orderId, null);
});
