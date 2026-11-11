/* Portable API v2 client. No browser cookies, secrets, storage, or platform imports. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SharedFabricationApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function fail(code, message, status) {
    const error = new Error(message); error.code = code; if (status) error.status = status; return error;
  }
  function normalizeApiBase(value) {
    const base = typeof value === 'string' ? value.trim().replace(/\/$/, '') : '';
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(base))
      throw fail('INVALID_API_BASE', '服务端地址须为 HTTPS origin，不含路径、账号、查询参数或片段。');
    return base;
  }
  function keyHeader(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(value))
      throw fail('IDEMPOTENCY_KEY_REQUIRED', '写操作需要 8–128 位幂等键；重试时复用同一键。');
    return value;
  }
  function createApiClient(options) {
    const settings = options || {};
    const apiBase = normalizeApiBase(settings.apiBase);
    if (typeof settings.transport !== 'function') throw fail('TRANSPORT_REQUIRED', '缺少平台网络 transport。');
    if (typeof settings.getAccessToken !== 'function') throw fail('AUTH_ADAPTER_REQUIRED', '缺少与服务端兼容的身份适配器。');
    async function request(method, path, data, extraHeaders) {
      const token = await settings.getAccessToken();
      if (typeof token !== 'string' || !token.trim()) throw fail('AUTH_REQUIRED', '尚未登录受支持的服务端身份；不能复用浏览器 ChatGPT Cookie。');
      if (/[\r\n]/.test(token)) throw fail('INVALID_TOKEN', '身份凭据格式无效。');
      const headers = Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + token }, data === undefined ? {} : { 'Content-Type': 'application/json' }, extraHeaders || {});
      let response;
      try { response = await settings.transport({ url: apiBase + '/api/v2' + path, method, headers, data, timeout: 15000 }); }
      catch (_) { throw fail('NETWORK_ERROR', '网络请求失败；未切换为本机演示，也未确认操作成功。'); }
      const status = response && (response.statusCode || response.status);
      if (typeof status !== 'number') throw fail('INVALID_RESPONSE', '服务端响应缺少 HTTP 状态。');
      if (status === 401) throw fail('AUTH_REQUIRED', '服务端未接受当前身份，请重新登录或完成平台鉴权接入。', status);
      if (status === 403) throw fail('FORBIDDEN', '当前身份没有访问该资源的权限。', status);
      if (status < 200 || status >= 300) {
        const body = response.data || {};
        const code = typeof body.error === 'string' ? body.error : (body.error && body.error.code) || body.code || 'API_ERROR';
        const message = typeof body.message === 'string' ? body.message : (body.error && body.error.message) || '服务端拒绝了本次请求。';
        throw fail(String(code), String(message), status);
      }
      if (!response.data || typeof response.data !== 'object') throw fail('INVALID_RESPONSE', '服务端未返回预期的 JSON 数据。');
      return response.data;
    }
    return Object.freeze({
      apiBase,
      async getSession() {
        const result = await request('GET', '/session');
        if (result.authenticated !== true) throw fail('AUTH_REQUIRED', '服务端会话尚未认证。');
        if (result.mode !== 'SERVER_SANDBOX') throw fail('UNEXPECTED_SERVER_MODE', '本演示客户端只接受 SERVER_SANDBOX 服务端。');
        return result;
      },
      async getWorkspace() {
        const result = await request('GET', '/workspace');
        if (!result.workspace || !Array.isArray(result.workspace.orders)) throw fail('INVALID_RESPONSE', '工作区响应缺少订单列表。');
        return result;
      },
      async getQuotes(input, idempotencyKey) {
        const result = await request('POST', '/quotes', input, { 'Idempotency-Key': keyHeader(idempotencyKey) });
        if (!Array.isArray(result.quotes)) throw fail('INVALID_RESPONSE', '报价响应缺少 quotes 列表。');
        return result;
      },
      async createOrder(quoteId, idempotencyKey) {
        if (typeof quoteId !== 'string' || !quoteId) throw fail('QUOTE_REQUIRED', '请选择服务端返回的有效报价。');
        const result = await request('POST', '/orders', { quoteId, demoAcknowledged: true }, { 'Idempotency-Key': keyHeader(idempotencyKey) });
        if (!result.order || typeof result.order.id !== 'string') throw fail('INVALID_RESPONSE', '创建订单响应缺少订单标识。');
        return result;
      },
      uploadModel(bytes, filename, idempotencyKey) {
        if (!bytes || typeof bytes.byteLength !== 'number' || bytes.byteLength < 1) throw fail('MODEL_REQUIRED', '模型上传需要非空二进制数据。');
        if (typeof filename !== 'string' || !filename.trim()) throw fail('FILENAME_REQUIRED', '模型上传需要文件名。');
        return request('POST', '/models', bytes, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(filename), 'Idempotency-Key': keyHeader(idempotencyKey) });
      },
      customerAction(action, id, extra, idempotencyKey) {
        if (!['accept', 'dispute', 'cancel'].includes(action)) throw fail('CUSTOMER_ACTION_NOT_ALLOWED', '仅允许客户验收、争议或取消操作。');
        if (typeof id !== 'string' || !id) throw fail('ORDER_REQUIRED', '缺少订单标识。');
        return request('POST', '/actions', Object.assign({}, extra || {}, { action, id, demoAcknowledged: true }), { 'Idempotency-Key': keyHeader(idempotencyKey) });
      }
    });
  }
  function createFetchTransport(fetchImpl) {
    if (typeof fetchImpl !== 'function') throw fail('TRANSPORT_REQUIRED', '缺少 fetch 实现。');
    return async function (request) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), request.timeout || 15000) : null;
      try {
        const binary = request.headers['Content-Type'] === 'application/octet-stream';
        const response = await fetchImpl(request.url, { method: request.method, headers: request.headers,
          body: request.data === undefined ? undefined : binary ? request.data : JSON.stringify(request.data),
          credentials: 'omit', signal: controller ? controller.signal : undefined });
        return { status: response.status, data: await response.json().catch(() => null) };
      } finally { if (timer) clearTimeout(timer); }
    };
  }
  return Object.freeze({ createApiClient, createFetchTransport, normalizeApiBase });
});
