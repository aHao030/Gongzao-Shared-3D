import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { estimateBatch, estimateBatchPrice, getMerchantPricing, getPricingProfile, settlementBreakdown } from '../services/platform/pricing.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

function harness() {
  let state = createWorkspace({ now: 1000000 }), n = 0;
  saveCustomerProfile(state, customerProfileFixture(), 1000000);
  const run = async (type, payload, key = `batch-key-${++n}`) => {
    const outcome = await applyCommand(state, { type, payload, idempotencyKey: key }, { now: 1000000 + ++n, idFactory: () => `batch-${++n}` });
    state = outcome.workspace; return outcome;
  };
  return { run, get state() { return state; } };
}
function editable(profile) {
  const { farmId, farmName, revision, updatedAt, mode, ...values } = profile;
  return values;
}

test('batch estimate has explicit edge clearance and never combines orders or promises a sliced layout', () => {
  const layout = estimateBatch([40, 35, 10], 31);
  assert.equal(layout.capacityPerPlate, 30);
  assert.deepEqual(layout.partsPerPlate, [30, 1]);
  assert.equal(layout.verified, false);
  assert.equal(layout.mixedOrders, false);
  assert.equal(layout.waitForOtherOrders, false);
  assert.equal(estimateBatch([240, 240, 250], 50).plateCount, 50);
  for (const size of [[240.01, 240, 250], [240, 240, 250.01], [], [0, 1, 1]]) assert.equal(estimateBatch(size, 1), null);
  for (const quantity of [0, -1, 51, 1.5, Infinity]) assert.equal(estimateBatch([40, 35, 10], quantity), null);
});

test('adjustable throughput changes continuous extrusion time but does not remove plate warmup or labor', () => {
  const profile = { ...getPricingProfile(createWorkspace(), 'f1'), materialKey: 'PLA' };
  const batch = estimateBatch([40, 35, 10], 31);
  const slow = estimateBatchPrice({ profile, batch, singleWeightGrams: 17.36, quantity: 31, quality: 'standard' });
  const fast = estimateBatchPrice({ profile: { ...profile, estimatedThroughputGramsPerHour: 40 }, batch, singleWeightGrams: 17.36, quantity: 31, quality: 'standard' });
  const warmup = profile.warmupMinutesPerPlate * batch.plateCount / 60;
  assert.ok(Math.abs(slow.productionHours - warmup - 2 * (fast.productionHours - warmup)) < 1e-10);
  assert.equal(slow.costBreakdown.materialCents, fast.costBreakdown.materialCents);
  assert.equal(slow.costBreakdown.plateSetupCents, fast.costBreakdown.plateSetupCents);
  assert.equal(slow.costBreakdown.finishingCents, fast.costBreakdown.finishingCents);
  assert.equal(slow.hoursByPlate.length, 2);
  assert.ok(slow.hoursByPlate[0] > slow.hoursByPlate[1]);
});

test('merchant evidence freezes cost assumptions at quote time and reset preserves saved profiles only', async () => {
  const h = harness();
  h.state.merchant = { profile: { businessName: '测试商家' } };
  const q = (await h.run('quote', { qty: 30 })).result.quotes[0];
  const created = (await h.run('order', { quoteId: q.quoteId, demoAcknowledged: true })).result.order;
  const before = structuredClone(getMerchantPricing(h.state).orderEconomics[0]);
  const profile = getPricingProfile(h.state, 'f1');
  await h.run('pricing-profile', { farmId: 'f1', expectedRevision: 1, profile: { ...editable(profile), laborCentsPerHour: 4500 }, demoAcknowledged: true });
  const after = getMerchantPricing(h.state).orderEconomics[0];
  assert.deepEqual(after, before);
  assert.equal(after.economics.profileSnapshot.laborCentsPerHour, 3000);
  assert.equal(after.economics.pricingRevision, 1);
  assert.equal(getPricingProfile(h.state, 'f1').revision, 2);
  assert.equal(created.settlementBreakdown.customerTotalCents, created.totalCents);
  const exposed = JSON.stringify(getPublicWorkspace(h.state));
  for (const key of ['profileSnapshot', 'estimatedCostCents', 'estimatedProfitCents', 'pricingProfiles', 'costBreakdown']) assert.equal(exposed.includes(key), false);
  await h.run('action', { action: 'reset', confirm: 'RESET_DEMO', demoAcknowledged: true });
  assert.equal(getPricingProfile(h.state, 'f1').revision, 2);
  assert.deepEqual(h.state.pricingEvidence, {});
  assert.deepEqual(getMerchantPricing(h.state).orderEconomics, []);
});

test('a failed merchant authorization cannot replay cached private configuration', async () => {
  const h = harness();
  h.state.merchant = { profile: { businessName: '测试商家' } };
  const payload = { farmId: 'f1', expectedRevision: 1, profile: editable(getPricingProfile(h.state, 'f1')), demoAcknowledged: true };
  await h.run('pricing-profile', payload, 'saved-private-profile');
  h.state.merchant.profile = null;
  await assert.rejects(h.run('pricing-profile', payload, 'saved-private-profile'), { code: 'MERCHANT_REQUIRED' });
  assert.throws(() => getMerchantPricing(h.state), { code: 'MERCHANT_REQUIRED' });
});

test('settlement refuses inconsistent stored splits and derives no fabricated costs for old orders', () => {
  const pending = { totalCents: 12345, qty: 3, settlementState: 'READY', quoteSnapshot: { totalCents: 12345, serviceCents: 745, shippingCents: 1000 } };
  const split = settlementBreakdown(pending);
  assert.equal(split.merchantReceivableCents, 11600);
  assert.equal(split.manufacturingCents, 10600);
  assert.equal(split.source, 'LEGACY_DERIVED');
  assert.equal('estimatedCostCents' in split, false);
  const bad = { ...pending, settlementBreakdown: { ...split, merchantReceivableCents: pending.totalCents } };
  assert.throws(() => settlementBreakdown(bad), { code: 'INVALID_SETTLEMENT_BREAKDOWN' });
  assert.throws(() => settlementBreakdown({ ...pending, quoteSnapshot: { ...pending.quoteSnapshot, totalCents: 12346 } }), { code: 'LEGACY_SETTLEMENT_REVIEW_REQUIRED' });
  assert.equal(settlementBreakdown({ ...pending, settlementState: 'SIMULATED_SETTLED' }), null);
});
