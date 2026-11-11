import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWorkspace, decodeWorkspace } from '../services/platform/workspace-storage.mjs';
import { createWorkspace } from '../services/platform/core.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';

test('legacy and oversized quote histories round-trip with distinct order and replay snapshots', async () => {
  const workspace = createWorkspace({ now: 1 });
  assert.deepEqual(await decodeWorkspace(JSON.stringify(workspace)), workspace);
  const original = { quoteId: 'Q-1', terms: '工艺参数'.repeat(100000) };
  workspace.quotes.push({ ...original, usedByOrderId: 'order-1' });
  workspace.pricingEvidence = { 'Q-1': { manufacturingCents: 5200 } };
  workspace.idempotency = Object.fromEntries([
    ['__proto__', { digest: 'initial-quote', result: { quotes: [original] } }],
    ['checkout', { result: { orderId: 'order-1' } }]
  ]);
  const encoded = await encodeWorkspace(workspace);
  assert.ok(Buffer.byteLength(encoded) < 1024 * 1024);
  const decoded = await decodeWorkspace(encoded);
  assert.deepEqual(decoded, workspace);
  assert.equal(decoded.idempotency.__proto__.result.quotes[0].usedByOrderId, undefined);
  assert.equal(decoded.quotes[0].usedByOrderId, 'order-1');
  await assert.rejects(decodeWorkspace(encoded.replace(/"historySize":\d+/, '"historySize":1')), /length/);
});

test('oversized non-quote rows and expanded histories are rejected before committing', async () => {
  const store = new SQLiteStore(':memory:');
  try {
    for (const additions of [{ orders: [{ notes: 'a'.repeat(1024 * 1024) }] }, { quotes: [{ terms: 'a'.repeat(6 * 1024 * 1024) }] }]) {
      await assert.rejects(store.transact('customer', old => ({ workspace: { ...old, ...additions, revision: 1 } })), { code: 'WORKSPACE_CAPACITY' });
    }
    assert.equal((await store.load('customer')).revision, 0);
    await store.transact('customer', old => ({ workspace: { ...old, revision: 1 } }));
    assert.equal((await store.load('customer')).revision, 1);
  } finally { store.close(); }
});
