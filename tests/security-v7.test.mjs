import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash, randomBytes } from 'node:crypto';
import { createOIDCAdapter } from '../services/platform/auth-oidc.mjs';
import { createPlatformServer } from '../services/platform/local.mjs';
import { handleHostedAuth } from '../services/platform/auth-config.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

// Independent authentication review with generated signing keys and an in-memory
// fake identity provider. This is not a live OAuth/provider or Sites edge audit.
const now = 1800000000000;
const issuer = 'https://qa-identity.invalid';
const publicOrigin = 'http://127.0.0.1:31701';
const redirectUri = publicOrigin + '/api/auth/oidc/callback';
const fixtureSecret = 'QA-ONLY-NOT-A-REAL-CLIENT-SECRET';
const config = { issuer, publicOrigin, clientId: 'qa-client', clientSecret: fixtureSecret, adapter: 'casdoor', providers: { google: 'QA-Google-Provider' } };
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const alternatePair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'qa-signing-key', use: 'sig', alg: 'RS256' };
const nonce = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(32).toString('base64url');
const claims = () => ({ iss: issuer, sub: 'fixture-subject', aud: config.clientId, iat: now / 1000, exp: now / 1000 + 300, nonce, email: 'same-address@example.invalid', email_verified: true, name: 'OIDC fixture' });
const metadata = () => ({ issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'] });
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function jwt(payload = claims(), header = { alg: 'RS256', kid: jwk.kid }, key = pair.privateKey) {
  const message = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return message + '.' + sign('sha256', Buffer.from(message), key).toString('base64url');
}
function adapterFixture({ token = () => jwt(), discovery = metadata(), keys = [jwk], rawConfig = config } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(options.redirect, 'error', 'server must refuse redirects before following credentials');
    if (String(url) === issuer + '/.well-known/openid-configuration') return json(discovery);
    if (String(url) === issuer + '/token') return json({ id_token: token(), access_token: 'QA-ONLY-ACCESS-TOKEN', refresh_token: 'QA-ONLY-REFRESH-TOKEN' });
    if (String(url) === issuer + '/jwks') return json({ keys });
    throw new Error('Unexpected fixture request');
  };
  return { adapter: createOIDCAdapter(rawConfig, { fetchImpl, clock: () => now }), calls };
}
const callback = adapter => adapter.verifyCallback({ code: 'QA-ONLY-CODE', verifier, nonce, redirectUri });

test('security v0.7: OIDC authorization binds PKCE S256, nonce, state and configured provider without exposing secret', async () => {
  const { adapter, calls } = adapterFixture();
  const href = await adapter.authorizationURL({ provider: 'google', state, nonce, verifier, redirectUri });
  const url = new URL(href);
  assert.equal(url.origin, issuer); assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('nonce'), nonce); assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('provider_hint'), 'QA-Google-Provider');
  assert.ok(!href.includes(verifier) && !href.includes(fixtureSecret));
  assert.equal(calls.length, 1);
  const identity = await callback(adapter);
  assert.deepEqual(identity, { issuer, sub: 'fixture-subject', email: 'same-address@example.invalid', emailVerified: true, displayName: 'OIDC fixture' });
  assert.doesNotMatch(JSON.stringify(identity), /ACCESS-TOKEN|REFRESH-TOKEN|CLIENT-SECRET|id_token/);
  const tokenCall = calls.find(call => call.url.endsWith('/token'));
  const sent = new URLSearchParams(tokenCall.options.body);
  assert.equal(sent.get('code_verifier'), verifier); assert.equal(sent.get('redirect_uri'), redirectUri);
});

