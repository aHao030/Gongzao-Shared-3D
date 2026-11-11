import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkspace } from '../services/platform/core.mjs';
import { encodeWorkspace, decodeWorkspace } from '../services/platform/workspace-storage.mjs';
import {
  applyMerchantCommand, createGatewayCredential, parseGatewayCredential, merchantDevices,
  merchantScanResult, DEVICE_OBSERVATION_FRESH_MS, BAMBU_MONITOR_INTERVAL_MS
} from '../services/platform/merchant.mjs';

const start = 1_800_000_000_000;
function printer(number, authenticated = false) {
  return {
    protocol: 'bambu', deviceKey: number.toString(16).padStart(64, '0'), name: 'Fixture ' + number,
    model: 'Bambu Lab P1S', endpoint: 'mqtts://192.168.5.' + number + ':8883',
    connectionState: authenticated ? 'online' : 'authorization_required',
    probeEvidence: authenticated ? { method: 'MQTT_TLS', advertised: true, printState: 'RUNNING', progressPercent: 27 } : { method: 'SSDP', advertised: true }
  };
}
const oldPrinter = { protocol: 'moonraker', deviceKey: 'fixture-moon', name: 'Fixture Klipper', model: 'Klipper', endpoint: 'http://192.168.5.90:7125', connectionState: 'online' };
async function setup() {
  const h = { owner: randomUUID(), now: start, ws: createWorkspace({ now: start }) };
  h.run = async (type, payload, options = {}) => {
    const { key = randomUUID(), ...context } = options;
    const r = await applyMerchantCommand(h.ws, { type, payload, idempotencyKey: key }, { ownerId: h.owner, now: h.now, ...context });
    h.ws = r.workspace;
    return r.result;
  };
  await h.run('enroll', { name: 'Fixture farm' });
  h.pair = async () => {
    const p = await createGatewayCredential(h.owner, h.now);
    await h.run('pairing', { name: 'Fixture gateway' }, { pairing: p });
    const credential = await parseGatewayCredential('Bearer ' + p.token);
    await h.run('gateway-poll', {}, { credential });
    return credential;
  };
  h.gateway = await h.pair();
  h.startScan = (auto, credential = h.gateway) => h.run('scan', { scope: 'real', gatewayId: credential.gatewayId, ...(auto ? { autoRegister: 'bambu' } : {}) });
  h.report = (scanId, candidates, extra = {}, credential = h.gateway, key) => h.run('gateway-report', { scanId, candidates, ...extra }, { credential, key });
  h.scan = async (candidates, auto = true, credential = h.gateway) => {
    const { scan } = await h.startScan(auto, credential);
    return (await h.report(scan.id, candidates, {}, credential)).scan;
  };
  h.poll = () => h.run('gateway-poll', {}, { credential: h.gateway });
  h.devices = () => merchantDevices(h.ws, h.now).devices;
  return h;
}

test('one gateway scan can register advertisements and verified reports without printing or importing other protocols', async () => {
  const h = await setup(), first = await h.startScan(false);
  const intent = await h.startScan(true);
  assert.equal(first.scan.id, intent.scan.id);
  assert.equal((await h.poll()).commands[0].autoRegister, 'bambu');
  const unseen = { ...printer(3), probeEvidence: null };
  const reported = printer(2, true);
  reported.serial = 'fixture-serial-not-for-server';
  reported.probeEvidence.accessCode = 'fixture-private-access-code';
  const response = await h.report(intent.scan.id, [printer(1), reported, unseen, oldPrinter]);
  assert.deepEqual(response.scan.registrationResult, { added: 2, existing: 0, blocked: 1 });
  assert.equal(h.devices().length, 2);
  const [advertised, active] = h.devices();
  assert.equal(advertised.verification.level, 'BAMBU_ADVERTISED');
  assert.equal(advertised.connectionState, 'authorization_required');
  assert.equal(advertised.capabilityDetails.protocolRead, false);
  assert.deepEqual(advertised.capabilities, []);
  assert.equal(active.verification.level, 'BAMBU_READONLY_REPORTED');
  assert.equal(active.probeEvidence.progressPercent, 27);
  assert.equal(active.capabilityDetails.protocolRead, true);
  for (const d of h.devices()) {
    assert.equal(d.automaticPrinting, false);
    assert.equal(d.capabilityDetails.startPrint, false);
    assert.equal(d.verification.hardwareVerified, false);
  }
  assert.ok(!JSON.stringify(h.ws).includes('fixture-private-access-code'));
  assert.ok(!JSON.stringify(h.ws).includes('fixture-serial-not-for-server'));
  await h.scan([{ ...printer(2), endpoint: 'mqtts://192.168.5.62:8883' }]);
  await h.scan([{ ...printer(2), endpoint: 'mqtts://192.168.5.62:8883' }]);
  assert.equal(h.devices()[1].endpoint, active.endpoint, 'repeated broadcasts cannot move a previously authenticated endpoint');
  assert.equal(h.devices()[1].connectionReason, 'IDENTITY_CONFLICT');
  const updated = await h.scan([printer(1, true), { ...printer(2, true), endpoint: 'mqtts://192.168.5.62:8883' }]);
  assert.deepEqual(updated.registrationResult, { added: 0, existing: 2, blocked: 0 });
  assert.equal(h.devices()[1].id, active.id);
  assert.equal(h.devices()[1].endpoint, 'mqtts://192.168.5.62:8883');
  assert.equal(h.devices()[0].capabilityDetails.protocolRead, true);
  const priorSeen = h.devices()[0].lastSeenAt;
  h.now += 1_000;
  const deferred = printer(1);
  deferred.probeEvidence.deferred = true;
  const partial = await h.scan([deferred]);
  assert.equal(partial.candidates[0].probeEvidence.deferred, true);
  assert.equal(h.devices()[0].probeEvidence.method, 'MQTT_TLS');
  assert.equal(h.devices()[0].lastSeenAt, priorSeen);
});

