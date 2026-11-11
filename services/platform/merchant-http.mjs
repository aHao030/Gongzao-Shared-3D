import { ApiError, ensure } from './geometry.mjs';
import { applyMerchantCommand, merchantSession, merchantDevices, merchantScanResult, requireMerchant, publicGateway, createGatewayCredential, parseGatewayCredential, authenticateGateway } from './merchant.mjs';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
async function readJson(request, maximum) {
  ensure(request.headers.get('content-type')?.split(';')[0] === 'application/json', 415, 'INVALID_CONTENT_TYPE', '接口需要 application/json');
  const length = Number(request.headers.get('content-length'));
  ensure(!Number.isFinite(length) || length <= maximum, 413, 'BODY_TOO_LARGE', '请求数据超过当前大小限制');
  const reader = request.body?.getReader(); ensure(reader, 400, 'INVALID_JSON', '请求体不能为空');
  let bytes = 0; const chunks = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maximum) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', '请求数据超过当前大小限制'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let cursor = 0; for (const chunk of chunks) { joined.set(chunk, cursor); cursor += chunk.byteLength; }
  let payload; try { payload = JSON.parse(new TextDecoder().decode(joined)); } catch { throw new ApiError(400, 'INVALID_JSON', '请求体不是有效 JSON'); }
  ensure(payload && typeof payload === 'object' && !Array.isArray(payload), 400, 'INVALID_PAYLOAD', '请求体必须为对象');
  return payload;
}
export async function handleMerchantApi(request, { store, ownerId, clock = Date.now }) {
  const url = new URL(request.url), path = url.pathname, now = clock(), requestId = crypto.randomUUID();
  try {
    ensure(request.headers.get('sec-fetch-site') !== 'cross-site', 403, 'CROSS_ORIGIN_DENIED', '不接受跨站调用');
    ensure(!request.headers.get('origin') || request.headers.get('origin') === url.origin, 403, 'CROSS_ORIGIN_DENIED', '不接受其他网站的请求');
    const gatewayRoute = path.startsWith('/api/v2/gateway/');
    let credential;
    if (gatewayRoute) {
      credential = await parseGatewayCredential(request.headers.get('authorization'));
      ownerId = credential.owner;
      authenticateGateway(await store.load(ownerId), credential, now);
    } else ensure(ownerId, 401, 'AUTH_REQUIRED', '请先登录或建立本地沙盒会话');
    if (!gatewayRoute && request.method === 'GET') {
      const workspace = await store.load(ownerId);
      if (path === '/api/v2/merchant/session') return reply({ ...merchantSession(workspace), requestId });
      requireMerchant(workspace);
      if (path === '/api/v2/merchant/devices') return reply({ ...merchantDevices(workspace, now), mode: 'MERCHANT_SANDBOX', requestId });
      if (path === '/api/v2/merchant/gateways') return reply({ gateways: requireMerchant(workspace).gateways.map(g => publicGateway(g, now)), requestId });
      if (path === '/api/v2/merchant/scan-result') return reply({ ...merchantScanResult(workspace, url.searchParams.get('scanId'), now), requestId });
      throw new ApiError(404, 'NOT_FOUND', '商家接口不存在');
    }
    ensure(request.method === 'POST', 405, 'METHOD_NOT_ALLOWED', '此接口不支持该方法');
    const routes = {
      '/api/v2/merchant/enroll': 'enroll', '/api/v2/merchant/pairing': 'pairing', '/api/v2/merchant/gateways/revoke': 'revoke',
      '/api/v2/merchant/scan': 'scan', '/api/v2/merchant/devices/import': 'import',
      '/api/v2/gateway/poll': 'gateway-poll', '/api/v2/gateway/report': 'gateway-report'
    };
    const type = routes[path]; ensure(type, 404, 'NOT_FOUND', '商家接口不存在');
    const key = request.headers.get('idempotency-key');
    ensure(typeof key === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(key), 400, 'IDEMPOTENCY_REQUIRED', '请提供 8–128 位唯一请求标识');
    const payload = await readJson(request, type === 'gateway-report' ? 131072 : 32768);
    const pairing = type === 'pairing' ? await createGatewayCredential(ownerId, now) : undefined;
    const outcome = await store.transact(ownerId, workspace => applyMerchantCommand(workspace, { type, payload, idempotencyKey: key }, { ownerId, now, credential, pairing }));
    return reply({ ...outcome.result, ...(type === 'pairing' ? { token: outcome.replayed ? null : pairing.token, platformOrigin: url.origin } : {}), mode: 'MERCHANT_SANDBOX', replayed: outcome.replayed === true, requestId }, ['enroll', 'pairing'].includes(type) && !outcome.replayed ? 201 : 200);
  } catch (error) {
    const known = error instanceof ApiError || ['DomainError', 'PlatformError'].includes(error.name);
    return reply({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务暂时无法处理请求，请稍后使用同一请求标识重试' }, requestId }, known ? error.status ?? 409 : 500);
  }
}
