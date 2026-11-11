import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOIDCAdapter, validateOIDCConfig } from '../services/platform/auth-oidc.mjs';
import { publicAuthConfig } from '../services/platform/auth-config.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { createLocalAuth } from '../services/platform/auth-local.mjs';
import { requireMerchantAccess, requireWorkerScope } from '../services/identity/authorization.mjs';
import { setupIdentity } from '../services/identity/setup.mjs';

const now = 1800000000000;
const issuer = 'https://identity.example.test/realms/gongzao';
const config = { issuer, publicOrigin: 'http://127.0.0.1:3000', adapter: 'keycloak', clientId: 'gongzao-platform', clientSecret: 'identity-test-secret-only', providers: { keycloak: 'realm', google: 'google-configured-alias' } };
const nonce = 'nonce'.repeat(10), state = 'state'.repeat(10), verifier = 'verifier'.repeat(8);
const redirectUri = config.publicOrigin + '/api/auth/oidc/callback';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'realm-signing', use: 'sig', alg: 'RS256' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function fixture({ claims = {}, metadata = {} } = {}) {
  const calls = [];
  const endpoints = { issuer, authorization_endpoint: issuer + '/protocol/openid-connect/auth', token_endpoint: issuer + '/protocol/openid-connect/token', jwks_uri: issuer + '/protocol/openid-connect/certs', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], ...metadata };
  const signedClaims = { iss: issuer, sub: 'one-real-subject', aud: config.clientId, nonce, iat: now / 1000, exp: now / 1000 + 300, email: 'owner@example.test', email_verified: true, name: 'Owner', realm_access: { roles: ['admin', 'merchant'] }, ...claims };
  const message = [ { alg: 'RS256', kid: jwk.kid }, signedClaims ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  const token = message + '.' + sign('sha256', Buffer.from(message), pair.privateKey).toString('base64url');
  const adapter = createOIDCAdapter(config, { clock: () => now, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url === issuer + '/.well-known/openid-configuration') return json(endpoints);
    if (url === endpoints.jwks_uri) return json({ keys: [jwk] });
    if (url === endpoints.token_endpoint) return json({ id_token: token });
    throw new Error('Unexpected fixture URL');
  } });
  return { adapter, calls };
}

test('v9 Keycloak realm issuer retains exact issuer path and selects configured identity providers with PKCE', async () => {
  const { adapter, calls } = fixture();
  const direct = new URL(await adapter.authorizationURL({ provider: 'keycloak', state, nonce, verifier, redirectUri }));
  assert.equal(direct.pathname, '/realms/gongzao/protocol/openid-connect/auth');
  assert.equal(direct.searchParams.has('kc_idp_hint'), false);
  assert.equal(direct.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  const google = new URL(await adapter.authorizationURL({ provider: 'google', state, nonce, verifier, redirectUri }));
  assert.equal(google.searchParams.get('kc_idp_hint'), 'google-configured-alias');
  assert.equal(calls[0].url, issuer + '/.well-known/openid-configuration');
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  const result = await adapter.verifyCallback({ code: 'test-code', nonce, verifier, redirectUri });
  assert.deepEqual(result, { issuer, sub: 'one-real-subject', email: 'owner@example.test', emailVerified: true, displayName: 'Owner' });
  assert.ok(!Object.hasOwn(result, 'roles'), 'identity-provider roles do not grant merchant privileges');
});

test('v9 Keycloak tokens for a different realm, audience or nonce and cross-origin discovery remain rejected', async () => {
  for (const claims of [{ iss: issuer.replace('gongzao', 'other') }, { aud: 'wrong-client' }, { nonce: 'attacker' }])
    await assert.rejects(fixture({ claims }).adapter.verifyCallback({ code: 'test-code', nonce, verifier, redirectUri }), { code: 'OIDC_FAILED' });
  const { adapter, calls } = fixture({ metadata: { token_endpoint: 'https://other.example.test/steal' } });
  await assert.rejects(adapter.verifyCallback({ code: 'test-code', nonce, verifier, redirectUri }), { code: 'OIDC_FAILED' });
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls).includes(config.clientSecret));
});