test('an ad cannot claim authorized telemetry and a configured but unseen address alone cannot be imported', async () => {
  const h = await setup(), { scan } = await h.startScan(false);
  for (const bad of [
    { ...printer(2), connectionState: 'online' }, { ...printer(2, true), connectionState: 'offline' },
    { ...printer(2), probeEvidence: { method: 'SSDP', advertised: true, printState: 'RUNNING' } },
    { ...printer(2, true), probeEvidence: { method: 'MQTT_TLS', advertised: false, printState: 'UNKNOWN', progressPercent: 101 } },
    { ...printer(2), deviceKey: 'raw-serial' }, { ...printer(2), endpoint: 'http://192.168.5.2' },
    { ...printer(2), endpoint: 'mqtts://192.168.5.2:8883/device' }, { ...printer(2), endpoint: 'mqtts://198.51.100.5:8883' }
  ]) await assert.rejects(h.report(scan.id, [bad]), error => error.status === 400);
  const done = (await h.report(scan.id, [printer(2), { ...printer(4), probeEvidence: null, connectionState: 'offline' }])).scan;
  assert.deepEqual(done.candidates.map(c => c.canRegister), [true, false]);
  await assert.rejects(h.run('import', { scanId: scan.id, candidateIds: done.candidates.map(c => c.id) }), { code: 'DEVICE_NOT_AUTHORIZED' });
  assert.equal(h.devices().length, 0);
  await h.run('import', { scanId: scan.id, candidateIds: [done.candidates[0].id] });
  assert.equal(h.devices()[0].verification.level, 'BAMBU_ADVERTISED');
});

test('another gateway cannot take over a registered Bambu identity or report a foreign store scan', async () => {
  const h = await setup(), b = await setup(), other = await h.pair();
  const scan = await h.startScan(true);
  await assert.rejects(b.report(scan.scan.id, [printer(1, true)]), { code: 'SCAN_NOT_FOUND' });
  await h.report(scan.scan.id, [printer(1, true)]);
  const peer = await h.scan([printer(1, true), printer(7)], true, other);
  assert.deepEqual(peer.registrationResult, { added: 1, existing: 0, blocked: 1 });
  assert.equal(peer.candidates[0].registrationConflict, 'OTHER_GATEWAY');
  assert.equal(h.devices().find(d => d.deviceKey === printer(1).deviceKey).gatewayId, h.gateway.gatewayId);
  const sameAddress = await h.scan([{ ...printer(8), endpoint: printer(1).endpoint }]);
  assert.equal(sameAddress.registrationResult.blocked, 1);
  assert.equal(sameAddress.candidates[0].registrationConflict, 'IDENTITY_CHANGED');
  assert.equal(b.devices().length, 0);
});

