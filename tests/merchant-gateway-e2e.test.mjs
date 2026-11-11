import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { GatewayClient } from '../services/device-gateway/client.mjs';
import { validateConfig } from '../services/device-gateway/config.mjs';

// Local HTTP + SQLite + actual gateway client. Printer observations are fixtures;
// no multicast or LAN scan, physical printer, payment, or hosted edge is exercised.
const endpoint = '/api/v2/merchant/';
const fixture = (overrides = {}) => ({ deviceKey: 'fixture-printer-one', name: 'Fixture printer', protocol: 'moonraker', model: 'Fixture Klipper', endpoint: 'http://192.168.20.40:7125', connectionState: 'online', ...overrides });
async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gongzao-merchant-e2e-'));
  let instance, base, now = Date.now();
  const clock = () => now;
  async function start() {
    instance = createPlatformServer({ dbPath: path.join(dir, 'test.sqlite'), clock });
    await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(0, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + instance.server.address().port;
  }
  async function stop() { if (instance) { await new Promise(resolve => instance.server.close(resolve)); instance.store.close(); instance = null; } }
  await start(); t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  async function request(route, { cookie, token, body, key = randomUUID(), headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + route, { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  }
  async function session() {
    const result = await request('/api/v2/session'); assert.equal(result.status, 200);
    return { cookie: result.headers.get('set-cookie').split(';')[0], owner: result.data.user.id };
  }
  const post = (user, route, body, key) => request(endpoint + route, { cookie: user.cookie, body, key });
  const get = (user, route) => request(endpoint + route, { cookie: user.cookie });
  async function enroll(user) { const r = await post(user, 'enroll', { name: 'Fixture workshop' }); assert.equal(r.status, 201); return r.data.profile; }
  async function pair(user, key = randomUUID()) {
    const r = await post(user, 'pairing', { name: 'Fixture gateway' }, key); assert.equal(r.status, 201);
    assert.ok(typeof r.data.token === 'string' && r.data.token.startsWith('gw1.'));
    return { token: r.data.token, id: r.data.gateway.id, key, client: new GatewayClient(validateConfig({ platformUrl: base, token: r.data.token, mdns: false, targets: [] }), { clock }) };
  }
  async function scan(user, gateway) { const r = await post(user, 'scan', { scope: 'real', gatewayId: gateway.id }); assert.equal(r.status, 200); return r.data.scan; }
  return { request, session, enroll, pair, scan, post, get, clock, advance: ms => { now += ms; }, raw: owner => instance.store.db.prepare('SELECT data FROM platform_workspaces WHERE owner=?').get(owner)?.data, restart: async () => { await stop(); await start(); } };
}

test('merchant HTTP: distinct portal routes serve the app and enrolment gates merchant APIs', async t => {
  const h = await setup(t), user = await h.session();
  for (const route of ['/merchant', '/merchant/', '/merchant/login', '/merchant/login/']) {
    const r = await h.request(route); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(r.text, /id="app"/);
  }
  assert.equal((await h.get(user, 'session')).data.profile, null);
  assert.equal((await h.get(user, 'devices')).status, 403);
  assert.equal((await h.post(user, 'enroll', { name: '' })).status, 400);
  const profile = await h.enroll(user);
  assert.equal(profile.verification, 'sandbox_unverified');
  assert.equal((await h.get(user, 'devices')).data.counts.total, 0);
  assert.equal((await h.post(user, 'scan', { scope: 'real' })).status, 409);
  assert.equal((await h.get(user, 'scan-result')).data.scan, null);
});

test('merchant HTTP: actual gateway client polls, reports fixtures and imports only authorized read-only devices', async t => {
  const h = await setup(t), user = await h.session(); await h.enroll(user); const gateway = await h.pair(user);
  await gateway.client.cycle(async () => { throw new Error('no scan exists yet'); });
  const scan = await h.scan(user, gateway); let discoveries = 0;
  const observation = { candidates: [fixture(), fixture({ deviceKey: 'authorization-required', endpoint: 'http://192.168.20.41:5000', protocol: 'octoprint', connectionState: 'authorization_required' })], diagnostics: [] };
  const cycle = await gateway.client.cycle(async () => { discoveries++; return observation; });
  assert.equal(discoveries, 1); assert.equal(cycle.events[0].count, 2);
  const result = await h.get(user, 'scan-result?scanId=' + scan.id); assert.equal(result.data.scan.status, 'complete');
  const ready = result.data.scan.candidates.find(c => c.connectionState === 'online');
  const blocked = result.data.scan.candidates.find(c => c.connectionState === 'authorization_required');
  assert.equal((await h.post(user, 'devices/import', { scanId: scan.id, candidateIds: [ready.id, blocked.id] })).status, 409);
  assert.equal((await h.get(user, 'devices')).data.counts.total, 0, 'mixed invalid import is atomic');
  const requestKey = randomUUID(), body = { scanId: scan.id, candidateIds: [ready.id] };
  assert.equal((await h.post(user, 'devices/import', body, requestKey)).status, 200);
  assert.equal((await h.post(user, 'devices/import', body, requestKey)).data.replayed, true);
  const duplicate = await h.post(user, 'devices/import', body); assert.equal(duplicate.data.imported.length, 0); assert.equal(duplicate.data.skipped.length, 1);
  const list = await h.get(user, 'devices'); assert.deepEqual(list.data.counts, { total: 1, real: 1, online: 1, offline: 0, demo: 0 });
  assert.deepEqual(list.data.devices[0].capabilities, ['monitor']); assert.equal(list.data.devices[0].automaticPrinting, false);
  await gateway.client.cycle(async () => { discoveries++; return observation; }); assert.equal(discoveries, 1, 'completed command is not rediscovered');
});

test('merchant HTTP: gateway credential is one-time, scoped, absent from stored/plain public results and revoked before replay', async t => {
  const h = await setup(t), user = await h.session(); await h.enroll(user); const gateway = await h.pair(user);
  const replay = await h.post(user, 'pairing', { name: 'Fixture gateway' }, gateway.key);
  assert.equal(replay.status, 200); assert.equal(replay.data.token, null); assert.equal(replay.data.gateway.id, gateway.id);
  const stored = h.raw(user.owner); assert.ok(!stored.includes(gateway.token)); assert.ok(stored.includes('tokenHash'));
  for (const route of ['devices', 'gateways', 'session', 'scan-result']) {
    const r = await h.get(user, route); assert.ok(!r.text.includes(gateway.token)); assert.ok(!r.text.includes('tokenHash')); assert.ok(!r.text.includes('pollLedger'));
  }
  const publicWorkspace = await h.request('/api/v2/workspace', { cookie: user.cookie }); assert.ok(!publicWorkspace.text.includes('tokenHash')); assert.ok(!publicWorkspace.text.includes('merchant_'));
  assert.equal((await h.request(endpoint + 'devices', { token: gateway.token })).status, 401, 'gateway cannot become merchant browser user');
  const pollKey = randomUUID(); assert.equal((await h.request('/api/v2/gateway/poll', { token: gateway.token, body: {}, key: pollKey })).status, 200);
  assert.equal((await h.post(user, 'gateways/revoke', { gatewayId: gateway.id })).status, 200);
  assert.equal((await h.request('/api/v2/gateway/poll', { token: gateway.token, body: {}, key: pollKey })).status, 401);
});

test('merchant HTTP: foreign merchant and foreign gateway cannot read, import, report or revoke another owner resources', async t => {
  const h = await setup(t), a = await h.session(), b = await h.session(); await h.enroll(a); await h.enroll(b);
  const ga = await h.pair(a), gb = await h.pair(b); await ga.client.cycle(async () => ({ candidates: [], diagnostics: [] }));
  const scan = await h.scan(a, ga);
  assert.equal((await h.get(b, 'scan-result?scanId=' + scan.id)).status, 404);
  assert.equal((await h.post(b, 'devices/import', { scanId: scan.id, candidateIds: ['anything'] })).status, 404);
  assert.equal((await h.post(b, 'gateways/revoke', { gatewayId: ga.id })).status, 404);
  assert.equal((await h.request('/api/v2/gateway/report', { token: gb.token, body: { scanId: scan.id, candidates: [fixture()] } })).status, 404);
  const pieces = ga.token.split('.'); pieces[1] = Buffer.from(b.owner).toString('base64url');
  assert.equal((await h.request('/api/v2/gateway/poll', { token: pieces.join('.'), body: {} })).status, 401);
  assert.equal((await h.get(b, 'devices')).data.counts.total, 0);
});

test('merchant HTTP: fresh real detection, concurrent registration and explicit demo registry remain separate', async t => {
  const h = await setup(t), user = await h.session(); await h.enroll(user); const gateway = await h.pair(user);
  await gateway.client.cycle(async () => ({ candidates: [], diagnostics: [] })); const scan = await h.scan(user, gateway);
  await gateway.client.cycle(async () => ({ candidates: [fixture({ source: 'demo', automaticPrinting: true, capabilities: ['print'] })], diagnostics: [] }));
  const candidate = (await h.get(user, 'scan-result?scanId=' + scan.id)).data.scan.candidates[0];
  assert.equal(candidate.source, 'real'); assert.equal(candidate.automaticPrinting, false); assert.deepEqual(candidate.capabilities, ['monitor']);
  const results = await Promise.all(Array.from({ length: 8 }, () => h.post(user, 'devices/import', { scanId: scan.id, candidateIds: [candidate.id] })));
  assert.ok(results.every(r => r.status === 200)); assert.equal((await h.get(user, 'devices')).data.counts.total, 1);
  const demo = await h.post(user, 'scan', { scope: 'demo' }); assert.equal(demo.data.scan.scope, 'demo');
  const demoIds = demo.data.scan.candidates.filter(c => c.connectionState === 'online').map(c => c.id);
  await h.post(user, 'devices/import', { scanId: demo.data.scan.id, candidateIds: demoIds });
  const list = await h.get(user, 'devices'); assert.equal(list.data.counts.real, 1); assert.equal(list.data.counts.demo, 2); assert.equal(list.data.counts.online, 1);
});

test('merchant HTTP: stale gateways and expired scans block import; refresh marks unseen registered devices offline', async t => {
  const h = await setup(t), user = await h.session(); await h.enroll(user); const gateway = await h.pair(user);
  await gateway.client.cycle(async () => ({ candidates: [], diagnostics: [] })); const scan = await h.scan(user, gateway);
  await gateway.client.cycle(async () => ({ candidates: [fixture()], diagnostics: [] }));
  const candidate = (await h.get(user, 'scan-result?scanId=' + scan.id)).data.scan.candidates[0];
  await h.post(user, 'devices/import', { scanId: scan.id, candidateIds: [candidate.id] });
  h.advance(90_001); assert.equal((await h.get(user, 'devices')).data.counts.offline, 1);
  const stale = (await h.get(user, 'scan-result?scanId=' + scan.id)).data.scan;
  assert.equal(stale.importable, false); assert.equal(stale.importBlockedReason, 'GATEWAY_OFFLINE');
  assert.equal((await h.post(user, 'scan', { scope: 'real', gatewayId: gateway.id })).status, 409);
  await gateway.client.cycle(async () => ({ candidates: [], diagnostics: [] }));
  const refresh = await h.scan(user, gateway); await gateway.client.cycle(async () => ({ candidates: [], diagnostics: [] }));
  assert.equal((await h.get(user, 'scan-result?scanId=' + refresh.id)).data.scan.status, 'complete');
  assert.equal((await h.get(user, 'devices')).data.devices[0].connectionState, 'offline');
  const pending = await h.scan(user, gateway); h.advance(120_001);
  assert.equal((await h.get(user, 'scan-result?scanId=' + pending.id)).data.scan.status, 'expired');
  const expired = (await h.get(user, 'scan-result?scanId=' + scan.id)).data.scan;
  assert.equal(expired.importable, false); assert.equal(expired.importBlockedReason, 'SCAN_EXPIRED');
  assert.equal((await h.request('/api/v2/gateway/report', { token: gateway.token, body: { scanId: pending.id, candidates: [fixture()] } })).status, 409);
  assert.equal((await h.post(user, 'devices/import', { scanId: scan.id, candidateIds: [candidate.id] })).status, 409);
});

test('merchant HTTP: existing v2 workspace, new registry and gateway survive restart and demo reset', async t => {
  const h = await setup(t), user = await h.session();
  const q = await h.request('/api/v2/quotes', { cookie: user.cookie, body: { modelId: 'sample-bracket', material: 'PLA', qty: 1, quality: 'standard', unit: 'mm', destination: 'east' } }); assert.equal(q.status, 200);
  const profile = await h.enroll(user); const gateway = await h.pair(user);
  const demo = await h.post(user, 'scan', { scope: 'demo' });
  await h.post(user, 'devices/import', { scanId: demo.data.scan.id, candidateIds: [demo.data.scan.candidates[0].id] });
  const reset = await h.request('/api/v2/actions', { cookie: user.cookie, body: { action: 'reset', confirm: 'RESET_DEMO', demoAcknowledged: true } }); assert.equal(reset.status, 200);
  await h.restart();
  assert.equal((await h.get(user, 'session')).data.profile.id, profile.id); assert.equal((await h.get(user, 'devices')).data.counts.demo, 1);
  assert.equal((await h.request('/api/v2/gateway/poll', { token: gateway.token, body: {} })).status, 200);
});

test('merchant HTTP: malformed gateway claims and unsafe report endpoints fail without closing pending scan', async t => {
  const h = await setup(t), user = await h.session(); await h.enroll(user); const gateway = await h.pair(user);
  await gateway.client.cycle(async () => ({ candidates: [], diagnostics: [] })); const scan = await h.scan(user, gateway);
  for (const token of ['invalid', 'gw1.invalid.gw_invalid.invalid', 'gw1...']) assert.equal((await h.request('/api/v2/gateway/poll', { token, body: {} })).status, 401);
  for (const badEndpoint of ['http://169.254.169.254', 'https://example.com', 'http://192.168.20.40/?key=private', 'http://user:secret@192.168.20.40']) {
    const r = await h.request('/api/v2/gateway/report', { token: gateway.token, body: { scanId: scan.id, candidates: [fixture({ endpoint: badEndpoint })] } }); assert.equal(r.status, 400);
  }
  assert.equal((await h.get(user, 'scan-result?scanId=' + scan.id)).data.scan.status, 'pending');
  assert.equal((await h.request('/api/v2/gateway/report', { token: gateway.token, body: { scanId: scan.id, candidates: [fixture()] }, headers: { Origin: 'https://foreign.example' } })).status, 403);
  const done = await h.request('/api/v2/gateway/report', { token: gateway.token, body: { scanId: scan.id, candidates: [fixture()] } }); assert.equal(done.status, 200);
});

test('merchant HTTP: prefixed device endpoints are supported and another gateway cannot duplicate or steal registration', async t => {
  const h = await setup(t), user = await h.session(); await h.enroll(user);
  const first = await h.pair(user), second = await h.pair(user);
  await first.client.cycle(async () => ({ candidates: [], diagnostics: [] }));
  await second.client.cycle(async () => ({ candidates: [], diagnostics: [] }));
  const endpointWithPrefix = 'http://192.168.20.40:7125/printer_a';
  const scanA = await h.scan(user, first);
  await first.client.cycle(async () => ({ candidates: [fixture({ endpoint: endpointWithPrefix })], diagnostics: [] }));
  const a = (await h.get(user, 'scan-result?scanId=' + scanA.id)).data.scan.candidates[0];
  assert.equal(a.endpoint, endpointWithPrefix);
  assert.equal((await h.post(user, 'devices/import', { scanId: scanA.id, candidateIds: [a.id] })).status, 200);
  const scanB = await h.scan(user, second);
  await second.client.cycle(async () => ({ candidates: [fixture({ endpoint: endpointWithPrefix, deviceKey: 'different-discovery-key' })], diagnostics: [] }));
  const b = (await h.get(user, 'scan-result?scanId=' + scanB.id)).data.scan.candidates[0];
  assert.equal(b.registered, true); assert.equal(b.existingDeviceId, a.id); assert.equal(b.registrationConflict, 'OTHER_GATEWAY');
  const duplicate = await h.post(user, 'devices/import', { scanId: scanB.id, candidateIds: [b.id] });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.error.code, 'DEVICE_ALREADY_REGISTERED_OTHER_GATEWAY');
  await h.post(user, 'gateways/revoke', { gatewayId: first.id });
  assert.equal((await h.post(user, 'devices/import', { scanId: scanB.id, candidateIds: [b.id] })).status, 409, 'revocation does not silently rebind a physical device');
  const list = await h.get(user, 'devices'); assert.equal(list.data.counts.total, 1); assert.equal(list.data.devices[0].gatewayId, first.id);
});
