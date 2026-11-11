import { materials } from './catalog.mjs';
import { ensure, modelForPricing, needsMeshAnalysis, scaledModelGeometry } from './geometry.mjs';
import { getCapabilities } from './inquiries.mjs';
import { findSliceEvidence } from './operations.mjs';
import { estimateBatch, estimateBatchPrice, estimatePartWeightGrams, getPricingProfile, platformFeeForManufacturing, PRICING_VERSION } from './pricing.mjs';

const autoMaterials = Object.keys(materials).filter(key => materials[key].auto);
const referenceIds = new Set(getCapabilities({}).capabilities.map(cap => cap.id));

function candidateCapabilities(customerWorkspace, merchantWorkspace, capabilityId) {
  if (!merchantWorkspace) {
    // A selected template supplies its dimensions and material constraints, but
    // a platform estimate never uses the buyer's own private pricing settings.
    const caps = getCapabilities(capabilityId ? customerWorkspace : {}).capabilities;
    return { caps, source: 'PLATFORM_REFERENCE' };
  }
  const caps = getCapabilities(merchantWorkspace).capabilities;
  const configured = caps.filter(cap => cap.updatedAt != null || cap.revision > 1 ||
    !referenceIds.has(cap.id) || Object.hasOwn(merchantWorkspace.pricingProfiles ?? {}, cap.farmId));
  // Once the merchant has chosen a process/rate, untouched sandbox lines
  // must not bring the lower end below that merchant's configured terms.
  if (configured.length) return { caps: configured, source: 'SHOP_CONFIG' };
  // An explicitly empty or disabled capability list also means no capacity.
  return { caps, source: 'PLATFORM_REFERENCE' };
}

function makeCandidate(ctx, cap, material, model, dimensions, volume, input) {
  if (!cap.materials.includes(material) || !dimensions.every((n, i) => n <= cap.maxDimensions[i])) return null;
  const batch = estimateBatch(dimensions, input.qty, cap.maxDimensions);
  if (!batch) return null;
  const sliced = findSliceEvidence(ctx, {
    modelId: model.id, modelHash: model.sha256, modelVersion: model.version ?? 1,
    qty: input.qty, unit: input.unit, material, quality: input.quality,
    farmId: cap.farmId, deviceIds: cap.deviceIds
  });
  let manufacturingCents;
  if (sliced) {
    // The slicer's measured mass, duration and price already cover the whole job.
    manufacturingCents = sliced.economics.suggestedManufacturingCents;
  } else {
    const profile = getPricingProfile(ctx, cap.farmId);
    const singleWeightGrams = estimatePartWeightGrams(volume, material, input.quality);
    manufacturingCents = estimateBatchPrice({ profile: { ...profile, materialKey: material },
      batch, singleWeightGrams, quantity: input.qty, quality: input.quality }).manufacturingCents;
  }
  const totalCents = manufacturingCents + platformFeeForManufacturing(manufacturingCents);
  ensure(Number.isSafeInteger(totalCents) && totalCents > 0, 400, 'INVALID_PRICE', '预算超出计价范围');
  return { material, totalCents, sliced: Boolean(sliced), customRate: Object.hasOwn(ctx.pricingProfiles ?? {}, cap.farmId) };
}

/**
 * A read-only, address-free rough estimate. Only data in the returned object
 * may be displayed to the other participant or frozen in a conversation.
 * HTTP resolves the shop and its published status before supplying its workspace.
 */
