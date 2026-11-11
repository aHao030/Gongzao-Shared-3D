import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkspace, applyCommand } from '../services/platform/core.mjs';
import { applyOperationsCommand } from '../services/platform/operations.mjs';
import {
  applyMerchantCommand, createGatewayCredential, parseGatewayCredential,
  merchantScanResult, merchantDevices
} from '../services/platform/merchant.mjs';
import { ManufacturingWorker, validateConfig } from '../services/manufacturing-worker/client.mjs';

const beginning = 1_790_000_000_000;
const command = (type, payload) => ({type, payload, idempotencyKey: randomUUID()});

test('an older scan cannot restore an offline observation or import a device that has disappeared', async () => {
  let state = createWorkspace({now: beginning});
  async function run(type, payload, context = {}) {
    const outcome = await applyMerchantCommand(state, command(type, payload), {now: beginning, ownerId: 'farm', ...context});
    state = outcome.workspace;
    return outcome.result;
  }
  await run('enroll', {name: '测试工坊'});
  const pairing = await createGatewayCredential('farm', beginning);
  await run('pairing', {name: '网关'}, {pairing});
  const credential = await parseGatewayCredential('Bearer ' + pairing.token);
  await run('gateway-poll', {}, {credential});
  async function scan(candidates) {
    const {scan} = await run('scan', {scope: 'real', gatewayId: pairing.id});
    return (await run('gateway-report', {scanId: scan.id, candidates}, {credential})).scan;
  }
  const first = await scan([{deviceKey: 'machine-a', name: 'A', protocol: 'moonraker',
    endpoint: 'http://192.168.1.12:7125', connectionState: 'online'}]);
  const selection = {scanId: first.id, candidateIds: [first.candidates[0].id]};
  await run('import', selection);
  await run('scan', {scope: 'demo'});
  assert.equal(merchantScanResult(state, first.id, beginning).scan.importable, true);
  await scan([]);
  assert.equal(merchantScanResult(state, first.id, beginning).scan.importBlockedReason, 'SCAN_SUPERSEDED');
  await assert.rejects(run('import', selection), {code: 'SCAN_SUPERSEDED'});
  assert.equal(merchantDevices(state, beginning).counts.online, 0);
});

async function productionFixture() {
  let state = createWorkspace({now: beginning});
  state = (await applyMerchantCommand(state, command('enroll', {name: '测试工坊'}), {ownerId: 'farm', now: beginning})).workspace;
  async function run(type, payload) {
    const outcome = await applyOperationsCommand(state, command(type, payload), {now: beginning});
    state = outcome.workspace;
    return outcome.result;
  }
  async function action(action, fields) {
    const outcome = await applyCommand(state, command('action', {id: 'order', demoAcknowledged: true, action, ...fields}), {now: beginning});
    state = outcome.workspace;
    return outcome.result;
  }
  const profile = (await run('save-profile', {expectedRevision: 0, name: '模板', localProfileId: 'local',
    engine: 'PrusaSlicer', process: 'FDM', material: 'PLA', deviceId: 'p1', farmId: 'f1', enabled: true})).profile;
  const spool = (await run('save-spool', {expectedRevision: 0, name: '样品', material: 'PLA',
    remainingGrams: 200, costCentsPerKg: 5000})).spool;
  const slicePayload = {kind: 'SLICE_MODEL', mode: 'SANDBOX', demoAcknowledged: true, modelId: state.models[0].id, profileId: profile.id};
  const slice = (await run('queue-job', slicePayload)).job;
  state.orders.push({id: 'order', farm: 'f1', qty: 1, material: 'PLA', unit: 'mm',
    modelId: slice.modelId, modelHash: slice.modelHash, totalCents: 7000, events: [], productionState: 'QUEUED',
    paymentState: 'SIMULATED_FROZEN', refundState: 'NONE', disputeState: 'NONE',
    settlementState: 'NOT_REQUESTED', acceptanceState: 'PENDING', logisticsState: 'NONE'});
  const create = () => run('create-production', {orderId: 'order', sliceJobId: slice.id, spoolId: spool.id, demoAcknowledged: true});
  return {get state() {return state;}, run, action, create, slicePayload, slice};
}

