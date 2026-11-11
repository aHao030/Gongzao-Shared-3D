// Generated from apps/shared/api-client.js; run node apps/tools/sync-client.mjs.
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
  const addressKeys = ['recipient', 'phone', 'countryCode', 'province', 'city', 'district', 'addressLine', 'postalCode'];
  function validMarket(market) {
    const isText = value => typeof value === 'string' && value.length <= 1500;
    if (!market || typeof market !== 'object' || !/^(?:[A-Z]{2}|OTHER)$/.test(market.countryCode) || !isText(market.name) || !isText(market.phonePrefix)) return false;
    if (market.referenceCurrency !== null && !/^[A-Z]{3}$/.test(market.referenceCurrency)) return false;
    const address = market.address, payment = market.payment;
    if (!address || !address.fields || !Array.isArray(address.fieldOrder) || !isText(address.note) || new Set(address.fieldOrder).size !== address.fieldOrder.length) return false;
    if (!addressKeys.every(key => {
      const field = address.fields[key];
      return field && isText(field.label) && isText(field.placeholder) && typeof field.required === 'boolean' && typeof field.visible === 'boolean' && (!field.required || field.visible)
        && (field.visible === address.fieldOrder.includes(key));
    }) || address.fieldOrder.some(key => !addressKeys.includes(key))) return false;
    return !!payment && payment.countryCode === market.countryCode && payment.accountingCurrency === 'CNY' && payment.referenceCurrency === market.referenceCurrency
      && payment.exchangeRate === null && payment.livePaymentsEnabled === false && isText(payment.note) && Array.isArray(payment.methods)
      && payment.methods.every(method => method && isText(method.id) && isText(method.label) && method.status === 'NOT_CONFIGURED' && method.enabled === false);
  }
  function objectInput(value, code, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(code, message);
    return value;
  }
  function recordId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
  }
  function recordResponse(value, key) {
    const record = value && value[key];
    if (!record || typeof record !== 'object' || Array.isArray(record) || !recordId(record.id))
      throw fail('INVALID_RESPONSE', '服务端响应缺少有效的 ' + key + ' 记录。');
    return value;
  }
  function listResponse(value, key) {
    if (!value || !Array.isArray(value[key]) || !value[key].every(item => item && typeof item === 'object' && !Array.isArray(item) && recordId(item.id)))
      throw fail('INVALID_RESPONSE', '服务端响应缺少有效的 ' + key + ' 列表。');
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
        const error = fail(String(code), String(message), status);
        const fields = body.error && body.error.fieldErrors;
        if (path === '/customer/profile' && fields && typeof fields === 'object' && !Array.isArray(fields)) {
          error.fieldErrors = {};
          for (const field of ['displayName', ...addressKeys]) {
            if (typeof fields[field] === 'string' && fields[field].length > 0 && fields[field].length <= 300) error.fieldErrors[field] = fields[field];
          }
        }
        throw error;
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
      async getCustomerProfile() {
        const result = await request('GET', '/customer/profile');
        if (!Object.prototype.hasOwnProperty.call(result, 'profile') || (result.profile !== null && (typeof result.profile !== 'object' || Array.isArray(result.profile))))
          throw fail('INVALID_RESPONSE', '账号资料响应缺少有效 profile。');
        return result;
      },
      async saveCustomerProfile(input, idempotencyKey) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('PROFILE_REQUIRED', '请提供账号资料和收货地址。');
        const result = await request('POST', '/customer/profile', input, { 'Idempotency-Key': keyHeader(idempotencyKey) });
        if (!result.profile || typeof result.profile !== 'object' || Array.isArray(result.profile)) throw fail('INVALID_RESPONSE', '账号资料保存响应缺少 profile。');
        return result;
      },
      async getMarkets(countryCode) {
        if (countryCode !== undefined && (typeof countryCode !== 'string' || !/^(?:[A-Z]{2}|OTHER)$/.test(countryCode)))
          throw fail('INVALID_COUNTRY', '请选择国家或地区，或填写两位国家或地区代码。');
        const result = await request('GET', '/markets' + (countryCode === undefined ? '' : '?country=' + encodeURIComponent(countryCode)));
        if (result.schemaVersion !== 1 || result.accountingCurrency !== 'CNY') throw fail('INVALID_RESPONSE', '国家与地址配置版本不受支持。');
        const markets = countryCode === undefined ? result.markets : [result.market];
        if (!Array.isArray(markets) || !markets.length || !markets.every(validMarket) || new Set(markets.map(market => market.countryCode)).size !== markets.length)
          throw fail('INVALID_RESPONSE', '国家与地址配置不完整；请稍后重试。');
        if (countryCode !== undefined && result.market.countryCode !== countryCode) throw fail('INVALID_RESPONSE', '服务端返回的国家配置与请求不一致。');
        return result;
      },
      async getCapabilities() {
        return listResponse(await request('GET', '/capabilities'), 'capabilities');
      },
      async getMerchantCapabilities() {
        return listResponse(await request('GET', '/merchant/capabilities'), 'capabilities');
      },
      async saveCapability(input, idempotencyKey) {
        objectInput(input, 'CAPABILITY_REQUIRED', '请提供制造能力配置。');
        objectInput(input.capability, 'CAPABILITY_REQUIRED', '请提供制造能力配置。');
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)
          throw fail('REVISION_REQUIRED', '保存制造能力需要已读取的配置版本，新配置使用版本 0。');
        const result = await request('POST', '/merchant/capabilities', Object.assign({}, input, { demoAcknowledged: true }), { 'Idempotency-Key': keyHeader(idempotencyKey) });
        return recordResponse(result, 'capability');
      },
      async getInquiries() {
        return listResponse(await request('GET', '/inquiries'), 'inquiries');
      },
      async getMerchantInquiries() {
        return listResponse(await request('GET', '/merchant/inquiries'), 'inquiries');
      },
      async createInquiry(input, idempotencyKey) {
        objectInput(input, 'INQUIRY_REQUIRED', '请提供模型与定制需求。');
        if (!recordId(input.modelId) || !recordId(input.capabilityId))
          throw fail('MODEL_CAPABILITY_REQUIRED', '请选择已上传的模型和商家制造能力。');
        if (input.dimensionsConfirmed !== true) throw fail('DIMENSIONS_CONFIRMATION_REQUIRED', '请先确认模型尺寸与单位。');
        const result = await request('POST', '/inquiries', Object.assign({}, input, { demoAcknowledged: true }), { 'Idempotency-Key': keyHeader(idempotencyKey) });
        return recordResponse(result, 'inquiry');
      },
      async submitProposal(input, idempotencyKey) {
        objectInput(input, 'PROPOSAL_REQUIRED', '请提供确认后的制造方案。');
        if (!recordId(input.inquiryId)) throw fail('INQUIRY_REQUIRED', '请先选择客户询价。');
        if (!Number.isInteger(input.expectedInquiryRevision) || input.expectedInquiryRevision < 1)
          throw fail('REVISION_REQUIRED', '提交方案需要当前询价版本，请先重新查询。');
        const result = await request('POST', '/merchant/proposals', Object.assign({}, input, { demoAcknowledged: true }), { 'Idempotency-Key': keyHeader(idempotencyKey) });
        return recordResponse(result, 'inquiry');
      },
      async acceptProposal(input, idempotencyKey) {
        objectInput(input, 'PROPOSAL_REQUIRED', '请提供需要确认的方案。');
        if (!recordId(input.inquiryId)) throw fail('INQUIRY_REQUIRED', '请先选择客户询价。');
        if (!Number.isInteger(input.proposalRevision) || input.proposalRevision < 1)
          throw fail('REVISION_REQUIRED', '请选择要确认的具体方案版本。');
        if (input.customerAccepted !== true) throw fail('CUSTOMER_CONFIRMATION_REQUIRED', '客户需明确确认当前方案、费用和交期。');
        const result = await request('POST', '/inquiries/accept', Object.assign({}, input, { demoAcknowledged: true }), { 'Idempotency-Key': keyHeader(idempotencyKey) });
        recordResponse(result, 'inquiry');
        return recordResponse(result, 'order');
      },
      async getOperations() {
        const result = await request('GET', '/merchant/operations');
        if (result.schemaVersion !== 1 || !['spools', 'profiles', 'jobs', 'productions', 'models', 'orders', 'devices'].every(key => Array.isArray(result[key])))
          throw fail('INVALID_RESPONSE', '生产工作台响应不完整。');
        return result;
      },
      async operationsCommand(type, payload, idempotencyKey) {
        const allowed = ['save-spool', 'set-spool-cost', 'save-profile', 'queue-job', 'cancel-job', 'create-production', 'readiness', 'dispatch-production', 'finish-production', 'qc-production', 'cancel-production', 'reconcile-production', 'schedule'];
        if (!allowed.includes(type)) throw fail('OPERATIONS_COMMAND_NOT_ALLOWED', '此客户端不允许后台任务领取或回传。');
        objectInput(payload, 'OPERATIONS_PAYLOAD_REQUIRED', '请提供生产操作参数。');
        return request('POST', '/merchant/operations/commands', { type, payload }, { 'Idempotency-Key': keyHeader(idempotencyKey) });
      },
      async getIntegrationStatus() {
        const result = await request('GET', '/merchant/integrations');
        if (!Array.isArray(result.services)) throw fail('INVALID_RESPONSE', '服务连接响应缺少服务列表。');
        return result;
      },
      async probeIntegration(service, idempotencyKey) {
        if (!['spoolman', 'fdmMonster', 'obico', 'karrio', 'hyperswitch', 'moonraker', 'octoprint'].includes(service))
          throw fail('INTEGRATION_NOT_ALLOWED', '请选择平台支持的连接服务。');
        return request('POST', '/merchant/integrations/probe', { service }, { 'Idempotency-Key': keyHeader(idempotencyKey) });
      },
      async observeExternalSpools(idempotencyKey) {
        return request('POST', '/merchant/integrations/sync-spools', {}, { 'Idempotency-Key': keyHeader(idempotencyKey) });
      },
      async observeShipment(input, idempotencyKey) {
        objectInput(input, 'SHIPMENT_REQUIRED', '请提供承运商和运单。');
        if (!recordId(input.carrier) || !recordId(input.trackingNumber)) throw fail('SHIPMENT_REQUIRED', '请填写承运商标识和物流单号。');
        return request('POST', '/merchant/integrations/tracking', { carrier: input.carrier, trackingNumber: input.trackingNumber }, { 'Idempotency-Key': keyHeader(idempotencyKey) });
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
        if (!['accept', 'dispute', 'cancel', 'request-refund'].includes(action)) throw fail('CUSTOMER_ACTION_NOT_ALLOWED', '仅允许客户验收、争议、取消或申请退款。');
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