test('security v0.7: OIDC rejects signed tokens with invalid issuer, audience, authorized party, times or nonce', async t => {
  const cases = {
    issuer: { iss: 'https://other-identity.invalid' }, audience: { aud: 'attacker-client' },
    authorizedParty: { azp: 'attacker-client' }, multipleAudiences: { aud: [config.clientId, 'another-client'] },
    expired: { exp: now / 1000 - 31 }, futureIssuedAt: { iat: now / 1000 + 31 },
    futureNotBefore: { nbf: now / 1000 + 31 }, wrongNonce: { nonce: randomBytes(32).toString('base64url') },
    missingSubject: { sub: '' }, invalidExpiry: { exp: String(now / 1000 + 300) }
  };
  for (const [name, changes] of Object.entries(cases)) await t.test(name, async () => {
    const { adapter } = adapterFixture({ token: () => jwt({ ...claims(), ...changes }) });
    await assert.rejects(callback(adapter), error => error.code === 'OIDC_FAILED');
  });
});

test('security v0.7: OIDC refuses attacker keys, unsigned or algorithm-confused tokens and JOSE key URLs', async t => {
  const cases = {
    wrongSigningKey: () => jwt(claims(), { alg: 'RS256', kid: jwk.kid }, alternatePair.privateKey),
    noAlgorithm: () => jwt(claims(), { alg: 'none', kid: jwk.kid }),
    hmacAlgorithm: () => jwt(claims(), { alg: 'HS256', kid: jwk.kid }),
    attackerJku: () => jwt(claims(), { alg: 'RS256', kid: jwk.kid, jku: 'https://attacker.invalid/jwks' }),
    embeddedJwk: () => jwt(claims(), { alg: 'RS256', kid: jwk.kid, jwk: alternatePair.publicKey.export({ format: 'jwk' }) }),
    criticalExtension: () => jwt(claims(), { alg: 'RS256', kid: jwk.kid, crit: ['b64'], b64: false }),
    wrongKeyIdentifier: () => jwt(claims(), { alg: 'RS256', kid: 'not-a-trusted-key' })
  };
  for (const [name, token] of Object.entries(cases)) await t.test(name, async () => {
    const { adapter, calls } = adapterFixture({ token });
    await assert.rejects(callback(adapter), error => error.code === 'OIDC_FAILED');
    assert.ok(calls.every(call => new URL(call.url).origin === issuer));
  });
  await assert.rejects(callback(adapterFixture({ keys: [jwk, jwk] }).adapter), /验证失败/);
});

test('security v0.7: malicious discovery cannot send authorization codes or secrets to another origin', async () => {
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    const { adapter, calls } = adapterFixture({ discovery: { ...metadata(), [field]: 'https://attacker.invalid/receive' } });
    await assert.rejects(callback(adapter), error => error.code === 'OIDC_FAILED');
    assert.equal(calls.length, 1); assert.equal(calls[0].options.method, undefined);
    assert.ok(!JSON.stringify(calls).includes(fixtureSecret));
  }
  const { adapter } = adapterFixture();
  for (const bad of ['https://attacker.invalid', '//attacker.invalid', publicOrigin + '/different-callback']) {
    await assert.rejects(adapter.authorizationURL({ provider: 'google', state, nonce, verifier, redirectUri: bad }));
  }
  await assert.rejects(adapter.authorizationURL({ provider: 'unconfigured-provider', state, nonce, verifier, redirectUri }));
});

