import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import vm from 'node:vm';

// A VM evaluates the actual browser client with storage/network test doubles.
// No browser, external service, or real delivery details are used.
const source = (await readFile(new URL('../dist/api-client.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const storageKey = 'coforge.pending-requests.v2';
const addressPayload = { shippingAddress: { recipient: '测试姓名', addressLine: '测试地址18号', phone: '13800000000' } };
function client({ secure = false, memory = new Map(), cryptoOverride } = {}) {
  const requests = [];
  let transport = async () => ({ ok: true, status: 200, json: async () => ({ saved: true }) });
  const context = vm.createContext({
    TextEncoder, Uint8Array, AbortController, setTimeout, clearTimeout,
    crypto: cryptoOverride ?? (secure ? webcrypto : { randomUUID }),
    sessionStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) },
    fetch: async (url, options) => { requests.push({ url, ...options }); return transport(url, options); }
  });
  vm.runInContext(source + '\nglobalThis.testApi = { prepareMutation, get };', context);
  return { api: context.testApi, memory, requests, transport: fn => { transport = fn; } };
}
const serialized = h => h.memory.get(storageKey);

test('web API privacy: initialization removes legacy plaintext and accepts only digest identities with safe request keys', () => {
  const validDigest = 'a'.repeat(64), validKey = 'safe-request-key-123';
  const memory = new Map([[storageKey, JSON.stringify({
    [validDigest]: validKey,
    ['/customer/profile:POST:' + JSON.stringify(addressPayload)]: 'old-request-key',
    ['b'.repeat(64)]: 'unsafe address value / secret',
    ['c'.repeat(64)]: { nested: 'not a key' },
    invalid: 'another-valid-key'
  })]]);
  const h = client({ memory });
  assert.deepEqual(JSON.parse(serialized(h)), { [validDigest]: validKey });
  assert.ok(!serialized(h).includes('测试地址'));
});

test('web API privacy: no-SubtleCrypto retries reuse memory-only identity without storing customer fields', async () => {
  const h = client();
  const first = await h.api.prepareMutation('/customer/profile', addressPayload);
  const duplicate = await h.api.prepareMutation('/customer/profile', structuredClone(addressPayload));
  assert.equal(first.key, duplicate.key);
  h.transport(async () => { throw new Error('simulated interruption'); });
  await assert.rejects(first.execute(), error => error.code === 'NETWORK_ERROR');
  const retry = await h.api.prepareMutation('/customer/profile', addressPayload);
  assert.equal(retry.key, first.key);
  assert.equal(serialized(h), '{}');
  h.transport(async () => ({ ok: true, status: 200, json: async () => ({ saved: true }) }));
  await retry.execute();
  const next = await h.api.prepareMutation('/customer/profile', addressPayload);
  assert.notEqual(next.key, first.key, 'success releases the in-memory request identity');
  assert.equal(serialized(h), '{}');
});

test('web API privacy: same-length bodies and filenames never share no-digest request keys', async () => {
  const h = client();
  const one = await h.api.prepareMutation('/customer/profile', { addressLine: '测试地址18号' });
  const two = await h.api.prepareMutation('/customer/profile', { addressLine: '测试地址28号' });
  assert.notEqual(one.key, two.key);
  const bytesA = new Uint8Array([1, 2, 3]).buffer, bytesB = new Uint8Array([3, 2, 1]).buffer;
  const fileA = await h.api.prepareMutation('/models', bytesA, { raw: true, headers: { 'X-File-Name': 'private-a.stl' } });
  const fileB = await h.api.prepareMutation('/models', bytesB, { raw: true, headers: { 'X-File-Name': 'private-a.stl' } });
  const fileC = await h.api.prepareMutation('/models', bytesA, { raw: true, headers: { 'X-File-Name': 'private-b.stl' } });
  const repeat = await h.api.prepareMutation('/models', bytesA, { raw: true, headers: { 'X-File-Name': 'private-a.stl' } });
  assert.equal(new Set([fileA.key, fileB.key, fileC.key]).size, 3); assert.equal(fileA.key, repeat.key);
  assert.ok(!serialized(h).includes('private-')); assert.ok(!serialized(h).includes('测试地址'));
});

test('web API privacy: SHA-256 identities support reload retries and persist only opaque digest/key pairs', async () => {
  const first = client({ secure: true });
  const task = await first.api.prepareMutation('/customer/profile', addressPayload);
  const entries = Object.entries(JSON.parse(serialized(first)));
  assert.equal(entries.length, 1); assert.match(entries[0][0], /^[a-f0-9]{64}$/); assert.equal(entries[0][1], task.key);
  assert.ok(!serialized(first).includes(addressPayload.shippingAddress.addressLine));
  const reloaded = client({ secure: true, memory: first.memory });
  const retry = await reloaded.api.prepareMutation('/customer/profile', addressPayload);
  assert.equal(retry.key, task.key);
  await retry.execute();
  assert.equal(reloaded.requests[0].headers['Idempotency-Key'], task.key);
  assert.equal(reloaded.requests[0].body, JSON.stringify(addressPayload));
  assert.equal(serialized(reloaded), '{}');
});

test('web API privacy: late duplicate success does not delete a newer hashed request identity', async () => {
  const h = client({ secure: true });
  const old = await h.api.prepareMutation('/customer/profile', addressPayload);
  const duplicate = await h.api.prepareMutation('/customer/profile', addressPayload);
  await old.execute();
  const newer = await h.api.prepareMutation('/customer/profile', addressPayload);
  assert.notEqual(newer.key, old.key);
  await duplicate.execute();
  assert.equal(Object.values(JSON.parse(serialized(h)))[0], newer.key);
});

test('web API privacy: unavailable digest implementation falls back without persisting raw data', async () => {
  const h = client({ cryptoOverride: { randomUUID, subtle: { digest: async () => { throw new Error('unavailable in this WebView'); } } } });
  const first = await h.api.prepareMutation('/customer/profile', addressPayload);
  const same = await h.api.prepareMutation('/customer/profile', addressPayload);
  assert.equal(first.key, same.key); assert.equal(serialized(h), '{}');
});
