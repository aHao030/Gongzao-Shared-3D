import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBatch, estimateBatchPrice, getPricingProfile, savePricingProfile, settlementBreakdown } from '../services/platform/pricing.mjs';
import { applyCommand, createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

const profile = changes => ({ ...getPricingProfile({}, 'f1'), materialKey: 'PLA', ...changes });
const input = p => {
  const { farmId, farmName, revision, updatedAt, mode, materialKey, ...values } = p;
  return values;
};
const calculate = (p, quantity = 1, weight = 10, dimensions = [20, 20, 20], quality = 'standard') => estimateBatchPrice({
  profile: p, batch: estimateBatch(dimensions, quantity), singleWeightGrams: weight, quantity, quality,
});

test('tiny valid models and zero optional costs cannot create NaN customer price components', () => {
  const p = profile({
    materialCostCentsPerKg: { PLA: 1, PETG: 1 }, machineCostCentsPerHour: 0,
    electricityCentsPerKwh: 0, averagePowerWatts: 0, laborCentsPerHour: 0,
    orderSetupMinutes: 0, plateSetupMinutes: 0, finishingMinutesPerPart: 0,
    packagingCentsPerOrder: 0, riskReserveBps: 0, minimumOrderProfitCents: 0,
    minimumProfitCentsPerMachineHour: 0, warmupMinutesPerPlate: 0,
  });
  const result = calculate(p, 1, 1.24e-12, [.001, .001, .001]);
  for (const key of ['manufacturingCents', 'saleMaterialCents', 'saleMachineCents', 'saleFinishingCents', 'estimatedCostCents', 'estimatedProfitCents']) {
    assert.ok(Number.isSafeInteger(result[key]) && result[key] >= 0, `${key} must be a nonnegative integer`);
  }
  assert.equal(result.saleMaterialCents + result.saleMachineCents + result.saleFinishingCents, result.manufacturingCents);
});

test('batch work grows per part while fixed setup is charged once per actual plate', () => {
  const p = profile({ estimatedThroughputGramsPerHour: 20, warmupMinutesPerPlate: 0, riskReserveBps: 0 });
  const one = calculate(p, 1, 10, [110, 110, 20]);
  const four = calculate(p, 4, 10, [110, 110, 20]);
  const five = calculate(p, 5, 10, [110, 110, 20]);
  assert.deepEqual(estimateBatch([110, 110, 20], 5).partsPerPlate, [4, 1]);
  assert.equal(four.materialGrams, 4 * one.materialGrams);
  assert.equal(four.productionHours, 4 * one.productionHours);
  assert.equal(four.costBreakdown.plateSetupCents, one.costBreakdown.plateSetupCents);
  assert.equal(five.costBreakdown.plateSetupCents, 2 * one.costBreakdown.plateSetupCents);
  assert.equal(five.costBreakdown.orderSetupCents, one.costBreakdown.orderSetupCents);
  assert.equal(five.costBreakdown.packagingCents, one.costBreakdown.packagingCents);
  assert.ok(four.manufacturingCents / 4 < one.manufacturingCents);
  assert.equal(calculate(p, 4, 10, [110, 110, 20], 'fine').productionHours, four.productionHours * 1.55);
});

test('reported margin preserves exact basis points without floating point under-reporting', () => {
  const p = profile({
    materialCostCentsPerKg: { PLA: 1000, PETG: 1000 }, machineCostCentsPerHour: 0,
    electricityCentsPerKwh: 0, averagePowerWatts: 0, laborCentsPerHour: 0,
    orderSetupMinutes: 0, plateSetupMinutes: 0, finishingMinutesPerPart: 0,
    packagingCentsPerOrder: 0, riskReserveBps: 0, minimumOrderProfitCents: 0,
    minimumProfitCentsPerMachineHour: 0, warmupMinutesPerPlate: 0, targetMarginBps: 5700,
  });
  const result = calculate(p, 1, 43);
  assert.equal(result.estimatedCostCents, 43);
  assert.equal(result.manufacturingCents, 100);
  assert.equal(result.estimatedMarginBps, 5700);
});

test('integer-cent prices satisfy exact margin, per-order and per-hour profit floors across bounded extremes', () => {
  let seed = 45931;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 1500; index++) {
    const p = profile({
      materialCostCentsPerKg: { PLA: 1 + Math.floor(random() * 10000000), PETG: 1 },
      estimatedThroughputGramsPerHour: .1 + random() * 999.9,
      targetMarginBps: index % 2 ? 8000 : Math.floor(random() * 8001),
      machineCostCentsPerHour: Math.floor(random() * 100001),
      riskReserveBps: Math.floor(random() * 10001),
      minimumOrderProfitCents: Math.floor(random() * 1000001),
      minimumProfitCentsPerMachineHour: Math.floor(random() * 100001),
    });
    const quantity = 1 + Math.floor(random() * 50);
    const result = calculate(p, quantity, 1e-7 + random() * 18000, [240, 240, 250], index % 2 ? 'fine' : 'standard');
    const minimumMarginPrice = (BigInt(result.estimatedCostCents) * 10000n + BigInt(10000 - p.targetMarginBps) - 1n) / BigInt(10000 - p.targetMarginBps);
    assert.ok(BigInt(result.manufacturingCents) >= minimumMarginPrice, `margin floor at case ${index}`);
    assert.ok(result.estimatedProfitCents >= p.minimumOrderProfitCents);
    assert.ok(result.estimatedProfitCents + 1e-7 >= result.productionHours * p.minimumProfitCentsPerMachineHour);
    assert.equal(result.saleMaterialCents + result.saleMachineCents + result.saleFinishingCents, result.manufacturingCents);
    assert.ok([result.manufacturingCents, result.saleMaterialCents, result.saleMachineCents, result.saleFinishingCents].every(n => Number.isSafeInteger(n) && n >= 0));
  }
});

