import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkspace } from '../services/platform/core.mjs';
import { applyMerchantCommand, createGatewayCredential, parseGatewayCredential, merchantDevices, merchantScanResult, DEVICE_OBSERVATION_FRESH_MS, GATEWAY_FRESH_MS } from '../services/platform/merchant.mjs';
import { probeTarget } from '../services/device-gateway/discovery.mjs';

const START = 1_790_000_000_000;
const candidate = (extra = {}) => ({ deviceKey: 'device-one', protocol: 'moonraker', name: '测试协议服务', endpoint: 'http://192.168.8.20:7125', connectionState: 'online', ...extra });
const evidence = (extra = {}) => ({ method: 'GET', endpoint: '/server/info', serviceReachable: true, controllerConnected: true, serviceVersion: 'fixture-1', controllerState: 'ready', ...extra });
async function setup() {
  const h = { workspace: createWorkspace({ now: START }), now: START, ownerId: 'device-v5-owner' };
  h.run = async (type, payload, options = {}) => { const result = await applyMerchantCommand(h.workspace, { type, payload, idempotencyKey: options.key || randomUUID() }, { ownerId: h.ownerId, now: h.now, ...options }); h.workspace = result.workspace; return result.result; };
  await h.run('enroll', { name: '设备测试工坊' });
  h.pairing = await createGatewayCredential(h.ownerId, h.now);
  await h.run('pairing', { name: '协议网关' }, { pairing: h.pairing });
  h.credential = await parseGatewayCredential('Bearer ' + h.pairing.token);
  h.poll = () => h.run('gateway-poll', {}, { credential: h.credential });
  await h.poll();
  h.scan = async (candidates, extra = {}) => { const result = await h.run('scan', { scope: 'real', gatewayId: h.pairing.id }); await h.run('gateway-report', { scanId: result.scan.id, candidates, ...extra }, { credential: h.credential }); return merchantScanResult(h.workspace, result.scan.id, h.now).scan; };
  h.import = scan => h.run('import', { scanId: scan.id, candidateIds: scan.candidates.map(c => c.id) });
  return h;
}

test('device v5: observation and gateway freshness are independent; heartbeat cannot renew a device observation', async () => {
  const h = await setup(), scan = await h.scan([candidate()]);
  await h.import(scan);
  let view = merchantDevices(h.workspace, h.now);
  assert.equal(view.serverNow, h.now);
  assert.equal(view.devices[0].freshUntil, START + GATEWAY_FRESH_MS);
  assert.equal(view.devices[0].observationExpiresAt, START + DEVICE_OBSERVATION_FRESH_MS);
  h.now += DEVICE_OBSERVATION_FRESH_MS; await h.poll();
  view = merchantDevices(h.workspace, h.now);
  assert.equal(view.gateways[0].status, 'online');
  assert.equal(view.counts.online, 0);
  assert.equal(view.devices[0].connectionReason, 'OBSERVATION_EXPIRED');
  assert.equal(view.devices[0].observedConnectionState, 'online');
});

test('device v5: missing and future timestamps fail closed for old workspaces', async () => {
  const h = await setup(); await h.import(await h.scan([candidate()]));
  delete h.workspace.merchant.devices[0].lastSeenAt;
  assert.equal(merchantDevices(h.workspace, h.now).devices[0].connectionReason, 'OBSERVATION_EXPIRED');
  h.workspace.merchant.devices[0].lastSeenAt = h.now + 1;
  assert.equal(merchantDevices(h.workspace, h.now).counts.online, 0);
  h.workspace.merchant.gateways[0].lastSeenAt = h.now + 1;
  assert.equal(merchantDevices(h.workspace, h.now).gateways[0].status, 'offline');
});

test('device v5: read-only evidence is bounded and never advertises machine or process certification', async () => {
  const h = await setup(), scan = await h.scan([candidate({ probeEvidence: { ...evidence(), hardwareVerified: true, apiKey: 'do-not-store' }, automaticPrinting: true, capabilities: ['startPrint'] })]);
  await h.import(scan);
  const d = merchantDevices(h.workspace, h.now).devices[0];
  assert.deepEqual(d.verification, { level: 'PROTOCOL_PROBE_REPORTED', modelConfirmed: false, hardwareVerified: false, processCertified: false });
  assert.deepEqual(d.capabilityDetails, { protocolRead: true, fileUpload: false, startPrint: false, cancelPrint: false });
  assert.equal(d.automaticPrinting, false);
  assert.equal(d.probeEvidence.apiKey, undefined);
  assert.equal(JSON.stringify(h.workspace).includes('do-not-store'), false);
  h.now += 1; await h.scan([candidate()]);
  assert.equal(merchantDevices(h.workspace, h.now).devices[0].verification.level, 'LEGACY_PROTOCOL_REPORTED');
  assert.equal(merchantDevices(h.workspace, h.now).devices[0].probeEvidence, null);
});

