import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkspace, getPublicWorkspace, applyCommand } from '../services/platform/core.mjs';
import { applyMerchantCommand } from '../services/platform/merchant.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { applyOperationsCommand, getOperations } from '../services/platform/operations.mjs';
import { getPricingProfile } from '../services/platform/pricing.mjs';

const beginning = 1_790_000_000_000;
const command = (type, payload = {}, key = randomUUID()) => ({ type, payload, idempotencyKey: key });
const worker = (workerId = 'review-worker-a') => ({ workerId, workerKinds: ['ANALYZE_MODEL', 'SLICE_MODEL', 'SCHEDULE'] });
const profilePayload = extra => ({ name: '审核夹具工艺', localProfileId: 'review-profile', engine: 'PrusaSlicer', process: 'FDM', material: 'PLA', quality: 'standard', farmId: 'f1', deviceId: 'p1', enabled: true, expectedRevision: 0, ...extra });
async function fixture({ stock = 1000, quantity = 1 } = {}) {
  let state = createWorkspace({ now: beginning });
  state = (await applyMerchantCommand(state, command('enroll', { name: '独立测试工坊' }), { ownerId: 'review-owner', now: beginning })).workspace;
  // These are isolated state-machine fixtures, not claims of uploaded real files.
  state.models.push({ ...structuredClone(state.models[0]), id: 'mdl_review_uploaded', isSample: false });
  const run = async (type, payload = {}, context = {}) => {
    const result = await applyOperationsCommand(state, command(type, payload, context.key), { now: beginning, ...context });
    state = result.workspace; return result.result;
  };
  const profile = (await run('save-profile', profilePayload())).profile;
  const spool = (await run('save-spool', { name: '测试耗材卷', material: 'PLA', remainingGrams: stock, costCentsPerKg: 10000, expectedRevision: 0, mode: 'SANDBOX' })).spool;
  const slice = (await run('queue-job', { kind: 'SLICE_MODEL', modelId: state.models[0].id, profileId: profile.id, quantity, unit: 'mm', mode: 'SANDBOX', demoAcknowledged: true })).job;
  const addOrder = id => {
    const order = { id, modelId: slice.modelId, modelHash: slice.modelHash, farm: 'f1', material: 'PLA', quality: 'standard', qty: quantity, unit: 'mm',
      paymentState: 'SIMULATED_FROZEN', disputeState: 'NONE', refundState: 'NONE', logisticsState: 'NONE', acceptanceState: 'PENDING',
      productionState: 'REVIEW_REQUIRED', status: 'review', settlementBreakdown: { manufacturingCents: 100000 }, events: [],
      quoteSnapshot: { fixture: 'immutable-agreed-price', totalCents: 108200 }, proposalSnapshot: { revision: 3, totalCents: 108200 } };
    state.orders.push(order); return order;
  };
  const productionPayload = orderId => ({ orderId, sliceJobId: slice.id, spoolId: spool.id, demoAcknowledged: true });
  return { state: () => state, setState: next => { state = next; }, run, profile, spool, slice, addOrder, productionPayload };
}
async function persisted(t, state) {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  await store.transact('review-owner', () => ({ workspace: state, result: {}, replayed: false }));
  return store;
}
async function competing(store, commands, contexts = [{}, {}]) {
  let arrivals = 0, calls = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const outcomes = await Promise.allSettled(commands.map((cmd, i) => store.transact('review-owner', async state => {
    calls++;
    if (arrivals < commands.length) { arrivals++; if (arrivals === commands.length) release(); await barrier; }
    return applyOperationsCommand(state, cmd, { now: beginning, ...contexts[i] });
  })));
  assert.ok(calls > commands.length, 'fixture must force a real stale CAS revision and retry');
  return outcomes;
}
const ok = outcome => outcome.status === 'fulfilled';
const rejectCode = code => error => error.code === code;

