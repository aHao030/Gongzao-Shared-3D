import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyCommand, createWorkspace } from '../services/platform/core.mjs';
import { applyMerchantCommand } from '../services/platform/merchant.mjs';
import { getCapabilities } from '../services/platform/inquiries.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

async function checkout(t, material = 'PLA') {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  const owner = 'checkout-audit';
  const run = (type, payload, key = crypto.randomUUID()) =>
    store.transact(owner, state => applyCommand(state, { type, payload, idempotencyKey: key }));
  await run('customer-profile', customerProfileFixture());
  const { result } = await run('quote', { material });
  const { result: { order } } = await run('order', { demoAcknowledged: true, quoteId: result.quotes[0].quoteId });
  const action = (action, fields = {}, key) =>
    run('action', { id: order.id, demoAcknowledged: true, action, ...fields }, key);
  return { order, action, load: () => store.load(owner) };
}

test('shipping data is printable and signed-receipt retries cannot repeat a logistics event or move funds', async t => {
  const { order, action, load } = await checkout(t);
  await action('complete-print', { id: order.deviceId });
  await action('collect-and-qc', { partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true });
  const trackingNumber = 'DEMO-EXP123';
  const before = await load();
  for (const fields of [{ carrier: '   ', trackingNumber }, { carrier: '快递', trackingNumber: [trackingNumber] }]) {
    await assert.rejects(action('ship', fields), { code: 'INVALID_TRACKING' });
  }
  assert.equal((await load()).revision, before.revision);
  const shipped = (await action('ship', { carrier: ' 测试快递 ', trackingNumber })).result.order;
  assert.equal(shipped.courier, '测试快递');
  const key = crypto.randomUUID();
  const receipts = await Promise.all([action('deliver', {}, key), action('deliver', {}, key)]);
  assert.equal(receipts.filter(receipt => receipt.replayed).length, 1);
  const delivered = (await load()).orders[0];
  assert.deepEqual(delivered.events.filter(event => event.kind).map(({ kind, at }) => [kind, at]),
    [['SHIPMENT', delivered.shippedAt], ['DELIVERY', delivered.deliveredAt]]);
  assert.equal(delivered.paymentState, 'SIMULATED_FROZEN');
  assert.equal(delivered.settlementState, 'NOT_REQUESTED');
  await assert.rejects(action('request-settlement'), { code: 'SETTLEMENT_BLOCKED' });
  await action('accept', { customerAccepted: true });
  const attempts = await Promise.allSettled([
    action('request-settlement'),
    action('request-refund', { reason: '售后核查' }),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const remaining = (await load()).orders[0];
  assert.notEqual(remaining.refundState === 'REQUESTED', remaining.settlementState === 'REQUESTED');
  assert.equal(remaining.paymentState, 'SIMULATED_FROZEN');
});

test('a customer can close an outstanding dispute after cancellation or a full refund without reopening fulfillment', async t => {
  for (const approveFirst of [false, true]) {
    const { action, load } = await checkout(t, 'PETG');
    await action('dispute', { open: true });
    const cancellation = await action('cancel');
    const requestId = cancellation.result.order.refundRequest.id;
    if (approveFirst) await action('resolve-refund', { requestId, approved: true });
    await action('dispute', { open: false });
    if (!approveFirst) await action('resolve-refund', { requestId, approved: true });
    await assert.rejects(action('dispute', { open: true }), { code: 'DISPUTE_NOT_ALLOWED' });
    await assert.rejects(action('request-settlement'), { code: 'SETTLEMENT_BLOCKED' });
    const result = (await load()).orders[0];
    assert.equal(result.disputeState, 'NONE');
    assert.equal(result.status, 'refunded');
    assert.equal(result.paymentState, 'SIMULATED_REFUNDED');
    assert.equal(result.refundRequest.id, requestId);
  }
});

test('new SQLite data and WAL files are private on POSIX and existing permissions survive restart', { skip: process.platform === 'win32' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gongzao-db-permissions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbDir = path.join(dir, 'data');
  const dbPath = path.join(dbDir, 'platform.sqlite');
  const mode = target => fs.statSync(target).mode & 0o777;
  const oldUmask = process.umask(0o022);
  try {
    const store = new SQLiteStore(dbPath);
    try {
      assert.equal(mode(dbDir), 0o700);
      for (const suffix of ['', '-shm', '-wal']) assert.equal(mode(dbPath + suffix), 0o600);
    } finally {
      store.close();
    }
    fs.chmodSync(dbDir, 0o750);
    fs.chmodSync(dbPath, 0o640);
    new SQLiteStore(dbPath).close();
    assert.equal(mode(dbPath), 0o640);
    assert.equal(mode(dbDir), 0o750);
  } finally {
    process.umask(oldUmask);
  }
});


test('a device-specific accepted plan keeps its device restriction without blocking a later job for the default device', async () => {
  let state = createWorkspace();
  async function run(apply, type, payload) {
    const outcome = await apply(state, { type, payload, idempotencyKey: crypto.randomUUID() }, { ownerId: 'audit-farm' });
    state = outcome.workspace;
    return outcome.result;
  }
  await run(applyMerchantCommand, 'enroll', { name: '指定机型测试工坊' });
  const { scan } = await run(applyMerchantCommand, 'scan', { scope: 'demo' });
  const candidate = scan.candidates.find(d => d.connectionState === 'online' && d.protocol === 'moonraker');
  await run(applyMerchantCommand, 'import', { scanId: scan.id, candidateIds: [candidate.id] });
  await run(applyCommand, 'customer-profile', customerProfileFixture());
  const base = getCapabilities(state).capabilities[0];
  const configure = (capability, deviceIds) => run(applyCommand, 'capability', {
    capability: { ...capability, deviceIds }, expectedRevision: capability.revision, demoAcknowledged: true,
  });
  const personal = await configure(base, [candidate.id]);
  async function acceptPlan() {
    const { inquiry } = await run(applyCommand, 'inquiry', { modelId: 'sample-bracket', capabilityId: base.id,
      material: 'PLA', unit: 'mm', qty: 1, dimensionsConfirmed: true, demoAcknowledged: true });
    return (await run(applyCommand, 'accept-inquiry', { inquiryId: inquiry.id,
      proposalRevision: inquiry.currentProposalRevision, customerAccepted: true, demoAcknowledged: true })).order;
  }
  const restricted = await acceptPlan();
  assert.equal(restricted.productionState, 'QUEUED');
  assert.equal(restricted.productionRoute, 'PRODUCTION_CENTER');
  assert.equal(state.devices[0].orderId, null);
  await configure(personal.capability, []);
  const unrestricted = await acceptPlan();
  assert.equal(state.devices[0].orderId, unrestricted.id);
  const original = state.orders.find(order => order.id === restricted.id);
  assert.equal(original.productionState, 'QUEUED');
  assert.deepEqual(original.capabilitySnapshot.deviceIds, [candidate.id]);
});

test('historical queued orders with a frozen slicing job stay in the production center after a legacy device becomes ready', async t => {
  const { load } = await checkout(t, 'PETG');
  const historical = await load();
  const queued = historical.orders[0];
  assert.equal(queued.productionState, 'QUEUED');
  // Older paid records have their slicing reference in quoteSnapshot with no route field.
  queued.quoteSnapshot.sliceEvidence = { jobId: 'historical-completed-slice' };
  const { workspace } = await applyCommand(historical, {
    type: 'action', idempotencyKey: crypto.randomUUID(), payload: {
      action: 'prepare-device', id: 'p1', demoAcknowledged: true,
      loadedMaterial: 'PETG', bedClear: true, materialReady: true,
    },
  });
  assert.equal(workspace.devices[0].orderId, null);
  assert.equal(workspace.orders[0].productionState, 'QUEUED');
});
