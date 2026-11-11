import { ensure, sha256 } from './geometry.mjs';
import { isServerNodeId } from './admin-nodes.mjs';

export const WORKER_KINDS = Object.freeze(['ANALYZE_MODEL', 'SLICE_MODEL', 'SCHEDULE']);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
export function validateWorkerAccess(config = { workers: [] }) {
  ensure(config && typeof config === 'object' && Array.isArray(config.workers) && config.workers.length <= 16,
    500, 'WORKER_CONFIG_INVALID', '制造服务凭据配置无效');
  const ids = new Set(), hashes = new Set();
  for (const worker of config.workers) {
    ensure(worker && label(worker.ownerId) && /^[A-Za-z0-9_-]{3,80}$/.test(worker.workerId || '') &&
      /^[a-f0-9]{64}$/.test(worker.tokenHash || '') && Number.isSafeInteger(worker.expiresAt) && worker.expiresAt > 0 &&
      Array.isArray(worker.kinds) && worker.kinds.length > 0 && worker.kinds.every(kind => WORKER_KINDS.includes(kind)) &&
      typeof worker.enabled === 'boolean' && (worker.serverNodeId === undefined || isServerNodeId(worker.serverNodeId)) &&
      !ids.has(worker.workerId) && !hashes.has(worker.tokenHash),
      500, 'WORKER_CONFIG_INVALID', '制造服务凭据配置无效');
    ids.add(worker.workerId); hashes.add(worker.tokenHash);
  }
  return structuredClone(config);
}

// Only hashes are retained by the platform. Credentials are separate from browser
// and discovery-gateway sessions and are scoped to one owner and task kind list.
export async function authenticateWorker(request, config, now = Date.now()) {
  const authorization = request.headers.get('authorization') || '';
  ensure(/^Bearer [A-Za-z0-9_-]{43,128}$/.test(authorization), 401, 'WORKER_AUTH_REQUIRED', '需要独立的制造服务凭据');
  const hash = await sha256(new TextEncoder().encode(authorization.slice(7)));
  const sameHash = expected => {
    let different = expected.length ^ hash.length;
    for (let i = 0; i < hash.length; i++) different |= hash.charCodeAt(i) ^ (expected.charCodeAt(i) || 0);
    return different === 0;
  };
  const worker = config?.workers?.find(record => sameHash(record.tokenHash));
  ensure(worker && worker.enabled && worker.expiresAt > now, 401, 'WORKER_AUTH_INVALID', '制造服务凭据无效、已禁用或已过期');
  return { ownerId: worker.ownerId, workerId: worker.workerId, kinds: [...worker.kinds],
    ...(worker.serverNodeId ? { serverNodeId: worker.serverNodeId } : {}) };
}

// The worker identity and job lease still authorize all model and result access.
// A bound management node is a separate availability and revocation check.
export async function requireWorkerNode(principal, control, { resultReport = false } = {}) {
  if (!principal.serverNodeId) return;
  ensure(typeof control?.nodeStatus === 'function', 503, 'WORKER_NODE_UNAVAILABLE', '暂时无法核对计算节点状态');
  const status = await control.nodeStatus(principal.serverNodeId);
  if (status === 'ONLINE' || (resultReport && status === 'OFFLINE')) return;
  if (status === 'OFFLINE' || status === 'NEVER_CONNECTED') {
    ensure(false, 409, 'WORKER_NODE_OFFLINE', '绑定节点尚未连接或心跳已过期，请先恢复节点心跳');
  }
  ensure(false, 403, 'WORKER_NODE_INACTIVE', '绑定节点不存在、已停用或已撤销');
}

export function workerReadiness(config, ownerId, now = Date.now()) {
  const workers = config?.workers?.filter(worker => worker.enabled && worker.ownerId === ownerId && worker.expiresAt > now) || [];
  return { configured: workers.length > 0, kinds: [...new Set(workers.flatMap(worker => worker.kinds))],
    status: workers.length ? 'CONFIGURED_NOT_VERIFIED' : 'NOT_CONFIGURED', onlineVerified: false };
}
