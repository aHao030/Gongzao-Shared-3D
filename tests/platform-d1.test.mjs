import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { D1Store } from '../services/platform/store-d1.mjs';
import { handleApi } from '../services/platform/http.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Adapter contract simulation only: real D1Store + handleApi, SQLite SQL execution
// behind the D1 method shape, and an in-memory R2 byte store. These tests do not
// validate Cloudflare execution, network consistency, quotas, or cloud capacity.
const cube = new Uint8Array(await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url)));
const ownerA = 'contract-owner-a';
const ownerB = 'contract-owner-b';

class SQLiteD1Double {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('CREATE TABLE platform_workspaces (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    this.zeroChangeWrites = 0;
    this.readBarrier = null;
  }
  // Force two CAS operations to observe the same prior revision, so the test
  // proves retry behavior instead of merely submitting two fast requests.
  holdNextRevisionReads(count) {
    assert.equal(this.readBarrier, null);
    this.readBarrier = { remaining: count, waiting: [] };
  }
  async afterSnapshot(sql) {
    if (!this.readBarrier || !/^SELECT revision, data FROM platform_workspaces/i.test(sql)) return;
    const barrier = this.readBarrier;
    await new Promise(resolve => {
      barrier.waiting.push(resolve);
      if (--barrier.remaining === 0) {
        this.readBarrier = null;
        barrier.waiting.forEach(release => release());
      }
    });
  }
  prepare(sql) {
    const database = this;
    const bound = parameters => ({
      bind: (...values) => bound(values),
      async first(columnName) {
        const row = database.sqlite.prepare(sql).get(...parameters) ?? null;
        await database.afterSnapshot(sql);
        return columnName && row ? row[columnName] : row;
      },
      async run() {
        const result = database.sqlite.prepare(sql).run(...parameters);
        const changes = Number(result.changes);
        if (/^(UPDATE|INSERT)/i.test(sql) && changes === 0) database.zeroChangeWrites++;
        return { success: true, meta: { changes, last_row_id: Number(result.lastInsertRowid) } };
      }
    });
    return bound([]);
  }
  close() { this.sqlite.close(); }
}

class MemoryR2Double {
  objects = new Map();
  putCalls = 0;
  async put(key, bytes, options = {}) {
    this.putCalls++;
    this.objects.set(key, { bytes: new Uint8Array(bytes), httpMetadata: { ...options.httpMetadata } });
    return { key };
  }
  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { key, httpMetadata: { ...object.httpMetadata }, arrayBuffer: async () => object.bytes.slice().buffer };
  }
}

function harness(t) {
  const db = new SQLiteD1Double(), bucket = new MemoryR2Double(), store = new D1Store(db, bucket);
  t.after(() => db.close());
  async function request(ownerId, pathname, { body, raw, method = 'GET', headers = {}, idempotencyKey = randomUUID() } = {}) {
    const request = new Request('https://adapter-contract.invalid' + pathname, {
      method,
      headers: { ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)
    });
    const response = await handleApi(request, { store, ownerId });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const bodyResult = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    return { status: response.status, headers: response.headers, body: bodyResult, bytes };
  }
  const post = (owner, pathname, body, idempotencyKey) => request(owner, pathname, { method: 'POST', body, idempotencyKey });
  const profileRequests = new Map();
  const ensureCustomerProfile = owner => {
    if (!profileRequests.has(owner)) profileRequests.set(owner, (async () => {
      const response = await post(owner, '/api/v2/customer/profile', customerProfileFixture());
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response;
    })());
    return profileRequests.get(owner);
  };
  const upload = (owner, name, idempotencyKey) => request(owner, '/api/v2/models', {
    method: 'POST', raw: cube, idempotencyKey,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) }
  });
  const quote = async (owner, changes = {}, idempotencyKey) => {
    await ensureCustomerProfile(owner);
    const ws = await store.load(owner), modelId = ws.models.find(model => model.isSample).id;
    const response = await post(owner, '/api/v2/quotes', { modelId, material: 'PLA', quality: 'standard', qty: 1, unit: 'mm', destination: 'east', ...changes }, idempotencyKey);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response;
  };
  return { db, bucket, store, request, post, upload, quote, ensureCustomerProfile };
}

