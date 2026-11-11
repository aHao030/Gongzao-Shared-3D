import { farms } from './catalog.mjs';
import { ensure } from './geometry.mjs';

export const PRICING_VERSION = 'batch-margin-sandbox-v1';
const copy = value => structuredClone(value);
const ceil = n => Math.ceil(n);
const safeMoney = n => Number.isSafeInteger(n) && n >= 0;
// Integer ratios keep cent rounding and displayed basis points exact even near
// configured upper bounds, where multiplying cents in Number could lose bits.
const ratioFloor = (n, multiplier, denominator) => Number(BigInt(n) * BigInt(multiplier) / BigInt(denominator));
const ratioCeil = (n, multiplier, denominator) => Number((BigInt(n) * BigInt(multiplier) + BigInt(denominator) - 1n) / BigInt(denominator));
const fieldRules = {
  machineCostCentsPerHour: [0, 100000, true],
  estimatedThroughputGramsPerHour: [0.1, 1000, false],
  warmupMinutesPerPlate: [0, 120, false],
  electricityCentsPerKwh: [0, 10000, true],
  averagePowerWatts: [0, 10000, true],
  laborCentsPerHour: [0, 100000, true],
  orderSetupMinutes: [0, 600, false],
  plateSetupMinutes: [0, 600, false],
  finishingMinutesPerPart: [0, 600, false],
  packagingCentsPerOrder: [0, 100000, true],
  riskReserveBps: [0, 10000, true],
  targetMarginBps: [0, 8000, true],
  minimumOrderProfitCents: [0, 1000000, true],
  minimumProfitCentsPerMachineHour: [0, 100000, true],
};
export function getPricingProfile(workspace, farmId) {
  const farm = farms.find(f => f.id === farmId);
  ensure(farm, 400, 'INVALID_FARM', '请选择有效的演示农场');
  return copy(workspace.pricingProfiles?.[farmId] ?? {
    farmId, farmName: farm.name, revision: 1, updatedAt: null, mode: 'DEMO_ASSUMPTIONS',
    materialCostCentsPerKg: { PLA: 6000, PETG: 7500 },
    machineCostCentsPerHour: Math.round(200 * farm.multiplierBps / 10000),
    estimatedThroughputGramsPerHour: 20, warmupMinutesPerPlate: 5,
    electricityCentsPerKwh: 100, averagePowerWatts: 120, laborCentsPerHour: 3000,
    orderSetupMinutes: 5, plateSetupMinutes: 5, finishingMinutesPerPart: 1,
    packagingCentsPerOrder: 200, riskReserveBps: 1000, targetMarginBps: 3000,
    minimumOrderProfitCents: 500, minimumProfitCentsPerMachineHour: 500,
  });
}
export function savePricingProfile(workspace, payload, now) {
  ensure(workspace.merchant?.profile, 403, 'MERCHANT_REQUIRED', '请先开通商家工作台');
  ensure(payload.demoAcknowledged === true, 400, 'DEMO_ACK_REQUIRED', '请确认这是演示计价配置');
  const previous = getPricingProfile(workspace, payload.farmId), input = payload.profile;
  ensure(Number.isInteger(payload.expectedRevision) && payload.expectedRevision === previous.revision, 409, 'PRICING_REVISION_CONFLICT', '计价配置已更新，请重新读取后保存');
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_PRICING_PROFILE', '计价配置无效');
  ensure(Object.keys(input).every(k => k === 'materialCostCentsPerKg' || Object.hasOwn(fieldRules, k)), 400, 'INVALID_PRICING_PROFILE', '计价配置包含未知字段');
  const normalized = {};
  for (const [key, [min, max, integer]] of Object.entries(fieldRules)) {
    const value = input[key];
    ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), 400, 'INVALID_PRICING_PROFILE', '计价参数超出允许范围');
    normalized[key] = value;
  }
  const material = input.materialCostCentsPerKg;
  ensure(material && typeof material === 'object' && !Array.isArray(material) && Object.keys(material).length === 2 && ['PLA', 'PETG'].every(k => Number.isInteger(material[k]) && material[k] >= 1 && material[k] <= 10000000), 400, 'INVALID_PRICING_PROFILE', '请填写 PLA 与 PETG 的材料采购价（分/千克）');
  normalized.materialCostCentsPerKg = { PLA: material.PLA, PETG: material.PETG };
  const changed = Object.keys(fieldRules).some(k => previous[k] !== normalized[k]) || ['PLA', 'PETG'].some(k => previous.materialCostCentsPerKg[k] !== material[k]);
  const profile = { ...previous, ...normalized, revision: previous.revision + (changed ? 1 : 0), updatedAt: changed ? now : previous.updatedAt };
  (workspace.pricingProfiles ??= {})[profile.farmId] = profile;
  return { profile: copy(profile) };
}