test('v9 insecure issuer requires explicit loopback development setting and canonical paths', () => {
  for (const bad of ['http://identity.example.test/realms/gongzao', 'https://identity.example.test/a/../realms/gongzao', issuer + '/', issuer + '?x=1', issuer + '#x', 'https://identity.example.test/realms%2fgongzao'])
    assert.throws(() => validateOIDCConfig({ ...config, issuer: bad, allowInsecureLoopbackIssuer: true }), { code: 'OIDC_CONFIG_INVALID' });
  assert.throws(() => validateOIDCConfig({ ...config, issuer: 'http://127.0.0.1:8180/realms/gongzao' }), { code: 'OIDC_CONFIG_INVALID' });
  assert.equal(validateOIDCConfig({ ...config, issuer: 'http://127.0.0.1:8180/realms/gongzao', allowInsecureLoopbackIssuer: true }).issuer, 'http://127.0.0.1:8180/realms/gongzao');
});

test('v9 public auth exposes only configured Keycloak entry and never exposes credentials or enables hosted providers', () => {
  const local = publicAuthConfig('LOCAL_SANDBOX', validateOIDCConfig(config));
  assert.equal(local.providers.length, 7);
  assert.equal(local.providers.find(p => p.id === 'keycloak').authorizationPath, '/api/auth/oidc/start?provider=keycloak');
  assert.ok(local.providers.filter(p => ['wechat', 'alipay', 'qq', 'apple', 'x'].includes(p.id)).every(p => !p.enabled));
  assert.equal(local.emailPassword.emailVerification, false);
  assert.equal(local.accessBoundary.crossMerchantMarketplace, false);
  assert.doesNotMatch(JSON.stringify(local), /identity-test-secret|clientSecret|realms\/gongzao/);
  assert.equal(publicAuthConfig('HOSTED_PLATFORM', config).providers.length, 6);
  assert.equal(publicAuthConfig('LOCAL_SANDBOX').providers.length, 6);
});

test('v9 secret environment references resolve server-side and fail closed when missing or ambiguous', () => {
  const db = new SQLiteStore(':memory:');
  const key = 'GONGZAO_IDENTITY_TEST_SECRET';
  const previous = process.env[key];
  try {
    const { clientSecret, ...noSecret } = config;
    delete process.env[key];
    assert.ok(createLocalAuth(db, { authConfig: { oidc: { ...noSecret, clientSecretEnv: key } } }).config().providers.every(p => !p.enabled));
    process.env[key] = 'test-only-environment-secret';
    const auth = createLocalAuth(db, { authConfig: { oidc: { ...noSecret, clientSecretEnv: key } } });
    assert.equal(auth.config().identityService.enabled, true);
    assert.ok(!JSON.stringify(auth.config()).includes(process.env[key]));
    assert.ok(createLocalAuth(db, { authConfig: { oidc: { ...config, clientSecretEnv: key } } }).config().providers.every(p => !p.enabled));
  } finally { previous === undefined ? delete process.env[key] : process.env[key] = previous; db.close(); }
});

test('v9 realm login round trip refreshes verified claims without moving or merging the owner workspace', async t => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  let verified = true, issuedNonce;
  const auth = createLocalAuth(store, { clock: () => now, authConfig: { publicOrigin: config.publicOrigin, oidc: config }, authFetch: async url => {
    if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token', jwks_uri: issuer + '/certs' });
    if (url.endsWith('/certs')) return json({ keys: [jwk] });
    if (url.endsWith('/token')) {
      const claims = { iss: issuer, sub: 'stable-subject', aud: config.clientId, nonce: issuedNonce, iat: now / 1000, exp: now / 1000 + 300, email: 'same@example.test', email_verified: verified, name: verified ? 'Original' : 'Updated' };
      const message = [{ alg: 'RS256', kid: jwk.kid }, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
      return json({ id_token: message + '.' + sign('sha256', Buffer.from(message), pair.privateKey).toString('base64url') });
    }
    throw new Error('Unexpected provider URL');
  } });
  async function login() {
    const start = await auth.handle(new Request(config.publicOrigin + '/api/auth/oidc/start?provider=keycloak'));
    assert.equal(start.status, 302);
    const location = new URL(start.headers.get('location'));
    issuedNonce = location.searchParams.get('nonce');
    const callback = await auth.handle(new Request(redirectUri + '?state=' + location.searchParams.get('state') + '&code=roundtrip-code', { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } }));
    assert.equal(callback.headers.get('location'), '/merchant');
    return store.db.prepare("SELECT * FROM auth_users WHERE subject='stable-subject'").get();
  }
  const first = await login();
  assert.equal(first.email_verified, 1);
  verified = false;
  const second = await login();
  assert.equal(second.id, first.id);
  assert.equal(second.owner, first.owner);
  assert.equal(second.email_verified, 0);
  assert.equal(second.display_name, 'Updated');
  assert.equal(store.db.prepare('SELECT count(*) n FROM auth_users').get().n, 1);
});