export function estimateBudget(customerWorkspace, input = {}, { merchantWorkspace = null, now = Date.now() } = {}) {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_BUDGET_INPUT', '估价条件格式不正确');
  const { modelId, qty = 1, unit = 'mm', quality = 'standard', material = 'AUTO', capabilityId } = input;
  ensure(typeof modelId === 'string' && modelId.length > 0 && modelId.length <= 160, 400, 'INVALID_MODEL_ID', '请选择已上传模型或示例');
  ensure(Number.isInteger(qty) && qty >= 1 && qty <= 50, 400, 'INVALID_QUANTITY', '数量须为 1–50 的整数');
  ensure(['standard','fine'].includes(quality) && ['mm','inch'].includes(unit), 400, 'INVALID_CONFIGURATION', '请选择有效的质量和文件单位');
  ensure(material === 'AUTO' || (typeof material === 'string' && Object.hasOwn(materials, material)), 400, 'INVALID_MATERIAL', '请选择支持的材料');
  ensure(capabilityId === undefined || typeof capabilityId === 'string' && capabilityId.length > 0 && capabilityId.length <= 160, 400, 'INVALID_CAPABILITY', '所选工艺模板无效');
  const original = (customerWorkspace.models ?? []).find(item => item.id === modelId);
  ensure(original, 404, 'MODEL_NOT_FOUND', '当前工作空间找不到该模型');
  const model = modelForPricing(original);
  const { caps, source } = candidateCapabilities(customerWorkspace, merchantWorkspace, capabilityId);
  const base = {
    version: 'model-budget-v1', pricingVersion: PRICING_VERSION, calculatedAt: now,
    currency: 'CNY', source, payable: false, modelId, modelName: model.name,
    modelVersion: model.version ?? 1, isSample: model.isSample === true, material, quality, qty, unit,
    includes: ['制造与基础包装', '平台服务费'], excludes: ['运费', '税费', '特殊后处理'],
    shippingCents: null, taxCents: null
  };
  const review = (reasonCode, explanation) => ({ ...base, status: 'REVIEW_REQUIRED', basis: 'MANUAL', reasonCode, explanation,
    lowCents: null, highCents: null, unitLowCents: null, unitHighCents: null, materialsCompared: [] });

  if (needsMeshAnalysis(original)) return review('LEGACY_ANALYSIS', '旧模型尚需重新解析，可重传原 STL，或联系商家核价。');
  if (model.format !== 'stl' || model.closed !== true || model.review) return review('MODEL_REVIEW', '现有资料不足以自动估价，请商家审核原图或模型。');
  if (material !== 'AUTO' && !materials[material].auto) return review('PROCESS_REVIEW', '此材料或工艺需要商家核对加工方式后报价。');
  const {dimensions, volume} = scaledModelGeometry(model, unit);
  if (dimensions.length !== 3 || !dimensions.every(side => Number.isFinite(side) && side > 0 && side <= 250) || !Number.isFinite(volume) || volume <= 0) {
    return review('GEOMETRY_REVIEW', '模型尺寸或体积超出当前预算范围，请核对单位或联系商家。');
  }
  const eligible = caps.filter(cap => (!capabilityId || cap.id === capabilityId) && cap.enabled && cap.process === 'FDM'
    && cap.quoteMode === 'AUTO_ESTIMATE' && cap.qualities.includes(quality));
  const options = material === 'AUTO' ? autoMaterials : [material];
  const ctx = merchantWorkspace ?? { operations: customerWorkspace.operations };
  const candidates = [];
  for (const cap of eligible) {
    for (const candidateMaterial of options) {
      const item = makeCandidate(ctx, cap, candidateMaterial, model, dimensions, volume, { qty, unit, quality });
      if (item) candidates.push(item);
    }
  }
  if (!candidates.length) return review('CAPABILITY_REVIEW', '所选工艺、材料、精度或尺寸没有匹配的自动计价配置，请联系商家确认。');
  const slicedCount = candidates.filter(item => item.sliced).length;
  const basis = slicedCount === 0 ? 'GEOMETRY' : slicedCount === candidates.length ? 'SLICER' : 'MIXED';
  const prices = candidates.map(item => item.totalCents);
  const lowCents = Math.min(...prices), highCents = Math.max(...prices);
  const rates = source === 'PLATFORM_REFERENCE' ? '采用平台参考配置。' :
    candidates.every(item => item.customRate) ? '采用该店已配置的计价参数。' : '采用该店工艺，未自设的费率按平台参考值计算。';
  const evidence = {
    GEOMETRY: '按实体体积、材料密度和估算板数计价，支撑、填充与摆放会影响结果。',
    SLICER: '使用匹配切片的整单耗材、机时和板数，实际生产损耗待商家确认。',
    MIXED: '部分配置已有整单切片，其余按几何估算。支撑、摆放和实际损耗会影响结果。'
  }[basis];
  return { ...base, status: 'ESTIMATED', basis, reasonCode: null, lowCents, highCents,
    unitLowCents: Math.round(lowCents / qty), unitHighCents: Math.round(highCents / qty),
    materialsCompared: [...new Set(candidates.map(item => item.material))],
    explanation: rates + (lowCents !== highCents ? '区间为匹配配置的最低与最高测算值。' : '') + evidence };
}
