import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createApiClient } = require('../shared/api-client.js');
const base = 'https://sandbox-api.example.test';
const address = { recipient: '测试客户', phone: '13800000000', countryCode: 'CN', province: '浙江省', city: '杭州市', district: '测试区', addressLine: '测试街道 1 号', postalCode: '' };
const input = { displayName: '测试', setupCompleted: true, shippingAddress: address };
const make = transport => createApiClient({ apiBase: base, transport, getAccessToken: () => 'test-only-token' });

test('profile read accepts an absent profile and rejects malformed payloads', async () => {
  assert.equal((await make(async () => ({ status: 200, data: { profile: null } })).getCustomerProfile()).profile, null);
  for (const data of [{}, { profile: [] }, { profile: 'invalid' }]) {
    await assert.rejects(make(async () => ({ status: 200, data })).getCustomerProfile(), { code: 'INVALID_RESPONSE' });
  }
});

test('profile save requires idempotency and forwards only caller supplied profile data', async () => {
  const calls = [];
  const client = make(async request => { calls.push(request); return { status: 200, data: { profile: { ...request.data, addressRevision: 1 } } }; });
  await assert.rejects(client.saveCustomerProfile(input), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.equal(calls.length, 0);
  await client.saveCustomerProfile(input, 'profile-save-key');
  await client.saveCustomerProfile(input, 'profile-save-key');
  assert.equal(calls[0].url, base + '/api/v2/customer/profile');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].data, input);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

async function adapter(transport) {
  const source = await readFile(new URL('../weapp/utils/service.js', import.meta.url), 'utf8');
  const memory = new Map();
  const modules = {
    './demo': require('../weapp/utils/demo.js'),
    '../config/service': { API_BASE: base, AUTH_ADAPTER_READY: true },
    './api-client': require('../shared/api-client.js'),
    './auth': { getAccessToken: () => 'test-only-token' },
    './transport': { wxTransport: async request => request.url.endsWith('/session') ? { status: 200, data: { authenticated: true, mode: 'SERVER_SANDBOX' } } : transport(request) }
  };
  const context = vm.createContext({ module: { exports: {} }, require: name => modules[name], wx: { getStorageSync: key => structuredClone(memory.get(key)), setStorageSync: (key, value) => memory.set(key, structuredClone(value)) } });
  vm.runInContext(source, context);
  return { service: context.module.exports, memory };
}

test('mini-program blocks quote before network quote request when address is missing', async () => {
  const calls = [];
  const { service } = await adapter(async request => { calls.push(request); return { status: 200, data: { profile: null } }; });
  await service.selectMode('server');
  await assert.rejects(service.getQuotes({ materialIndex: 0, quantity: 1 }), { code: 'ADDRESS_REQUIRED' });
  assert.deepEqual(calls.map(call => call.url), [base + '/api/v2/customer/profile']);
});

test('address revision changes quote retry scope without sending a fixed destination or storing address', async () => {
  let revision = 1;
  const calls = [];
  const { service, memory } = await adapter(async request => {
    if (request.url.endsWith('/customer/profile')) return { status: 200, data: { profile: { shippingAddress: address, addressRevision: revision } } };
    calls.push(request); throw new Error('simulated request interruption');
  });
  await service.selectMode('server');
  const spec = { materialIndex: 0, quantity: 1 };
  await assert.rejects(service.getQuotes(spec), { code: 'NETWORK_ERROR' });
  await assert.rejects(service.getQuotes(spec), { code: 'NETWORK_ERROR' });
  revision = 2;
  await assert.rejects(service.getQuotes(spec), { code: 'NETWORK_ERROR' });
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.notEqual(calls[1].headers['Idempotency-Key'], calls[2].headers['Idempotency-Key']);
  assert.equal(Object.hasOwn(calls[0].data, 'destination'), false);
  const stored = JSON.stringify([...memory.entries()]);
  assert.equal(stored.includes(address.recipient), false);
  assert.equal(stored.includes(address.addressLine), false);
});

test('profile save retry stays in memory and success invalidates previous selected quotes', async () => {
  const profileKeys = []; let attempts = 0;
  const { service, memory } = await adapter(async request => {
    if (request.url.endsWith('/customer/profile') && request.method === 'GET') return { status: 200, data: { profile: { shippingAddress: address, addressRevision: 1 } } };
    if (request.url.endsWith('/quotes')) return { status: 200, data: { quotes: [{ quoteId: 'q-existing', farm: { name: 'test' }, total: 1, days: [1, 2] }] } };
    if (request.url.endsWith('/customer/profile')) {
      profileKeys.push(request.headers['Idempotency-Key']);
      if (attempts++ === 0) throw new Error('request interruption');
      return { status: 200, data: { profile: { ...input, addressRevision: 2 } } };
    }
    throw new Error('order must not be sent after changing address');
  });
  await service.selectMode('server'); await service.getQuotes({ materialIndex: 0, quantity: 1 });
  await assert.rejects(service.saveCustomerProfile(input), { code: 'NETWORK_ERROR' });
  await service.saveCustomerProfile(input);
  assert.equal(profileKeys[0], profileKeys[1]);
  await assert.rejects(service.createOrder('q-existing'), /重新获取/);
  assert.equal(JSON.stringify([...memory.entries()]).includes(address.addressLine), false);
});

test('local demonstration does not collect a real shipping address', async () => {
  const { service, memory } = await adapter(async () => { throw new Error('network must not be used'); });
  const result = await service.getCustomerProfile();
  assert.equal(result.profile, null); assert.equal(result.localOnly, true);
  await assert.rejects(service.saveCustomerProfile(input), { code: 'SERVER_MODE_REQUIRED' });
  assert.equal(memory.size, 0);
});

test('mini-program receives only address field errors relevant to its form', async () => {
  const response = {status: 400, data: {error: {code: 'INVALID_ADDRESS', message: '请重新检查收货地址', fieldErrors: {phone: '号码格式不正确', unrelated: 'unknown', city: 42}}}};
  const client = make(async () => response);
  await assert.rejects(client.saveCustomerProfile(input, 'test-address-key'), error => {
    assert.deepEqual(error.fieldErrors, {phone: '号码格式不正确'});
    return true;
  });
});

test('a late server quote cannot replace a newer quote when the customer orders', async () => {
  let finishOld, started;
  const start = new Promise(resolve => { started = resolve; });
  const {service} = await adapter(async request => {
    if (request.url.endsWith('/customer/profile')) return {status: 200, data: {profile: {shippingAddress: address, addressRevision: 1}}};
    if (request.url.endsWith('/orders')) return {status: 200, data: {order: {id: request.data.quoteId}}};
    const quoteId = 'qty-' + request.data.qty;
    if (request.data.qty === 1) { started(); await new Promise(resolve => { finishOld = resolve; }); }
    return {status: 200, data: {quotes: [{quoteId, days: [1,2], total: 20}]}};
  });
  await service.selectMode('server');
  const old = service.getQuotes({materialIndex: 0, quantity: 1});
  await start;
  await service.getQuotes({materialIndex: 0, quantity: 2});
  finishOld(); await old;
  assert.equal((await service.createOrder('qty-2')).id,'qty-2');
  await assert.rejects(service.createOrder('qty-1'),/重新获取/);
});