test('refund requested while printing can finish stock accounting and release the machine before refund approval', async () => {
  const h = await productionFixture();
  const {production} = await h.create();
  const fields = {productionId: production.id, demoAcknowledged: true};
  await h.run('readiness', {...fields, bedClear: true, materialReady: true, deviceClear: true, loadedMaterial: 'PLA'});
  await h.run('dispatch-production', fields);
  const requested = await h.action('request-refund', {reason: '订货内容需调整'});
  const refund = {requestId: requested.order.refundRequest.id, approved: true};
  await assert.rejects(h.action('resolve-refund', refund), {code: 'PRODUCTION_RESERVATION_ACTIVE'});
  await h.run('finish-production', {...fields, actualMaterialGrams: 21, actualDurationSeconds: 600});
  assert.equal(h.state.orders[0].status, 'refund_pending');
  await h.run('qc-production', {...fields, partRemoved: true, bedClear: true, passed: true});
  assert.equal(h.state.orders[0].status, 'refund_pending');
  assert.equal(h.state.devices[0].orderId, null);
  assert.equal(h.state.operations.spools[0].remainingGrams, 179);
  await h.action('resolve-refund', refund);
  assert.equal(h.state.orders[0].status, 'refunded');
});

test('paused equipment cannot reserve materials until it returns to service', async () => {
  const h = await productionFixture();
  h.state.devices[0].state = 'maintenance';
  await assert.rejects(h.create(), {code: 'DEVICE_UNAVAILABLE'});
  assert.equal(h.state.operations.spools[0].reservedGrams, 0);
  assert.equal(h.state.operations.productions.length, 0);
});

test('an existing computation can still be reused at the job capacity limit', async () => {
  const h = await productionFixture();
  while (h.state.operations.jobs.length < 180) h.state.operations.jobs.push({id: randomUUID(), status: 'CANCELLED'});
  const reused = await h.run('queue-job', h.slicePayload);
  assert.equal(reused.job.id, h.slice.id);
  assert.equal(reused.alreadyQueued, true);
  await assert.rejects(h.run('queue-job', {...h.slicePayload, quantity: 2}), {code: 'JOB_CAPACITY'});
});

async function reportingWorker(t, respond) {
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gongzao-audit-worker-'));
  t.after(() => fs.rm(workDirectory, {recursive: true, force: true}));
  const worker = new ManufacturingWorker(validateConfig({platformOrigin: 'http://127.0.0.1',
    workDirectory, workerToken: 'test-credential-for-a-simulated-transport'}), {fetchImpl: respond});
  const job = {id: 'job-old', leaseToken: 'expired-synthetic-lease', attempt: 1};
  await worker.saveJournal({job, report: {route: 'complete', key: randomUUID(), payload: {jobId: job.id, attempt: 1}}});
  return worker;
}

test('a worker releases a durably rejected stale report and polls for new work after restart', async t => {
  const routes = [];
  const worker = await reportingWorker(t, async url => {
    routes.push(url.pathname);
    return url.pathname.endsWith('/claim') ? Response.json({job: null}) :
      Response.json({error: {code: 'STALE_JOB_LEASE', message: '租约已失效'}}, {status: 409});
  });
  assert.equal((await worker.cycle()).status, 'LEASE_RELEASED');
  assert.equal((await worker.cycle()).status, 'IDLE');
  assert.deepEqual(routes, ['/api/v2/worker/complete', '/api/v2/worker/claim']);
});

test('a changed slicing profile records failure on the held attempt instead of repeating rejected evidence', async t => {
  const routes = [];
  const worker = await reportingWorker(t, async (url, options) => {
    routes.push(url.pathname);
    if (url.pathname.endsWith('/complete')) return Response.json({error: {code: 'PROFILE_CHANGED', message: '配置已更新'}}, {status: 409});
    const payload = JSON.parse(options.body);
    assert.equal(payload.errorCode, 'PROFILE_CHANGED');
    assert.equal(payload.attempt, 1);
    assert.equal(payload.leaseToken, 'expired-synthetic-lease');
    return Response.json({accepted: true});
  });
  assert.equal((await worker.cycle()).status, 'FAILED');
  assert.deepEqual(await worker.readJournal(), {});
  assert.deepEqual(routes, ['/api/v2/worker/complete', '/api/v2/worker/fail']);
});

