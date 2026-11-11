import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { createApiClient, createFetchTransport, normalizeApiBase } = require('../shared/api-client.js');
const base = 'https://sandbox-api.example.test';
const validToken = () => 'unit-test-only-not-a-real-token';
const make = (transport, getAccessToken = validToken) => createApiClient({ apiBase: base, transport, getAccessToken });

test('API base only accepts HTTPS origins and rejects credentials/paths', () => {
  assert.equal(normalizeApiBase(base + '/'), base);
  for (const value of ['', 'http://api.test', 'https://user:pass@api.test', base + '/api/v2', base + '?token=x', base + '#x', '//api.test'])
    assert.throws(() => normalizeApiBase(value), { code: 'INVALID_API_BASE' });
});

test('missing identity blocks network before any request', async () => {
  let calls = 0;
  await assert.rejects(make(async () => { calls++; }, () => null).getWorkspace(), { code: 'AUTH_REQUIRED' });
  assert.equal(calls, 0);
});

test('session handshake requires authenticated SERVER_SANDBOX', async () => {
  await assert.rejects(make(async () => ({ status: 200, data: { authenticated: false, mode: 'SERVER_SANDBOX' } })).getSession(), { code: 'AUTH_REQUIRED' });
  await assert.rejects(make(async () => ({ status: 200, data: { authenticated: true, mode: 'PRODUCTION' } })).getSession(), { code: 'UNEXPECTED_SERVER_MODE' });
  const result = await make(async () => ({ status: 200, data: { authenticated: true, mode: 'SERVER_SANDBOX', persistence: 'test' } })).getSession();
  assert.equal(result.persistence, 'test');
});

test('quote client uses the v2 route and passes the contracted payload', async () => {
  const input = { modelId: 'sample-bracket', material: 'PLA', quality: 'standard', qty: 2, unit: 'mm', destination: 'east' };
  let captured;
  const result = await make(async request => { captured = request; return { statusCode: 200, data: { quotes: [{ quoteId: 'q1' }] } }; }).getQuotes(input, 'quote-key-123');
  assert.equal(captured.headers['Idempotency-Key'], 'quote-key-123');
  assert.equal(captured.url, base + '/api/v2/quotes'); assert.equal(captured.method, 'POST'); assert.deepEqual(captured.data, input); assert.equal(result.quotes[0].quoteId, 'q1');
});