test('v9 merchant access requires authenticated account and stored enrollment; worker authorization is a separate scope', () => {
  const workspace = { merchant: { profile: { name: 'Farm' } } };
  assert.throws(() => requireMerchantAccess({ ownerId: 'owner', accountAuthenticated: false, workspace }), { code: 'ACCOUNT_LOGIN_REQUIRED' });
  assert.throws(() => requireMerchantAccess({ ownerId: 'owner', accountAuthenticated: true, workspace: {} }), { code: 'MERCHANT_REQUIRED' });
  assert.throws(() => requireMerchantAccess({ ownerId: 'owner', accountAuthenticated: true, workspace, mode: 'GLOBAL_MARKETPLACE' }), { code: 'MARKETPLACE_ACCESS_NOT_ENABLED' });
  const merchant = requireMerchantAccess({ ownerId: 'owner', accountAuthenticated: true, workspace });
  assert.equal(merchant.realDispatch, false);
  assert.throws(() => requireWorkerScope(merchant, { ownerId: 'owner', permission: 'models:read', now }), { code: 'WORKER_AUTH_REQUIRED' });
  const worker = { type: 'worker', authenticated: true, workerId: 'worker-one', ownerId: 'owner', expiresAt: now + 1000, permissions: ['models:read'] };
  assert.equal(requireWorkerScope(worker, { ownerId: 'owner', permission: 'models:read', now }).workerId, 'worker-one');
  assert.throws(() => requireWorkerScope(worker, { ownerId: 'other', permission: 'models:read', now }), { code: 'WORKER_AUTH_REQUIRED' });
  assert.throws(() => requireWorkerScope(worker, { ownerId: 'owner', permission: 'jobs:claim', now }), { code: 'WORKER_SCOPE_DENIED' });
  assert.throws(() => requireWorkerScope({ ...worker, expiresAt: now }, { ownerId: 'owner', permission: 'models:read', now }), { code: 'WORKER_AUTH_REQUIRED' });
});

test('v9 Keycloak configuration generator creates unique credentials and never overwrites an existing identity', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gongzao-identity-v9-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'identity');
  const generated = await setupIdentity({ directory, development: true });
  const local = JSON.parse(await fs.readFile(generated.authConfigPath, 'utf8'));
  const realm = JSON.parse(await fs.readFile(generated.realmPath, 'utf8'));
  assert.equal(realm.clients[0].secret, local.oidc.clientSecret);
  assert.equal(realm.clients[0].attributes['pkce.code.challenge.method'], 'S256');
  assert.equal(realm.clients[0].directAccessGrantsEnabled, false);
  assert.deepEqual(realm.identityProviders, []);
  assert.equal(generated.emailVerification, false);
  assert.equal(local.oidc.allowInsecureLoopbackIssuer, true);
  assert.ok(!JSON.stringify(generated).includes(local.oidc.clientSecret));
  await assert.rejects(setupIdentity({ directory, development: true }), { code: 'EEXIST' });
  assert.equal(JSON.parse(await fs.readFile(generated.authConfigPath, 'utf8')).oidc.clientSecret, local.oidc.clientSecret);
  await assert.rejects(setupIdentity({ directory: path.join(temp, 'invalid') }), /OIDC|配置无效|HTTPS/);
  const production = await setupIdentity({ directory: path.join(temp, 'production'), issuer, publicOrigin: 'https://print.example.test' });
  assert.equal(JSON.parse(await fs.readFile(production.realmPath, 'utf8')).verifyEmail, true);
  assert.equal(production.passwordReset, true);
});
