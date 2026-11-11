import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlatformServer } from '../services/platform/local.mjs';

// Uses disposable accounts, real loopback HTTP, SQLite and the shipped STL
// fixture. No third-party service, actual payment, or physical device is used.
async function harness(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gongzao-review-http-v9-'));
  const dbPath = path.join(directory, 'platform.sqlite');
  let instance, base, now = 1_790_000_000_000;
  const access = { workers: [] };
  async function start() {
    instance = createPlatformServer({ dbPath, clock: () => now, workerAccessConfig: access, authConfig: {}, integrationConfig: {} });
    await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(0, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + instance.server.address().port;
  }
  async function stop() {
    if (!instance) return;
    await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    instance.store.close(); instance = null;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(route, { cookie, token, payload, bytes, key = randomUUID(), headers = {}, method = payload === undefined && bytes === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + route, { method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(method === 'POST' ? { 'Idempotency-Key': key, 'Content-Type': bytes ? 'application/octet-stream' : 'application/json' } : {}), ...headers },
      ...(method === 'POST' ? { body: bytes ?? JSON.stringify(payload) } : {}) });
    const raw = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes: raw,
      data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(new TextDecoder().decode(raw)) : null };
  }
  async function account(merchant) {
    const registered = await request('/api/auth/register', { payload: { email: 'review-' + randomUUID() + '@example.invalid', password: 'Review-v9-only-password-2026' } });
    success(registered);
    const cookie = registered.headers.getSetCookie().find(x => x.startsWith('coforge_account=')).split(';')[0];
    const ownerId = success(await request('/api/v2/session', { cookie })).user.id;
    if (merchant) success(await request('/api/v2/merchant/enroll', { cookie, payload: { name: '独立审查工坊' } }));
    return { cookie, ownerId };
  }
  const a = await account(true), b = await account(true), customer = await account(false);
  for (const [index, account] of [a, b].entries()) {
    account.token = randomBytes(32).toString('base64url');
    account.workerId = 'http-review-worker-' + index;
    access.workers.push({ ownerId: account.ownerId, workerId: account.workerId, tokenHash: createHash('sha256').update(account.token).digest('hex'),
      enabled: true, expiresAt: now + 3600000, kinds: ['ANALYZE_MODEL'] });
  }
  await stop(); await start();
  const cube = new Uint8Array(await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url)));
  async function upload(account, filename = 'review-cube.stl') {
    return success(await request('/api/v2/models', { cookie: account.cookie, bytes: cube, headers: { 'X-File-Name': filename } })).model;
  }
  async function operation(account, type, payload, extra = {}) {
    return request('/api/v2/merchant/operations/commands', { cookie: account.cookie, payload: { type, payload }, ...extra });
  }
  async function queued(account = a) {
    const model = await upload(account);
    const job = success(await operation(account, 'queue-job', { kind: 'ANALYZE_MODEL', modelId: model.id, mode: 'WORKER', unit: 'mm', quantity: 1 })).job;
    return { model, job };
  }
  const view = async account => success(await request('/api/v2/merchant/operations', { cookie: account.cookie }));
  return { request, operation, upload, queued, view, a, b, customer, cube, advance: ms => { now += ms; } };
}
function success(response) { assert.ok([200, 201].includes(response.status), JSON.stringify(response.data)); return response.data; }
function denied(response, status, code) { assert.equal(response.status, status, JSON.stringify(response.data)); if (code) assert.equal(response.data.error.code, code); }

test('review v0.9 HTTP: browser accounts cannot execute worker-only commands or obtain machine credentials', async t => {
  const h = await harness(t);
  denied(await h.request('/api/v2/merchant/operations'), 401);
  denied(await h.request('/api/v2/merchant/operations', { cookie: h.customer.cookie }), 403);
  const { job } = await h.queued();
  for (const type of ['claim-job', 'complete-job', 'fail-job', 'expire-leases', 'sync-spools'])
    denied(await h.operation(h.a, type, { jobId: job.id, workerId: h.a.workerId }), 403, 'OPERATION_NOT_ALLOWED');
  denied(await h.request('/api/v2/worker/claim', { cookie: h.a.cookie, payload: {}, headers: { 'X-Worker-Id': h.a.workerId, 'oai-authenticated-user-id': h.a.ownerId } }), 401);
  const claims = success(await h.request('/api/v2/worker/claim', { token: h.a.token, payload: {} })).job;
  const publicView = await h.view(h.a);
  assert.ok(!JSON.stringify(publicView).includes(claims.leaseToken));
  assert.ok(!JSON.stringify(publicView).includes(h.a.token));
  assert.equal(publicView.realDispatchEnabled, false);
});