test('merchant configuration rejects nonfinite, out of range, fractional cents and stale revisions without mutation', () => {
  const workspace = { merchant: { profile: { name: 'Test farm' } } };
  const p = input(profile());
  const invalid = [
    { targetMarginBps: 8001 }, { targetMarginBps: -1 }, { targetMarginBps: NaN },
    { machineCostCentsPerHour: Infinity }, { machineCostCentsPerHour: Number.MAX_VALUE },
    { machineCostCentsPerHour: .5 }, { machineCostCentsPerHour: -1 },
    { estimatedThroughputGramsPerHour: 0 }, { estimatedThroughputGramsPerHour: 1001 },
    { warmupMinutesPerPlate: -1 }, { minimumOrderProfitCents: 1000001 },
    { materialCostCentsPerKg: { PLA: 0, PETG: 1 } },
    { materialCostCentsPerKg: { PLA: 1, PETG: Infinity } },
    { materialCostCentsPerKg: { PLA: 1, PETG: 1, METAL: 1 } },
    { unauthorizedField: true },
  ];
  for (const change of invalid) {
    const before = structuredClone(workspace);
    assert.throws(() => savePricingProfile(workspace, { farmId: 'f1', profile: { ...p, ...change }, expectedRevision: 1, demoAcknowledged: true }, 10), { code: 'INVALID_PRICING_PROFILE' });
    assert.deepEqual(workspace, before);
  }
  const response = savePricingProfile(workspace, { farmId: 'f1', profile: { ...p, targetMarginBps: 4000 }, expectedRevision: 1, demoAcknowledged: true }, 10);
  assert.equal(response.profile.revision, 2);
  const before = structuredClone(workspace);
  assert.throws(() => savePricingProfile(workspace, { farmId: 'f1', profile: p, expectedRevision: 1, demoAcknowledged: true }, 11), { code: 'PRICING_REVISION_CONFLICT' });
  assert.deepEqual(workspace, before);
  response.profile.targetMarginBps = 0;
  assert.equal(getPricingProfile(workspace, 'f1').targetMarginBps, 4000);
});

