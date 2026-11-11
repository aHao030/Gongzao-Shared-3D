import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';

// These are loopback HTTP integration tests against disposable SQLite databases.
// They do not contact payment providers, physical machines, or a hosted D1 database.
const cube = await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url));
const key = () => randomUUID();

async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coforge-v2-test-'));
  const dbPath = path.join(directory, 'platform.sqlite');
  let instance, base;
  async function start() {
    instance = createPlatformServer({ dbPath });
    await new Promise((resolve, reject) => {
      instance.server.once('error', reject);
      instance.server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${instance.server.address().port}`;
  }
  async function stop() {
    if (!instance) return;
    await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    instance.store.close(); instance = null;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = async (pathname, { cookie, method = 'GET', body, raw, headers = {}, idempotencyKey } = {}) => {
    const response = await fetch(base + pathname, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      ...(raw instanceof ReadableStream ? { duplex: 'half' } : {}),
      redirect: 'manual'
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json') ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    return { status: response.status, headers: response.headers, body: data, bytes };
  };
  const session = async () => {
    const response = await request('/api/v2/session');
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, 'new local session sets a cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=/i);
    return setCookie.split(';')[0];
  };
  const workspace = async cookie => {
    const result = await request('/api/v2/workspace', { cookie });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.workspace;
  };
  const post = (cookie, pathname, body, idempotencyKey = key()) => request(pathname, { cookie, method: 'POST', body, idempotencyKey });
  const quotes = async (cookie, config = {}) => {
    const ws = await workspace(cookie);
    const modelId = ws.models.find(model => model.isSample).id;
    const response = await post(cookie, '/api/v2/quotes', { modelId, material: 'PLA', qty: 1, quality: 'standard', unit: 'mm', destination: 'east', ...config });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.quotes.length, 3);
    return response.body.quotes;
  };
  const order = async (cookie, config = {}, extra = {}, idempotencyKey = key()) => {
    const [quote] = await quotes(cookie, config);
    const response = await post(cookie, '/api/v2/orders', { quoteId: quote.quoteId, demoAcknowledged: true, ...extra }, idempotencyKey);
    assert.ok([200, 201].includes(response.status), JSON.stringify(response.body));
    return { quote, ...response };
  };
  const upload = (cookie, filename = 'cube-20mm.stl', idempotencyKey = key(), raw = cube) => request('/api/v2/models', {
    cookie, method: 'POST', raw, idempotencyKey,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(filename) }
  });
  const action = (cookie, body, idempotencyKey = key()) => post(cookie, '/api/v2/actions', { demoAcknowledged: true, ...body }, idempotencyKey);
  const storedFileCount = () => instance.store.db.prepare('SELECT count(*) AS count FROM local_model_files').get().count;
  const failFileWrites = enabled => instance.store.db.exec(enabled
    ? "CREATE TRIGGER fail_test_file_write BEFORE INSERT ON local_model_files BEGIN SELECT RAISE(ABORT, 'injected local test failure'); END"
    : 'DROP TRIGGER fail_test_file_write');
  return { request, session, workspace, post, quotes, order, upload, action, storedFileCount, failFileWrites, restart: async () => { await stop(); await start(); } };
}

test('v2: server derives geometry, hash and price from uploaded bytes; client values cannot replace them', async t => {
  const h = await harness(t), cookie = await h.session();
  const uploaded = await h.upload(cookie);
  assert.ok([200, 201].includes(uploaded.status), JSON.stringify(uploaded.body));
  const model = uploaded.body.model;
  assert.deepEqual(model.dimensions, [20, 20, 20]);
  assert.ok(Math.abs(model.volume - 8) < 1e-9);
  assert.equal(model.sha256, createHash('sha256').update(cube).digest('hex'));
  assert.equal(model.closed, true);
  const [normal] = await h.quotes(cookie, { modelId: model.id });
  const [forged] = await h.quotes(cookie, { modelId: model.id, amountCents: 1, totalCents: 1, price: 0, volume: 0.0001, dimensions: [1, 1, 1] });
  assert.equal(forged.totalCents, normal.totalCents);
  assert.deepEqual(forged.dimensions, [20, 20, 20]);
  const created = await h.post(cookie, '/api/v2/orders', { quoteId: forged.quoteId, demoAcknowledged: true, totalCents: 1, paymentState: 'SIMULATED_RELEASED', status: 'settled' });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
  assert.equal(created.body.order.totalCents, normal.totalCents);
  assert.notEqual(created.body.order.status, 'settled');
  assert.equal(created.body.order.settlementState, 'NOT_REQUESTED');
});

test('v2: separate sessions isolate workspaces, uploaded bytes and mutation identifiers', async t => {
  const h = await harness(t), a = await h.session(), b = await h.session();
  assert.notEqual(a, b);
  const uploaded = await h.upload(a), modelId = uploaded.body.model.id;
  const created = await h.order(a, { modelId });
  const other = await h.workspace(b);
  assert.equal(other.orders.length, 0);
  assert.equal(other.models.some(model => model.id === modelId), false);
  const download = await h.request(`/api/v2/models/${modelId}/download`, { cookie: b });
  assert.ok([403, 404].includes(download.status));
  const foreignQuote = await h.post(b, '/api/v2/orders', { quoteId: created.quote.quoteId, demoAcknowledged: true });
  assert.ok([403, 404].includes(foreignQuote.status));
  const foreignAction = await h.action(b, { action: 'cancel', id: created.body.order.id });
  assert.ok([403, 404].includes(foreignAction.status));
  const spoof = await h.request('/api/v2/workspace', { cookie: b, headers: { 'oai-authenticated-user-id': 'forged-admin', 'oai-authenticated-user-email': 'admin@example.invalid' } });
  assert.equal(spoof.status, 200);
  assert.equal(spoof.body.workspace.orders.length, 0);
  const unauthenticated = await h.request('/api/v2/workspace', { headers: { 'oai-authenticated-user-id': 'forged-admin' } });
  assert.equal(unauthenticated.status, 401);
});

test('v2: all mutation routes require keys and reject conflicting replay; 32 concurrent duplicate submissions create one order', async t => {
  const h = await harness(t), cookie = await h.session();
  for (const pathname of ['/api/v2/quotes', '/api/v2/orders', '/api/v2/actions']) {
    const response = await h.request(pathname, { cookie, method: 'POST', body: {} });
    assert.equal(response.status, 400, pathname);
    assert.match(response.body.error.code, /IDEMPOTENCY/);
  }
  const withoutKey = await h.request('/api/v2/models', { cookie, method: 'POST', raw: cube, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'cube.stl' } });
  assert.equal(withoutKey.status, 400);
  assert.match(withoutKey.body.error.code, /IDEMPOTENCY/);
  const [quote] = await h.quotes(cookie), idempotencyKey = key();
  const payload = { quoteId: quote.quoteId, demoAcknowledged: true };
  const responses = await Promise.all(Array.from({ length: 32 }, () => h.post(cookie, '/api/v2/orders', payload, idempotencyKey)));
  responses.forEach(response => assert.ok([200, 201].includes(response.status), JSON.stringify(response.body)));
  assert.equal(new Set(responses.map(response => response.body.order.id)).size, 1);
  const ws = await h.workspace(cookie);
  assert.equal(ws.orders.length, 1);
  assert.equal(ws.devices.filter(device => device.orderId === ws.orders[0].id).length, 1);
  const conflict = await h.post(cookie, '/api/v2/orders', { ...payload, qty: 2 }, idempotencyKey);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
});

test('v2: concurrent distinct requests retain every order without duplicate machine ownership', async t => {
  const h = await harness(t), cookie = await h.session();
  const batches = await Promise.all(Array.from({ length: 16 }, () => h.quotes(cookie)));
  const responses = await Promise.all(batches.map(([quote]) => h.post(cookie, '/api/v2/orders', { quoteId: quote.quoteId, demoAcknowledged: true })));
  responses.forEach(response => assert.ok([200, 201].includes(response.status), JSON.stringify(response.body)));
  const ws = await h.workspace(cookie);
  assert.equal(ws.orders.length, 16);
  assert.equal(new Set(ws.orders.map(order => order.id)).size, 16);
  assert.equal(ws.orders.filter(order => order.status === 'printing').length, 1);
  assert.equal(ws.orders.filter(order => order.status === 'queued').length, 15);
});

test('v2: reopening SQLite preserves session, models, orders, bytes and idempotent results', async t => {
  const h = await harness(t), cookie = await h.session();
  const uploadKey = key(), upload = await h.upload(cookie, 'durable-cube.stl', uploadKey);
  const [quote] = await h.quotes(cookie, { modelId: upload.body.model.id }), orderKey = key();
  const payload = { quoteId: quote.quoteId, demoAcknowledged: true };
  const before = await h.post(cookie, '/api/v2/orders', payload, orderKey);
  const oldWorkspace = await h.workspace(cookie);
  await h.restart();
  const restored = await h.workspace(cookie);
  assert.deepEqual(restored.orders, oldWorkspace.orders);
  assert.deepEqual(restored.models, oldWorkspace.models);
  assert.equal(restored.revision, oldWorkspace.revision);
  const replay = await h.post(cookie, '/api/v2/orders', payload, orderKey);
  assert.equal(replay.body.order.id, before.body.order.id);
  assert.equal((await h.workspace(cookie)).orders.length, 1);
  assert.equal((await h.workspace(cookie)).revision, oldWorkspace.revision);
  const download = await h.request(`/api/v2/models/${upload.body.model.id}/download`, { cookie });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(download.bytes), cube);
  const replayUpload = await h.upload(cookie, 'durable-cube.stl', uploadKey);
  assert.equal(replayUpload.body.model.id, upload.body.model.id);
});

test('v2: rejected upload replay cannot create orphan local file records', async t => {
  const h = await harness(t), cookie = await h.session(), idempotencyKey = key();
  const first = await h.upload(cookie, 'accepted.stl', idempotencyKey);
  assert.equal(first.status, 201);
  assert.equal(h.storedFileCount(), 1);
  const conflicting = await h.upload(cookie, 'rejected-new-name.stl', idempotencyKey);
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.storedFileCount(), 1, 'an idempotency rejection must not insert inaccessible bytes');
  const replay = await h.upload(cookie, 'accepted.stl', idempotencyKey);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.model.id, first.body.model.id);
  assert.equal(h.storedFileCount(), 1);
});

test('v2: SQLite file-write failure rolls back model, revision and idempotency ledger together', async t => {
  const h = await harness(t), cookie = await h.session(), idempotencyKey = key();
  const before = await h.workspace(cookie);
  h.failFileWrites(true);
  const failed = await h.upload(cookie, 'retry-after-storage-failure.stl', idempotencyKey);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(failed.body.error.message, /injected local test failure/);
  const afterFailure = await h.workspace(cookie);
  assert.equal(afterFailure.revision, before.revision);
  assert.equal(afterFailure.models.filter(model => !model.isSample).length, 0);
  assert.equal(h.storedFileCount(), 0);
  h.failFileWrites(false);
  const retry = await h.upload(cookie, 'retry-after-storage-failure.stl', idempotencyKey);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.replayed, false, 'failed transaction must not retain a successful idempotency result');
  assert.equal(h.storedFileCount(), 1);
  assert.equal((await h.workspace(cookie)).revision, before.revision + 1);
});

test('v2: material mismatch stays queued; FIFO, explicit readiness and occupied devices prevent unsafe starts', async t => {
  const h = await harness(t), cookie = await h.session();
  const petg = (await h.order(cookie, { material: 'PETG' })).body.order;
  assert.equal(petg.status, 'queued');
  const pla = (await h.order(cookie, { material: 'PLA' })).body.order;
  assert.equal(pla.status, 'queued', 'later matching material must not bypass the FIFO head');
  let ws = await h.workspace(cookie), device = ws.devices.find(device => device.farm === petg.farm);
  assert.equal(device.orderId, null);
  assert.equal(device.blockedReason, 'MATERIAL_MISMATCH');
  const missingReady = await h.action(cookie, { action: 'prepare-device', id: device.id, loadedMaterial: 'PETG' });
  assert.equal(missingReady.status, 409);
  const prepared = await h.action(cookie, { action: 'prepare-device', id: device.id, bedClear: true, materialReady: true, loadedMaterial: 'PETG' });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  ws = await h.workspace(cookie);
  assert.equal(ws.orders.find(order => order.id === petg.id).status, 'printing');
  const overwrite = await h.action(cookie, { action: 'prepare-device', id: device.id, bedClear: true, materialReady: true, loadedMaterial: 'PLA' });
  assert.equal(overwrite.status, 409);
  await h.action(cookie, { action: 'complete-print', id: device.id });
  const afterPrint = await h.workspace(cookie);
  assert.equal(afterPrint.orders.find(order => order.id === pla.id).status, 'queued');
  const uncollected = await h.action(cookie, { action: 'prepare-device', id: device.id, bedClear: true, materialReady: true, loadedMaterial: 'PLA' });
  assert.equal(uncollected.status, 409);
  const collection = await h.action(cookie, { action: 'collect-and-qc', id: petg.id, partRemoved: true, bedClear: true, materialReady: true, loadedMaterial: 'PLA', qcPassed: true });
  assert.equal(collection.status, 200, JSON.stringify(collection.body));
  const after = await h.workspace(cookie);
  assert.equal(after.orders.find(order => order.id === pla.id).status, 'printing');
});

test('v2: arbitrary state transitions and premature settlement are rejected without changing workspace', async t => {
  const h = await harness(t), cookie = await h.session();
  const order = (await h.order(cookie)).body.order, initial = await h.workspace(cookie);
  for (const payload of [
    { action: 'simulate-transition', id: order.id, nextState: 'ACCEPTED', productionState: 'EXECUTION_UNKNOWN' },
    { action: 'set-state', id: order.id, status: 'settled' },
    { action: 'accept', id: order.id, customerAccepted: true },
    { action: 'cancel', id: order.id }
  ]) {
    const result = await h.action(cookie, payload);
    assert.ok([400, 409].includes(result.status), JSON.stringify(result.body));
  }
  const noAck = await h.post(cookie, '/api/v2/actions', { action: 'complete-print', id: order.deviceId });
  assert.equal(noAck.status, 409);
  assert.equal(noAck.body.error.code, 'DEMO_ACK_REQUIRED');
  const after = await h.workspace(cookie);
  assert.equal(after.revision, initial.revision);
  assert.deepEqual(after.orders, initial.orders);
  assert.deepEqual(after.devices, initial.devices);
});

test('v2: invalid origins, oversized request bodies and path-like filenames are rejected', async t => {
  const h = await harness(t), cookie = await h.session();
  const origin = await h.request('/api/v2/quotes', { cookie, method: 'POST', idempotencyKey: key(), body: {}, headers: { Origin: 'https://attacker.example.invalid' } });
  assert.equal(origin.status, 403);
  const largeJson = await h.post(cookie, '/api/v2/quotes', { padding: 'x'.repeat(32769) });
  assert.equal(largeJson.status, 413);
  const chunked = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ padding: 'x'.repeat(32769) })));
    controller.close();
  } });
  const noContentLength = await h.request('/api/v2/quotes', { cookie, method: 'POST', idempotencyKey: key(), raw: chunked, headers: { 'Content-Type': 'application/json' } });
  assert.equal(noContentLength.status, 413, 'streamed bodies must be bounded even without Content-Length');
  const hugeFile = await h.upload(cookie, 'oversized.step', key(), Buffer.alloc(20 * 1024 * 1024 + 1));
  assert.equal(hugeFile.status, 413);
  for (const name of ['../../outside.stl', '..\\outside.stl']) {
    const result = await h.upload(cookie, name);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_FILENAME');
  }
  assert.equal((await h.workspace(cookie)).models.filter(model => !model.isSample).length, 0);
});

test('v2: HTML-like filenames remain JSON data and download as attachments', async t => {
  const h = await harness(t), cookie = await h.session();
  const name = '<img src=x onerror=alert(1)>.stl';
  const result = await h.upload(cookie, name);
  assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
  assert.match(result.headers.get('content-type'), /^application\/json/);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.body.model.name, name);
  const downloaded = await h.request(`/api/v2/models/${result.body.model.id}/download`, { cookie });
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get('content-type'), /^application\/octet-stream/);
  assert.match(downloaded.headers.get('content-disposition'), /^attachment;/i);
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(downloaded.bytes), cube);
});
