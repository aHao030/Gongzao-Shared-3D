import { getCapabilities, getInquiries, saveCapability, createInquiry, saveProposal, acceptInquiry } from './inquiries.mjs';
import { getCustomerProfile, saveCustomerProfile, requireShippingAddress } from './customer.mjs';
import { ACCOUNTING_CURRENCY, quoteMarketContext } from './market.mjs';
import { addQuoteEvidence } from './quote-evidence.mjs';
import { PRICING_VERSION, getPricingProfile, savePricingProfile, estimateBatch, estimateBatchPrice, settlementBreakdown } from './pricing.mjs';
import { CATALOG_VERSION, farms, materials, destinations, freshDevices, sampleModel } from './catalog.mjs';
import { findSliceEvidence } from './operations.mjs';

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
const reasonText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const money = cents => cents / 100;
const stamp = now => new Date(now).toISOString();
const event = (order, label, now) => order.events.push({ label, time: stamp(now), at: now, simulated: true });
const find = (list, id, code) => { const item = list.find(item => item.id === id); check(item, code, '记录不存在', 404); return item; };
const farmOf = id => farms.find(farm => farm.id === id);

export function createWorkspace({ now = Date.now() } = {}) {
  return { schemaVersion: 2, revision: 0, createdAt: now, updatedAt: now, mode: 'DEMO_SANDBOX', orders: [], devices: freshDevices(), quotes: [], models: [{ ...clone(sampleModel), createdAt: now }], idempotency: {} };
}
export function getPublicWorkspace(workspace) {
  return clone({ customerProfile: getCustomerProfile(workspace), revision: workspace.revision, orders: workspace.orders, devices: workspace.devices, inquiries: getInquiries(workspace).inquiries, models: workspace.models.map(({ blobKey, ...model }) => model) });
}
const managedProduction = (workspace, orderId) => workspace.operations?.productions?.find(production => production.orderId === orderId);
const productionOccupies = (workspace, deviceId) => workspace.operations?.productions?.some(production => production.deviceId === deviceId && !['CANCELLED','QC_PASSED','QC_FAILED'].includes(production.status));
function nextQueued(workspace, device) { return workspace.orders.find(order => order.farm === device.farm && order.productionState === 'QUEUED' && !managedProduction(workspace,order.id)); }
function project(order) {
  order.dispute = order.disputeState === 'OPEN';
  if (order.refundState === 'SIMULATED_REFUNDED') order.status = 'refunded';
  else if (order.refundState === 'REQUESTED') order.status = 'refund_pending';
  else if (order.productionState === 'CANCELLED') order.status = 'cancelled';
  else if (order.productionState === 'REVIEW_REQUIRED') order.status = 'review';
  else if (order.settlementState === 'SIMULATED_SETTLED') order.status = 'settled';
  else if (order.settlementState === 'REQUESTED') order.status = 'settling';
  else if (order.settlementState === 'FAILED') order.status = 'settlement_failed';
  else if (order.acceptanceState === 'ACCEPTED') order.status = 'accepted';
  else if (order.logisticsState === 'DELIVERED') order.status = 'delivered';
  else if (order.logisticsState === 'SHIPPED') order.status = 'shipped';
  else order.status = { QUEUED: 'queued', PRINTING: 'printing', WAITING_REMOVAL: 'awaiting_pickup', QC_FAILED: 'qc_failed', QC_PASSED: 'ready_to_ship' }[order.productionState];
  check(Boolean(order.status), 'INVALID_STATE', '订单状态不可展示');
}
function dispatchNext(workspace, device, now) {
  if (productionOccupies(workspace,device?.id)) return;
  if (device.state !== 'ready' || device.orderId) return;
  const order = nextQueued(workspace, device);
  device.blockedReason = null;
  if (!order) return;
  if (order.paymentState !== 'SIMULATED_FROZEN' || order.disputeState === 'OPEN' || order.refundState === 'REQUESTED' || order.refundState === 'SIMULATED_REFUNDED') { device.blockedReason = 'FUNDS_BLOCKED'; return; }
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
function validateConfiguration(payload, destination) {
  const config = { modelId: payload.modelId ?? 'sample-bracket', material: payload.material ?? 'PLA', quality: payload.quality ?? 'standard', qty: payload.qty ?? 1, unit: payload.unit ?? 'mm', destination };
  check(text(config.modelId) && own(materials, config.material) && ['standard', 'fine'].includes(config.quality) && ['mm', 'inch'].includes(config.unit) && own(destinations, config.destination), 'INVALID_CONFIGURATION', '模型、材料、层高、单位或地区无效', 400);
  check(Number.isInteger(config.qty) && config.qty >= 1 && config.qty <= 50, 'INVALID_QUANTITY', '数量必须为 1–50 的整数', 400);
  if (own(payload, 'destination')) check(payload.destination === destination, 'DESTINATION_MISMATCH', '收货地区已变化，请使用账号中保存的地址重新测算');
  return config;
}
async function makeQuotes(workspace, payload, now, idFactory) {
  const { address, addressRevision, destination } = requireShippingAddress(workspace);
  const addressFingerprint = await digest(address);
  const config = validateConfiguration(payload, destination), model = find(workspace.models, config.modelId, 'MODEL_NOT_FOUND');
  const geometry = modelTerms(model, config.unit);
  const reviewReasons = [];
  if (model.review || model.closed !== true || model.format !== 'stl') reviewReasons.push('MODEL_REVIEW');
  if (!materials[config.material].auto) reviewReasons.push('PROCESS_REVIEW');
  if (config.destination === 'other') reviewReasons.push('DESTINATION_REVIEW');
  if (geometry.dimensions.some(n => n > 250) || geometry.volume <= 0) reviewReasons.push('GEOMETRY_REVIEW');
  const batch = estimateBatch(geometry.dimensions, config.qty);
  if (!batch && !reviewReasons.includes('GEOMETRY_REVIEW')) reviewReasons.push('PLATE_LAYOUT_REVIEW');
  const quotes = [];
  for (const farm of farms) {
    const device = workspace.devices.find(d => d.farm === farm.id);
    const capability = workspace.manufacturingCapabilities ? getCapabilities(workspace).capabilities.find(c => c.farmId === farm.id && (!payload.capabilityId || c.id === payload.capabilityId) && c.enabled && c.materials.includes(config.material) && c.qualities.includes(config.quality) && (geometry.dimensions.length !== 3 || geometry.dimensions.every((n, i) => n <= c.maxDimensions[i]))) : null;
    const configuredReasons = workspace.manufacturingCapabilities ? !capability ? ['CAPABILITY_UNAVAILABLE'] : capability.quoteMode === 'MERCHANT_REVIEW' ? ['CAPABILITY_REVIEW'] : [] : [];
    const farmReviewReasons = [...reviewReasons, ...configuredReasons];
    const q = { quoteId: `Q-${idFactory()}`, version: CATALOG_VERSION, mode: 'DEMO_ONLY', farm: clone(farm), ...config, addressRevision, addressFingerprint, modelName: model.name, modelHash: model.sha256, modelVersion: model.version ?? 1, profileVersion: device.profileVersion, recipeVersion: device.recipeVersion, geometrySource: model.geometrySource ?? 'server-upload-parser', review: farmReviewReasons.length > 0, reviewReasons: farmReviewReasons, issuedAt: now, expiresAt: now + 900000, dimensions: geometry.dimensions, volume: geometry.volume };
    if (workspace.manufacturingCapabilities) Object.assign(q, { capabilityId: capability?.id ?? null, capabilityRevision: capability?.revision ?? null, capabilityUnavailable: !capability });
    Object.assign(q, quoteMarketContext(address, q.review), { currency: ACCOUNTING_CURRENCY, priceStatus: q.review ? 'REVIEW_REQUIRED' : 'SANDBOX_ESTIMATE', payable: false });
    if (q.review) Object.assign(q, { totalCents: 0, total: 0, days: [], weight: 0, hours: 0, productionHours: 0, queueHours: 0, transitDays: [], preparationDays: 0, materialCents: 0, machineCents: 0, finishingCents: 0, shippingCents: 0, serviceCents: 0, material: 0, machine: 0, finishing: 0, shipping: 0, service: 0 });
    else {
      let weight = geometry.volume * materials[config.material].density * (config.quality === 'fine' ? 1.1 : 1);
      const profile = getPricingProfile(workspace, farm.id);
      let economics = estimateBatchPrice({ profile: { ...profile, materialKey: config.material }, batch, singleWeightGrams: weight, quantity: config.qty, quality: config.quality });
      const sliced = findSliceEvidence(workspace,{modelId:model.id,modelHash:model.sha256,qty:config.qty,unit:config.unit,material:config.material,farmId:farm.id,quality:config.quality});
      let quotedBatch = batch;
      if (sliced) {
        const { job, economics: measured } = sliced, total = measured.suggestedManufacturingCents;
        const allocate = cents => measured.estimatedCostCents > 0 ? Number(BigInt(total)*BigInt(cents)/BigInt(measured.estimatedCostCents)) : 0;
        const saleMaterialCents = allocate(measured.costBreakdown.materialCents), saleMachineCents = allocate(measured.costBreakdown.machineCents+measured.costBreakdown.electricityCents);
        economics = {...measured,productionHours:measured.durationSeconds/3600,materialGrams:measured.materialGrams,manufacturingCents:total,saleMaterialCents,saleMachineCents,saleFinishingCents:total-saleMaterialCents-saleMachineCents,profitFloorCents:measured.minimumProfitCents,estimatedMarginBps:Number(BigInt(measured.estimatedProfitCents)*10000n/BigInt(total))};
        weight = measured.materialGrams/config.qty;
        quotedBatch = {...clone(batch),method:'SLICER_OUTPUT_ESTIMATE',plateCount:job.result.plateCount,verified:false,layoutVerified:false,partsPerPlate:null,capacityPerPlate:null};
        q.sliceEvidence = {jobId:job.id,inputHash:job.inputHash,modelHash:job.modelHash,profileId:job.profileId,profileRevision:job.profileRevision,profileSha256:job.result.profileSha256,artifactHash:job.result.artifactHash,engineVersion:job.result.engineVersion,provenance:'WORKER_OBSERVED'};
        q.estimateBasis='SLICER_OUTPUT';
      } else q.estimateBasis='DEMO_GEOMETRY_ESTIMATE';
      const { productionHours, manufacturingCents, saleMaterialCents: materialCents, saleMachineCents: machineCents, saleFinishingCents: finishingCents } = economics;
      const hours = productionHours / config.qty;
      const serviceCents = Math.ceil(manufacturingCents * 700 / 10000);
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
      const pricingSummary = { manufacturingCents, platformFeeCents: serviceCents, shippingCents, merchantReceivableCents: manufacturingCents + shippingCents, customerTotalCents: totalCents, averageUnitManufacturingCents: Math.round(manufacturingCents / config.qty) };
      Object.assign(q, { pricingVersion: PRICING_VERSION, pricingRevision: profile.revision, batch: clone(quotedBatch), pricingSummary, weight, hours, productionHours, queueHours, preparationDays, transitDays, days, materialCents, machineCents, finishingCents, shippingCents, serviceCents, totalCents, total: money(totalCents), material: money(materialCents), machine: money(machineCents), finishing: money(finishingCents), shipping: money(shippingCents), service: money(serviceCents) });
      // Costs and profit are owner-scoped merchant evidence, never quote/order fields.
      (workspace.pricingEvidence ??= {})[q.quoteId] = { ...economics, quoteId: q.quoteId, farmId: farm.id, modelName: model.name, quantity: config.qty, pricingRevision: profile.revision, issuedAt: now, mode: sliced?'SLICER_WITH_MERCHANT_COST_ASSUMPTIONS':'DEMO_ASSUMPTIONS', batch: clone(quotedBatch), pricingSummary: clone(pricingSummary), profileSnapshot: clone(profile) };

    }
    // q.material is a legacy UI sales amount allocation, not a private cost; preserve the selected material separately.
    q.materialKey = config.material;
    addQuoteEvidence(q, { model, device, orders: workspace.orders, now });
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
  check(payload.analysisVersion === undefined || text(payload.analysisVersion, 100), 'INVALID_MODEL_ANALYSIS', '模型分析版本无效', 400);
  check(payload.analysisNote === undefined || text(payload.analysisNote, 1000), 'INVALID_MODEL_ANALYSIS', '模型分析说明无效', 400);
  const model = { analysisVersion: payload.analysisVersion ?? 'legacy-unversioned', analysisNote: payload.analysisNote ?? '历史模型记录，分析器版本未记录', id, name: payload.name, size: payload.size, sha256: payload.sha256, dimensions: [...dimensions], volume, closed: payload.closed === true, review: reviewed, format: payload.format, version: 1, createdAt: now, isSample: false, geometrySource: 'server-upload-parser', unit: 'mm', faceCount: payload.faceCount ?? 0 };
  workspace.models.push(model); return { model };
}
async function createOrder(workspace, payload, now, idFactory, acceptedProposal = {}) {
  check(payload.demoAcknowledged === true, 'DEMO_ACK_REQUIRED', '请确认这是模拟订单');
  check(workspace.orders.length < 500, 'ORDER_CAPACITY', '演示订单最多保留 500 笔');
  check(text(payload.quoteId), 'INVALID_QUOTE_ID', '报价 ID 无效', 400);
  const quote = workspace.quotes.find(q => q.quoteId === payload.quoteId);
  check(quote, 'QUOTE_NOT_FOUND', '报价不存在，请重新获取', 404);
  check(!quote.inquiryId || (quote.inquiryId === acceptedProposal.acceptedInquiryId && quote.proposalRevision === acceptedProposal.acceptedProposalRevision), 'PROPOSAL_CONFIRMATION_REQUIRED', '请通过需求页面确认当前方案后下单');
  if (workspace.manufacturingCapabilities || quote.capabilityId) {
    const capability = getCapabilities(workspace).capabilities.find(c => c.id === quote.capabilityId);
    check(capability && !quote.capabilityUnavailable && capability.enabled, 'CAPABILITY_UNAVAILABLE', '制造能力已暂停或不匹配，请重新选择制造方案');
    check(capability.revision === quote.capabilityRevision && capability.materials.includes(quote.materialKey) && capability.qualities.includes(quote.quality), 'CAPABILITY_CHANGED', '制造能力配置已更新，请重新报价');
  }
  check(now < quote.expiresAt, 'QUOTE_EXPIRED', '报价已过期，请重新获取');
  check(!quote.usedByOrderId, 'QUOTE_USED', '该报价已创建订单，请获取新报价');
  const { fingerprint, usedByOrderId, ...terms } = quote;
  check(await digest(terms) === fingerprint, 'QUOTE_CHANGED', '报价快照校验失败');
  if (!quote.review) check(quote.pricingVersion === PRICING_VERSION && quote.pricingRevision === getPricingProfile(workspace, quote.farm.id).revision, 'PRICING_CHANGED', '商家计价配置已更新，请重新测算后下单');
  const { address, addressRevision } = requireShippingAddress(workspace);
  check(quote.addressRevision === addressRevision && quote.addressFingerprint === await digest(address), 'ADDRESS_CHANGED', '收货地址已更新，请重新测算费用后下单');
  const model = find(workspace.models, quote.modelId, 'MODEL_NOT_FOUND');
  check(model.sha256 === quote.modelHash && (model.version ?? 1) === quote.modelVersion, 'MODEL_CHANGED', '文件版本已变化，请重新报价');
  if(quote.sliceEvidence){
    const evidence=quote.sliceEvidence, currentProfile=workspace.operations?.profiles?.find(profile=>profile.id===evidence.profileId);
    check(currentProfile?.enabled && currentProfile.revision===evidence.profileRevision && (!currentProfile.expectedProfileSha256 || currentProfile.expectedProfileSha256===evidence.profileSha256), 'SLICE_PROFILE_CHANGED', '切片工艺已更新，请重新切片并测算费用');
  }
  const order = { id: `DEMO-${idFactory()}`, created: stamp(now), createdAt: now, farm: quote.farm.id, modelId: model.id, modelName: model.name, modelHash: model.sha256, material: quote.materialKey, qty: quote.qty, quality: quote.quality, unit: quote.unit, destination: quote.destination, shippingAddress: clone(address), addressRevision, totalCents: quote.totalCents, total: quote.total, quoteId: quote.quoteId, quoteSnapshot: { ...clone(quote), estimatedWeight: quote.weight * quote.qty }, productionState: quote.review ? 'REVIEW_REQUIRED' : 'QUEUED', paymentState: quote.review ? 'UNPAID' : 'SIMULATED_FROZEN', logisticsState: 'NONE', acceptanceState: 'PENDING', settlementState: 'NOT_REQUESTED', disputeState: 'NONE', refundState: 'NONE', status: '', dispute: false, events: [] };
  // Older valid v0.6 quotes lack a market snapshot; derive their context from
  // the verified stored address, never from an order's client-supplied fields.
  const marketContext = quote.market && quote.paymentContext ? { market: clone(quote.market), paymentContext: clone(quote.paymentContext) } : quoteMarketContext(address, quote.review);
  Object.assign(order, marketContext, { currency: ACCOUNTING_CURRENCY, priceStatus: quote.review ? 'REVIEW_REQUIRED' : 'SANDBOX_ESTIMATE', payable: false });
  if (!quote.review) order.settlementBreakdown = { ...clone(quote.pricingSummary), source: 'V0_6_QUOTE' };
  quote.usedByOrderId = order.id;
  event(order, quote.review ? '已提交演示工程询价，尚未付款' : '已创建演示订单，模拟付款已冻结（未真实收款）', now);
  project(order); workspace.orders.push(order);
  if (!quote.review) dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  return { order };
}
function act(workspace, payload, now, idFactory) {
  check(payload.demoAcknowledged === true, 'DEMO_ACK_REQUIRED', '请确认这是模拟操作');
  const action = payload.action;
  check(['reset', 'complete-print', 'prepare-device', 'set-device-paused', 'collect-and-qc', 'ship', 'deliver', 'accept', 'request-settlement', 'resolve-settlement', 'request-refund', 'resolve-refund', 'dispute', 'cancel'].includes(action), 'UNKNOWN_ACTION', '未知操作', 400);
  if (action === 'reset') {
    check(payload.confirm === 'RESET_DEMO', 'RESET_CONFIRMATION_REQUIRED', '重置需明确确认');
    check(!(workspace.operations?.jobs?.length || workspace.operations?.productions?.length), 'OPERATIONS_RESET_BLOCKED', '生产中心已有模型任务或库存台账，不能通过旧演示重置删除关联模型和订单');
    const fresh = createWorkspace({ now });
    // Preserve the request ledger so old mutation keys cannot replay after reset.
    Object.assign(workspace, { orders: fresh.orders, devices: fresh.devices, quotes: fresh.quotes, models: fresh.models, pricingEvidence: {}, inquiries: [], proposalEconomics: [] });
    return { reset: true };
  }
  check(text(payload.id), 'INVALID_RESOURCE_ID', '订单或设备 ID 无效', 400);
  if (['complete-print', 'prepare-device', 'set-device-paused'].includes(action)) {
    const device = find(workspace.devices, payload.id, 'DEVICE_NOT_FOUND');
    check(!productionOccupies(workspace,device.id), 'USE_PRODUCTION_CENTER', '此设备由生产中心管理，请在那里记录完工、取件与质检');
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
  const production = managedProduction(workspace,order.id);
  if (production && action === 'collect-and-qc') throw new PlatformError('USE_PRODUCTION_CENTER','此订单需在生产中心确认取件与质检');
  if (production && (action === 'cancel' || action === 'resolve-refund' && payload.approved === true))
    check(['CANCELLED','QC_FAILED','QC_PASSED'].includes(production.status), 'PRODUCTION_RESERVATION_ACTIVE', '请先在生产中心取消未开始任务或完成生产核对，释放库存预留后再处理取消或退款');
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
    check(order.productionState === 'QC_PASSED' && order.logisticsState === 'NONE' && order.paymentState === 'SIMULATED_FROZEN' && order.disputeState !== 'OPEN' && ['NONE', 'REJECTED'].includes(order.refundState), 'SHIPMENT_NOT_ALLOWED', '仅质检通过、款项冻结且无待处理退款或争议的未发货订单可以发货');
    check(text(payload.carrier, 80) && /^DEMO-[A-Za-z0-9-]{3,27}$/.test(payload.trackingNumber ?? ''), 'INVALID_TRACKING', '请输入承运商及 DEMO- 开头的演示运单', 400);
    order.courier = payload.carrier; order.tracking = payload.trackingNumber; order.logisticsState = 'SHIPPED'; event(order, '模拟承运商已揽收', now);
  } else if (action === 'deliver') {
    check(order.logisticsState === 'SHIPPED', 'DELIVERY_NOT_ALLOWED', '订单尚未发货或已送达');
    order.logisticsState = 'DELIVERED'; event(order, '模拟物流签收，等待客户验收', now);
  } else if (action === 'accept') {
    check(payload.customerAccepted === true, 'ACCEPTANCE_REQUIRED', '必须明确确认收货验收');
    check(order.productionState === 'QC_PASSED' && order.logisticsState === 'DELIVERED' && order.paymentState === 'SIMULATED_FROZEN' && order.acceptanceState === 'PENDING' && order.settlementState === 'NOT_REQUESTED' && order.disputeState === 'NONE' && ['NONE', 'REJECTED'].includes(order.refundState), 'SETTLEMENT_BLOCKED', '生产、交付、付款或争议条件尚不满足验收');
    order.acceptanceState = 'ACCEPTED'; order.acceptedAt = now; order.settlementState = 'READY';
    event(order, '客户已确认验收，款项仍冻结，等待模拟结算申请', now);
  } else if (action === 'request-settlement') {
    check(order.acceptanceState === 'ACCEPTED' && ['READY', 'FAILED'].includes(order.settlementState) && order.productionState === 'QC_PASSED' && order.logisticsState === 'DELIVERED' && order.paymentState === 'SIMULATED_FROZEN' && order.disputeState === 'NONE' && ['NONE', 'REJECTED'].includes(order.refundState), 'SETTLEMENT_BLOCKED', '须客户验收且没有待处理退款或争议，才可申请结算');
    const breakdown = settlementBreakdown(order);
    check(breakdown, 'LEGACY_SETTLEMENT_REVIEW_REQUIRED', '旧订单结算数据需要人工核验');
    order.settlementBreakdown = breakdown;
    order.settlementState = 'REQUESTED';
    if (order.settlementAttempt) (order.settlementHistory ??= []).push(clone(order.settlementAttempt));
    order.settlementAttempt = { id: `SET-${idFactory()}`, status: 'REQUESTED', amountCents: breakdown.merchantReceivableCents, amountBasis: breakdown.source, requestedAt: now, sequence: (order.settlementAttempt?.sequence ?? 0) + 1 };
    event(order, '模拟结算申请已提交，等待处理结果，尚未释放款项', now);
  } else if (action === 'resolve-settlement') {
    check(order.settlementState === 'REQUESTED' && order.settlementAttempt?.status === 'REQUESTED', 'SETTLEMENT_NOT_PENDING', '没有待处理的结算申请');
    check(payload.attemptId === order.settlementAttempt.id, 'SETTLEMENT_ATTEMPT_MISMATCH', '结算处理结果不属于当前申请');
    check(['succeeded', 'failed'].includes(payload.outcome), 'INVALID_SETTLEMENT_RESULT', '请选择模拟结算成功或失败', 400);
    check(order.acceptanceState === 'ACCEPTED' && order.productionState === 'QC_PASSED' && order.logisticsState === 'DELIVERED' && order.paymentState === 'SIMULATED_FROZEN' && order.disputeState === 'NONE' && ['NONE', 'REJECTED'].includes(order.refundState), 'SETTLEMENT_BLOCKED', '当前状态不允许完成结算');
    // A v0.5 in-flight gross amount is immutable historical evidence. It may
    // fail and be retried with a derived split, but cannot succeed as a net payout.
    if (!order.settlementBreakdown) check(payload.outcome === 'failed', 'LEGACY_SETTLEMENT_REVIEW_REQUIRED', '旧版申请包含客户总款，请先标记失败后重新申请商家分账');
    else {
      const breakdown = settlementBreakdown(order);
      check(order.settlementAttempt.amountCents === breakdown.merchantReceivableCents, 'SETTLEMENT_BLOCKED', '结算申请金额与商家应收不一致');
    }
    if (payload.outcome === 'failed') {
      check(reasonText(payload.reason), 'RESULT_REASON_REQUIRED', '请填写模拟失败原因（最多 500 字）', 400);
      order.settlementState = 'FAILED'; order.settlementAttempt.status = 'FAILED'; order.settlementAttempt.reason = payload.reason;
      event(order, '模拟结算失败，款项仍冻结，可修正后重新申请', now);
    } else {
      order.settlementState = 'SIMULATED_SETTLED'; order.paymentState = 'SIMULATED_RELEASED'; order.settlementAttempt.status = 'SIMULATED_SUCCEEDED'; order.settledAt = now;
      event(order, '模拟结算成功（未发生真实转账，也不代表银行到账）', now);
    }
    order.settlementAttempt.resolvedAt = now;
  } else if (action === 'request-refund') {
    check(order.paymentState === 'SIMULATED_FROZEN' && ['NOT_REQUESTED', 'READY', 'FAILED'].includes(order.settlementState) && ['NONE', 'REJECTED'].includes(order.refundState), 'REFUND_NOT_ALLOWED', '该订单不可申请退款，或已有资金操作待处理');
    check(reasonText(payload.reason), 'REFUND_REASON_REQUIRED', '请填写退款原因（最多 500 字）', 400);
    check(payload.amountCents === undefined || payload.amountCents === order.totalCents, 'PARTIAL_REFUND_UNSUPPORTED', '当前演示仅支持整单退款', 400);
    order.refundState = 'REQUESTED';
    if (order.refundRequest) (order.refundHistory ??= []).push(clone(order.refundRequest));
    order.refundRequest = { id: `REF-${idFactory()}`, status: 'REQUESTED', amountCents: order.totalCents, reason: payload.reason, requestedAt: now, sequence: (order.refundRequest?.sequence ?? 0) + 1 };
    event(order, '已申请整单模拟退款，暂停派发、发货与结算；运行中的设备不会自动停机', now);
    if (order.productionState === 'QUEUED') dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  } else if (action === 'resolve-refund') {
    check(order.refundState === 'REQUESTED' && order.refundRequest?.status === 'REQUESTED', 'REFUND_NOT_PENDING', '没有待处理的退款申请');
    check(payload.requestId === order.refundRequest.id, 'REFUND_REQUEST_MISMATCH', '退款处理结果不属于当前申请');
    check(typeof payload.approved === 'boolean', 'INVALID_REFUND_RESULT', '请选择批准或拒绝模拟退款', 400);
    check(order.paymentState === 'SIMULATED_FROZEN' && ['NOT_REQUESTED', 'READY', 'FAILED'].includes(order.settlementState) && order.refundRequest.amountCents === order.totalCents, 'REFUND_NOT_ALLOWED', '当前资金状态不允许处理退款');
    if (payload.approved) {
      check(!['PRINTING', 'WAITING_REMOVAL'].includes(order.productionState) && !workspace.devices.some(device => device.orderId === order.id), 'REFUND_PRODUCTION_OCCUPIED', '请先完成模拟打印并取件释放设备，再确认退款；申请退款不会自动停机');
      order.refundState = 'SIMULATED_REFUNDED'; order.paymentState = 'SIMULATED_REFUNDED'; order.refundRequest.status = 'SIMULATED_SUCCEEDED'; order.refundedAt = now;
      if (order.productionState === 'QUEUED') order.productionState = 'CANCELLED';
      // Retain acceptance and production evidence. A refund does not rewrite physical history.
      if (['READY', 'FAILED'].includes(order.settlementState)) order.settlementState = 'CANCELLED';
      event(order, '整单模拟退款已完成（未发生真实退款），该订单不可再发货或结算', now);
    } else {
      check(order.productionState !== 'CANCELLED', 'CANCELLATION_REFUND_REQUIRED', '已取消的已付款订单必须完成退款');
      check(reasonText(payload.reason), 'RESULT_REASON_REQUIRED', '请填写拒绝退款原因（最多 500 字）', 400);
      order.refundState = 'REJECTED'; order.refundRequest.status = 'REJECTED'; order.refundRequest.resolutionReason = payload.reason;
      event(order, '模拟退款申请被拒绝，可重新申请或继续履约；争议不会自动关闭', now);
    }
    order.refundRequest.resolvedAt = now;
    dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  } else if (action === 'dispute') {
    check(typeof payload.open === 'boolean', 'INVALID_INPUT', 'open 必须为布尔值', 400);
    check(order.paymentState === 'SIMULATED_FROZEN' && order.productionState !== 'CANCELLED' && ['NOT_REQUESTED', 'READY', 'FAILED'].includes(order.settlementState), 'DISPUTE_NOT_ALLOWED', '仅已付款且未提交结算的有效订单可以处理争议');
    check((order.disputeState === 'OPEN') !== payload.open, 'NO_STATE_CHANGE', '争议状态未变化');
    order.disputeState = payload.open ? 'OPEN' : 'NONE'; event(order, payload.open ? '已开启演示争议，暂停派发、发货与结算，运行中的设备不会自动停机' : '演示争议已撤销，其他待处理退款仍会阻止结算', now);
    if (order.productionState === 'QUEUED') dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  } else if (action === 'cancel') {
    check(['REVIEW_REQUIRED', 'QUEUED'].includes(order.productionState), 'CANCELLATION_NOT_ALLOWED', '已开始生产的订单不能直接取消');
    order.productionState = 'CANCELLED';
    if (order.paymentState === 'SIMULATED_FROZEN' && order.refundState !== 'REQUESTED') {
      order.refundState = 'REQUESTED';
      if (order.refundRequest) (order.refundHistory ??= []).push(clone(order.refundRequest));
      order.refundRequest = { id: `REF-${idFactory()}`, status: 'REQUESTED', amountCents: order.totalCents, reason: '客户取消未生产订单', requestedAt: now, sequence: (order.refundRequest?.sequence ?? 0) + 1 };
    }
    event(order, order.paymentState === 'SIMULATED_FROZEN' ? '未生产订单已取消，退款申请待模拟处理，尚未退回款项' : '未付款工程询价已取消', now);
    dispatchNext(workspace, workspace.devices.find(d => d.farm === order.farm), now);
  } else throw new PlatformError('UNKNOWN_ACTION', '未知操作', 400);
  project(order); return { order };
}

export async function applyCommand(original, command, { now = Date.now(), idFactory = () => crypto.randomUUID() } = {}) {
  check(command && typeof command === 'object' && !Array.isArray(command), 'INVALID_INPUT', '命令无效', 400);
  const { type, payload = {}, idempotencyKey } = command;
  check(['register-model', 'quote', 'order', 'action', 'customer-profile', 'pricing-profile', 'capability', 'inquiry', 'proposal', 'accept-inquiry'].includes(type), 'UNKNOWN_COMMAND', '未知命令', 400);
  check(text(idempotencyKey, 160), 'IDEMPOTENCY_REQUIRED', '写操作必须提供幂等标识', 400);
  check(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_INPUT', 'payload 必须为对象', 400);
  check(Number.isFinite(now) && now >= 0, 'INVALID_CLOCK', '服务端时间无效');
  if (['pricing-profile', 'capability', 'proposal'].includes(type)) check(original.merchant?.profile, 'MERCHANT_REQUIRED', '请先开通商家工作台', 403);
  const requestDigest = await digest({ type, payload });
  if (own(original.idempotency, idempotencyKey)) {
    const cached = original.idempotency[idempotencyKey];
    check(cached.digest === requestDigest, 'IDEMPOTENCY_CONFLICT', '同一幂等标识不能用于不同请求');
    return { workspace: original, result: clone(cached.result), replayed: true };
  }
  check(Object.keys(original.idempotency).length < 2000, 'IDEMPOTENCY_CAPACITY', '演示空间操作记录已达 2000 条，请创建新的演示空间');
  const workspace = clone(original);
  let result;
  if (type === 'capability') result = saveCapability(workspace, payload, now, idFactory);
  else if (type === 'inquiry') result = await createInquiry(workspace, payload, now, idFactory, makeQuotes);
  else if (type === 'proposal') result = await saveProposal(workspace, payload, now);
  else if (type === 'accept-inquiry') result = await acceptInquiry(workspace, payload, now, idFactory, createOrder);
  else if (type === 'pricing-profile') result = savePricingProfile(workspace, payload, now);
  else if (type === 'customer-profile') result = saveCustomerProfile(workspace, payload, now);
  else if (type === 'register-model') result = registerModel(workspace, payload, now, idFactory);
  else if (type === 'quote') result = await makeQuotes(workspace, payload, now, idFactory);
  else if (type === 'order') result = await createOrder(workspace, payload, now, idFactory);
  else if (type === 'action') result = act(workspace, payload, now, idFactory);
  else throw new PlatformError('UNKNOWN_COMMAND', '未知命令', 400);
  workspace.revision = original.revision + 1; workspace.updatedAt = now;
  result = { ...clone(result), mode: 'DEMO_ONLY', physicalCommandsSent: 0, moneyTransferred: 0 };
  // defineProperty safely supports even keys such as __proto__ in durable JSON.
  Object.defineProperty(workspace.idempotency, idempotencyKey, { value: { digest: requestDigest, result, at: now }, writable: true, enumerable: true, configurable: true });
  return { workspace, result: clone(result), replayed: false };
}