test('replaying an older report or manual registration preserves its receipt without stale job progress', async () => {
  const h = await setup(), { scan } = await h.startScan(false);
  const reportKey = randomUUID(), importKey = randomUUID(), original = [printer(1, true)];
  const reported = (await h.report(scan.id, original, {}, h.gateway, reportKey)).scan;
  const request = { scanId: scan.id, candidateIds: [reported.candidates[0].id] };
  await h.run('import', request, { key: importKey });
  h.now += DEVICE_OBSERVATION_FRESH_MS;
  const replayed = await h.run('import', request, { key: importKey });
  assert.equal(replayed.imported.length, 1);
  assert.equal(replayed.devices[0].probeEvidence, null);
  assert.equal(replayed.imported[0].capabilityDetails.protocolRead, false);
  const oldScan = (await h.report(scan.id, original, {}, h.gateway, reportKey)).scan;
  assert.equal(oldScan.candidates[0].probeEvidence, null);
  assert.equal(oldScan.candidates[0].canRegister, false);
});

test('monitor jobs rotate through registered keys, tolerate incomplete coverage and do not fill the merchant ledger', async () => {
  const h = await setup();
  const printers = Array.from({ length: 35 }, (_, i) => printer(i + 1, true));
  const first = await h.scan([...printers, oldPrinter]);
  await h.run('import', { scanId: first.id, candidateIds: [first.candidates.at(-1).id] });
  await h.scan(printers);
  assert.equal(h.devices().at(-1).connectionState, 'online', 'Bambu-only detection must not mark another protocol missing');
  const permanent = Object.keys(h.ws.merchant.ledger).length;
  h.now += BAMBU_MONITOR_INTERVAL_MS;
  const [job] = (await h.poll()).commands;
  assert.equal(job.kind, 'monitor-bambu');
  assert.equal(job.deviceKeys.length, 32);
  await assert.rejects(h.report(job.id, [oldPrinter]), { code: 'INVALID_MONITOR_DEVICE' });
  await assert.rejects(h.report(job.id, [printer(35, true)]), { code: 'INVALID_MONITOR_DEVICE' });
  await h.report(job.id, [printer(1, true)], { partialDiagnostics: ['BAMBU_PACKET_LIMIT'] });
  assert.equal(h.devices()[1].lastSeenAt, start);
  assert.equal(h.devices()[1].connectionState, 'online');
  assert.equal(h.devices()[34].connectionState, 'online');
  assert.equal(h.devices().at(-1).connectionState, 'online');
  h.now += BAMBU_MONITOR_INTERVAL_MS / 2;
  const [remaining] = (await h.poll()).commands;
  assert.deepEqual(remaining.deviceKeys, printers.slice(32).map(p => p.deviceKey));
  const reportKey = randomUUID();
  await h.report(remaining.id, [], {}, h.gateway, reportKey);
  await h.report(remaining.id, [], {}, h.gateway, reportKey);
  assert.equal(h.devices()[34].connectionState, 'offline');
  assert.equal(h.devices()[34].probeEvidence, null);
  assert.equal(Object.keys(h.ws.merchant.ledger).length, permanent);
  h.now = start + DEVICE_OBSERVATION_FRESH_MS;
  const [pending] = (await h.poll()).commands;
  const expired = h.devices()[1];
  assert.equal(expired.connectionReason, 'OBSERVATION_EXPIRED');
  assert.equal(expired.probeEvidence, null);
  assert.equal(expired.capabilityDetails.protocolRead, false);
  const oldView = merchantScanResult(h.ws, first.id, h.now).scan;
  assert.equal(oldView.candidates[0].probeEvidence, null);
  const manual = await h.startScan(false);
  await h.report(manual.scan.id, [printer(2, true)]);
  await assert.rejects(h.report(pending.id, [printer(2)]), { code: 'MONITOR_SUPERSEDED' });
  assert.equal(h.devices()[1].connectionState, 'online');
});

test('repeated 100-machine inventories fit the persisted workspace and retain importable and historical receipts', async () => {
  const h = await setup();
  const farm = Array.from({ length: 100 }, (_, i) => printer(i + 1, true));
  let historical;
  for (let round = 0; round < 25; round++) {
    h.now += 1;
    const { scan } = await h.startScan(true), key = randomUUID();
    const done = (await h.report(scan.id, farm, {}, h.gateway, key)).scan;
    assert.equal(done.registrationResult.added + done.registrationResult.existing, farm.length);
    assert.equal(done.candidates.length, farm.length);
    if (!round) historical = { id: scan.id, key };
    h.ws = await decodeWorkspace(await encodeWorkspace(h.ws));
  }
  assert.equal(h.devices().length, 100);
  const replay = (await h.report(historical.id, farm, {}, h.gateway, historical.key)).scan;
  assert.equal(replay.registrationResult.added, 100);
  assert.equal(replay.importable, false);
  assert.equal(replay.candidateCount, 100);
  assert.equal(replay.candidatesArchived, true);
});
