import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { applyMerchantCommand, createGatewayCredential, parseGatewayCredential, authenticateGateway, merchantSession, merchantDevices, merchantScanResult, GATEWAY_FRESH_MS, SCAN_TTL_MS } from '../services/platform/merchant.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { handleApi } from '../services/platform/http.mjs';

const beginning = 1_790_000_000_000;
function harness() {
  let workspace = createWorkspace({ now: beginning }), now = beginning;
  const ownerId = 'owner-merchant-A';
  return {
    ownerId, state: () => workspace, now: () => now, advance: ms => { now += ms; },
    run: async (type, payload = {}, options = {}) => {
      const outcome = await applyMerchantCommand(workspace, { type, payload, idempotencyKey: options.key ?? randomUUID() }, { ownerId, now, ...options });
      workspace = outcome.workspace; return outcome;
    },
    pair: async function (name = '本地网关') {
      const pairing = await createGatewayCredential(ownerId, now);
      await this.run('pairing', { name }, { pairing });
      return { raw: pairing, parsed: await parseGatewayCredential('Bearer ' + pairing.token) };
    }
  };
}
const device = (extra = {}) => ({ deviceKey: 'stable-moonraker-001', name: '测试 Moonraker', protocol: 'moonraker', model: 'FDM', endpoint: 'http://192.168.1.20:7125', connectionState: 'online', ...extra });
const rejectCode = code => error => error.code === code;

async function online(h) {
  await h.run('enroll', { name: '测试制造工坊' });
  const pair = await h.pair(); await h.run('gateway-poll', {}, { credential: pair.parsed });
  return pair;
}
async function finishedScan(h, pair, candidates = [device()]) {
  const { result } = await h.run('scan', { scope: 'real', gatewayId: pair.raw.id });
  await h.run('gateway-report', { scanId: result.scan.id, candidates }, { credential: pair.parsed });
  return merchantScanResult(h.state(), result.scan.id, h.now()).scan;
}

test('merchant: enrollment is explicit, owner-bound and idempotent; new inventory has no invented devices', async () => {
  const h = harness(); assert.equal(merchantSession(h.state()).profile, null);
  assert.throws(() => merchantDevices(h.state()), rejectCode('MERCHANT_REQUIRED'));
  await assert.rejects(h.run('enroll', { name: '' }), rejectCode('INVALID_MERCHANT_NAME'));
  const key = randomUUID(), first = await h.run('enroll', { name: '制造工坊' }, { key });
  const again = await h.run('enroll', { name: '制造工坊' }, { key });
  assert.equal(again.replayed, true); assert.equal(first.result.profile.id, again.result.profile.id);
  assert.equal(first.result.profile.verification, 'sandbox_unverified');
  assert.deepEqual(merchantDevices(h.state()).counts, { total: 0, real: 0, online: 0, offline: 0, demo: 0 });
  await assert.rejects(h.run('enroll', { name: '变更请求' }, { key }), rejectCode('IDEMPOTENCY_CONFLICT'));
  assert.equal(merchantSession(createWorkspace()).profile, null);
});

test('merchant: pairing stores only token hash and never leaks it through customer projection', async () => {
  const h = harness(); await h.run('enroll', { name: '测试工坊' });
  const pairing = await createGatewayCredential(h.ownerId, h.now()), key = randomUUID();
  const first = await h.run('pairing', { name: '网关' }, { pairing, key });
  assert.equal(first.result.token, undefined);
  const raw = JSON.stringify(h.state()); assert.equal(raw.includes(pairing.token), false);
  assert.equal(raw.includes(pairing.token.split('.').at(-1)), false);
  assert.ok(raw.includes(pairing.tokenHash));
  const publicData = JSON.stringify(getPublicWorkspace(h.state()));
  assert.equal(publicData.includes(pairing.tokenHash), false); assert.equal(publicData.includes('merchant_'), false);
  const parsed = await parseGatewayCredential('Bearer ' + pairing.token);
  assert.equal(authenticateGateway(h.state(), parsed, h.now()).id, pairing.id);
  const other = createWorkspace(); assert.throws(() => authenticateGateway(other, parsed, h.now()), rejectCode('GATEWAY_AUTH_INVALID'));
  await assert.rejects(parseGatewayCredential('Bearer gw1.not-a-valid-token'), rejectCode('GATEWAY_AUTH_INVALID'));
});