test('one confirmed order binds its slice choice, snapshot model revision and approved devices in the form and server', async () => {
  const {getOperations} = await import('../services/platform/operations.mjs');
  const {createOperationsUI} = await import('../dist/operations-ui.js');
  const h = await productionFixture();
  const order = h.state.orders[0];
  order.quoteSnapshot = {modelVersion: 1, sliceEvidence: {jobId: h.slice.id}};
  order.capabilitySnapshot = {deviceIds: ['p1']};
  h.state.operations.jobs.push({...structuredClone(h.slice), id: 'other-slice'});
  const snapshot = getOperations(h.state);
  let rendered = '';
  const ui = createOperationsUI({document: {addEventListener() {}}, getRequest: async () => snapshot,
    modal(_title, body) {rendered = body;}});
  await ui.load();
  await ui.handleAction('new-production', {dataset: {}});
  assert.ok(rendered.includes(h.slice.id));
  assert.ok(!rendered.includes('other-slice'));
  const fields = {orderId: 'order', sliceJobId: 'other-slice', spoolId: h.state.operations.spools[0].id, demoAcknowledged: true};
  await assert.rejects(h.run('create-production', fields), {code: 'SLICE_ORDER_MISMATCH'});
  order.quoteSnapshot.modelVersion = 2;
  await assert.rejects(h.create(), {code: 'SLICE_ORDER_MISMATCH'});
  order.quoteSnapshot.modelVersion = 1;
  order.capabilitySnapshot.deviceIds = ['another-device'];
  await assert.rejects(h.create(), {code: 'SLICE_ORDER_MISMATCH'});
  assert.equal(h.state.operations.spools[0].reservedGrams, 0);
  order.capabilitySnapshot.deviceIds = ['p1'];
  assert.equal((await h.create()).production.sliceJobId, h.slice.id);
});

test('a temporary model download interruption preserves the same worker claim for a successful retry', async t => {
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gongzao-audit-transfer-'));
  t.after(() => fs.rm(workDirectory, {recursive: true, force: true}));
  const model = new TextEncoder().encode('synthetic-model');
  const {createHash} = await import('node:crypto');
  const digest = createHash('sha256').update(model).digest('hex');
  const job = {id: 'job-transfer', kind: 'ANALYZE_MODEL', mode: 'WORKER', modelId: 'mdl_1', format: 'stl',
    modelHash: digest, inputHash: 'a'.repeat(64), leaseToken: 'test-lease', attempt: 1};
  let claims = 0, downloads = 0;
  const config = validateConfig({platformOrigin: 'http://127.0.0.1', workDirectory, workerToken: 'synthetic-token-for-loopback-testing'});
  const worker = new ManufacturingWorker(config, {engine: async () => ({}), fetchImpl: async url => {
    if (url.pathname.endsWith('/claim')) {claims++; return Response.json({job});}
    if (url.pathname.endsWith('/download')) {
      if (++downloads === 1) throw new Error('temporary transport interruption');
      return new Response(model);
    }
    assert.ok(url.pathname.endsWith('/complete'));
    return Response.json({accepted: true});
  }});
  await assert.rejects(worker.cycle(), {code: 'PLATFORM_UNAVAILABLE'});
  assert.equal((await worker.readJournal()).job.id, job.id);
  assert.equal((await worker.cycle()).status, 'COMPLETED');
  assert.equal(claims, 1);
  assert.equal(downloads, 2);
});

test('older quick orders restore the same capability revision or report when its original device scope is unknown', async () => {
  const h = await productionFixture();
  h.state.orders[0].quoteSnapshot = {capabilityId: 'registered-capability', capabilityRevision: 3};
  h.state.manufacturingCapabilities = [{id: 'registered-capability', revision: 4, deviceIds: ['p1']}];
  await assert.rejects(h.create(), {code: 'ORDER_CAPABILITY_UNVERIFIED'});
  h.state.manufacturingCapabilities[0] = {id: 'registered-capability', revision: 3, deviceIds: ['alternate-device']};
  await assert.rejects(h.create(), {code: 'SLICE_ORDER_MISMATCH'});
  assert.equal(h.state.operations.spools[0].reservedGrams, 0);
  h.state.manufacturingCapabilities[0].deviceIds = ['p1'];
  assert.equal((await h.create()).production.deviceId, 'p1');
});