// Conservative axis-aligned grid demonstration; it does not inspect supports,
// brim, gantry collisions, surface contact, or produce any machine toolpath.
export function estimateBatch(dimensions, quantity) {
  if (!Array.isArray(dimensions) || dimensions.length !== 3 || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return null;
  const [x, y, z] = dimensions, usable = 240, gap = 5;
  if (![x, y, z].every(n => Number.isFinite(n) && n > 0) || z > 250) return null;
  const layout = (w, h) => Math.floor((usable + gap) / (w + gap)) * Math.floor((usable + gap) / (h + gap));
  const normal = layout(x, y), rotated = layout(y, x), capacityPerPlate = Math.max(normal, rotated);
  if (!Number.isSafeInteger(capacityPerPlate) || capacityPerPlate < 1) return null;
  const partsPerPlate = [];
  for (let left = quantity; left > 0; left -= capacityPerPlate) partsPerPlate.push(Math.min(left, capacityPerPlate));
  return { method: 'BOUNDING_BOX_GRID_ESTIMATE', plateSizeMm: [250, 250], spacingMm: gap, edgeMarginMm: 5, capacityPerPlate, plateCount: partsPerPlate.length, partsPerPlate, rotationDegrees: rotated > normal ? 90 : 0, verified: false, mixedOrders: false, waitForOtherOrders: false };
}
export function estimateBatchPrice({ profile, batch, singleWeightGrams, quantity, quality }) {
  const hoursByPlate = batch.partsPerPlate.map(count => singleWeightGrams * count / profile.estimatedThroughputGramsPerHour * (quality === 'fine' ? 1.55 : 1) + profile.warmupMinutesPerPlate / 60);
  const productionHours = hoursByPlate.reduce((sum, hours) => sum + hours, 0);
  const materialGrams = singleWeightGrams * quantity;
  const materialCents = ceil(materialGrams * profile.materialCostCentsPerKg[profile.materialKey] / 1000);
  const machineCents = ceil(productionHours * profile.machineCostCentsPerHour);
  const electricityCents = ceil(productionHours * profile.averagePowerWatts / 1000 * profile.electricityCentsPerKwh);
  const orderSetupCents = ceil(profile.orderSetupMinutes / 60 * profile.laborCentsPerHour);
  const plateSetupCents = ceil(batch.plateCount * profile.plateSetupMinutes / 60 * profile.laborCentsPerHour);
  const finishingCents = ceil(quantity * profile.finishingMinutesPerPart / 60 * profile.laborCentsPerHour);
  const packagingCents = profile.packagingCentsPerOrder;
  const baseCents = materialCents + machineCents + electricityCents + orderSetupCents + plateSetupCents + finishingCents + packagingCents;
  ensure(safeMoney(baseCents), 400, 'INVALID_PRICE', '计价超出允许范围');
  const riskReserveCents = ratioCeil(baseCents, profile.riskReserveBps, 10000);
  const estimatedCostCents = baseCents + riskReserveCents;
  const profitFloorCents = Math.max(profile.minimumOrderProfitCents, ceil(productionHours * profile.minimumProfitCentsPerMachineHour));
  const manufacturingCents = Math.max(ratioCeil(estimatedCostCents, 10000, 10000 - profile.targetMarginBps), estimatedCostCents + profitFloorCents, 1);
  ensure([baseCents, estimatedCostCents, manufacturingCents, profitFloorCents].every(safeMoney), 400, 'INVALID_PRICE', '计价超出允许范围');
  const estimatedProfitCents = manufacturingCents - estimatedCostCents;
  const saleMaterialCents = estimatedCostCents > 0 ? ratioFloor(manufacturingCents, materialCents, estimatedCostCents) : 0;
  const saleMachineCents = estimatedCostCents > 0 ? ratioFloor(manufacturingCents, machineCents + electricityCents, estimatedCostCents) : 0;
  return {
    productionHours, hoursByPlate, materialGrams, manufacturingCents,
    saleMaterialCents, saleMachineCents, saleFinishingCents: manufacturingCents - saleMaterialCents - saleMachineCents,
    costBreakdown: { materialCents, machineCents, electricityCents, orderSetupCents, plateSetupCents, finishingCents, packagingCents, riskReserveCents },
    estimatedCostCents, estimatedProfitCents, estimatedMarginBps: ratioFloor(estimatedProfitCents, 10000, manufacturingCents),
    targetMarginBps: profile.targetMarginBps, profitFloorCents,
  };
}
export function settlementBreakdown(order) {
  if (order.settlementBreakdown) {
    const b = order.settlementBreakdown;
    ensure(['V0_6_QUOTE', 'V0_8_PROPOSAL', 'LEGACY_DERIVED'].includes(b.source) && [b.manufacturingCents, b.platformFeeCents, b.shippingCents, b.merchantReceivableCents, b.customerTotalCents].every(safeMoney) && b.manufacturingCents + b.shippingCents === b.merchantReceivableCents && b.merchantReceivableCents + b.platformFeeCents === b.customerTotalCents && b.customerTotalCents === order.totalCents, 409, 'INVALID_SETTLEMENT_BREAKDOWN', '订单分账快照无法校验，请核验后处理');
    return copy(b);
  }
  if (order.settlementState === 'SIMULATED_SETTLED') return null;
  const q = order.quoteSnapshot, total = order.totalCents, fee = q?.serviceCents, shipping = q?.shippingCents;
  ensure([total, fee, shipping].every(safeMoney) && total > fee && total > fee + shipping && q?.totalCents === total && Number.isInteger(order.qty) && order.qty > 0 && q?.review !== true, 409, 'LEGACY_SETTLEMENT_REVIEW_REQUIRED', '旧订单缺少可校验分账数据，不能自动结算');
  return { manufacturingCents: total - fee - shipping, platformFeeCents: fee, shippingCents: shipping, merchantReceivableCents: total - fee, customerTotalCents: total, averageUnitManufacturingCents: Math.round((total - fee - shipping) / order.qty), source: 'LEGACY_DERIVED' };
}
export function getMerchantPricing(workspace) {
  ensure(workspace.merchant?.profile, 403, 'MERCHANT_REQUIRED', '请先开通商家工作台');
  const evidence = workspace.pricingEvidence ?? {};
  return {
    mode: 'DEMO_ASSUMPTIONS', revision: workspace.revision,
    profiles: farms.map(farm => getPricingProfile(workspace, farm.id)),
    quoteEconomics: workspace.quotes.slice(-60).reverse().filter(q => evidence[q.quoteId]).map(q => ({ ...copy(evidence[q.quoteId]), expiresAt: q.expiresAt, usedByOrderId: q.usedByOrderId ?? null })),
    orderEconomics: workspace.orders.map(order => {
      let breakdown = order.settlementBreakdown ?? null;
      if (!breakdown && order.paymentState !== 'UNPAID' && order.settlementState !== 'SIMULATED_SETTLED') { try { breakdown = settlementBreakdown(order); } catch {} }
      return { orderId: order.id, farmId: order.farm, modelName: order.modelName, quantity: order.qty, status: order.status, settlementState: order.settlementState, refundState: order.refundState, settlementBreakdown: copy(breakdown), economics: evidence[order.quoteId] ? copy(evidence[order.quoteId]) : null, legacyUnsplit: order.settlementState === 'SIMULATED_SETTLED' && !order.settlementBreakdown };
    }),
  };
}