test('review v0.9: two concurrent production requests cannot reserve the same remaining stock twice', async t => {
  const h = await fixture({ stock: 40 }); h.addOrder('order-a'); h.addOrder('order-b');
  const store = await persisted(t, h.state());
  const outcomes = await competing(store, ['order-a', 'order-b'].map(id => command('create-production', h.productionPayload(id))));
  assert.equal(outcomes.filter(ok).length, 1);
  assert.equal(outcomes.find(x => !ok(x)).reason.code, 'INSUFFICIENT_STOCK');
  const state = await store.load('review-owner');
  assert.equal(state.operations.productions.length, 1);
  const spool = state.operations.spools[0];
  assert.equal(spool.reservedGrams, state.operations.productions[0].reservedGrams);
  assert.ok(spool.remainingGrams - spool.reservedGrams >= 0);
});

test('review v0.9: different request keys cannot duplicate one order production under CAS contention', async t => {
  const h = await fixture(); h.addOrder('order-a');
  const store = await persisted(t, h.state());
  const outcomes = await competing(store, [0, 1].map(() => command('create-production', h.productionPayload('order-a'))));
  assert.equal(outcomes.filter(ok).length, 1);
  assert.equal(outcomes.find(x => !ok(x)).reason.code, 'PRODUCTION_EXISTS');
  const state = await store.load('review-owner');
  assert.equal(state.operations.productions.length, 1);
  assert.equal(state.operations.spools[0].reservedGrams, state.operations.productions[0].reservedGrams);
});

test('review v0.9: competing workers cannot both own the same job lease', async t => {
  const h = await fixture();
  const queued = (await h.run('queue-job', { kind: 'ANALYZE_MODEL', modelId: 'mdl_review_uploaded', mode: 'WORKER' })).job;
  const store = await persisted(t, h.state());
  const outcomes = await competing(store, [0, 1].map(() => command('claim-job', { kinds: ['ANALYZE_MODEL'] })), [worker('review-worker-a'), worker('review-worker-b')]);
  assert.ok(outcomes.every(ok));
  const claims = outcomes.map(x => x.value.result.job).filter(Boolean);
  assert.equal(claims.length, 1); assert.equal(claims[0].id, queued.id);
  const state = await store.load('review-owner'), job = state.operations.jobs.find(x => x.id === queued.id);
  assert.equal(job.attempt, 1); assert.equal(job.leaseToken, claims[0].leaseToken);
  assert.ok(!JSON.stringify(getOperations(state)).includes(job.leaseToken));
  assert.ok(!JSON.stringify(getPublicWorkspace(state)).includes(job.leaseToken));
});

test('review v0.9: idle worker polling does not consume the operation ledger or workspace capacity', async () => {
  const h = await fixture(), before = structuredClone(h.state());
  for (let i = 0; i < 20; i++) {
    const response = await h.run('claim-job', { kinds: ['ANALYZE_MODEL'] }, worker());
    assert.equal(response.job, null);
  }
  assert.deepEqual(h.state(), before);
});

test('review v0.9: lease expiry rotates ownership and rejects late results and stale claim replays', async () => {
  const h = await fixture();
  const queued = (await h.run('queue-job', { kind: 'ANALYZE_MODEL', modelId: 'mdl_review_uploaded', mode: 'WORKER' })).job;
  const key = randomUUID(), first = (await h.run('claim-job', { kinds: ['ANALYZE_MODEL'], leaseSeconds: 30 }, { ...worker(), key })).job;
  const second = (await h.run('claim-job', { kinds: ['ANALYZE_MODEL'], leaseSeconds: 30 }, { ...worker('review-worker-b'), now: beginning + 30000 })).job;
  assert.equal(second.id, queued.id); assert.equal(second.attempt, 2); assert.notEqual(second.leaseToken, first.leaseToken);
  const before = structuredClone(h.state());
  await assert.rejects(h.run('fail-job', { jobId: first.id, leaseToken: first.leaseToken, attempt: first.attempt, errorCode: 'LATE', errorMessage: '旧计算服务超时返回' }, { ...worker(), now: beginning + 30001 }), rejectCode('STALE_JOB_LEASE'));
  const replay = await h.run('claim-job', { kinds: ['ANALYZE_MODEL'], leaseSeconds: 30 }, { ...worker(), key, now: beginning + 30001 });
  assert.equal(replay.job, null); assert.equal(replay.staleClaim, true);
  assert.deepEqual(h.state(), before);
});

