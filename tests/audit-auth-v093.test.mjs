import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createPlatformServer } from '../services/platform/local.mjs';
import { createLocalAuth } from '../services/platform/auth-local.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { setupIdentity } from '../services/identity/setup.mjs';

async function localServer(t) {
  let now = Date.UTC(2026, 0, 12);
  const { server, store } = createPlatformServer({ dbPath: ':memory:', clock: () => now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    request: (pathname, options) => fetch(base + pathname, options),
    expireAccount() { now += 7 * 86400000; }
  };
}

test('public application links open the static shell while account API requests remain same-origin', async t => {
  const { request } = await localServer(t);
  const navigation = { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' } };
  for (const route of ['/', '/login', '/merchant/login']) {
    const result = await request(route, navigation);
    assert.equal(result.status, 200, route);
    assert.match(result.headers.get('content-type'), /^text\/html/);
    assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(result.headers.get('set-cookie'), null);
    await result.text();
  }
  const account = await request('/api/auth/session', navigation);
  assert.equal(account.status, 403);
  assert.equal((await account.json()).error.code, 'CROSS_ORIGIN_DENIED');
});

test('guest sessions can use their workspace while only signed-in accounts obtain merchant enrollment access', async t => {
  const { request, expireAccount } = await localServer(t);
  const guestResponse = await request('/api/v2/session');
  const guestCookie = guestResponse.headers.getSetCookie()[0].split(';')[0];
  const guest = await guestResponse.json();
  assert.equal(guest.authenticated, false);
  assert.equal(guest.sessionType, 'GUEST');
  assert.equal(guest.workspaceAvailable, true);
  assert.equal((await request('/api/v2/workspace', { headers: { Cookie: guestCookie } })).status, 200);
  assert.equal((await request('/api/v2/merchant/session', { headers: { Cookie: guestCookie } })).status, 401);
  const signup = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
    body: JSON.stringify({ email: 'session-audit@example.test', password: 'example-test-password', adoptLegacyWorkspace: true })
  });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.getSetCookie().find(item => item.startsWith('coforge_account=')).split(';')[0];
  const current = await (await request('/api/v2/session', { headers: { Cookie: cookie } })).json();
  assert.equal(current.authenticated, true);
  assert.equal(current.sessionType, 'ACCOUNT');
  assert.equal(current.user.id, guest.user.id, 'adopting a workspace must not change its identifier');
  assert.equal((await request('/api/v2/merchant/session', { headers: { Cookie: cookie } })).status, 200);
  expireAccount();
  const afterExpiry = await (await request('/api/v2/session', { headers: { Cookie: cookie } })).json();
  assert.equal(afterExpiry.authenticated, false);
  assert.notEqual(afterExpiry.user.id, current.user.id);
});

test('identity setup accepts a public homepage URL with a trailing slash and generates a usable callback', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gongzao-origin-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const site = 'https://farm.example.test', issuer = 'https://identity.example.test/realms/gongzao';
  const result = await setupIdentity({directory: path.join(directory, 'identity'), publicOrigin: site + '/', issuer});
  const config = JSON.parse(await readFile(result.authConfigPath, 'utf8'));
  const realm = JSON.parse(await readFile(result.realmPath, 'utf8'));
  assert.equal(config.publicOrigin, site);
  assert.deepEqual(realm.clients[0].redirectUris, [site + '/api/auth/oidc/callback']);
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  // Also support files created by previous versions with the slash in both locations.
  const legacyConfig = { ...config, publicOrigin: site + '/', oidc: {...config.oidc, publicOrigin: site + '/'} };
  const auth = createLocalAuth(store, {authConfig: legacyConfig});
  assert.equal(auth.publicOrigin, site);
  assert.equal(auth.config().identityService.enabled, true);
});

test('an open form stays with its original workspace when another tab changes the browser account', async t => {
  const {request} = await localServer(t);
  async function register(email) {
    const result = await request('/api/auth/register', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password:'example-test-password'})
    });
    assert.equal(result.status, 201);
    return result.headers.getSetCookie()[0].split(';')[0];
  }
  const [cookieA, cookieB] = await Promise.all([
    register('tab-a@example.test'), register('tab-b@example.test')
  ]);
  let browserCookie = cookieA;
  let reloadCount = 0;
  const memory = new Map();
  const source = (await readFile(new URL('../dist/api-client.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
  function openPage() {
    const context = vm.createContext({
      TextEncoder, Uint8Array, AbortController, setTimeout, clearTimeout, crypto:webcrypto,
      location:{reload() { reloadCount++; }},
      sessionStorage:{
        setItem:(key, value) => memory.set(key,value),
        getItem:key => memory.get(key) ?? null,
        removeItem:key => memory.delete(key)
      },
      fetch:(route, options) => request(route, {...options, headers:{...options.headers,Cookie:browserCookie}})
    });
    vm.runInContext(source + '\nglobalThis.api = {get,prepareMutation,takeWorkspaceChangeNotice};', context);
    return context.api;
  }
  const tabA = openPage();
  await tabA.get('/session');
  const draft = await tabA.prepareMutation('/customer/profile', {
    displayName:'示例草稿', setupCompleted:true, shippingAddress:null
  });
  browserCookie = cookieB;
  await assert.rejects(draft.execute(), {code:'WORKSPACE_CHANGED'});
  await assert.rejects(draft.execute(), {code:'WORKSPACE_CHANGED'});
  assert.equal(reloadCount, 1);
  const tabB = openPage();
  await tabB.get('/session');
  assert.equal(tabB.takeWorkspaceChangeNotice(), true);
  assert.equal(tabB.takeWorkspaceChangeNotice(), false);
  assert.equal((await tabB.get('/customer/profile')).profile, null);
  const updated = await tabB.prepareMutation('/customer/profile', {
    displayName:'当前用户的新资料', setupCompleted:true, shippingAddress:null
  });
  assert.equal((await updated.execute()).profile.displayName, '当前用户的新资料');
  browserCookie = cookieA;
  await assert.rejects(tabB.get('/session'), {code:'WORKSPACE_CHANGED'});
  assert.equal(reloadCount, 2);
});
