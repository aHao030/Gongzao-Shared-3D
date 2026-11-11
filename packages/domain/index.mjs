import { createHash, randomUUID } from 'node:crypto';

import { assert } from './rules.mjs';
export * from './rules.mjs';

// Node-only quote generation, hashing and in-memory command deduplication.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// These are fabricated calibration values. They are not market prices or live farms.
export const DEMO_CATALOG = freeze({
  mode: 'DEMO_ONLY', currency: 'CNY', profileVersion: 'fdm-demo-v1',
  models: { 'demo-bracket': { label: '演示支架', modelHash: fingerprint('fixture-bracket-v1'), volumeCm3: 18, printHours: 1.8, dimensionsMm: [60, 40, 30] } },
  materials: { PLA: { centsPerCm3: 55 }, PETG: { centsPerCm3: 70 } },
  farms: {
    'demo-farm-a': { label: '演示农场 A', hourlyCents: 800, setupCents: 1200, minimumCents: 2500, queueHours: [8, 16], maxDimensionsMm: [250, 250, 250] },
    'demo-farm-b': { label: '演示农场 B', hourlyCents: 1000, setupCents: 1000, minimumCents: 2800, queueHours: [2, 6], maxDimensionsMm: [250, 250, 250] }
  },
  shippingCents: 1000, platformBasisPoints: 800,
  reviewHours: [0.5, 2], postProcessHours: [1, 3], shippingHours: [24, 72]
});

export function createQuote(request, catalog = DEMO_CATALOG, options = {}) {
  const { modelId = 'demo-bracket', material = 'PLA', quantity = 1, farmId = 'demo-farm-a' } = request;
  const model = catalog.models[modelId], farm = catalog.farms[farmId], stock = catalog.materials[material];
  assert(model && farm && stock, 'UNSUPPORTED_CAPABILITY', '当前仅支持目录中列出的演示模型、农场与材料');
  assert(Number.isInteger(quantity) && quantity >= 1 && quantity <= 100, 'INVALID_QUANTITY', '数量必须为 1–100 的整数');
  assert(model.dimensionsMm.every((v, i) => v <= farm.maxDimensionsMm[i]), 'BUILD_VOLUME_EXCEEDED', '模型超过该设备的成型尺寸');
  const materialCents = Math.ceil(model.volumeCm3 * stock.centsPerCm3 * quantity);
  const machineCents = Math.ceil(model.printHours * farm.hourlyCents * quantity);
  const productionCents = Math.max(farm.minimumCents, materialCents + machineCents + farm.setupCents);
  const platformCents = Math.ceil(productionCents * catalog.platformBasisPoints / 10000);
  const processing = model.printHours * quantity;
  const shipMin = catalog.reviewHours[0] + farm.queueHours[0] + processing + catalog.postProcessHours[0];
  const shipMax = catalog.reviewHours[1] + farm.queueHours[1] + processing * 1.25 + catalog.postProcessHours[1];
  const now = options.now ?? Date.now();
  const terms = {
    mode: 'DEMO_ONLY', currency: catalog.currency, modelId, modelHash: model.modelHash,
    farmId, material, quantity, process: 'FDM', profileVersion: catalog.profileVersion,
    recipeVersion: 'demo-slicer-recipe-v1', geometryVersion: 'server-fixture-v1',
    costs: { materialCents, machineCents, setupCents: farm.setupCents, productionCents, platformCents, shippingCents: catalog.shippingCents },
    amountCents: productionCents + platformCents + catalog.shippingCents,
    eta: { shipHours: [shipMin, shipMax], deliveryHours: [shipMin + catalog.shippingHours[0], shipMax + catalog.shippingHours[1]], basis: '演示工作量，不代表真实交付承诺；串行加工，无拼盘优化' },
    issuedAt: now, expiresAt: now + 15 * 60 * 1000
  };
  return freeze({ quoteId: options.quoteId ?? randomUUID(), ...terms, fingerprint: fingerprint(terms) });
}

export function verifyQuote(quote, expectedFingerprint, now = Date.now()) {
  const { quoteId, fingerprint: digest, ...terms } = quote;
  assert(fingerprint(terms) === digest && digest === expectedFingerprint, 'QUOTE_CHANGED', '报价条款或版本已变更，请重新确认');
  assert(now < quote.expiresAt, 'QUOTE_EXPIRED', '报价已过期');
  return true;
}

export class IdempotencyRegistry {
  #entries = new Map();
  run(key, payload, operation) {
    assert(typeof key === 'string' && key.length > 0, 'MISSING_IDEMPOTENCY_KEY', '必须提供幂等标识');
    const digest = fingerprint(payload), existing = this.#entries.get(key);
    if (existing) {
      assert(existing.digest === digest, 'IDEMPOTENCY_CONFLICT', '同一幂等标识不能复用于不同内容');
      return existing.result;
    }
    const result = operation();
    this.#entries.set(key, { digest, result });
    return result;
  }
}
