import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuote, verifyQuote, transition, reserve, confirmReservation, claimLease, canReleaseMachine, settlementEligibility, IdempotencyRegistry } from '../packages/domain/index.mjs';
import { GatewaySimulator, signDemoEnvelope, fileHash } from '../services/gateway-simulator/index.mjs';
import { createDemoServer } from '../services/api/server.mjs';

function fixture() {
  const secret = 'test-secret-with-at-least-16-chars', now = 100000, bytes = Buffer.from('not-gcode-demo');
  const quote = createQuote({}, undefined, { now });
  const payload = { attemptId: 'a1', orderId: 'o1', machineId: 'm1', leaseToken: 'l1', issuedAt: now, expiresAt: now + 30000, fileSha256: fileHash(bytes), modelHash: quote.modelHash, profileVersion: quote.profileVersion, recipeVersion: quote.recipeVersion, quoteFingerprint: quote.fingerprint };
  const context = { now, bytes, machineId: 'm1', lease: { token: 'l1', orderId: 'o1', expiresAt: now + 30000 }, readiness: { online: true, bedClear: true, operatorReady: true, noFault: true, doorInterlockOk: true, sufficientMaterial: true, modelHash: quote.modelHash, profileVersion: quote.profileVersion, recipeVersion: quote.recipeVersion, observedAt: now } };
  const gateway = new GatewaySimulator(secret);
  const envelope = (action, commandId, changes = {}) => signDemoEnvelope({ ...payload, action, commandId, ...changes }, secret);
  return { gateway, context, envelope, quote, payload, now };
}