test('review v0.9 HTTP: job mutations and leased file downloads stay within their server-bound owner', async t => {
  const h = await harness(t), { model, job } = await h.queued();
  const claim = success(await h.request('/api/v2/worker/claim', { token: h.a.token, payload: {} })).job;
  const route = '/api/v2/worker/models/' + model.id + '/download?jobId=' + job.id;
  const leaseHeaders = { 'X-Job-Lease': claim.leaseToken, 'X-Job-Attempt': String(claim.attempt) };
  denied(await h.request(route, { cookie: h.a.cookie, headers: leaseHeaders }), 401);
  denied(await h.request(route, { token: h.b.token, headers: leaseHeaders }), 403, 'WORKER_MODEL_DENIED');
  denied(await h.operation(h.b, 'cancel-job', { jobId: job.id, ownerId: h.a.ownerId }), 404, 'JOB_NOT_FOUND');
  assert.equal((await h.view(h.b)).jobs.length, 0);
  const response = await h.request(route, { token: h.a.token, headers: leaseHeaders });
  assert.equal(response.status, 200); assert.deepEqual(response.bytes, h.cube);
  assert.equal(response.headers.get('x-model-sha256'), model.sha256);
  denied(await h.request(route, { token: h.a.token, headers: { ...leaseHeaders, 'X-Job-Attempt': '2' } }), 403);
  denied(await h.request(route, { token: h.a.token, headers: { ...leaseHeaders, 'X-Job-Lease': 'wrong-lease' } }), 403);
  denied(await h.request('/api/v2/worker/models/mdl_different/download?jobId=' + job.id, { token: h.a.token, headers: leaseHeaders }), 403);
});

test('review v0.9 HTTP: scoped workers cannot claim ungranted task kinds or download expired work', async t => {
  const h = await harness(t), { model, job } = await h.queued();
  denied(await h.request('/api/v2/worker/claim', { token: h.a.token, payload: { kinds: ['SLICE_MODEL'] } }), 403, 'WORKER_KIND_DENIED');
  const claim = success(await h.request('/api/v2/worker/claim', { token: h.a.token, payload: { leaseSeconds: 30 } })).job;
  h.advance(30000);
  denied(await h.request('/api/v2/worker/models/' + model.id + '/download?jobId=' + job.id, { token: h.a.token,
    headers: { 'X-Job-Lease': claim.leaseToken, 'X-Job-Attempt': String(claim.attempt) } }), 403, 'WORKER_MODEL_DENIED');
  denied(await h.request('/api/v2/worker/fail', { token: h.a.token, payload: { jobId: job.id, leaseToken: claim.leaseToken, attempt: claim.attempt, errorCode: 'STALE', errorMessage: '迟到的计算结果' } }), 409, 'STALE_JOB_LEASE');
});

test('review v0.9 HTTP: accepted worker results are whitelisted, replayable and revoke model download leases', async t => {
  const h = await harness(t), { model, job } = await h.queued();
  const lease = success(await h.request('/api/v2/worker/claim', { token: h.a.token, payload: {} })).job;
  const result = { inputHash: job.inputHash, modelHash: model.sha256, profileRevision: null, engineVersion: 'independent-fixture', provenance: 'WORKER_OBSERVED',
    geometry: { dimensionsMm: [20, 20, 20], volumeMm3: 8000, surfaceAreaMm2: 2400, watertight: true, windingConsistent: true, isVolume: true, bodyCount: 1, faceCount: 12, requiresReview: false, warnings: [], secret: 'PRIVATE-UPSTREAM-FIELD' },
    token: 'PRIVATE-UPSTREAM-TOKEN', absolutePath: '/private/upstream/path' };
  const payload = { jobId: job.id, leaseToken: lease.leaseToken, attempt: lease.attempt, result };
  denied(await h.request('/api/v2/worker/complete', { token: h.a.token, payload: { ...payload, result: { ...result, modelHash: '0'.repeat(64) } } }), 400, 'JOB_RESULT_MISMATCH');
  const key = randomUUID(), completed = success(await h.request('/api/v2/worker/complete', { token: h.a.token, payload, key }));
  assert.equal(completed.job.status, 'COMPLETED');
  assert.doesNotMatch(JSON.stringify(completed), /PRIVATE-UPSTREAM|absolutePath|leaseToken/);
  assert.equal(success(await h.request('/api/v2/worker/complete', { token: h.a.token, payload, key })).replayed, true);
  denied(await h.request('/api/v2/worker/models/' + model.id + '/download?jobId=' + job.id, { token: h.a.token,
    headers: { 'X-Job-Lease': lease.leaseToken, 'X-Job-Attempt': String(lease.attempt) } }), 403, 'WORKER_MODEL_DENIED');
  const view = await h.view(h.a);
  assert.equal(view.jobs.find(x => x.id === job.id).status, 'COMPLETED');
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE-UPSTREAM|absolutePath|leaseToken/);
});

test('review v0.9 HTTP: configuration injection and cross-origin manufacturing writes fail closed', async t => {
  const h = await harness(t);
  denied(await h.request('/api/v2/merchant/integrations/probe', { cookie: h.a.cookie, payload: { service: 'spoolman', baseUrl: 'http://169.254.169.254', apiKey: 'FORGED' } }), 400, 'INVALID_PAYLOAD');
  denied(await h.request('/api/v2/merchant/integrations/sync-spools', { cookie: h.a.cookie, payload: { spools: [{ remainingGrams: 1000000 }] } }), 400, 'INVALID_PAYLOAD');
  denied(await h.operation(h.a, 'save-spool', { name: 'forged', material: 'PLA', remainingGrams: 1000, costCentsPerKg: 1, expectedRevision: 0 }, { headers: { Origin: 'https://unrelated.invalid' } }), 403, 'CROSS_ORIGIN_DENIED');
  const status = success(await h.request('/api/v2/merchant/integrations', { cookie: h.a.cookie }));
  assert.ok(status.services.every(service => service.configured === false));
  assert.equal(status.realDeviceDispatch, false); assert.equal(status.realPayments, false);
});
