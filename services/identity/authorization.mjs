import { ApiError } from '../platform/geometry.mjs';

/**
 * These inputs come only from the server's verified session and stored owner
 * workspace. Never construct them from request JSON, query strings or roles
 * supplied by a client. Authentication and merchant enrollment are separate.
 */
export function requireMerchantAccess({ ownerId, accountAuthenticated, workspace, mode = 'OWNER_WORKSPACE' } = {}) {
  if (accountAuthenticated !== true || typeof ownerId !== 'string' || !ownerId || ownerId.length > 300)
    throw new ApiError(401, 'ACCOUNT_LOGIN_REQUIRED', '请先登录账号');
  if (mode !== 'OWNER_WORKSPACE')
    throw new ApiError(403, 'MARKETPLACE_ACCESS_NOT_ENABLED', '跨商户生产权限尚未开通');
  if (!workspace?.merchant?.profile)
    throw new ApiError(403, 'MERCHANT_REQUIRED', '请先开通商家工作台');
  return Object.freeze({
    type: 'merchant', ownerId, scope: 'OWNER_WORKSPACE',
    permissions: Object.freeze(['operations:read', 'operations:write', 'integrations:read', 'integrations:probe']),
    realDispatch: false, realPayments: false
  });
}

export const WORKER_PERMISSIONS = Object.freeze(['jobs:claim', 'jobs:complete', 'jobs:fail', 'models:read']);

/** A worker principal must already have been authenticated by a server-only credential store. */
export function requireWorkerScope(principal, { ownerId, permission, now = Date.now() } = {}) {
  if (!principal || principal.type !== 'worker' || principal.authenticated !== true ||
      typeof principal.workerId !== 'string' || !principal.workerId || principal.ownerId !== ownerId ||
      !Number.isSafeInteger(principal.expiresAt) || principal.expiresAt <= now || principal.revokedAt != null)
    throw new ApiError(401, 'WORKER_AUTH_REQUIRED', '需要有效的制造服务凭据');
  if (!WORKER_PERMISSIONS.includes(permission) || !Array.isArray(principal.permissions) || !principal.permissions.includes(permission))
    throw new ApiError(403, 'WORKER_SCOPE_DENIED', '制造服务凭据没有此操作权限');
  return Object.freeze({ type: 'worker', workerId: principal.workerId, ownerId, permission });
}