test('review v0.9: profile revisions invalidate in-flight slicing results without changing paid snapshots', async () => {
  const h = await fixture(); h.addOrder('order-a');
  const queued = (await h.run('queue-job', { kind: 'SLICE_MODEL', modelId: 'mdl_review_uploaded', profileId: h.profile.id, mode: 'WORKER', quantity: 1, unit: 'mm' })).job;
  const lease = (await h.run('claim-job', { kinds: ['SLICE_MODEL'] }, worker())).job;
  await h.run('save-profile', profilePayload({ id: h.profile.id, expectedRevision: h.profile.revision, name: '更新后的配置' }));
  const before = structuredClone(h.state());
  const result = { inputHash: queued.inputHash, modelHash: queued.modelHash, profileRevision: queued.profileRevision, engineVersion: 'review-slicer', provenance: 'WORKER_OBSERVED', durationSeconds: 3600, materialGrams: 30, artifactHash: 'a'.repeat(64), profileSha256: 'b'.repeat(64) };
  await assert.rejects(h.run('complete-job', { jobId: lease.id, leaseToken: lease.leaseToken, attempt: lease.attempt, result }, worker()), rejectCode('PROFILE_CHANGED'));
  assert.deepEqual(h.state(), before);
  assert.equal(h.state().orders[0].quoteSnapshot.totalCents, 108200);
});

test('review v0.9: reservations cannot be edited away or released twice', async () => {
  const h = await fixture(); h.addOrder('order-a');
  const production = (await h.run('create-production', h.productionPayload('order-a'))).production;
  const spool = h.state().operations.spools[0];
  await assert.rejects(h.run('save-spool', { ...spool, expectedRevision: spool.revision, remainingGrams: production.reservedGrams - 1 }), rejectCode('STOCK_RESERVED'));
  await h.run('cancel-production', { productionId: production.id, demoAcknowledged: true });
  const before = structuredClone(h.state());
  await assert.rejects(h.run('cancel-production', { productionId: production.id, demoAcknowledged: true }), rejectCode('PRODUCTION_CANCEL_BLOCKED'));
  assert.deepEqual(h.state(), before); assert.equal(h.state().operations.spools[0].reservedGrams, 0);
});

test('review v0.9: repricing during printing cannot retroactively change the production cost basis or customer contract', async () => {
  const h = await fixture(); const order = h.addOrder('order-a'), originalTerms = structuredClone({ quote: order.quoteSnapshot, proposal: order.proposalSnapshot });
  const production = (await h.run('create-production', h.productionPayload('order-a'))).production;
  await h.run('readiness', { productionId: production.id, demoAcknowledged: true, bedClear: true, materialReady: true, deviceClear: true, loadedMaterial: 'PLA' });
  await h.run('dispatch-production', { productionId: production.id, demoAcknowledged: true });
  const finish = command('finish-production', { productionId: production.id, demoAcknowledged: true, actualMaterialGrams: 28, actualDurationSeconds: 7200 });
  const expected = await applyOperationsCommand(h.state(), finish, { now: beginning + 7200000 });
  const profile = getPricingProfile(h.state(), 'f1');
  const fields = Object.fromEntries(Object.entries(profile).filter(([key]) => !['farmId', 'farmName', 'revision', 'updatedAt', 'mode'].includes(key)));
  fields.machineCostCentsPerHour += 1000;
  const repriced = await applyCommand(h.state(), command('pricing-profile', { farmId: 'f1', expectedRevision: profile.revision, profile: fields, demoAcknowledged: true }), { now: beginning + 1000 });
  const actual = await applyOperationsCommand(repriced.workspace, finish, { now: beginning + 7200000 });
  assert.equal(actual.result.production.actuals.actualCostCents, expected.result.production.actuals.actualCostCents);
  assert.deepEqual({ quote: actual.workspace.orders[0].quoteSnapshot, proposal: actual.workspace.orders[0].proposalSnapshot }, originalTerms);
});