test('merchant: real scan requires fresh gateway; scope is never silently replaced by demo', async () => {
  const h = harness(); await h.run('enroll', { name: '工坊' });
  await assert.rejects(h.run('scan', {}), rejectCode('SCAN_SCOPE_REQUIRED'));
  await assert.rejects(h.run('scan', { scope: 'real' }), rejectCode('GATEWAY_REQUIRED'));
  const pair = await h.pair();
  await assert.rejects(h.run('scan', { scope: 'real', gatewayId: pair.raw.id }), rejectCode('GATEWAY_OFFLINE'));
  await h.run('gateway-poll', {}, { credential: pair.parsed });
  const scan = await h.run('scan', { scope: 'real', gatewayId: pair.raw.id });
  assert.equal(scan.result.scan.status, 'pending'); assert.equal(scan.result.scan.candidates.length, 0);
  h.advance(GATEWAY_FRESH_MS + 1);
  await assert.rejects(h.run('scan', { scope: 'real', gatewayId: pair.raw.id }), rejectCode('GATEWAY_OFFLINE'));
});

test('merchant: demo import is explicit, authorization gate is atomic, and duplicate imports never inflate counts', async () => {
  const h = harness(); await h.run('enroll', { name: '工坊' });
  const { result } = await h.run('scan', { scope: 'demo' });
  const scan = result.scan; assert.equal(scan.candidates.length, 3); assert.ok(scan.candidates.every(c => c.source === 'demo'));
  const before = JSON.stringify(h.state());
  await assert.rejects(h.run('import', { scanId: scan.id, candidateIds: scan.candidates.map(c => c.id) }), rejectCode('DEVICE_NOT_AUTHORIZED'));
  assert.equal(JSON.stringify(h.state()), before);
  const ids = scan.candidates.filter(c => c.connectionState === 'online').map(c => c.id);
  const first = await h.run('import', { scanId: scan.id, candidateIds: ids });
  assert.equal(first.result.imported.length, 2);
  assert.deepEqual(first.result.counts, { total: 2, real: 0, online: 0, offline: 0, demo: 2 });
  const again = await h.run('import', { scanId: scan.id, candidateIds: ids });
  assert.equal(again.result.imported.length, 0); assert.equal(again.result.skipped.length, 2);
  h.advance(SCAN_TTL_MS + 1);
  const expiredView = merchantScanResult(h.state(), scan.id, h.now()).scan;
  assert.equal(expiredView.status, 'complete'); assert.equal(expiredView.importable, false); assert.equal(expiredView.importBlockedReason, 'SCAN_EXPIRED');
  await assert.rejects(h.run('import', { scanId: scan.id, candidateIds: ids }), rejectCode('SCAN_NOT_IMPORTABLE'));
});

test('merchant: authenticated real report is monitor-only, stable across repeated scans and stale when gateway is offline', async () => {
  const h = harness(), pair = await online(h);
  const scan = await finishedScan(h, pair, [device({ capabilities: ['start'], automaticPrinting: true })]);
  assert.deepEqual(scan.candidates[0].capabilities, ['monitor']); assert.equal(scan.candidates[0].automaticPrinting, false);
  const first = await h.run('import', { scanId: scan.id, candidateIds: [scan.candidates[0].id] });
  const registeredAt = first.result.devices[0].registeredAt; assert.equal(first.result.counts.online, 1);
  h.advance(1000); await h.run('gateway-poll', {}, { credential: pair.parsed });
  const second = await finishedScan(h, pair, [device({ endpoint: 'http://192.168.1.21:7125/moonraker/printer1' })]);
  assert.equal(second.candidates[0].id, scan.candidates[0].id);
  const importedAgain = await h.run('import', { scanId: second.id, candidateIds: [second.candidates[0].id] });
  assert.equal(importedAgain.result.counts.real, 1); assert.equal(importedAgain.result.devices[0].registeredAt, registeredAt);
  h.advance(GATEWAY_FRESH_MS + 1);
  const stale = merchantDevices(h.state(), h.now()); assert.equal(stale.counts.online, 0); assert.equal(stale.counts.offline, 1);
});