const password = 'QA-ONLY-unique-password-2026';
const activeCookie = response => response.headers.getSetCookie().find(value => value.startsWith('coforge_account=') && !value.includes('Max-Age=0'))?.split(';')[0];
async function localHarness(t, { oidc = false, tokenFactory, clock = () => now } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gongzao-security-v7-'));
  let instance, base, chosenPort = 0;
  const providerCalls = [], issued = new Map();
  if (oidc) {
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    chosenPort = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
  }
  async function start() {
    const authFetch = async (url, options = {}) => {
      providerCalls.push({ url: String(url), options });
      if (String(url).endsWith('/.well-known/openid-configuration')) return json(metadata());
      if (String(url).endsWith('/jwks')) return json({ keys: [jwk] });
      if (String(url).endsWith('/token')) {
        const values = new URLSearchParams(options.body), flow = issued.get(values.get('code'));
        assert.ok(flow, 'fixture authorization code must have a matching start request');
        assert.equal(createHash('sha256').update(values.get('code_verifier')).digest('base64url'), flow.challenge);
        return json({ id_token: tokenFactory ? tokenFactory(flow) : jwt({ ...claims(), nonce: flow.nonce, sub: flow.sub ?? 'fixture-subject' }) });
      }
      throw new Error('Unexpected external call');
    };
    instance = createPlatformServer({ dbPath: path.join(directory, 'auth.sqlite'), clock,
      authConfig: oidc ? { oidc: { ...config, publicOrigin: 'http://127.0.0.1:' + chosenPort } } : {}, authFetch });
    await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(chosenPort, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + instance.server.address().port;
  }
  async function stop() {
    if (!instance) return;
    await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    instance.store.close(); instance = null;
  }
  await start(); t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(route, { cookie, body, headers = {}, raw, method = body === undefined && raw === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + route, { method, redirect: 'manual',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomBytes(12).toString('hex') } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, data: text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  }
  async function register(email = 'qa@example.invalid', extra = {}, cookie) {
    return request('/api/auth/register', { cookie, body: { email, password, ...extra } });
  }
  async function startFlow({ returnTo = '/merchant', sub, code = randomBytes(12).toString('hex') } = {}) {
    const result = await request('/api/auth/oidc/start?provider=google&returnTo=' + encodeURIComponent(returnTo));
    assert.equal(result.status, 302, result.text);
    const target = new URL(result.headers.get('location'));
    const flow = { state: target.searchParams.get('state'), nonce: target.searchParams.get('nonce'), challenge: target.searchParams.get('code_challenge'), sub };
    issued.set(code, flow);
    return { ...flow, code, cookie: result.headers.getSetCookie()[0].split(';')[0], callback: '/api/auth/oidc/callback?state=' + flow.state + '&code=' + code };
  }
  return { request, register, startFlow, providerCalls, sql: (sql, ...args) => instance.store.db.prepare(sql).all(...args), restart: async () => { await stop(); await start(); } };
}

test('security v0.7: local passwords use distinct salted hashes and random hashed sessions; logout and restart retain isolation', async t => {
  const h = await localHarness(t), first = await h.register(), second = await h.register('second@example.invalid');
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  const a = activeCookie(first), b = activeCookie(second);
  assert.match(a, /^coforge_account=[a-f0-9]{64}$/); assert.notEqual(a, b);
  for (const cookie of first.headers.getSetCookie()) assert.match(cookie, /HttpOnly; SameSite=Lax/);
  const users = h.sql('SELECT * FROM auth_users ORDER BY email');
  assert.equal(users.length, 2); assert.notEqual(users[0].password_hash, users[1].password_hash); assert.notEqual(users[0].password_salt, users[1].password_salt);
  assert.match(users[0].password_hash, /^[a-f0-9]{128}$/); assert.match(users[0].password_salt, /^[a-f0-9]{64}$/);
  const sessions = h.sql('SELECT * FROM auth_sessions');
  assert.equal(sessions.length, 2); assert.ok(!JSON.stringify(sessions).includes(a.split('=')[1]));
  for (const route of ['/api/auth/config', '/api/auth/session', '/api/v2/workspace']) {
    const r = await h.request(route, { cookie: a }); assert.equal(r.status, 200);
    assert.doesNotMatch(r.text, /password_hash|password_salt|token_hash|QA-ONLY/);
  }
  await h.restart();
  assert.equal((await h.request('/api/auth/session', { cookie: a })).data.user.id, first.data.user.id);
  assert.equal((await h.request('/api/auth/session', { cookie: b })).data.user.id, second.data.user.id);
  assert.equal((await h.request('/api/auth/logout', { cookie: a, body: {} })).status, 200);
  assert.equal((await h.request('/api/auth/session', { cookie: a })).data.authenticated, false);
  assert.equal((await h.request('/api/auth/session', { cookie: b })).data.authenticated, true);
  const login = await h.request('/api/auth/login', { body: { email: 'QA@EXAMPLE.INVALID', password } });
  assert.equal(login.status, 200); assert.notEqual(activeCookie(login), a); assert.equal(login.data.user.id, first.data.user.id);
});

test('security v0.7: local spoofed platform identity, anonymous merchant access and malformed cookies fail closed', async t => {
  const h = await localHarness(t);
  const legacy = await h.request('/api/v2/session'); const legacyCookie = legacy.headers.getSetCookie()[0].split(';')[0];
  const forgedHeaders = { 'oai-authenticated-user-id': 'forged-admin', 'oai-authenticated-user-email': 'admin@example.invalid' };
  for (const route of ['/api/v2/merchant/session', '/api/v2/merchant/devices', '/api/v2/merchant/pricing']) {
    const r = await h.request(route, { cookie: legacyCookie, headers: forgedHeaders });
    assert.equal(r.status, 401); assert.equal(r.data.error.code, 'ACCOUNT_LOGIN_REQUIRED');
  }
  const enrol = await h.request('/api/v2/merchant/enroll', { cookie: legacyCookie, headers: forgedHeaders, body: { name: 'forged merchant' } });
  assert.equal(enrol.status, 401);
  assert.equal((await h.request('/api/auth/session', { cookie: legacyCookie, headers: forgedHeaders })).data.authenticated, false);
  const registered = await h.register(), account = activeCookie(registered);
  for (const cookie of [account + '; ' + account, 'coforge_account=malformed', 'coforge_account=' + '0'.repeat(64)]) {
    assert.equal((await h.request('/api/auth/session', { cookie, headers: forgedHeaders })).data.authenticated, false);
  }
});

test('security v0.7: account endpoints reject cross-site requests, unsafe content types, large bodies and repeated guesses', async t => {
  const h = await localHarness(t);
  for (const headers of [{ Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const result = await h.request('/api/auth/register', { headers, body: { email: 'csrf@example.invalid', password } });
    assert.equal(result.status, 403);
  }
  assert.equal(h.sql('SELECT * FROM auth_users').length, 0);
  const form = await h.request('/api/auth/register', { headers: { 'Content-Type': 'text/plain' }, raw: '{"email":"form@example.invalid","password":"DO-NOT-STORE"}' });
  assert.equal(form.status, 415);
  const huge = await h.request('/api/auth/register', { body: { email: 'huge@example.invalid', password, padding: 'x'.repeat(17000) } });
  assert.equal(huge.status, 413); assert.ok(!huge.text.includes(password));
  for (let i = 0; i < 8; i++) {
    const r = await h.request('/api/auth/login', { body: { email: 'absent@example.invalid', password } });
    assert.equal(r.status, 401); assert.equal(r.data.error.code, 'INVALID_CREDENTIALS'); assert.ok(!r.text.includes(password));
  }
  const limited = await h.request('/api/auth/login', { body: { email: 'absent@example.invalid', password } });
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after')); assert.equal(h.sql('SELECT * FROM auth_users').length, 0);
});

test('security v0.7: explicit legacy workspace binding revokes every anonymous token without exposing data to another account', async t => {
  const h = await localHarness(t);
  const old = await h.request('/api/v2/session'), oldCookie = old.headers.getSetCookie()[0].split(';')[0];
  const profile = { displayName: 'Legacy owner marker', setupCompleted: true, shippingAddress: null };
  assert.equal((await h.request('/api/v2/customer/profile', { cookie: oldCookie, body: profile })).status, 200);
  const adopted = await h.register('adopted@example.invalid', { adoptLegacyWorkspace: true }, oldCookie);
  assert.equal(adopted.status, 201); const account = activeCookie(adopted);
  assert.equal(h.sql('SELECT * FROM local_sessions WHERE owner=?', old.data.user.id).length, 0);
  assert.equal((await h.request('/api/v2/customer/profile', { cookie: account })).data.profile.displayName, profile.displayName);
  assert.equal((await h.request('/api/v2/customer/profile', { cookie: oldCookie })).status, 401);
  const rival = await h.register('rival@example.invalid', { adoptLegacyWorkspace: true }, oldCookie);
  assert.equal(rival.status, 409); assert.equal(rival.data.error.code, 'WORKSPACE_UNAVAILABLE');
  const independent = await h.register('independent@example.invalid');
  assert.equal((await h.request('/api/v2/customer/profile', { cookie: activeCookie(independent) })).data.profile, null);
  await h.request('/api/auth/logout', { cookie: account, body: {} });
  assert.equal((await h.request('/api/v2/customer/profile', { cookie: oldCookie })).status, 401);
  await h.restart();
  const login = await h.request('/api/auth/login', { body: { email: 'adopted@example.invalid', password } });
  assert.equal((await h.request('/api/v2/customer/profile', { cookie: activeCookie(login) })).data.profile.displayName, profile.displayName);
});

test('security v0.7: HTTP OAuth flows are browser-bound, one-use and never merge by email or redirect off-site', async t => {
  const h = await localHarness(t, { oidc: true });
  const emailAccount = await h.register('same-address@example.invalid'); assert.equal(emailAccount.status, 201);
  const flow = await h.startFlow({ returnTo: 'https://attacker.invalid/receive' });
  const stolen = await h.request(flow.callback, { cookie: 'coforge_oidc_flow=' + '1'.repeat(64) });
  assert.equal(stolen.status, 302); assert.match(stolen.headers.get('location'), /auth_error=OIDC_FAILED/);
  assert.equal(h.providerCalls.filter(call => call.url.endsWith('/token')).length, 0);
  const success = await h.request(flow.callback, { cookie: flow.cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(success.status, 302); assert.equal(success.headers.get('location'), '/merchant');
  const oidcAccount = activeCookie(success); assert.ok(oidcAccount);
  const identity = (await h.request('/api/auth/session', { cookie: oidcAccount })).data;
  assert.equal(identity.user.email, emailAccount.data.user.email); assert.notEqual(identity.user.id, emailAccount.data.user.id);
  assert.equal(identity.user.provider, 'oidc'); assert.equal(h.sql('SELECT * FROM auth_users').length, 2);
  const replay = await h.request(flow.callback, { cookie: flow.cookie });
  assert.match(replay.headers.get('location'), /auth_error=OIDC_FAILED/); assert.equal(activeCookie(replay), undefined);
  assert.equal(h.providerCalls.filter(call => call.url.endsWith('/token')).length, 1);
  const sameSubject = await h.startFlow();
  const secondSuccess = await h.request(sameSubject.callback, { cookie: sameSubject.cookie });
  assert.equal((await h.request('/api/auth/session', { cookie: activeCookie(secondSuccess) })).data.user.id, identity.user.id);
  const otherSubject = await h.startFlow({ sub: 'another-subject-same-email' });
  const thirdSuccess = await h.request(otherSubject.callback, { cookie: otherSubject.cookie });
  assert.notEqual((await h.request('/api/auth/session', { cookie: activeCookie(thirdSuccess) })).data.user.id, identity.user.id);
  assert.equal(h.sql('SELECT * FROM auth_users').length, 3);
});

test('security v0.7: rejected OAuth token consumes flow and cannot create any authenticated account', async t => {
  const h = await localHarness(t, { oidc: true, tokenFactory: flow => jwt({ ...claims(), nonce: flow.nonce, aud: 'attacker-client' }) });
  const flow = await h.startFlow();
  const failed = await h.request(flow.callback, { cookie: flow.cookie });
  assert.match(failed.headers.get('location'), /auth_error=OIDC_FAILED/); assert.equal(activeCookie(failed), undefined);
  assert.equal(h.sql('SELECT * FROM auth_users').length, 0); assert.equal(h.sql('SELECT * FROM auth_sessions').length, 0);
  assert.equal(h.sql('SELECT * FROM auth_oidc_flows').length, 0);
  await h.request(flow.callback, { cookie: flow.cookie });
  assert.equal(h.providerCalls.filter(call => call.url.endsWith('/token')).length, 1);
});

test('security v0.7: hosted auth consumes only platform identity and never enables independent local/OAuth sessions', async () => {
  // The header here represents Sites trusted edge context. This unit test does
  // not establish that a deployed edge strips forged public-client headers.
  const request = (route, { headers = {}, method = 'GET', body } = {}) => new Request('https://hosted.example.invalid' + route, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const cookies = { Cookie: 'coforge_account=' + 'a'.repeat(64) + '; coforge_sandbox=' + 'b'.repeat(64) };
  const anonymous = await handleHostedAuth(request('/api/auth/session', { headers: cookies })).json();
  assert.equal(anonymous.authenticated, false); assert.equal(anonymous.user, null);
  const trusted = await handleHostedAuth(request('/api/auth/session', { headers: { ...cookies, 'oai-authenticated-user-id': 'trusted-platform-owner' } })).json();
  assert.equal(trusted.user.id, 'trusted-platform-owner'); assert.equal(trusted.user.provider, 'hosted-platform');
  const config = await handleHostedAuth(request('/api/auth/config')).json();
  assert.equal(config.emailPassword.enabled, false); assert.equal(config.platform.signInUrl, '/signin-with-chatgpt');
  assert.ok(config.providers.every(provider => provider.enabled === false && provider.authorizationPath === null));
  for (const route of ['/api/auth/register', '/api/auth/login', '/api/auth/oidc/start', '/api/auth/oidc/callback']) {
    const result = handleHostedAuth(request(route, { method: route.endsWith('start') || route.endsWith('callback') ? 'GET' : 'POST', headers: cookies }));
    assert.equal(result.status, 403); assert.equal(result.headers.get('set-cookie'), null);
  }
});

test('security v0.7: expired account sessions and expired browser OAuth flows cannot be reused', async t => {
  let clock = now;
  const h = await localHarness(t, { oidc: true, clock: () => clock });
  const registered = await h.register(), cookie = activeCookie(registered);
  const flow = await h.startFlow();
  clock += 10 * 60000 + 1;
  const expiredFlow = await h.request(flow.callback, { cookie: flow.cookie });
  assert.match(expiredFlow.headers.get('location'), /auth_error=OIDC_FAILED/);
  assert.equal(activeCookie(expiredFlow), undefined);
  assert.equal(h.providerCalls.filter(call => call.url.endsWith('/token')).length, 0);
  clock += 7 * 86400000;
  assert.equal((await h.request('/api/auth/session', { cookie })).data.authenticated, false);
  assert.equal((await h.request('/api/v2/merchant/devices', { cookie })).status, 401);
});

test('admin OIDC returns a verified account to the admin page and a cancelled authorization to admin login', async t => {
  const h = await localHarness(t, { oidc: true });
  const cancelled = await h.startFlow({ returnTo: '/admin' });
  const back = await h.request('/api/auth/oidc/callback?state=' + cancelled.state + '&error=access_denied', { cookie: cancelled.cookie });
  assert.equal(back.headers.get('location'), '/admin/login?auth_error=OIDC_FAILED');
  const approved = await h.startFlow({ returnTo: '/admin' });
  const result = await h.request(approved.callback, { cookie: approved.cookie });
  assert.equal(result.headers.get('location'), '/admin');
  const access = await h.request('/api/admin/session', { cookie: activeCookie(result) });
  assert.equal(access.data.authenticated, true);
  assert.equal(access.data.authorized, false);
});
