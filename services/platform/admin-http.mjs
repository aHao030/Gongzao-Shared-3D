// The hosting adapters supply the verified account ID and the control store.
// Request payloads cannot select the account that authorizes an action.
import { ApiError, ensure } from './geometry.mjs';
import { jsonResponse, readLimited } from './http.mjs';
import { readAdminBusiness } from './admin-business.mjs';

const allowedMethods = new Map([
  ['/api/admin/session', 'GET'],
  ['/api/admin/overview', 'GET'],
  ['/api/admin/business', 'GET'],
  ['/api/admin/actions', 'POST'],
  ['/api/admin/nodes/heartbeat', 'POST']
]);
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const reply = (body, status = 200, headers = {}) => jsonResponse(body, status, { ...privateHeaders, ...headers });

async function jsonObject(request, limit) {
  ensure(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json', 415,
    'INVALID_CONTENT_TYPE', '请使用 JSON 格式提交');
  const bytes = await readLimited(request, limit);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'INVALID_JSON', '无法读取提交的 JSON'); }
  ensure(value && typeof value === 'object' && !Array.isArray(value), 400, 'INVALID_PAYLOAD', '请求内容必须为对象');
  return value;
}

function sessionContext(actorId) {
  return actorId ? 'admin:' + encodeURIComponent(actorId) : null;
}

export async function handleAdminHttp(request, { actorId, control, store, clock = Date.now, memberExists }) {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();
  try {
    const method = allowedMethods.get(url.pathname);
    ensure(method, 404, 'NOT_FOUND', '管理接口不存在');
    if (method !== request.method) {
      return reply({ error: { code: 'METHOD_NOT_ALLOWED', message: '此接口不支持该方法' }, requestId }, 405, { Allow: method });
    }
    const origin = request.headers.get('origin');
    ensure(!origin || origin === url.origin, 403, 'CROSS_ORIGIN_DENIED', '请在同一站点操作');
    ensure(request.headers.get('sec-fetch-site') !== 'cross-site', 403, 'CROSS_ORIGIN_DENIED', '请在同一站点操作');

    if (url.pathname === '/api/admin/nodes/heartbeat') {
      const auth = request.headers.get('authorization') || '';
      // The node domain validates token format, credential rotation and revocation.
      const token = /^Bearer ([^\s]{1,512})$/.exec(auth)?.[1];
      ensure(token, 401, 'NODE_AUTH_REQUIRED', '服务器心跳需要独立的节点凭据');
      return reply(await control.heartbeat(token, await jsonObject(request, 2048)));
    }

    const context = sessionContext(actorId);
    const session = await control.resolve(actorId);
    if (url.pathname === '/api/admin/session') {
      return reply({ ...session, authenticated: Boolean(actorId), context });
    }

    ensure(actorId, 401, 'ADMIN_LOGIN_REQUIRED', '请先登录管理员账号');
    ensure(session.configured, 503, 'ADMIN_NOT_CONFIGURED', '尚未开通首位平台管理员');
    ensure(session.authorized, 403, 'ADMIN_ACCESS_DENIED', '此账号尚未获授管理员权限');
    const pinned = request.headers.get('X-Gongzao-Admin-Context');
    if (request.method === 'POST' || pinned !== null) {
      ensure(pinned === context, 409, 'ADMIN_CONTEXT_CHANGED', '当前账号已切换或页面已过期，请刷新后核对');
    }
    if (url.pathname === '/api/admin/overview') return reply(await control.overview(actorId));
    if (url.pathname === '/api/admin/business') return reply(await readAdminBusiness(store, clock()));

    const key = request.headers.get('Idempotency-Key');
    ensure(typeof key === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(key), 400, 'IDEMPOTENCY_REQUIRED', '操作需要唯一请求标识');
    const body = await jsonObject(request, 8192);
    // Validate recipients only for actors with membership management access.
    // The domain rechecks that permission in its commit operation.
    if (body.action === 'member.grant' && session.permissions.manageMembers && memberExists) {
      ensure(typeof body.subject === 'string' && await memberExists(body.subject), 400,
        'ADMIN_SUBJECT_UNKNOWN', '找不到该已注册账号，请核对账号标识');
    }
    return reply(await control.execute(actorId, { ...body, requestId: key }));
  } catch (error) {
    if (error instanceof ApiError) {
      return reply({ error: { code: error.code, message: error.message }, requestId }, error.status);
    }
    return reply({ error: { code: 'ADMIN_UNAVAILABLE', message: '管理服务暂时无法完成请求，请稍后再试' }, requestId }, 503);
  }
}