test('D1 adapter contract: owner isolation covers workspace, model downloads and foreign mutations', async t => {
  const h = harness(t);
  const uploaded = await h.upload(ownerA, 'isolated-cube.stl');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const modelId = uploaded.body.model.id;
  const quoted = await h.quote(ownerA, { modelId });
  const created = await h.post(ownerA, '/api/v2/orders', { quoteId: quoted.body.quotes[0].quoteId, demoAcknowledged: true });
  assert.equal(created.status, 201);
  const other = await h.request(ownerB, '/api/v2/workspace');
  assert.equal(other.status, 200);
  assert.equal(other.body.workspace.orders.length, 0);
  assert.equal(other.body.workspace.models.some(model => model.id === modelId), false);
  const denied = await h.request(ownerB, `/api/v2/models/${modelId}/download`);
  assert.equal(denied.status, 404);
  assert.equal(denied.body.error.code, 'MODEL_NOT_FOUND');
  const owned = await h.request(ownerA, `/api/v2/models/${modelId}/download`);
  assert.equal(owned.status, 200);
  assert.deepEqual(owned.bytes, cube);
  const foreignMutation = await h.post(ownerB, '/api/v2/actions', { action: 'cancel', id: created.body.order.id, demoAcknowledged: true });
  assert.equal(foreignMutation.status, 404);
  assert.equal(foreignMutation.body.error.code, 'ORDER_NOT_FOUND');
  // Identical content and names can belong to two owners without sharing object keys.
  const secondUpload = await h.upload(ownerB, 'isolated-cube.stl');
  assert.equal(secondUpload.status, 201);
  assert.equal(secondUpload.body.model.id, modelId);
  assert.equal(h.bucket.objects.size, 2);
  assert.notEqual(await h.store.blobKey(ownerA, modelId), await h.store.blobKey(ownerB, modelId));
});

test('D1 adapter contract: colliding CAS writes retry and retain both commands', async t => {
  const h = harness(t);
  await h.quote(ownerA);
  const before = await h.store.load(ownerA);
  h.db.holdNextRevisionReads(2);
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(keys.map((key, index) => h.quote(ownerA, { qty: index + 2 }, key)));
  const after = await h.store.load(ownerA);
  assert.ok(h.db.zeroChangeWrites >= 1, 'at least one stale revision must actually fail its compare-and-swap');
  assert.equal(after.revision, before.revision + 2);
  assert.equal(after.quotes.length, before.quotes.length + 6);
  for (const key of keys) assert.equal(Object.hasOwn(after.idempotency, key), true);
  const retainedIds = new Set(after.quotes.map(quote => quote.quoteId));
  for (const result of results) for (const quote of result.body.quotes) assert.equal(retainedIds.has(quote.quoteId), true);
});

test('D1 adapter contract: known idempotency conflicts and replay do not write new R2 objects', async t => {
  const h = harness(t), idempotencyKey = randomUUID();
  const first = await h.upload(ownerA, 'accepted.stl', idempotencyKey);
  assert.equal(first.status, 201);
  assert.equal(h.bucket.objects.size, 1);
  assert.equal(h.bucket.putCalls, 1);
  const conflicting = await h.upload(ownerA, 'rejected.stl', idempotencyKey);
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.bucket.objects.size, 1);
  assert.equal(h.bucket.putCalls, 1);
  const replay = await h.upload(ownerA, 'accepted.stl', idempotencyKey);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.model.id, first.body.model.id);
  assert.equal(h.bucket.putCalls, 1);
});

test('D1 adapter contract: invalid business requests remain 4xx and do not commit state', async t => {
  const h = harness(t), sampleId = (await h.store.load(ownerA)).models.find(model => model.isSample).id;
  await h.ensureCustomerProfile(ownerA);
  const before = await h.store.load(ownerA);
  const cases = [
    ['/api/v2/quotes', { modelId: sampleId, qty: 0 }, 400, 'INVALID_QUANTITY'],
    ['/api/v2/orders', { quoteId: 'nonexistent-quote', demoAcknowledged: true }, 404, 'QUOTE_NOT_FOUND'],
    ['/api/v2/actions', { action: 'prepare-device', id: 'p1' }, 409, 'DEMO_ACK_REQUIRED']
  ];
  for (const [pathname, payload, status, code] of cases) {
    const response = await h.post(ownerA, pathname, payload);
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(response.body.error.code, code);
    assert.equal(typeof response.body.requestId, 'string');
  }
  const state = await h.store.load(ownerA);
  assert.equal(state.revision, before.revision);
  assert.equal(state.orders.length, 0);
  assert.equal(state.quotes.length, 0);
  assert.deepEqual(state.idempotency, before.idempotency);
  assert.equal(h.bucket.objects.size, 0);
});

test('D1 adapter contract: missing trusted identity returns 401 even with forged user headers', async t => {
  const h = harness(t);
  for (const pathname of ['/api/v2/session', '/api/v2/workspace', '/api/v2/models/mdl_missing/download']) {
    const response = await h.request(undefined, pathname, { headers: { 'oai-authenticated-user-id': ownerA } });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTH_REQUIRED');
  }
  const health = await h.request(undefined, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.persistence, 'd1');
  assert.equal(health.body.realPayments, false);
  assert.equal(health.body.realDevices, false);
});