test('merchant: invalid candidates and foreign scans leave state unchanged; pending scan expires deterministically', async () => {
  const h = harness(), pair = await online(h), secondPair = await h.pair('另一个网关');
  const scan = (await h.run('scan', { scope: 'real', gatewayId: pair.raw.id })).result.scan;
  const before = JSON.stringify(h.state());
  await assert.rejects(h.run('gateway-report', { scanId: scan.id, candidates: [device()] }, { credential: secondPair.parsed }), rejectCode('SCAN_NOT_FOUND'));
  await assert.rejects(h.run('gateway-report', { scanId: scan.id, candidates: [device({ endpoint: 'https://example.com' })] }, { credential: pair.parsed }), rejectCode('INVALID_DEVICE_ENDPOINT'));
  await assert.rejects(h.run('gateway-report', { scanId: scan.id, candidates: [device({ endpoint: 'http://user:secret@192.168.1.20' })] }, { credential: pair.parsed }), rejectCode('INVALID_DEVICE_ENDPOINT'));
  assert.equal(JSON.stringify(h.state()), before);
  h.advance(SCAN_TTL_MS + 1);
  assert.equal(merchantScanResult(h.state(), scan.id, h.now()).scan.status, 'expired');
  await assert.rejects(h.run('gateway-report', { scanId: scan.id, candidates: [] }, { credential: pair.parsed }), rejectCode('SCAN_CLOSED'));
});

test('merchant: report replay succeeds once but revoked credentials cannot replay or update heartbeat', async () => {
  const h = harness(), pair = await online(h);
  const scan = (await h.run('scan', { scope: 'real', gatewayId: pair.raw.id })).result.scan, key = randomUUID(), payload = { scanId: scan.id, candidates: [device()] };
  await h.run('gateway-report', payload, { credential: pair.parsed, key });
  assert.equal((await h.run('gateway-report', payload, { credential: pair.parsed, key })).replayed, true);
  await h.run('revoke', { gatewayId: pair.raw.id });
  const before = JSON.stringify(h.state());
  await assert.rejects(h.run('gateway-report', payload, { credential: pair.parsed, key }), rejectCode('GATEWAY_AUTH_INVALID'));
  await assert.rejects(h.run('gateway-poll', {}, { credential: pair.parsed }), rejectCode('GATEWAY_AUTH_INVALID'));
  assert.equal(JSON.stringify(h.state()), before);
});

test('merchant: bounded poll ledger cannot consume unbounded workspace history', async () => {
  const h = harness(), pair = await online(h);
  for (let i = 0; i < 160; i++) { h.advance(5000); await h.run('gateway-poll', {}, { credential: pair.parsed }); }
  assert.equal(Object.keys(h.state().merchant.pollLedger).length, 128);
  assert.equal(Object.keys(h.state().merchant.ledger).length, 2);
  assert.ok(new TextEncoder().encode(JSON.stringify(h.state())).byteLength < 100_000);
});

test('merchant HTTP: pairing token is shown once, persists as hash, and cross-origin calls remain blocked', async t => {
  const store = new SQLiteStore(':memory:'); t.after(() => store.close());
  const ownerId = 'http-owner', request = async (path, payload, key = randomUUID(), extras = {}) => {
    const response = await handleApi(new Request('https://merchant.example' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...extras }, body: JSON.stringify(payload) }), { store, ownerId, clock: () => beginning });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('/api/v2/merchant/enroll', { name: '工坊' })).status, 201);
  const key = randomUUID(), first = await request('/api/v2/merchant/pairing', { name: '网关' }, key);
  assert.equal(first.status, 201); assert.match(first.body.token, /^gw1\./);
  const again = await request('/api/v2/merchant/pairing', { name: '网关' }, key);
  assert.equal(again.body.token, null); assert.equal(again.body.replayed, true);
  assert.equal(first.body.gateway.id, again.body.gateway.id);
  assert.equal(JSON.stringify(await store.load(ownerId)).includes(first.body.token), false);
  const blocked = await request('/api/v2/merchant/scan', { scope: 'demo' }, randomUUID(), { Origin: 'https://foreign.example' });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'CROSS_ORIGIN_DENIED');
});