test('duplicate payment/dispatch cannot reserve capacity or start a production attempt twice', () => {
  const { gateway, context, envelope } = fixture();
  const registry = new IdempotencyRegistry(); let payments = 0;
  for (let i = 0; i < 3; i++) registry.run('provider-event-1', { orderId: 'o1', amount: 100 }, () => ({ counter: ++payments }));
  assert.equal(payments, 1);
  const upload = envelope('UPLOAD_DEMO', 'upload-1'), start = envelope('START_DEMO', 'start-1');
  gateway.execute(upload, context); gateway.execute(upload, context);
  gateway.execute(start, context); gateway.execute(start, context);
  assert.equal(gateway.simulatedStartCount, 1);
  assert.throws(() => gateway.execute(envelope('START_DEMO', 'another-start'), context), { code: 'START_NOT_ALLOWED' });
  assert.throws(() => registry.run('provider-event-1', { orderId: 'o1', amount: 200 }, () => null), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('lost start acknowledgement remains unknown and cannot trigger automatic retry or lease reuse', () => {
  const { gateway, context, envelope, payload, now } = fixture();
  gateway.execute(envelope('UPLOAD_DEMO', 'u1'), context);
  const start = envelope('START_DEMO', 's1');
  assert.equal(gateway.execute(start, { ...context, simulateTimeout: true }).state, 'EXECUTION_UNKNOWN');
  assert.equal(gateway.execute(start, context).state, 'EXECUTION_UNKNOWN');
  assert.throws(() => gateway.execute(envelope('START_DEMO', 's2'), context), { code: 'START_NOT_ALLOWED' });
  const busy = { id: 'm1', state: 'EXECUTION_UNKNOWN', activeJobId: 'o1', reservation: { orderId: 'o1', confirmed: true }, lease: { expiresAt: now - 1 } };
  assert.throws(() => claimLease(busy, 'o1', 'another-gateway', now), { code: 'MACHINE_UNAVAILABLE' });
  assert.throws(() => gateway.reconcile('a1', { attemptId: 'wrong', fileSha256: payload.fileSha256, state: 'RUNNING' }), { code: 'INSUFFICIENT_EVIDENCE' });
  assert.equal(gateway.reconcile('a1', { attemptId: 'a1', fileSha256: payload.fileSha256, state: 'RUNNING' }).state, 'RUNNING');
  assert.equal(gateway.simulatedStartCount, 1);
});

test('tampered files and stale or incomplete local readiness prevent any simulated start', () => {
  const f = fixture();
  assert.throws(() => f.gateway.execute(f.envelope('UPLOAD_DEMO', 'bad-upload'), { ...f.context, bytes: Buffer.from('changed') }), { code: 'FILE_HASH_MISMATCH' });
  f.gateway.execute(f.envelope('UPLOAD_DEMO', 'u'), f.context);
  for (const patch of [{ bedClear: false }, { sufficientMaterial: false }, { online: false }, { observedAt: f.now - 11000 }, { profileVersion: 'other-profile' }]) {
    assert.throws(() => f.gateway.execute(f.envelope('START_DEMO', `blocked-${JSON.stringify(patch)}`), { ...f.context, readiness: { ...f.context.readiness, ...patch } }), { code: 'NOT_READY' });
  }
  const tampered = f.envelope('START_DEMO', 'tampered'); tampered.payload.modelHash = 'f'.repeat(64);
  assert.throws(() => f.gateway.execute(tampered, f.context), { code: 'INVALID_SIGNATURE' });
  assert.equal(f.gateway.simulatedStartCount, 0);
});

test('different attempts cannot share a busy machine and require a new clearance epoch for reuse', () => {
  const f = fixture();
  f.gateway.execute(f.envelope('UPLOAD_DEMO', 'u-a'), f.context);
  const other = { attemptId: 'a2', orderId: 'o2', leaseToken: 'l2' };
  const context2 = { ...f.context, lease: { token: 'l2', orderId: 'o2', expiresAt: f.now + 30000 } };
  f.gateway.execute(f.envelope('UPLOAD_DEMO', 'u-b', other), context2);
  f.gateway.execute(f.envelope('START_DEMO', 's-a'), { ...f.context, simulateTimeout: true });
  const start2 = f.envelope('START_DEMO', 's-b', other);
  assert.throws(() => f.gateway.execute(start2, context2), { code: 'MACHINE_OCCUPIED' });
  assert.throws(() => f.gateway.confirmClearance('a1', { bedClear: true }), { code: 'CLEARANCE_NOT_ALLOWED' });
  f.gateway.reconcile('a1', { attemptId: 'a1', fileSha256: f.payload.fileSha256, state: 'RUNNING' });
  f.gateway.reportCompletion('a1', { attemptId: 'a1', fileSha256: f.payload.fileSha256 });
  assert.throws(() => f.gateway.execute(start2, context2), { code: 'MACHINE_OCCUPIED' });
  f.gateway.confirmClearance('a1', { partRemoved: true, bedClear: true, clearanceId: 'clear-a1', observedAt: f.now + 1 }, f.now + 1);
  assert.throws(() => f.gateway.execute(start2, context2), { code: 'STALE_CLEARANCE' });
  const fresh = { ...context2, now: f.now + 2, readiness: { ...context2.readiness, observedAt: f.now + 2, clearanceId: 'clear-a1' } };
  assert.equal(f.gateway.execute(start2, fresh).state, 'RUNNING');
  assert.equal(f.gateway.simulatedStartCount, 2);
});

test('cancellation cannot silently stop a running or unknown job and paid reservations may expire', () => {
  for (const state of ['STARTING', 'RUNNING', 'EXECUTION_UNKNOWN']) {
    assert.throws(() => transition(state, 'CANCELLED'), { code: 'INVALID_TRANSITION' });
    assert.equal(transition(state, 'CANCEL_REQUESTED'), 'CANCEL_REQUESTED');
  }
  assert.equal(canReleaseMachine('CANCEL_REQUESTED', { bedClear: true }), false);
  assert.equal(canReleaseMachine('CANCELLED', { bedClear: true, stopConfirmed: true }), true);
  const held = reserve({ state: 'IDLE', availableGrams: 100, reservation: null }, 'o1', 10, 0, 100);
  assert.throws(() => reserve(held, 'o2', 10, 1), { code: 'MACHINE_UNAVAILABLE' });
  assert.throws(() => confirmReservation(held, 'o1', 101), { code: 'RESERVATION_EXPIRED' });
});

test('print done does not free bed, delivery alone cannot settle, and a dispute blocks settlement', () => {
  assert.equal(canReleaseMachine('WAITING_REMOVAL', { bedClear: true }), false);
  assert.equal(canReleaseMachine('QC_PENDING', { partRemoved: true, bedClear: true }), true);
  const order = { productionState: 'QC_PASSED', acceptanceState: 'PENDING', logisticsState: 'DELIVERED', paymentState: 'PAID_FROZEN_DEMO', settlementState: 'NOT_REQUESTED', disputeOpen: false, refundState: 'NONE' };
  assert.equal(settlementEligibility(order).eligible, false);
  order.acceptanceState = 'ACCEPTED';
  assert.equal(settlementEligibility(order).eligible, true);
  assert.equal(settlementEligibility({ ...order, disputeOpen: true }).eligible, false);
  assert.equal(settlementEligibility({ ...order, refundState: 'PROCESSING' }).eligible, false);
  const registry = new IdempotencyRegistry(); let transfers = 0;
  const settle = () => registry.run('settlement-o1', { orderId: 'o1' }, () => { assert.equal(settlementEligibility(order).eligible, true); transfers++; order.settlementState = 'SIMULATED_SETTLED'; return { status: 'done' }; });
  settle(); settle(); assert.equal(transfers, 1);
  assert.equal(settlementEligibility(order).eligible, false);
});

test('immutable quote binds price and manufacturing profile; server rejects modified terms', () => {
  const quote = createQuote({}, undefined, { now: 100 });
  assert.equal(Object.isFrozen(quote.costs), true);
  assert.equal(verifyQuote(quote, quote.fingerprint, 101), true);
  assert.throws(() => verifyQuote({ ...quote, amountCents: 1 }, quote.fingerprint, 101), { code: 'QUOTE_CHANGED' });
  assert.throws(() => verifyQuote(quote, quote.fingerprint, quote.expiresAt), { code: 'QUOTE_EXPIRED' });
});

test('local API uses server price, idempotent orders and payment simulation acknowledgement', async t => {
  const server = createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, input, key) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  const { body: { quote } } = await request('/api/quotes', { amountCents: 1 });
  assert.notEqual(quote.amountCents, 1);
  const first = await request('/api/orders', { quoteId: quote.quoteId, fingerprint: quote.fingerprint }, 'create-1');
  const repeated = await request('/api/orders', { quoteId: quote.quoteId, fingerprint: quote.fingerprint }, 'create-1');
  assert.equal(first.status, 201); assert.equal(first.body.order.orderId, repeated.body.order.orderId);
  const actionPath = `/api/orders/${first.body.order.orderId}/actions`;
  assert.equal((await request(actionPath, { action: 'simulate-payment' }, 'pay-failed')).status, 409);
  const paid = await request(actionPath, { action: 'simulate-payment', demoAcknowledged: true }, 'pay-1');
  assert.equal(paid.body.order.paymentState, 'PAID_FROZEN_DEMO');
  assert.equal(paid.body.moneyTransferred, 0);
  assert.equal(paid.body.physicalCommandsSent, 0);
  assert.equal((await request(actionPath, { action: 'simulate-settlement', demoAcknowledged: true }, 'settle-early')).status, 409);
  for (const nextState of ['DISPATCHED', 'UPLOADED', 'READY', 'STARTING', 'RUNNING', 'WAITING_REMOVAL', 'QC_PENDING', 'QC_PASSED']) {
    const result = await request(actionPath, { action: 'simulate-transition', nextState, demoAcknowledged: true, readinessConfirmed: true, partRemoved: true, bedClear: true, qcPassed: true }, `advance-${nextState}`);
    assert.equal(result.status, 200, nextState);
  }
  await request(actionPath, { action: 'simulate-shipment', trackingNumber: 'DEMO-001', demoAcknowledged: true }, 'ship');
  const delivered = await request(actionPath, { action: 'simulate-delivery', demoAcknowledged: true }, 'deliver');
  assert.equal(delivered.body.order.productionState, 'QC_PASSED');
  assert.equal(delivered.body.order.acceptanceState, 'PENDING');
  assert.equal((await request(actionPath, { action: 'simulate-settlement', demoAcknowledged: true }, 'settle-before-accept')).status, 409);
  await request(actionPath, { action: 'simulate-acceptance', customerAccepted: true, demoAcknowledged: true }, 'accept');
  const settled = await request(actionPath, { action: 'simulate-settlement', demoAcknowledged: true }, 'settle');
  assert.equal(settled.body.order.settlementState, 'SIMULATED_SETTLED');
  assert.equal((await request(actionPath, { action: 'simulate-settlement', demoAcknowledged: true }, 'settle')).status, 200);
  assert.equal((await request(actionPath, { action: 'simulate-settlement', demoAcknowledged: true }, 'settle-again')).status, 409);
});

test('old order quality events cannot release a machine now occupied by another order', async t => {
  const server = createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let key = 0;
  const post = async (path, data) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `interleaved-${++key}` }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const { body: { quote } } = await post('/api/quotes', {});
  const create = () => post('/api/orders', { quoteId: quote.quoteId, fingerprint: quote.fingerprint });
  const a = (await create()).body.order;
  const action = (id, input) => post(`/api/orders/${id}/actions`, { demoAcknowledged: true, ...input });
  const progress = async (id, states) => {
    for (const nextState of states) assert.equal((await action(id, { action: 'simulate-transition', nextState, readinessConfirmed: true, partRemoved: true, bedClear: true, qcPassed: true })).status, 200);
  };
  await action(a.orderId, { action: 'simulate-payment' });
  await progress(a.orderId, ['DISPATCHED', 'UPLOADED', 'READY', 'STARTING', 'RUNNING', 'WAITING_REMOVAL', 'QC_PENDING']);
  const b = (await create()).body.order;
  await action(b.orderId, { action: 'simulate-payment' });
  await progress(b.orderId, ['DISPATCHED', 'UPLOADED', 'READY', 'STARTING', 'RUNNING']);
  await progress(a.orderId, ['QC_PASSED']);
  const third = await create();
  assert.equal(third.status, 409);
  assert.equal(third.body.error.code, 'MACHINE_UNAVAILABLE');
});
