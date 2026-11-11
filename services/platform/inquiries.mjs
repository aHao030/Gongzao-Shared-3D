import { ApiError, ensure, modelForPricing, scaledModelGeometry } from './geometry.mjs';
import { farms, materials } from './catalog.mjs';
import { requireShippingAddress } from './customer.mjs';
import { quoteMarketContext } from './market.mjs';
import { getPricingProfile, platformFeeForManufacturing, estimateBatch, estimateBatchPrice, estimatePartWeightGrams, PRICING_VERSION } from './pricing.mjs';
import { requireMerchant } from './merchant.mjs';
import { findSliceEvidence } from './operations.mjs';

const copy = value => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const cleanText = (value, max = 500) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const nonempty = (value, max = 120) => cleanText(value, max) && value.trim().length > 0;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
export async function termsDigest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(n => n.toString(16).padStart(2, '0')).join(''); }
const processMaterials = { FDM: ['PLA', 'PETG', 'ABS'], RESIN: ['RESIN'], METAL: ['ALUMINUM'], CNC: ['CNC'] };
const money = n => Number.isSafeInteger(n) && n >= 0 && n <= 100000000;
const ack = payload => ensure(payload.demoAcknowledged === true, 409, 'DEMO_ACK_REQUIRED', '请确认这是沙盒演示，不会执行真实付款或打印');
const required = (list, id, kind) => { const found = list.find(item => item.id === id); ensure(found, 404, kind + '_NOT_FOUND', '记录不存在'); return found; };
const snapshotModel = model => { const { blobKey, ...rest } = model; return copy(rest); };
const defaults = () => farms.map(farm => ({ id: 'cap-' + farm.id + '-standard', name: farm.name + ' · 标准 FDM', farmId: farm.id, process: 'FDM', materials: ['PLA', 'PETG'], maxDimensions: [240, 240, 250], qualities: ['standard', 'fine'], enabled: true, quoteMode: 'AUTO_ESTIMATE', deviceIds: [], note: '演示工艺能力，尚未验证真实设备生产能力', revision: 1, updatedAt: null, mode: 'DEMO_ONLY', hardwareVerified: false }));
export function getCapabilities(workspace, merchant = false) {
  if (merchant) requireMerchant(workspace);
  return { mode: 'DEMO_ONLY', capabilities: copy(workspace.manufacturingCapabilities ?? defaults()), realProduction: false };
}
function capabilityOf(workspace, id) { return required(getCapabilities(workspace).capabilities, id, 'CAPABILITY'); }
export function saveCapability(workspace, payload, now, idFactory) {
  requireMerchant(workspace); ack(payload);
  const input = payload.capability;
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_CAPABILITY', '请填写制造能力配置');
  const list = getCapabilities(workspace).capabilities;
  const previous = input.id ? required(list, input.id, 'CAPABILITY') : null;
  ensure(payload.expectedRevision === (previous?.revision ?? 0), 409, 'CAPABILITY_CHANGED', '配置已更新，请刷新后再保存');
  ensure(nonempty(input.name, 100) && farms.some(f => f.id === input.farmId) && own(processMaterials, input.process), 400, 'INVALID_CAPABILITY', '名称、演示产线或工艺无效');
  ensure(typeof input.enabled === 'boolean' && ['AUTO_ESTIMATE', 'MERCHANT_REVIEW'].includes(input.quoteMode), 400, 'INVALID_CAPABILITY', '接单状态或报价方式无效');
  ensure(Array.isArray(input.materials) && input.materials.length > 0 && input.materials.length <= 6 && new Set(input.materials).size === input.materials.length && input.materials.every(m => processMaterials[input.process].includes(m)), 400, 'INVALID_MATERIAL', '材料必须与工艺匹配');
  ensure(Array.isArray(input.maxDimensions) && input.maxDimensions.length === 3 && input.maxDimensions.every(n => Number.isFinite(n) && n > 0 && n <= 10000), 400, 'INVALID_DIMENSIONS', '成型尺寸必须是有效的毫米尺寸');
  ensure(Array.isArray(input.qualities) && input.qualities.length > 0 && input.qualities.length <= 2 && new Set(input.qualities).size === input.qualities.length && input.qualities.every(q => ['standard', 'fine'].includes(q)), 400, 'INVALID_QUALITY', '请选择支持的表面层高方案');
  // This is only an estimate policy. Neither a caller's verification fields nor
  // linking inventory can grant actual printing authorization.
  ensure(input.quoteMode !== 'AUTO_ESTIMATE' || input.process === 'FDM' && input.materials.every(m => ['PLA', 'PETG'].includes(m)), 400, 'AUTO_ESTIMATE_UNSUPPORTED', '自动估价目前仅支持 PLA / PETG 的 FDM 演示模板');
  const deviceIds = input.deviceIds ?? [];
  ensure(Array.isArray(deviceIds) && deviceIds.length <= 20 && new Set(deviceIds).size === deviceIds.length && deviceIds.every(id => workspace.merchant.devices.some(d => d.id === id)), 400, 'INVALID_DEVICE', '只能关联当前店铺已登记的设备');
  ensure(input.note === undefined || cleanText(input.note, 500), 400, 'INVALID_NOTE', '说明最多 500 字');
  ensure(previous || list.length < 50, 409, 'CAPABILITY_CAPACITY', '最多保存 50 个制造能力模板');
  const capability = { id: previous?.id ?? 'CAP-' + idFactory(), name: input.name.trim(), farmId: input.farmId, process: input.process, materials: [...input.materials], maxDimensions: [...input.maxDimensions], qualities: [...input.qualities], enabled: input.enabled, quoteMode: input.quoteMode, deviceIds: [...deviceIds], note: (input.note ?? '').trim(), revision: (previous?.revision ?? 0) + 1, updatedAt: now, mode: 'DEMO_ONLY', hardwareVerified: false };
  if (previous) list[list.findIndex(c => c.id === previous.id)] = capability; else list.push(capability);
  workspace.manufacturingCapabilities = list;
  return { capability, capabilities: copy(list) };
}
function compatible(capability, model, unit, material = 'AUTO') {
  ensure(capability.enabled, 409, 'CAPABILITY_DISABLED', '该制造能力已暂停接单，请选择其他方案');
  ensure(material === 'AUTO' || capability.materials.includes(material), 409, 'MATERIAL_UNSUPPORTED', '所选制造能力不支持该材料');
  const shape = scaledModelGeometry(model, unit);
  if (shape.dimensions.length === 3) {
    // Conservative axis-aligned envelope; no unverified rotation or nesting claims.
    ensure(shape.dimensions.every((n, i) => n <= capability.maxDimensions[i]), 409, 'CAPABILITY_SIZE_EXCEEDED', '模型尺寸超出所选能力范围，请选择更大的工艺模板或联系商家');
  }
  return shape;
}
function requirementsOf(payload, now) {
  const input = payload.requirements ?? {};
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_REQUIREMENTS', '需求内容无效');
  const result = {};
  for (const [key, max] of [['purpose', 300], ['color', 80], ['note', 1000]]) {
    ensure(input[key] === undefined || cleanText(input[key], max), 400, 'INVALID_REQUIREMENTS', '需求说明超出长度或包含无效字符');
    result[key] = (input[key] ?? '').trim();
  }
  const tolerance = input.toleranceMm;
  ensure(tolerance === undefined || tolerance === null || Number.isFinite(tolerance) && tolerance > 0 && tolerance <= 100, 400, 'INVALID_TOLERANCE', '尺寸公差需为 0–100 毫米之间的正数');
  result.toleranceMm = tolerance ?? null;
  const requested = input.requestedDeliveryDate ?? '';
  const day = new Date(now).toISOString().slice(0, 10);
  ensure(requested === '' || typeof requested === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requested) && Number.isFinite(Date.parse(requested)) && new Date(requested).toISOString().slice(0, 10) === requested && requested >= day && Date.parse(requested) <= now + 2 * 366 * 86400000, 400, 'INVALID_DELIVERY_DATE', '期望收货日期需为未来两年内的有效日期');
  result.requestedDeliveryDate = requested;
  return result;
}
export function getInquiries(workspace, merchant = false) {
  if (merchant) requireMerchant(workspace);
  const result = { mode: 'DEMO_ONLY', inquiries: copy(workspace.inquiries ?? []), realPayments: false, realProduction: false };
  for (const inquiry of result.inquiries) {
    if (inquiry.status !== 'AWAITING_CUSTOMER') continue;
    const current = inquiry.proposals.find(proposal => proposal.revision === inquiry.currentProposalRevision);
    if (current?.status === 'ACTIVE' && current.pricingVersion !== PRICING_VERSION) {
      current.requoteReason = '计价规则已更新。请商家重新报价，或在创作页重新提交需求。';
    }
  }
  if (merchant) result.proposalEconomics = copy(workspace.proposalEconomics ?? []);
  return result;
}
function proposalBase(inquiry, capability, model, addressState, profile, now, revision) {
  return { revision, status: 'ACTIVE', process: capability.process, capabilitySnapshot: copy(capability), modelHash: model.sha256, modelVersion: model.version ?? 1, capabilityId: capability.id, capabilityRevision: capability.revision, pricingVersion: PRICING_VERSION, pricingRevision: profile.revision, addressRevision: addressState.addressRevision, shippingAddress: copy(addressState.address), createdAt: now, expiresAt: now + 900000, mode: 'DEMO_ONLY', payable: false, currency: 'CNY' };
}
function summarizePrice(manufacturingCents, shippingCents, quantity) {
  const platformFeeCents = platformFeeForManufacturing(manufacturingCents);
  const totalCents = manufacturingCents + shippingCents + platformFeeCents;
  ensure([manufacturingCents, shippingCents, platformFeeCents, totalCents].every(money) && manufacturingCents > 0, 400, 'INVALID_PRICE', '价格超出有效范围');
  return { manufacturingCents, shippingCents, platformFeeCents, totalCents, merchantReceivableCents: manufacturingCents + shippingCents, customerTotalCents: totalCents, averageUnitManufacturingCents: Math.round(manufacturingCents / quantity) };
}
function range(value, label) {
  ensure(Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 0 && n <= 365) && value[1] >= value[0], 400, 'INVALID_LEAD_TIME', label + '需为 0–365 天之间递增的整数区间');
  return [...value];
}
function evidenceFor(workspace, inquiry, material, quality, hours, manualCost) {
  const capability = inquiry.capabilitySnapshot, profile = getPricingProfile(workspace, capability.farmId);
  const model = modelForPricing(required(workspace.models, inquiry.modelId, 'MODEL'));
  const shape = scaledModelGeometry(model, inquiry.unit), batch = estimateBatch(shape.dimensions, inquiry.qty, capability.maxDimensions);
  const sliced = findSliceEvidence(workspace, { modelId: model.id, modelHash: model.sha256, modelVersion: model.version ?? 1, qty: inquiry.qty, unit: inquiry.unit, material, farmId: capability.farmId, quality, deviceIds: capability.deviceIds });
  let estimatedCostCents = manualCost, source = 'MERCHANT_COST_DECLARATION';
  if (sliced) {
    estimatedCostCents = Math.max(estimatedCostCents, sliced.economics.estimatedCostCents);
    hours = Math.max(hours, sliced.economics.durationSeconds / 3600);
    source = 'MERCHANT_WITH_SLICE_FLOOR';
  } else if (['PLA', 'PETG'].includes(material) && model.format === 'stl' && model.closed === true && !model.review && batch && shape.volume > 0) {
    const baseline = estimateBatchPrice({ profile: { ...profile, materialKey: material }, batch, singleWeightGrams: estimatePartWeightGrams(shape.volume, material, quality), quantity: inquiry.qty, quality });
    estimatedCostCents = Math.max(estimatedCostCents, baseline.estimatedCostCents);
    hours = Math.max(hours, baseline.productionHours);
    source = 'MERCHANT_WITH_ESTIMATE_FLOOR';
  }
  const profitFloorCents = Math.max(profile.minimumOrderProfitCents, Math.ceil(hours * profile.minimumProfitCentsPerMachineHour));
  const minimumManufacturingCents = Math.max(Math.ceil(estimatedCostCents * 10000 / (10000 - profile.targetMarginBps)), estimatedCostCents + profitFloorCents, 1);
  return { estimatedCostCents, profitFloorCents, minimumManufacturingCents, targetMarginBps: profile.targetMarginBps, minimumOrderProfitCents: profile.minimumOrderProfitCents, minimumProfitCentsPerMachineHour: profile.minimumProfitCentsPerMachineHour, pricingRevision: profile.revision, productionHoursForFloor: hours, source, ...(sliced ? { sliceEvidence: sliced.evidence } : {}), mode: 'DEMO_ASSUMPTIONS' };
}
export async function createInquiry(workspace, payload, now, idFactory, makeQuotes) {
  ack(payload);
  ensure(nonempty(payload.modelId) && ['mm', 'inch'].includes(payload.unit) && Number.isInteger(payload.qty) && payload.qty >= 1 && payload.qty <= 50, 400, 'INVALID_INQUIRY', '请选择模型、单位和 1–50 件的数量');
  ensure(payload.dimensionsConfirmed === true, 409, 'DIMENSIONS_CONFIRMATION_REQUIRED', '请确认模型单位和尺寸');
  ensure(payload.material === 'AUTO' || own(materials, payload.material), 400, 'INVALID_MATERIAL', '请选择材料或让商家推荐');
  const model = modelForPricing(required(workspace.models, payload.modelId, 'MODEL')), capability = capabilityOf(workspace, payload.capabilityId);
  const normalizedGeometry = compatible(capability, model, payload.unit, payload.material);
  const requirements = requirementsOf(payload, now), addressState = requireShippingAddress(workspace);
  const list = workspace.inquiries ??= [];
  ensure(list.length < 500, 409, 'INQUIRY_CAPACITY', '沙盒最多保存 500 份需求');
  const inquiry = { id: 'INQ-' + idFactory(), revision: 1, status: 'AWAITING_MERCHANT', createdAt: now, updatedAt: now, modelId: model.id, modelSnapshot: snapshotModel(model), dimensionsMm: [...normalizedGeometry.dimensions], volumeCm3: normalizedGeometry.volume, capabilityId: capability.id, capabilitySnapshot: copy(capability), unit: payload.unit, qty: payload.qty, material: payload.material, requirements, dimensionsConfirmed: true, proposals: [], currentProposalRevision: null, orderId: null, mode: 'DEMO_ONLY' };
  list.push(inquiry);
  const standard = !model.review && capability.quoteMode === 'AUTO_ESTIMATE' && capability.process === 'FDM' && ['PLA', 'PETG'].includes(payload.material) && capability.qualities.includes('standard') && !Object.values(requirements).some(Boolean);
  if (standard) {
    const { quotes } = await makeQuotes(workspace, { modelId: model.id, material: payload.material, qty: payload.qty, unit: payload.unit, quality: 'standard', capabilityId: capability.id }, now, idFactory);
    const quote = quotes.find(q => q.farm.id === capability.farmId);
    if (quote && !quote.review) {
      const profile = getPricingProfile(workspace, capability.farmId);
      const dispatchDays = [Math.max(0, quote.days[0] - quote.transitDays[0]), Math.max(0, quote.days[1] - quote.transitDays[1])];
      const proposal = { ...proposalBase(inquiry, capability, model, addressState, profile, now, 1), source: 'AUTO_ESTIMATE', material: payload.material, quality: 'standard', ...summarizePrice(quote.pricingSummary.manufacturingCents, quote.shippingCents, inquiry.qty), productionHours: quote.productionHours, dispatchDays, transitDays: [...quote.transitDays], arrivalDays: [...quote.days], note: quote.sliceEvidence ? '按当前模型与工艺的切片结果估价，尚需实机核验。' : '按模型尺寸与演示工艺估价，尚未切片或核验设备。', quoteId: quote.quoteId };
      proposal.addressFingerprint = await termsDigest(addressState.address);
      quote.inquiryId = inquiry.id; quote.proposalRevision = 1; quote.capabilityId = capability.id; quote.capabilityRevision = capability.revision;
      const { fingerprint, ...terms } = quote; quote.fingerprint = await termsDigest(terms);
      // makeQuotes returns the actual stored records; the reference must stay protected.
      inquiry.proposals.push(proposal); inquiry.currentProposalRevision = 1; inquiry.status = 'AWAITING_CUSTOMER';
      const original = workspace.pricingEvidence?.[quote.quoteId];
      if (original) (workspace.proposalEconomics ??= []).push({ inquiryId: inquiry.id, proposalRevision: 1, ...copy(original) });
    }
  }
  return { inquiry: copy(inquiry) };
}
export async function saveProposal(workspace, payload, now) {
  requireMerchant(workspace); ack(payload);
  const inquiry = required(workspace.inquiries ?? [], payload.inquiryId, 'INQUIRY');
  ensure(inquiry.status !== 'ORDERED' && !inquiry.orderId, 409, 'INQUIRY_ALREADY_ORDERED', '已确认付款的方案不可修改，请按退款或新需求流程处理');
  ensure(payload.expectedInquiryRevision === inquiry.revision, 409, 'INQUIRY_CHANGED', '需求或报价已更新，请刷新后重新提交');
  const capability = capabilityOf(workspace, inquiry.capabilityId), model = required(workspace.models, inquiry.modelId, 'MODEL');
  ensure(model.sha256 === inquiry.modelSnapshot.sha256 && (model.version ?? 1) === (inquiry.modelSnapshot.version ?? 1), 409, 'MODEL_CHANGED', '模型已变化，请客户重新提交需求');
  ensure(own(materials, payload.material) && capability.qualities.includes(payload.quality), 400, 'INVALID_CONFIGURATION', '材料或层高方案无效');
  compatible(capability, model, inquiry.unit, payload.material);
  ensure(money(payload.manufacturingCents) && payload.manufacturingCents > 0 && money(payload.shippingCents) && money(payload.estimatedCostCents) && payload.estimatedCostCents > 0, 400, 'INVALID_PRICE', '请填写有效的制造价、运费与预计成本（分）');
  ensure(Number.isFinite(payload.productionHours) && payload.productionHours > 0 && payload.productionHours <= 8760, 400, 'INVALID_PRODUCTION_HOURS', '预计制造工时必须大于 0 且不超过一年');
  ensure(nonempty(payload.note, 1000), 400, 'PROPOSAL_NOTE_REQUIRED', '请说明材料、制造方案及注意事项（最多 1000 字）');
  const dispatchDays = range(payload.dispatchDays, '发货时间'), transitDays = range(payload.transitDays, '运输时间');
  ensure(dispatchDays[1] * 24 >= payload.productionHours, 400, 'INVALID_LEAD_TIME', '最晚发货时间不能短于预计制造工时');
  inquiry.capabilitySnapshot = copy(capability);
  const economics = evidenceFor(workspace, inquiry, payload.material, payload.quality, payload.productionHours, payload.estimatedCostCents);
  ensure(dispatchDays[0] >= Math.floor(economics.productionHoursForFloor / 24), 400, 'INVALID_LEAD_TIME', '最早发货日期早于制造所需的完整天数，请调整交付计划');
  ensure(dispatchDays[1] * 24 >= economics.productionHoursForFloor, 400, 'INVALID_LEAD_TIME', '发货时间不能短于当前模板测算的制造工时，请调整交付计划或更新计价模板');
  ensure(payload.manufacturingCents >= economics.minimumManufacturingCents, 409, 'PROFIT_FLOOR_NOT_MET', '制造报价低于当前成本、目标毛利率或最低利润限制；最低制造报价为 ¥' + (economics.minimumManufacturingCents / 100).toFixed(2));
  const profile = getPricingProfile(workspace, capability.farmId), addressState = requireShippingAddress(workspace), revision = (inquiry.currentProposalRevision ?? 0) + 1;
  const proposal = { ...proposalBase(inquiry, capability, model, addressState, profile, now, revision), source: 'MERCHANT_REVIEW', ...(economics.sliceEvidence ? { sliceEvidence: copy(economics.sliceEvidence) } : {}), material: payload.material, quality: payload.quality, ...summarizePrice(payload.manufacturingCents, payload.shippingCents, inquiry.qty), productionHours: economics.productionHoursForFloor, dispatchDays, transitDays, arrivalDays: dispatchDays.map((n, i) => n + transitDays[i]), note: payload.note.trim() };
  proposal.addressFingerprint = await termsDigest(addressState.address);
  for (const old of inquiry.proposals) if (old.status === 'ACTIVE') old.status = 'SUPERSEDED';
  inquiry.proposals.push(proposal); inquiry.currentProposalRevision = revision; inquiry.revision++; inquiry.updatedAt = now; inquiry.status = 'AWAITING_CUSTOMER';
  (workspace.proposalEconomics ??= []).push({ inquiryId: inquiry.id, proposalRevision: revision, ...economics, estimatedProfitCents: payload.manufacturingCents - economics.estimatedCostCents });
  return { inquiry: copy(inquiry), proposal: copy(proposal) };
}
export async function acceptInquiry(workspace, payload, now, idFactory, createOrder) {
  ack(payload);
  ensure(payload.customerAccepted === true, 409, 'CUSTOMER_ACCEPTANCE_REQUIRED', '请确认制造方案、价格和交付时间后继续');
  const inquiry = required(workspace.inquiries ?? [], payload.inquiryId, 'INQUIRY');
  ensure(inquiry.status !== 'ORDERED' && !inquiry.orderId, 409, 'INQUIRY_ALREADY_ORDERED', '该需求已生成订单');
  ensure(Number.isInteger(payload.proposalRevision) && payload.proposalRevision === inquiry.currentProposalRevision, 409, 'PROPOSAL_CHANGED', '报价方案已更新，请阅读并确认最新版本');
  const proposal = inquiry.proposals.find(p => p.revision === payload.proposalRevision);
  ensure(proposal?.status === 'ACTIVE', 409, 'PROPOSAL_CHANGED', '当前方案不可确认');
  ensure(proposal.pricingVersion === PRICING_VERSION, 409, 'PRICING_CHANGED', '计价规则已更新，请商家重新报价，或在创作页重新提交需求');
  ensure(now < proposal.expiresAt, 409, 'PROPOSAL_EXPIRED', '方案已过期，请商家重新报价');
  const capability = capabilityOf(workspace, inquiry.capabilityId), model = required(workspace.models, inquiry.modelId, 'MODEL');
  compatible(capability, model, inquiry.unit, proposal.material);
  ensure(capability.revision === proposal.capabilityRevision, 409, 'CAPABILITY_CHANGED', '商家制造能力已调整，请重新报价');
  ensure(model.sha256 === proposal.modelHash && (model.version ?? 1) === proposal.modelVersion, 409, 'MODEL_CHANGED', '模型已变化，请重新提交需求');
  const profile = getPricingProfile(workspace, capability.farmId);
  ensure(profile.revision === proposal.pricingRevision, 409, 'PRICING_CHANGED', '商家成本或利润规则已调整，请重新报价');
  const addressState = requireShippingAddress(workspace);
  ensure(addressState.addressRevision === proposal.addressRevision && await termsDigest(addressState.address) === proposal.addressFingerprint, 409, 'ADDRESS_CHANGED', '收货地址已变化，请商家重新确认运费和交付时间');
  let quoteId = proposal.quoteId;
  if (proposal.source === 'MERCHANT_REVIEW') {
    ensure(workspace.quotes.length < 6000, 409, 'QUOTE_CAPACITY', '演示报价数量已达上限');
    const farm = farms.find(f => f.id === capability.farmId), device = workspace.devices.find(d => d.farm === farm.id), shape = scaledModelGeometry(model, inquiry.unit);
    const quote = { quoteId: 'Q-' + idFactory(), version: 'coforge-proposal-v8', mode: 'DEMO_ONLY', farm: copy(farm), modelId: model.id, modelName: model.name, modelHash: model.sha256, modelVersion: model.version ?? 1, materialKey: proposal.material, material: 0, machine: proposal.manufacturingCents / 100, finishing: 0, shipping: proposal.shippingCents / 100, service: proposal.platformFeeCents / 100, materialCents: 0, machineCents: proposal.manufacturingCents, finishingCents: 0, shippingCents: proposal.shippingCents, serviceCents: proposal.platformFeeCents, totalCents: proposal.totalCents, total: proposal.totalCents / 100, qty: inquiry.qty, quality: proposal.quality, unit: inquiry.unit, destination: addressState.destination, addressRevision: proposal.addressRevision, addressFingerprint: proposal.addressFingerprint, profileVersion: device?.profileVersion ?? 'UNVERIFIED', recipeVersion: device?.recipeVersion ?? 'UNVERIFIED', review: true, reviewReasons: ['PRODUCTION_VALIDATION_REQUIRED'], issuedAt: now, expiresAt: proposal.expiresAt, dimensions: shape.dimensions, volume: shape.volume, weight: 0, hours: proposal.productionHours / inquiry.qty, productionHours: proposal.productionHours, queueHours: 0, preparationDays: 0, transitDays: copy(proposal.transitDays), days: copy(proposal.arrivalDays), pricingVersion: PRICING_VERSION, pricingRevision: proposal.pricingRevision, pricingSummary: summarizePrice(proposal.manufacturingCents, proposal.shippingCents, inquiry.qty), inquiryId: inquiry.id, proposalRevision: proposal.revision, capabilityId: capability.id, capabilityRevision: capability.revision, ...quoteMarketContext(addressState.address, true), priceStatus: 'MERCHANT_SANDBOX_OFFER', payable: false, currency: 'CNY' };
    if (proposal.sliceEvidence) quote.sliceEvidence = copy(proposal.sliceEvidence);
    quote.fingerprint = await termsDigest(quote); workspace.quotes.push(quote); quoteId = quote.quoteId;
  }
  const result = await createOrder(workspace, { quoteId, demoAcknowledged: true }, now, idFactory, { acceptedInquiryId: inquiry.id, acceptedProposalRevision: proposal.revision });
  const order = result.order;
  order.inquiryId = inquiry.id; order.approvedPlan = true; order.proposalSnapshot = copy(proposal); order.requirementsSnapshot = copy(inquiry.requirements); order.capabilitySnapshot = copy(capability);
  order.proposalSnapshot.status = 'ACCEPTED'; order.paymentState = 'SIMULATED_FROZEN'; order.priceStatus = proposal.source === 'AUTO_ESTIMATE' ? 'SANDBOX_ESTIMATE' : 'MERCHANT_SANDBOX_OFFER';
  order.settlementBreakdown = { ...summarizePrice(proposal.manufacturingCents, proposal.shippingCents, inquiry.qty), source: 'V0_8_PROPOSAL' };
  if (proposal.source === 'MERCHANT_REVIEW') order.events.push({ label: '客户已确认制造方案，模拟款项已冻结；等待生产核验，尚未下发设备', time: new Date(now).toISOString(), at: now, simulated: true });
  proposal.status = 'ACCEPTED'; inquiry.status = 'ORDERED'; inquiry.orderId = order.id; inquiry.revision++; inquiry.updatedAt = now; inquiry.acceptedAt = now;
  return { inquiry: copy(inquiry), order };
}