test('review v0.9: unknown device-start outcome stays blocked when leases expire', async () => {
  const h = await fixture(); h.addOrder('order-a');
  const production = (await h.run('create-production', h.productionPayload('order-a'))).production;
  const record = h.state().operations.productions.find(p => p.id === production.id);
  // Inject the persisted uncertain boundary that a future hardware adapter may encounter.
  record.status = 'DISPATCHING'; record.dispatchLeaseUntil = beginning;
  const reserved = h.state().operations.spools[0].reservedGrams;
  await h.run('expire-leases', {}, worker());
  assert.equal(h.state().operations.productions[0].status, 'UNKNOWN');
  assert.equal(h.state().operations.spools[0].reservedGrams, reserved);
  await assert.rejects(h.run('dispatch-production', { productionId: production.id, demoAcknowledged: true }), rejectCode('READINESS_REQUIRED'));
  await assert.rejects(h.run('cancel-production', { productionId: production.id, demoAcknowledged: true }), rejectCode('PRODUCTION_CANCEL_BLOCKED'));
});

test('review v0.9: legacy device controls cannot bypass production inventory and QC', async () => {
  const h = await fixture(); h.addOrder('order-a');
  const production = (await h.run('create-production', h.productionPayload('order-a'))).production;
  await h.run('readiness', { productionId: production.id, demoAcknowledged: true, bedClear: true, materialReady: true, deviceClear: true, loadedMaterial: 'PLA' });
  await h.run('dispatch-production', { productionId: production.id, demoAcknowledged: true });
  const before = structuredClone(h.state());
  for (const payload of [
    { action: 'complete-print', id: 'p1' },
    { action: 'prepare-device', id: 'p1', bedClear: true, materialReady: true, loadedMaterial: 'PLA' },
    { action: 'collect-and-qc', id: 'order-a', partRemoved: true, qcPassed: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA' }
  ]) await assert.rejects(applyCommand(h.state(), command('action', { ...payload, demoAcknowledged: true })), rejectCode('USE_PRODUCTION_CENTER'));
  await assert.rejects(applyCommand(h.state(), command('action', { action: 'reset', confirm: 'RESET_DEMO', demoAcknowledged: true })), rejectCode('OPERATIONS_RESET_BLOCKED'));
  assert.deepEqual(h.state(), before);
});

test('review v0.9: legacy successful refund requires active production reservation to be released first', async () => {
  const h = await fixture(); const order = h.addOrder('order-a');
  order.totalCents = 108200; order.settlementState = 'NOT_REQUESTED';
  await h.run('create-production', h.productionPayload('order-a'));
  const requested = await applyCommand(h.state(), command('action', { action: 'request-refund', id: order.id, reason: '客户取消测试订单', demoAcknowledged: true }));
  const changed = requested.workspace.orders.find(o => o.id === order.id);
  await assert.rejects(applyCommand(requested.workspace, command('action', { action: 'resolve-refund', id: order.id, requestId: changed.refundRequest.id, approved: true, demoAcknowledged: true })), rejectCode('PRODUCTION_RESERVATION_ACTIVE'));
  assert.ok(requested.workspace.operations.spools[0].reservedGrams > 0);
  assert.equal(requested.workspace.orders[0].paymentState, 'SIMULATED_FROZEN');
});