test('quotes reject missing idempotency before transport', async () => {
  let calls = 0; const client = make(async () => { calls++; });
  await assert.rejects(client.getQuotes({ modelId: 'sample-bracket' }), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.equal(calls, 0);
});

test('order creation requires idempotency and explicit sandbox acknowledgement', async () => {
  const calls = [];
  const client = make(async request => { calls.push(request); return { status: 201, data: { order: { id: 'order1' }, workspace: {} } }; });
  await assert.rejects(client.createOrder('q1', ''), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.equal(calls.length, 0);
  await client.createOrder('q1', 'order-retry-key-123'); await client.createOrder('q1', 'order-retry-key-123');
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.deepEqual(calls[0].data, { quoteId: 'q1', demoAcknowledged: true });
});

test('server errors and network failures stay errors without local fake success', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN']])
    await assert.rejects(make(async () => ({ status, data: {} })).getWorkspace(), { code });
  await assert.rejects(make(async () => ({ status: 409, data: { error: { code: 'QUOTE_EXPIRED', message: '报价已过期' } } })).getWorkspace(), { code: 'QUOTE_EXPIRED', status: 409 });
  await assert.rejects(make(async () => { throw new Error('secret transport details'); }).getWorkspace(), error => error.code === 'NETWORK_ERROR' && !error.message.includes('secret'));
  await assert.rejects(make(async () => ({ status: 200, data: '<html>login</html>' })).getWorkspace(), { code: 'INVALID_RESPONSE' });
});

test('customer action interface cannot dispatch merchant/settlement operations', async () => {
  let captured;
  const client = make(async request => { captured = request; return { status: 200, data: { ok: true } }; });
  assert.throws(() => client.customerAction('start-printer', 'o1', {}, 'customer-123'), { code: 'CUSTOMER_ACTION_NOT_ALLOWED' });
  await client.customerAction('accept', 'o1', { action: 'start-printer', id: 'o2', demoAcknowledged: false }, 'customer-123');
  assert.equal(captured.data.action, 'accept'); assert.equal(captured.data.id, 'o1'); assert.equal(captured.data.demoAcknowledged, true);
});

test('binary model upload preserves raw bytes and encodes filename', async () => {
  let captured;
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  await make(async request => { captured = request; return { status: 201, data: { model: { id: 'm1' } } }; }).uploadModel(buffer, '连接件.stl', 'upload-model-123');
  assert.equal(captured.data, buffer); assert.equal(captured.headers['Content-Type'], 'application/octet-stream');
  assert.equal(captured.headers['X-File-Name'], encodeURIComponent('连接件.stl'));
});

test('fetch transport explicitly omits browser cookies', async () => {
  let options;
  const transport = createFetchTransport(async (url, init) => { options = init; return { status: 200, json: async () => ({ quotes: [] }) }; });
  await make(transport).getQuotes({ modelId: 'sample-bracket' }, 'quote-fetch-123');
  assert.equal(options.credentials, 'omit'); assert.equal(options.body, JSON.stringify({ modelId: 'sample-bracket' }));
});

test('mini-program defaults to local mode and blocks unsupported remote auth', async () => {
  const service = require('../weapp/utils/service.js');
  assert.equal(service.getMode(), 'local');
  await assert.rejects(service.selectMode('server'), { code: 'AUTH_ADAPTER_NOT_READY' });
  assert.equal(service.getMode(), 'local');
});

test('WeChat generated client matches the shared source', async () => {
  const shared = await readFile(new URL('../shared/api-client.js', import.meta.url), 'utf8');
  const mini = await readFile(new URL('../weapp/utils/api-client.js', import.meta.url), 'utf8');
  assert.equal(mini, '// Generated from apps/shared/api-client.js; run node apps/tools/sync-client.mjs.\n' + shared);
});

test('mini-program retains failed quote idempotency keys across adapter reloads', async () => {
  const { default: vm } = await import('node:vm');
  const source = await readFile(new URL('../weapp/utils/service.js', import.meta.url), 'utf8');
  const memory = new Map(); const quoteKeys = []; let quoteAttempts = 0;
  function adapter() {
    const modules = {
      './demo': require('../weapp/utils/demo.js'),
      '../config/service': { API_BASE: base, AUTH_ADAPTER_READY: true },
      './api-client': require('../shared/api-client.js'),
      './auth': { getAccessToken: validToken },
      './transport': { wxTransport: async request => {
        if (request.url.endsWith('/session')) return { status: 200, data: { authenticated: true, mode: 'SERVER_SANDBOX' } };
        quoteKeys.push(request.headers['Idempotency-Key']); quoteAttempts++;
        if (quoteAttempts === 1) throw new Error('test network interruption');
        return { status: 200, data: { quotes: [{ quoteId: 'q1', farm: { name: 'test' }, total: 1, days: [1, 2] }] } };
      } }
    };
    const context = vm.createContext({ module: { exports: {} }, require: name => modules[name], wx: { getStorageSync: key => structuredClone(memory.get(key)), setStorageSync: (key, value) => memory.set(key, structuredClone(value)) } });
    vm.runInContext(source, context); return context.module.exports;
  }
  const first = adapter(); await first.selectMode('server');
  const spec = { materialIndex: 0, quantity: 1 };
  await assert.rejects(first.getQuotes(spec), { code: 'NETWORK_ERROR' });
  assert.equal(first.getMode(), 'server');
  const reloaded = adapter(); await reloaded.selectMode('server'); await reloaded.getQuotes(spec);
  assert.equal(quoteKeys.length, 2); assert.equal(quoteKeys[0], quoteKeys[1]);
  assert.deepEqual(memory.get('shared_fabrication_pending_api_keys_v1'), {});
});