test('device v5: contradictory or overlong protocol evidence cannot finish a scan', async () => {
  const h = await setup(), pending = await h.run('scan', { scope: 'real', gatewayId: h.pairing.id });
  const before = JSON.stringify(h.workspace);
  for (const probeEvidence of [evidence({ method: 'POST' }), evidence({ endpoint: '/printer/print/start' }), evidence({ controllerConnected: false }), evidence({ serviceVersion: 'x'.repeat(101) }), evidence({ controllerState: 'ready\nforged' })]) {
    await assert.rejects(h.run('gateway-report', { scanId: pending.scan.id, candidates: [candidate({ probeEvidence })] }, { credential: h.credential }), { code: 'INVALID_PROBE_EVIDENCE' });
    assert.equal(JSON.stringify(h.workspace), before);
  }
});

test('device v5: two different identities at one normalized endpoint cannot enter a scan', async () => {
  const h = await setup(), pending = await h.run('scan', { scope: 'real', gatewayId: h.pairing.id });
  const before = JSON.stringify(h.workspace);
  await assert.rejects(h.run('gateway-report', { scanId: pending.scan.id, candidates: [candidate(), candidate({ deviceKey: 'other-identity', endpoint: 'http://192.168.8.20:7125/' })] }, { credential: h.credential }), { code: 'DUPLICATE_ENDPOINT' });
  assert.equal(JSON.stringify(h.workspace), before);
});

test('device v5: changed identity at a registered endpoint is visible but cannot duplicate or replace inventory', async () => {
  const h = await setup(); await h.import(await h.scan([candidate()]));
  const originalId = h.workspace.merchant.devices[0].id;
  h.now += 1;
  const changed = await h.scan([candidate({ deviceKey: 'replacement-identity' })]);
  assert.equal(changed.candidates[0].registrationConflict, 'IDENTITY_CHANGED');
  assert.equal(changed.candidates[0].existingDeviceId, originalId);
  await assert.rejects(h.import(changed), { code: 'DEVICE_IDENTITY_CONFLICT' });
  assert.equal(h.workspace.merchant.devices.length, 1);
  assert.equal(h.workspace.merchant.devices[0].id, originalId);
  assert.equal(merchantDevices(h.workspace, h.now).counts.online, 0);
});

test('device v5: moving an existing identity onto another registered address cannot silently steal it', async () => {
  const h = await setup(); await h.import(await h.scan([candidate(), candidate({ deviceKey: 'device-two', endpoint: 'http://192.168.8.21:7125' })]));
  h.now += 1;
  const collision = await h.scan([candidate({ endpoint: 'http://192.168.8.21:7125' })]);
  await assert.rejects(h.import(collision), { code: 'DEVICE_IDENTITY_CONFLICT' });
  const devices = merchantDevices(h.workspace, h.now).devices;
  assert.equal(devices[0].endpoint, 'http://192.168.8.20:7125');
  assert.equal(devices[0].connectionReason, 'IDENTITY_CONFLICT');
});

test('device v5: failed scan cannot refresh registered device into online even if it includes candidates', async () => {
  const h = await setup(); await h.import(await h.scan([candidate()]));
  h.now += 1;
  await h.scan([candidate()], { error: { code: 'PARTIAL_FAILURE', message: '测试扫描失败' } });
  const d = merchantDevices(h.workspace, h.now).devices[0];
  assert.equal(d.connectionState, 'offline'); assert.equal(d.connectionReason, 'SCAN_FAILED');
  assert.equal(d.lastSeenAt, START);
});

test('device v5: OctoPrint version probe never claims printer connection or readiness', async () => {
  const methods = [];
  const result = await probeTarget({ protocol: 'octoprint', endpoint: 'http://192.168.8.22' }, { transport: async (url, options) => { methods.push(options.method + ' ' + url.pathname); return { status: 200, data: { api: '0.1', server: 'fixture', text: 'OctoPrint fixture' } }; } });
  assert.deepEqual(methods, ['GET /api/version']);
  assert.equal(result.probeEvidence.controllerConnected, null);
  assert.equal(result.probeEvidence.controllerState, '');
  const h = await setup(); await h.import(await h.scan([result]));
  assert.equal(merchantDevices(h.workspace, h.now).devices[0].verification.hardwareVerified, false);
});

test('device v5: Moonraker shutdown is retained as observation and never authorizes print control', async () => {
  const result = await probeTarget({ protocol: 'moonraker', endpoint: 'http://192.168.8.23:7125' }, { transport: async () => ({ status: 200, data: { result: { klippy_connected: true, klippy_state: 'shutdown', components: [], moonraker_version: 'fixture' } } }) });
  assert.equal(result.probeEvidence.controllerState, 'shutdown');
  const h = await setup(); await h.import(await h.scan([result]));
  const d = merchantDevices(h.workspace, h.now).devices[0];
  assert.equal(d.automaticPrinting, false); assert.equal(d.capabilityDetails.startPrint, false);
});
