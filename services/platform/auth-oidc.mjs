import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

// This adapter is server-only. Browser responses must never serialize its config.
// Identity is the exact (issuer, sub) pair, never a matching e-mail address.
const PROVIDERS = new Set(['wechat', 'alipay', 'x', 'apple', 'qq', 'google', 'keycloak']);
const MAX_JSON_BYTES = 65536;
const MAX_ID_TOKEN_BYTES = 24576;
const REQUEST_TIMEOUT_MS = 12000;
const CLOCK_TOLERANCE_SECONDS = 30;
const CONTROL = /[\u0000-\u001f\u007f]/;

function failure(code = 'OIDC_FAILED') {
  const error = new Error(code === 'OIDC_CONFIG_INVALID' ? '身份服务配置无效' : '身份服务验证失败，请重新登录');
  error.code = code;
  return error;
}

function requireCondition(condition, code) {
  if (!condition) throw failure(code);
}

function textValue(value, maximum, minimum = 1) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum && !CONTROL.test(value);
}

function originURL(value, allowLoopback = false) {
  requireCondition(textValue(value, 2048), 'OIDC_CONFIG_INVALID');
  let url;
  try { url = new URL(value); } catch { throw failure('OIDC_CONFIG_INVALID'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  requireCondition((url.protocol === 'https:' || (allowLoopback && loopback && url.protocol === 'http:')) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'OIDC_CONFIG_INVALID');
  return url.origin;
}

// OIDC issuers can have a path (Keycloak uses /realms/<realm>). Keep that
// exact identity, while separately restricting discovered endpoints by origin.
function issuerURL(value, allowLoopback = false) {
  requireCondition(textValue(value, 2048) && !/[\\\s]/.test(value), 'OIDC_CONFIG_INVALID');
  let url;
  try { url = new URL(value); } catch { throw failure('OIDC_CONFIG_INVALID'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  requireCondition((url.protocol === 'https:' || (allowLoopback && loopback && url.protocol === 'http:')) &&
    !url.username && !url.password && !url.search && !url.hash &&
    !/%(?:2f|5c|2e)/i.test(url.pathname), 'OIDC_CONFIG_INVALID');
  const normalized = url.origin + (url.pathname === '/' ? '' : url.pathname);
  // Reject dot-segment/encoding normalization and ambiguous trailing slash.
  requireCondition(value === normalized && (url.pathname === '/' || !url.pathname.endsWith('/')), 'OIDC_CONFIG_INVALID');
  return normalized;
}

/** Validate only administrator-supplied configuration; never pass browser data here. */
export function validateOIDCConfig(raw) {
  requireCondition(raw && typeof raw === 'object' && !Array.isArray(raw), 'OIDC_CONFIG_INVALID');
  requireCondition(raw.allowInsecureLoopbackIssuer === undefined || typeof raw.allowInsecureLoopbackIssuer === 'boolean', 'OIDC_CONFIG_INVALID');
  const issuer = issuerURL(raw.issuer, raw.allowInsecureLoopbackIssuer === true);
  const publicOrigin = originURL(raw.publicOrigin, true);
  const adapter = raw.adapter ?? 'oidc';
  requireCondition(['oidc', 'casdoor', 'keycloak'].includes(adapter), 'OIDC_CONFIG_INVALID');
  requireCondition(textValue(raw.clientId, 512) && textValue(raw.clientSecret, 4096), 'OIDC_CONFIG_INVALID');
  const tokenEndpointAuthMethod = raw.tokenEndpointAuthMethod ?? 'client_secret_post';
  requireCondition(['client_secret_post', 'client_secret_basic'].includes(tokenEndpointAuthMethod), 'OIDC_CONFIG_INVALID');
  requireCondition(raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers), 'OIDC_CONFIG_INVALID');
  const providers = Object.create(null);
  for (const [id, providerName] of Object.entries(raw.providers)) {
    requireCondition(PROVIDERS.has(id) && textValue(providerName, 200), 'OIDC_CONFIG_INVALID');
    if (id === 'keycloak') requireCondition(adapter === 'keycloak' && providerName === 'realm', 'OIDC_CONFIG_INVALID');
    providers[id] = providerName;
  }
  requireCondition(Object.keys(providers).length > 0, 'OIDC_CONFIG_INVALID');
  return Object.freeze({ issuer, publicOrigin, adapter, clientId: raw.clientId, clientSecret: raw.clientSecret,
    tokenEndpointAuthMethod, providers: Object.freeze(providers), allowInsecureLoopbackIssuer: raw.allowInsecureLoopbackIssuer === true });
}

function endpointURL(value, issuer) {
  requireCondition(textValue(value, 2048));
  let url;
  try { url = new URL(value); } catch { throw failure(); }
  // Discovery cannot delegate requests or client credentials to another origin.
  const issuerOrigin = new URL(issuer).origin;
  requireCondition(url.protocol === new URL(issuer).protocol && url.origin === issuerOrigin && !url.username && !url.password && !url.hash);
  return url.href;
}

async function fetchJSON(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let reader;
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    requireCondition(response.ok && !response.redirected);
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) requireCondition(/^\d+$/.test(declaredLength) && Number(declaredLength) <= MAX_JSON_BYTES);
    requireCondition(response.body && typeof response.body.getReader === 'function');
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      requireCondition(total <= MAX_JSON_BYTES);
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    requireCondition(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
    return parsed;
  } catch {
    if (reader) { try { await reader.cancel(); } catch {} }
    throw failure();
  } finally {
    clearTimeout(timeout);
  }
}

function base64JSON(value, maxBytes) {
  requireCondition(textValue(value, maxBytes * 2) && /^[A-Za-z0-9_-]+$/.test(value));
  const decoded = Buffer.from(value, 'base64url');
  requireCondition(decoded.length <= maxBytes && decoded.toString('base64url') === value);
  let parsed;
  try { parsed = JSON.parse(decoded.toString('utf8')); } catch { throw failure(); }
  requireCondition(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  return parsed;
}

function constantEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function plainClaim(value, maxLength) {
  return textValue(value, maxLength) ? value : null;
}

/**
 * Fixed-issuer Authorization Code + PKCE adapter. The caller owns one-use state,
 * browser-cookie binding, flow expiry and session creation in its own database.
 */
export function createOIDCAdapter(raw, { fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const config = validateOIDCConfig(raw);
  let discoveryCache = null;
  let discoveryCacheUntil = 0;
  let discoveryPending = null;
  const expectedRedirect = config.publicOrigin + '/api/auth/oidc/callback';

  function validateRedirect(redirectUri) {
    requireCondition(redirectUri === expectedRedirect);
  }

  async function discovery() {
    if (discoveryCache && clock() < discoveryCacheUntil) return discoveryCache;
    if (discoveryPending) return discoveryPending;
    discoveryPending = (async () => {
      const metadata = await fetchJSON(fetchImpl, config.issuer + '/.well-known/openid-configuration',
        { headers: { Accept: 'application/json' } });
      requireCondition(metadata.issuer === config.issuer);
      requireCondition(Array.isArray(metadata.response_types_supported) && metadata.response_types_supported.includes('code'));
      if (metadata.code_challenge_methods_supported !== undefined)
        requireCondition(Array.isArray(metadata.code_challenge_methods_supported) && metadata.code_challenge_methods_supported.includes('S256'));
      if (metadata.token_endpoint_auth_methods_supported !== undefined)
        requireCondition(Array.isArray(metadata.token_endpoint_auth_methods_supported) && metadata.token_endpoint_auth_methods_supported.includes(config.tokenEndpointAuthMethod));
      const result = Object.freeze({
        authorization_endpoint: endpointURL(metadata.authorization_endpoint, config.issuer),
        token_endpoint: endpointURL(metadata.token_endpoint, config.issuer),
        jwks_uri: endpointURL(metadata.jwks_uri, config.issuer)
      });
      discoveryCache = result;
      discoveryCacheUntil = clock() + 300000;
      return result;
    })();
    try { return await discoveryPending; } finally { discoveryPending = null; }
  }

  async function authorizationURL({ provider, state, nonce, verifier, redirectUri }) {
    try {
      validateRedirect(redirectUri);
      requireCondition(PROVIDERS.has(provider) && Object.hasOwn(config.providers, provider));
      requireCondition(textValue(state, 256, 32) && textValue(nonce, 256, 32) &&
        textValue(verifier, 128, 43) && /^[A-Za-z0-9._~-]+$/.test(verifier));
      const metadata = await discovery();
      const url = new URL(metadata.authorization_endpoint);
      // Ignore any security-sensitive query fields a discovery document supplied.
      url.search = '';
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'openid profile email');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
      if (config.adapter === 'casdoor') url.searchParams.set('provider_hint', config.providers[provider]);
      if (config.adapter === 'keycloak' && provider !== 'keycloak') url.searchParams.set('kc_idp_hint', config.providers[provider]);
      return url.href;
    } catch { throw failure(); }
  }

  async function verifyIDToken(idToken, nonce, metadata) {
    requireCondition(textValue(idToken, MAX_ID_TOKEN_BYTES));
    const parts = idToken.split('.');
    requireCondition(parts.length === 3);
    const header = base64JSON(parts[0], 2048);
    requireCondition(['RS256', 'ES256'].includes(header.alg) && textValue(header.kid, 200));
    // Only keys from the configured issuer's discovered JWKS are trusted.
    requireCondition(header.jku === undefined && header.jwk === undefined && header.x5u === undefined &&
      header.crit === undefined && header.b64 === undefined);
    const claims = base64JSON(parts[1], MAX_ID_TOKEN_BYTES);
    requireCondition(/^[A-Za-z0-9_-]+$/.test(parts[2]));
    const signature = Buffer.from(parts[2], 'base64url');
    requireCondition(signature.toString('base64url') === parts[2] && signature.length <= 1024);
    const jwks = await fetchJSON(fetchImpl, metadata.jwks_uri, { headers: { Accept: 'application/json' } });
    requireCondition(Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys.length <= 64);
    const candidates = jwks.keys.filter(key => key && typeof key === 'object' && key.kid === header.kid &&
      (key.alg === undefined || key.alg === header.alg) && (key.use === undefined || key.use === 'sig') &&
      (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes('verify'))));
    requireCondition(candidates.length === 1);
    const jwk = candidates[0];
    requireCondition(jwk.d === undefined);
    if (header.alg === 'RS256') requireCondition(jwk.kty === 'RSA');
    else requireCondition(jwk.kty === 'EC' && jwk.crv === 'P-256');
    let publicKey;
    try { publicKey = createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw failure(); }
    if (header.alg === 'RS256') requireCondition(publicKey.asymmetricKeyType === 'rsa' &&
      publicKey.asymmetricKeyDetails.modulusLength >= 2048 && publicKey.asymmetricKeyDetails.modulusLength <= 8192);
    else requireCondition(signature.length === 64 && publicKey.asymmetricKeyType === 'ec');
    const key = header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey;
    requireCondition(verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), key, signature));
    const now = Math.floor(clock() / 1000);
    requireCondition(claims.iss === config.issuer && textValue(claims.sub, 255));
    const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    requireCondition(Array.isArray(audiences) && audiences.length > 0 && audiences.length <= 20 &&
      audiences.every(aud => textValue(aud, 512)) && audiences.includes(config.clientId));
    requireCondition((audiences.length === 1 || claims.azp === config.clientId) &&
      (claims.azp === undefined || claims.azp === config.clientId));
    requireCondition(Number.isSafeInteger(claims.exp) && claims.exp > now - CLOCK_TOLERANCE_SECONDS &&
      Number.isSafeInteger(claims.iat) && claims.iat <= now + CLOCK_TOLERANCE_SECONDS && claims.iat < claims.exp);
    if (claims.nbf !== undefined) requireCondition(Number.isSafeInteger(claims.nbf) && claims.nbf <= now + CLOCK_TOLERANCE_SECONDS);
    requireCondition(constantEqual(claims.nonce, nonce));
    const emailClaim = plainClaim(claims.email, 254);
    const email = emailClaim && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClaim) ? emailClaim : null;
    return {
      issuer: config.issuer,
      sub: claims.sub,
      email,
      emailVerified: claims.email_verified === true && Boolean(email),
      displayName: plainClaim(claims.name, 120) ?? plainClaim(claims.preferred_username, 120) ?? '第三方账号'
    };
  }

  async function verifyCallback({ code, verifier, nonce, redirectUri }) {
    try {
      validateRedirect(redirectUri);
      requireCondition(textValue(code, 4096) && textValue(nonce, 256, 32) &&
        textValue(verifier, 128, 43) && /^[A-Za-z0-9._~-]+$/.test(verifier));
      const metadata = await discovery();
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        code_verifier: verifier, client_id: config.clientId });
      const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
      if (config.tokenEndpointAuthMethod === 'client_secret_post') form.set('client_secret', config.clientSecret);
      else {
        // RFC 6749 2.3.1 applies form encoding before constructing HTTP Basic.
        const encode = value => new URLSearchParams({ value }).toString().slice(6);
        headers.Authorization = 'Basic ' + Buffer.from(encode(config.clientId) + ':' + encode(config.clientSecret)).toString('base64');
      }
      const response = await fetchJSON(fetchImpl, metadata.token_endpoint, { method: 'POST', headers, body: form.toString() });
      requireCondition(response.error === undefined && typeof response.id_token === 'string');
      // Access/refresh tokens are deliberately discarded: this is a login adapter.
      return await verifyIDToken(response.id_token, nonce, metadata);
    } catch { throw failure(); }
  }

  return Object.freeze({ config, authorizationURL, verifyCallback });
}