test('legacy settlement recovers merchant net from preserved service fee and never invents settled history', () => {
  const order = { qty: 3, totalCents: 11700, settlementState: 'READY', quoteSnapshot: { totalCents: 11700, serviceCents: 700, shippingCents: 1000, review: false } };
  const breakdown = settlementBreakdown(order);
  assert.equal(breakdown.manufacturingCents, 10000);
  assert.equal(breakdown.merchantReceivableCents, 11000);
  assert.equal(breakdown.customerTotalCents, breakdown.merchantReceivableCents + breakdown.platformFeeCents);
  assert.equal(breakdown.source, 'LEGACY_DERIVED');
  assert.equal(settlementBreakdown({ ...order, settlementState: 'SIMULATED_SETTLED' }), null);
  for (const bad of [
    { ...order, quoteSnapshot: {} },
    { ...order, totalCents: 1699 },
    { ...order, totalCents: Infinity },
    { ...order, quoteSnapshot: { ...order.quoteSnapshot, serviceCents: -1 } },
    { ...order, quoteSnapshot: { ...order.quoteSnapshot, review: true } },
  ]) assert.throws(() => settlementBreakdown(bad), { code: 'LEGACY_SETTLEMENT_REVIEW_REQUIRED' });
});

test('customer quotes bound quantity, protect merchant economics and reject stale pricing revisions', async () => {
  let workspace = createWorkspace({ now: 1000000 }), sequence = 0;
  saveCustomerProfile(workspace, customerProfileFixture(), 1000000);
  workspace.merchant = { profile: { name: 'Test farm' } };
  const run = async (type, payload) => {
    const response = await applyCommand(workspace, { type, payload, idempotencyKey: `pricing-adversarial-${++sequence}` }, { now: 1000000, idFactory: () => `review-${++sequence}` });
    workspace = response.workspace;
    return response.result;
  };
  for (const qty of [0, -1, 1.5, 51, Number.MAX_VALUE]) {
    const before = structuredClone(workspace);
    await assert.rejects(run('quote', { qty }), { code: 'INVALID_QUANTITY' });
    assert.deepEqual(workspace, before);
  }
  for (const qty of [NaN, Infinity]) await assert.rejects(run('quote', { qty }), { code: 'INVALID_INPUT' });
  const quote = (await run('quote', { qty: 50 })).quotes[0];
  const terms = structuredClone(quote);
  const privateKeys = ['profileSnapshot', 'costBreakdown', 'estimatedCostCents', 'estimatedProfitCents', 'estimatedMarginBps', 'targetMarginBps', 'profitFloorCents'];
  const assertPrivate = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!privateKeys.includes(key), `private merchant field exposed: ${key}`);
      assertPrivate(child);
    }
  };
  assertPrivate(quote);
  assertPrivate(getPublicWorkspace(workspace));
  assert.equal(quote.pricingSummary.customerTotalCents, quote.pricingSummary.merchantReceivableCents + quote.serviceCents);
  assert.equal(quote.pricingSummary.merchantReceivableCents, quote.pricingSummary.manufacturingCents + quote.shippingCents);
  assert.equal(quote.serviceCents, Math.ceil(quote.pricingSummary.manufacturingCents * .07));
  const originalProfile = getPricingProfile(workspace, 'f1');
  await run('pricing-profile', { farmId: 'f1', profile: { ...input(originalProfile), targetMarginBps: 4000 }, expectedRevision: originalProfile.revision, demoAcknowledged: true });
  assert.deepEqual(workspace.quotes.find(q => q.quoteId === quote.quoteId), terms);
  await assert.rejects(run('order', { quoteId: quote.quoteId, demoAcknowledged: true }), { code: 'PRICING_CHANGED' });
  const fresh = (await run('quote', { qty: 50 })).quotes[0];
  const created = await run('order', { quoteId: fresh.quoteId, demoAcknowledged: true });
  assertPrivate(created);
  assertPrivate(getPublicWorkspace(workspace));
  assert.equal(created.order.settlementBreakdown.merchantReceivableCents, fresh.totalCents - fresh.serviceCents);
});
