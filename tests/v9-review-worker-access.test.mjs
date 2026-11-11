import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { authenticateWorker, validateWorkerAccess, workerReadiness } from '../services/platform/worker-access.mjs';

// Synthetic credentials only. This exercises the worker trust boundary, not
// actual cloud networking, an external identity provider, or a print device.
const now = 1_790_000_000_000;
function fixture() {
  const token = randomBytes(32).toString('base64url');
  const record = { ownerId: 'review-owner-a', workerId: 'review-worker-a',
    tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: now + 60_000,
    kinds: ['ANALYZE_MODEL'], enabled: true };
  return { token, record, config: validateWorkerAccess({ workers: [record] }) };
}
const request = (token, headers = {}) => new Request('https://review.invalid/api/v2/worker/claim', {
  headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }
});

test('review v0.9: worker identity and task scope come only from server configuration', async () => {
  const { token, record, config } = fixture();
  const identity = await authenticateWorker(request(token, {
    'oai-authenticated-user-id': 'review-owner-b', 'x-worker-id': 'forged-worker',
    Cookie: 'coforge_account=' + 'a'.repeat(64)
  }), config, now);
  assert.deepEqual(identity, { ownerId: record.ownerId, workerId: record.workerId, kinds: ['ANALYZE_MODEL'] });
  assert.doesNotMatch(JSON.stringify(identity), /tokenHash|expiresAt/);
  assert.ok(!JSON.stringify(identity).includes(token));
  identity.kinds.push('SLICE_MODEL');
  assert.deepEqual(config.workers[0].kinds, ['ANALYZE_MODEL'], 'returned claims must not mutate trusted configuration');
});

test('review v0.9: browser sessions, discovery credentials and guessed tokens do not authenticate a manufacturing worker', async () => {
  const { config } = fixture();
  const cases = [
    request(null, { Cookie: 'coforge_account=' + 'a'.repeat(64), 'oai-authenticated-user-id': 'review-owner-a' }),
    request('gw1.discovery-token.not-a-manufacturing-worker'),
    request(randomBytes(32).toString('base64url')),
    request('short'),
    request('a'.repeat(129)),
    new Request('https://review.invalid', { headers: { Authorization: 'Basic abcdef' } })
  ];
  for (const input of cases) await assert.rejects(authenticateWorker(input, config, now), error => error.status === 401);
});

test('review v0.9: disabled and expired worker credentials fail at the expiry boundary', async () => {
  const { token, config } = fixture();
  await assert.rejects(authenticateWorker(request(token), config, now + 60_000), error => error.status === 401);
  config.workers[0].enabled = false;
  await assert.rejects(authenticateWorker(request(token), config, now), error => error.status === 401);
  assert.equal(workerReadiness(config, 'review-owner-a', now).configured, false);
});

test('review v0.9: configuration rejects ambiguous credentials and invalid task grants', () => {
  const { record } = fixture();
  for (const workers of [
    [record, { ...record, workerId: 'other-worker' }],
    [record, { ...record, tokenHash: '0'.repeat(64) }],
    [{ ...record, kinds: ['DEVICE_START'] }],
    [{ ...record, kinds: [] }],
    [{ ...record, enabled: 'true' }],
    [{ ...record, expiresAt: Infinity }],
    [{ ...record, ownerId: '' }],
    [{ ...record, tokenHash: 'not-a-hash' }]
  ]) assert.throws(() => validateWorkerAccess({ workers }), error => error.code === 'WORKER_CONFIG_INVALID');
});

test('review v0.9: service readiness is owner scoped and never implies tested connectivity', () => {
  const { token, record, config } = fixture();
  const ready = workerReadiness(config, record.ownerId, now);
  assert.deepEqual(ready, { configured: true, kinds: ['ANALYZE_MODEL'], status: 'CONFIGURED_NOT_VERIFIED', onlineVerified: false });
  const other = workerReadiness(config, 'review-owner-b', now);
  assert.deepEqual(other, { configured: false, kinds: [], status: 'NOT_CONFIGURED', onlineVerified: false });
  assert.ok(!JSON.stringify(ready).includes(token));
  assert.ok(!JSON.stringify(ready).includes(record.tokenHash));
  assert.equal(workerReadiness(config, record.ownerId, record.expiresAt).configured, false);
  record.ownerId = 'changed-after-validation';
  assert.equal(config.workers[0].ownerId, 'review-owner-a', 'validated configuration must own a defensive copy');
});
