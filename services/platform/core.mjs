import { CATALOG_VERSION, farms, materials, destinations, freshDevices, sampleModel } from './catalog.mjs';

export class PlatformError extends Error {
  constructor(code, message, status = 409) { super(message); this.name = 'PlatformError'; this.code = code; this.status = status; }
}
const check = (condition, code, message, status) => { if (!condition) throw new PlatformError(code, message, status); };
const clone = value => structuredClone(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const json = value => {
  if (Array.isArray(value)) return `[${value.map(json).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${json(value[key])}`).join(',')}}`;
  check(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'INVALID_INPUT', '请求必须由有效 JSON 值组成', 400);
  return JSON.stringify(value);
};
async function digest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : json(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
const text = (value, limit = 160) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
const money = cents => cents / 100;
const stamp = now => new Date(now).toISOString();
const event = (order, label, now) => order.events.push({ label, time: stamp(now), at: now, simulated: true });
const find = (list, id, code) => { const item = list.find(item => item.id === id); check(item, code, '记录不存在', 404); return item; };
const farmOf = id => farms.find(farm => farm.id === id);

export function createWorkspace({ now = Date.now() } = {}) {
  return { schemaVersion: 2, revision: 0, createdAt: now, updatedAt: now, mode: 'DEMO_SANDBOX', orders: [], devices: freshDevices(), quotes: [], models: [{ ...clone(sampleModel), createdAt: now }], idempotency: {} };
}
export function getPublicWorkspace(workspace) {
  return clone({ revision: workspace.revision, orders: workspace.orders, devices: workspace.devices, models: workspace.models.map(({ blobKey, ...model }) => model) });
}
function nextQueued(workspace, device) { return workspace.orders.find(order => order.farm === device.farm && order.productionState === 'QUEUED'); }
function project(order) {
  order.dispute = order.disputeState === 'OPEN';
  if (order.productionState === 'CANCELLED') order.status = 'cancelled';
  else if (order.productionState === 'REVIEW_REQUIRED') order.status = 'review';
  else if (order.settlementState === 'SIMULATED_SETTLED') order.status = 'settled';
  else if (order.logisticsState === 'DELIVERED') order.status = 'delivered';
  else if (order.logisticsState === 'SHIPPED') order.status = 'shipped';
  else order.status = { QUEUED: 'queued', PRINTING: 'printing', WAITING_REMOVAL: 'awaiting_pickup', QC_FAILED: 'qc_failed', QC_PASSED: 'ready_to_ship' }[order.productionState];
  check(Boolean(order.status), 'INVALID_STATE', '订单状态不可展示');
}
function dispatchNext(workspace, device, now) {
  if (device.state !== 'ready' || device.orderId) return;
  const order = nextQueued(workspace, device);
  device.blockedReason = null;
  if (!order) return;
  if (!device.bedClear || !device.materialReady) { device.blockedReason = 'READINESS_REQUIRED'; return; }
  if (device.loadedMaterial !== order.material) { device.blockedReason = 'MATERIAL_MISMATCH'; return; }
  if (device.profileVersion !== order.quoteSnapshot.profileVersion || device.recipeVersion !== order.quoteSnapshot.recipeVersion) { device.blockedReason = 'PROFILE_MISMATCH'; return; }
  device.state = 'printing'; device.orderId = order.id; device.bedClear = false;
  order.deviceId = device.id; order.productionState = 'PRINTING'; order.startedAt = now;
  event(order, '服务端模拟派发成功，材料匹配，开始模拟打印', now); project(order);
}
function readiness(payload) {
  check(payload.bedClear === true && payload.materialReady === true, 'READINESS_REQUIRED', '必须确认清台、设备无报警及材料余量充足');
  check(['PLA', 'PETG'].includes(payload.loadedMaterial), 'INVALID_MATERIAL', '备机材料仅支持 PLA / PETG', 400);
}
function modelTerms(model, unit) {
  const factor = unit === 'inch' ? 25.4 : 1;
  return { dimensions: model.dimensions.map(value => value * factor), volume: model.volume * factor ** 3 };
}
function validateConfiguration(payload) {
  const config = { modelId: payload.modelId ?? 'sample-bracket', material: payload.material ?? 'PLA', quality: payload.quality ?? 'standard', qty: payload.qty ?? 1, unit: payload.unit ?? 'mm', destination: payload.destination ?? 'east' };
  check(text(config.modelId) && own(materials, config.material) && ['standard', 'fine'].includes(config.quality) && ['mm', 'inch'].includes(config.unit) && own(destinations, config.destination), 'INVALID_CONFIGURATION', '模型、材料、层高、单位或地区无效', 400);
  check(Number.isInteger(config.qty) && config.qty >= 1 && config.qty <= 50, 'INVALID_QUANTITY', '数量必须为 1–50 的整数', 400);
  return config;
}
async function makeQuotes(workspace, payload, now, idFactory) {
  const config = validateConfiguration(payload), model = find(workspace.models, config.modelId, 'MODEL_NOT_FOUND');
  const geometry = modelTerms(model, config.unit);
  const reviewReasons = [];
  if (model.review || model.closed !== true || model.format !== 'stl') reviewReasons.push('MODEL_REVIEW');
  if (!materials[config.material].auto) reviewReasons.push('PROCESS_REVIEW');
  if (config.destination === 'other') reviewReasons.push('DESTINATION_REVIEW');
  if (geometry.dimensions.some(n => n > 250) || geometry.volume <= 0) reviewReasons.push('GEOMETRY_REVIEW');
  const quotes = [];
  for (const farm of farms) {
    const device = workspace.devices.find(d => d.farm === farm.id);
    const q = { quoteId: `Q-${idFactory()}`, version: CATALOG_VERSION, mode: 'DEMO_ONLY', farm: clone(farm), ...config, modelName: model.name, modelHash: model.sha256, modelVersion: model.version ?? 1, profileVersion: device.profileVersion, recipeVersion: device.recipeVersion, geometrySource: model.geometrySource ?? 'server-upload-parser', review: reviewReasons.length > 0, reviewReasons: [...reviewReasons], issuedAt: now, expiresAt: now + 900000, dimensions: geometry.dimensions, volume: geometry.volume };
    if (q.review) Object.assign(q, { totalCents: 0, total: 0, days: [...farm.days], weight: 0, hours: 0, productionHours: 0, queueHours: 0, transitDays: [], preparationDays: 0, materialCents: 0, machineCents: 0, finishingCents: 0, shippingCents: 0, serviceCents: 0, material: 0, machine: 0, finishing: 0, shipping: 0, service: 0 });
    else {
      const weight = geometry.volume * materials[config.material].density * (config.quality === 'fine' ? 1.1 : 1);
      const hours = Math.max(0.6, weight / 7) * (config.quality === 'fine' ? 1.55 : 1);
      const productionHours = hours * config.qty;
      const materialCents = Math.round(weight * materials[config.material].centsPerGram * config.qty * farm.multiplierBps / 10000);
      const machineCents = Math.round(hours * 700 * config.qty * farm.multiplierBps / 10000);
      const finishingCents = farm.baseCents + Math.max(0, config.qty - 1) * 200;
      const serviceCents = Math.round((materialCents + machineCents + finishingCents) * 700 / 10000);
      const sameRegion = config.destination === farm.origin;
      const shippingCents = farm.shippingCents + (sameRegion ? 0 : config.destination === 'north' ? 800 : 400);
      const transitDays = sameRegion ? [1, 2] : config.destination === 'north' ? [3, 5] : [2, 3];
      const queueHours = workspace.orders.filter(order => order.farm === farm.id && ['PRINTING', 'QUEUED'].includes(order.productionState)).reduce((sum, order) => sum + order.quoteSnapshot.productionHours, 0);
      const preparationDays = ['waiting', 'maintenance'].includes(device.state) || device.loadedMaterial !== config.material ? 1 : 0;
      const manufacturingDays = Math.max(1, Math.ceil((productionHours + queueHours) / 8));
      const handlingDays = Math.max(0, farm.days[0] - 2);
      const days = [handlingDays + manufacturingDays + preparationDays + transitDays[0], handlingDays + manufacturingDays + preparationDays + transitDays[1] + Math.max(1, farm.days[1] - farm.days[0] - 1)];
      const totalCents = materialCents + machineCents + finishingCents + serviceCents + shippingCents;
      check(Number.isSafeInteger(totalCents) && totalCents > 0, 'INVALID_PRICE', '报价超出有效范围');
      Object.assign(q, { weight, hours, productionHours, queueHours, preparationDays, transitDays, days, materialCents, machineCents, finishingCents, shippingCents, serviceCents, totalCents, total: money(totalCents), material: money(materialCents), machine: money(machineCents), finishing: money(finishingCents), shipping: money(shippingCents), service: money(serviceCents) });
    }
    // q.material is a legacy UI cost; preserve the selected material separately.
    q.materialKey = config.material;
    q.fingerprint = await digest(q);
    quotes.push(q);
  }
  check(workspace.quotes.length + quotes.length <= 6000, 'QUOTE_CAPACITY', '演示报价数量已达 6000 份上限');
  workspace.quotes.push(...quotes);
  return { quotes };
}
function registerModel(workspace, payload, now, idFactory) {
  // HTTP upload layer computes SHA-256 and geometry from actual bytes; do not expose
  // this command as an endpoint that accepts arbitrary browser metadata.
  check(text(payload.name, 180) && Number.isInteger(payload.size) && payload.size > 0 && payload.size <= 20 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(payload.sha256 ?? '') && ['stl', 'step', 'stp', '3mf', 'png', 'jpg', 'jpeg', 'webp'].includes(payload.format), 'INVALID_MODEL', '模型元数据无效', 400);
  if (['png', 'jpg', 'jpeg', 'webp'].includes(payload.format)) check(payload.review === true, 'IMAGE_REVIEW_REQUIRED', '图片必须进入工程审核，不能直接自动生产', 400);
  const id = payload.id ?? `M-${idFactory()}`;
  check(text(id), 'INVALID_MODEL', '模型 ID 无效', 400);
  const existing = workspace.models.find(model => model.id === id);
  if (existing) {
    check(existing.sha256 === payload.sha256 && existing.name === payload.name && existing.size === payload.size, 'MODEL_EXISTS', '该模型 ID 已绑定不同文件');
    return { model: existing };
  }
  check(workspace.models.length < 100, 'MODEL_CAPACITY', '演示模型最多保留 100 个');
  const dimensions = payload.dimensions ?? [], volume = payload.volume ?? 0;
  const reviewed = payload.review === true || payload.format !== 'stl' || payload.closed !== true;
  check(Array.isArray(dimensions) && (dimensions.length === 0 || (dimensions.length === 3 && dimensions.every(n => Number.isFinite(n) && n > 0 && n <= 100000))) && Number.isFinite(volume) && volume >= 0, 'INVALID_GEOMETRY', '模型几何无效', 400);
  if (!reviewed) check(dimensions.length === 3 && volume > 0 && volume <= dimensions.reduce((a, b) => a * b, 1) / 1000 * 1.01, 'INVALID_GEOMETRY', '实体体积与外形尺寸不一致', 400);
  check(payload.faceCount === undefined || (Number.isInteger(payload.faceCount) && payload.faceCount >= 0 && payload.faceCount <= 100000), 'INVALID_GEOMETRY', '三角面数量无效', 400);
  const model = { id, name: payload.name, size: payload.size, sha256: payload.sha256, dimensions: [...dimensions], volume, closed: payload.closed === true, review: reviewed, format: payload.format, version: 1, createdAt: now, isSample: false, geometrySource: 'server-upload-parser', unit: 'mm', faceCount: payload.faceCount ?? 0 };
  workspace.models.push(model); return { model };
}
async function createOrder(workspace, payload, now, idFactory) {
  check(payload.demoAcknowledged === true, 'DEMO_ACK_REQUIRED', '请确认这是模拟订单');
  check(workspace.orders.length < 500, 'ORDER_CAPACITY', '演示订单最多保留 500 笔');
  check(text(payload.quoteId), 'INVALID_QUOTE_ID', '报价 ID 无效', 400);
  const quote = workspace.quotes.find(q => q.quoteId === payload.quoteId);
  check(quote, 'QUOTE_NOT_FOUND', '报价不存在，请重新获取', 404);
  check(now < quote.expiresAt, 'QUOTE_EXPIRED', '报价已过期，请重新获取');
  check(!quote.usedByOrderId, 'QUOTE_USED', '该报价已创建订单，请获取新报价');
  const { fingerprint, usedByOrderId, ...terms } = quote;
  check(await digest(terms) === fingerprint, 'QUOTE_CHANGED', '报价快照校验失败');
  const model = find(workspace.models, quote.modelId, 'MODEL_NOT_FOUND');
  check(model.sha256 === quote.modelHash && (model.version ?? 1) === quote.modelVersion, 'MODEL_CHANGED', '文件版本已变化，请重新报价');
  const order = { id: `DEMO-${idFactory()}`, created: stamp(now), createdAt: now, farm: quote.farm.id, modelId: model.id, modelName: model.name, modelHash: model.sha256, material: quote.materialKey, qty: quote.qty, quality: quote.quality, unit: quote.unit, destination: quote.destination, totalCents: quote.totalCents, total: quote.total, quoteId: quote.quoteId, quoteSnapshot: { ...clone(quote), estimatedWeight: quote.weight * quote.qty }, productionState: quote.review ? 'REVIEW_REQUIRED' : 'QUEUED', paymentState: quote.review ? 'UNPAID' : 'SIMULATED_FROZEN', logisticsState: 'NONE', acceptanceState: 'PENDING', settlementState: 'NOT_REQUESTED', disputeState: 'NONE', refundState: 'NONE', status: '', dispute: false, events: [] };
  quote.usedByOrderId = order.id;
  event(order, quote.review ? '已提交演示工程询价，尚未付款' : '已创建演示订单，模拟付款已冻结（未真实收款）', now);
  project(order); workspace.orders.push(order);
  if (!quote.review) dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  return { order };
}
function act(workspace, payload, now) {
  check(payload.demoAcknowledged === true, 'DEMO_ACK_REQUIRED', '请确认这是模拟操作');
  const action = payload.action;
  check(['reset', 'complete-print', 'prepare-device', 'set-device-paused', 'collect-and-qc', 'ship', 'deliver', 'accept', 'dispute', 'cancel'].includes(action), 'UNKNOWN_ACTION', '未知操作', 400);
  if (action === 'reset') {
    check(payload.confirm === 'RESET_DEMO', 'RESET_CONFIRMATION_REQUIRED', '重置需明确确认');
    const fresh = createWorkspace({ now });
    // Preserve the request ledger so old mutation keys cannot replay after reset.
    Object.assign(workspace, { orders: fresh.orders, devices: fresh.devices, quotes: fresh.quotes, models: fresh.models });
    return { reset: true };
  }
  check(text(payload.id), 'INVALID_RESOURCE_ID', '订单或设备 ID 无效', 400);
  if (['complete-print', 'prepare-device', 'set-device-paused'].includes(action)) {
    const device = find(workspace.devices, payload.id, 'DEVICE_NOT_FOUND');
    if (action === 'complete-print') {
      check(device.state === 'printing' && device.orderId, 'DEVICE_NOT_PRINTING', '设备当前没有打印任务');
      const order = find(workspace.orders, device.orderId, 'ORDER_NOT_FOUND');
      check(order.productionState === 'PRINTING' && order.deviceId === device.id, 'DEVICE_OWNER_MISMATCH', '任务与设备占用不匹配');
      device.state = 'waiting'; order.productionState = 'WAITING_REMOVAL';
      event(order, '模拟打印完成，等待取件、清台与质检', now); project(order);
      return { order, device };
    }
    check(['ready', 'maintenance'].includes(device.state) && !device.orderId, 'DEVICE_OCCUPIED', '设备仍被生产任务占用');
    if (action === 'set-device-paused') {
      check(typeof payload.paused === 'boolean', 'INVALID_INPUT', 'paused 必须为布尔值', 400);
      check(payload.paused === true, 'READINESS_REQUIRED', '恢复接单请执行备机确认');
      device.state = 'maintenance'; device.bedClear = false; device.materialReady = false;
    } else {
      readiness(payload); device.state = 'ready'; device.loadedMaterial = payload.loadedMaterial;
      device.bedClear = true; device.materialReady = true; device.clearanceEpoch++; dispatchNext(workspace, device, now);
    }
    return { device, blockedReason: device.blockedReason ?? null };
  }
  const order = find(workspace.orders, payload.id, 'ORDER_NOT_FOUND');
  if (action === 'collect-and-qc') {
    check(order.productionState === 'WAITING_REMOVAL', 'COLLECTION_NOT_ALLOWED', '该订单不处于待取件状态');
    const device = find(workspace.devices, order.deviceId, 'DEVICE_NOT_FOUND');
    check(device.state === 'waiting' && device.orderId === order.id, 'DEVICE_OWNER_MISMATCH', '只能释放本任务当前占用的设备');
    check(payload.partRemoved === true && typeof payload.qcPassed === 'boolean', 'QC_EVIDENCE_REQUIRED', '必须确认取件并提交质检结果');
    readiness(payload);
    order.productionState = payload.qcPassed ? 'QC_PASSED' : 'QC_FAILED';
    event(order, payload.qcPassed ? '取件、清台及模拟质检通过' : '模拟质检失败，暂停交付与结算', now);
    device.state = 'ready'; device.orderId = null; device.loadedMaterial = payload.loadedMaterial; device.bedClear = true; device.materialReady = true; device.clearanceEpoch++;
    project(order); dispatchNext(workspace, device, now); return { order, device, blockedReason: device.blockedReason ?? null };
  }
  if (action === 'ship') {
    check(order.productionState === 'QC_PASSED' && order.logisticsState === 'NONE', 'SHIPMENT_NOT_ALLOWED', '仅质检通过且未发货的订单可以发货');
    check(text(payload.carrier, 80) && /^DEMO-[A-Za-z0-9-]{3,27}$/.test(payload.trackingNumber ?? ''), 'INVALID_TRACKING', '请输入承运商及 DEMO- 开头的演示运单', 400);
    order.courier = payload.carrier; order.tracking = payload.trackingNumber; order.logisticsState = 'SHIPPED'; event(order, '模拟承运商已揽收', now);
  } else if (action === 'deliver') {
    check(order.logisticsState === 'SHIPPED', 'DELIVERY_NOT_ALLOWED', '订单尚未发货或已送达');
    order.logisticsState = 'DELIVERED'; event(order, '模拟物流签收，等待客户验收', now);
  } else if (action === 'accept') {
    check(payload.customerAccepted === true, 'ACCEPTANCE_REQUIRED', '必须明确确认收货验收');
    check(order.productionState === 'QC_PASSED' && order.logisticsState === 'DELIVERED' && order.paymentState === 'SIMULATED_FROZEN' && order.acceptanceState === 'PENDING' && order.settlementState === 'NOT_REQUESTED' && order.disputeState === 'NONE' && order.refundState === 'NONE', 'SETTLEMENT_BLOCKED', '生产、交付、付款或争议条件尚不满足结算');
    order.acceptanceState = 'ACCEPTED'; order.settlementState = 'SIMULATED_SETTLED'; order.paymentState = 'SIMULATED_RELEASED';
    event(order, '模拟客户验收及结算完成（未发生真实转账）', now);
  } else if (action === 'dispute') {
    check(typeof payload.open === 'boolean', 'INVALID_INPUT', 'open 必须为布尔值', 400);
    check(order.logisticsState === 'DELIVERED' && order.settlementState === 'NOT_REQUESTED', 'DISPUTE_NOT_ALLOWED', '该演示仅支持签收后、结算前的争议');
    check((order.disputeState === 'OPEN') !== payload.open, 'NO_STATE_CHANGE', '争议状态未变化');
    order.disputeState = payload.open ? 'OPEN' : 'NONE'; event(order, payload.open ? '已开启演示争议，暂停结算' : '演示争议已撤销', now);
  } else if (action === 'cancel') {
    check(['REVIEW_REQUIRED', 'QUEUED'].includes(order.productionState), 'CANCELLATION_NOT_ALLOWED', '已开始生产的订单不能直接取消');
    order.productionState = 'CANCELLED';
    if (order.paymentState === 'SIMULATED_FROZEN') { order.refundState = 'SIMULATED_REFUNDED'; order.paymentState = 'SIMULATED_REFUNDED'; }
    event(order, '订单已取消，模拟已付款金额已退回（无真实交易）', now);
    dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  } else throw new PlatformError('UNKNOWN_ACTION', '未知操作', 400);
  project(order); return { order };
}

export async function applyCommand(original, command, { now = Date.now(), idFactory = () => crypto.randomUUID() } = {}) {
  check(command && typeof command === 'object' && !Array.isArray(command), 'INVALID_INPUT', '命令无效', 400);
  const { type, payload = {}, idempotencyKey } = command;
  check(['register-model', 'quote', 'order', 'action'].includes(type), 'UNKNOWN_COMMAND', '未知命令', 400);
  check(text(idempotencyKey, 160), 'IDEMPOTENCY_REQUIRED', '写操作必须提供幂等标识', 400);
  check(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_INPUT', 'payload 必须为对象', 400);
  check(Number.isFinite(now) && now >= 0, 'INVALID_CLOCK', '服务端时间无效');
  const requestDigest = await digest({ type, payload });
  if (own(original.idempotency, idempotencyKey)) {
    const cached = original.idempotency[idempotencyKey];
    check(cached.digest === requestDigest, 'IDEMPOTENCY_CONFLICT', '同一幂等标识不能用于不同请求');
    return { workspace: original, result: clone(cached.result), replayed: true };
  }
  check(Object.keys(original.idempotency).length < 2000, 'IDEMPOTENCY_CAPACITY', '演示空间操作记录已达 2000 条，请创建新的演示空间');
  const workspace = clone(original);
  let result;
  if (type === 'register-model') result = registerModel(workspace, payload, now, idFactory);
  else if (type === 'quote') result = await makeQuotes(workspace, payload, now, idFactory);
  else if (type === 'order') result = await createOrder(workspace, payload, now, idFactory);
  else if (type === 'action') result = act(workspace, payload, now);
  else throw new PlatformError('UNKNOWN_COMMAND', '未知命令', 400);
  workspace.revision = original.revision + 1; workspace.updatedAt = now;
  result = { ...clone(result), mode: 'DEMO_ONLY', physicalCommandsSent: 0, moneyTransferred: 0 };
  // defineProperty safely supports even keys such as __proto__ in durable JSON.
  Object.defineProperty(workspace.idempotency, idempotencyKey, { value: { digest: requestDigest, result, at: now }, writable: true, enumerable: true, configurable: true });
  return { workspace, result: clone(result), replayed: false };
}
