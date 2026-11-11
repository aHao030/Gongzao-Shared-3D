export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', requestId = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const API_ROOT = '/api/v2';
const PENDING_KEY = 'coforge.pending-requests.v2';
let pending = {};
try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || '{}'); } catch {}
function remember() {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch {}
}
async function fingerprint(path, method, body) {
  const prefix = new TextEncoder().encode(method + ':' + path + ':');
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body ? new Uint8Array(body) : new Uint8Array();
  const merged = new Uint8Array(prefix.length + bytes.length);
  merged.set(prefix); merged.set(bytes, prefix.length);
  if (globalThis.crypto?.subtle) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', merged));
    return [...hash].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  // An unsecure local file cannot reach the hosted API. This fallback only
  // retains the same task identity within the current page session.
  return path + ':' + method + ':' + (typeof body === 'string' ? body : bytes.length);
}
function uniqueKey() {
  return globalThis.crypto?.randomUUID?.() || 'request-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}
async function send(path, { method = 'GET', body, headers = {}, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(API_ROOT + path, {
      method, body, headers: { Accept: 'application/json', ...headers },
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal
    });
    let result;
    try { result = await response.json(); } catch {
      throw new ApiError('服务端未返回有效数据，请稍后重试。', { status: response.status, code: 'INVALID_RESPONSE' });
    }
    if (!response.ok || result.error) {
      throw new ApiError(result.error?.message || '请求未成功，请重试。', {
        status: response.status, code: result.error?.code || 'REQUEST_FAILED', requestId: result.requestId || ''
      });
    }
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.name === 'AbortError'
      ? '请求超时，操作结果尚未确认。请使用原请求重试核对。'
      : '无法连接服务端。没有在本地替你完成该操作，请恢复网络后重试。',
    { code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' });
  } finally { clearTimeout(timer); }
}
export function get(path) { return send(path); }

/** The returned task owns an immutable body and idempotency key across retries. */
export async function prepareMutation(path, payload, options = {}) {
  const raw = options.raw === true;
  const body = raw ? payload.slice(0) : JSON.stringify(payload);
  const headers = {
    'Content-Type': raw ? 'application/octet-stream' : 'application/json',
    ...options.headers
  };
  // File name is part of request identity, not merely the file's byte content.
  const identity = await fingerprint(path + ':' + JSON.stringify(headers), 'POST', body);
  const key = pending[identity] || uniqueKey();
  pending[identity] = key;
  remember();
  return {
    path, key,
    async execute() {
      const result = await send(path, { method: 'POST', body, headers: { ...headers, 'Idempotency-Key': key } });
      delete pending[identity];
      remember();
      return result;
    }
  };
}
