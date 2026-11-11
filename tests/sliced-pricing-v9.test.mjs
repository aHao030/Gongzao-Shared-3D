import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWorkspace, applyCommand, getPublicWorkspace } from '../services/platform/core.mjs';
import { applyMerchantCommand } from '../services/platform/merchant.mjs';
import { applyOperationsCommand } from '../services/platform/operations.mjs';
import { analyzeModel } from '../services/platform/geometry.mjs';
import { getPricingProfile, getMerchantPricing } from '../services/platform/pricing.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

// Independent domain integration: actual STL parsing, merchant enrollment,
// authenticated worker lease/result and customer quote/order commands. The
// fixed worker measurements are contract fixtures, not a physical print test.
const profileHash = 'a'.repeat(64), artifactHash = 'b'.repeat(64);
const workerContext = { workerId: 'trusted-slicing-worker', workerKinds: ['SLICE_MODEL'] };
function editablePricing(profile) {
  const { farmId, farmName, revision, updatedAt, mode, ...values } = profile;
  return values;
}

async function harness() {
  let state = createWorkspace({ now: 1_000_000 }), sequence = 0, now = 1_000_000;
  const idFactory = () => 'sliced-' + ++sequence;
  async function command(type, payload) {
    const outcome = await applyCommand(state, { type, payload, idempotencyKey: 'slice-core-' + ++sequence }, { now: ++now, idFactory });
    state = outcome.workspace; return outcome.result;
  }
  async function operations(type, payload, context = {}) {
    const outcome = await applyOperationsCommand(state, { type, payload, idempotencyKey: 'slice-ops-' + ++sequence }, { now: ++now, idFactory, ...context });
    state = outcome.workspace; return outcome.result;
  }
  const enrolled = await applyMerchantCommand(state, { type: 'enroll', payload: { name: '切片估价集成测试农场' }, idempotencyKey: 'slice-enroll-merchant' }, { ownerId: 'test-owner', now: ++now, idFactory });
  state = enrolled.workspace;
  await command('customer-profile', customerProfileFixture());
  const bytes = new Uint8Array(await fs.readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url)));
  const model = (await command('register-model', await analyzeModel(bytes, 'sliced-pricing-cube.stl'))).model;
  assert.equal(model.closed, true);
  const profile = (await operations('save-profile', { name: '测试 PLA 工艺', localProfileId: 'test-pla-standard', engine: 'PrusaSlicer', process: 'FDM', material: 'PLA', quality: 'standard', deviceId: 'p1', farmId: 'f1', expectedProfileSha256: profileHash, expectedRevision: 0, enabled: true })).profile;
  async function slice({ quantity = 3, unit = 'mm', selectedProfile = profile, mode = 'WORKER', grams = 100, seconds = 7200, plateCount = 2 } = {}) {
    const queued = (await operations('queue-job', { kind: 'SLICE_MODEL', mode, modelId: model.id, profileId: selectedProfile.id, quantity, unit, ...(mode === 'SANDBOX' ? { demoAcknowledged: true } : {}) })).job;
    if (mode === 'SANDBOX') return queued;
    const claim = (await operations('claim-job', { kinds: ['SLICE_MODEL'], leaseSeconds: 300 }, workerContext)).job;
    assert.equal(claim.id, queued.id);
    return (await operations('complete-job', { jobId: queued.id, leaseToken: claim.leaseToken, attempt: claim.attempt, result: {
      inputHash: queued.inputHash, modelHash: model.sha256, profileRevision: selectedProfile.revision,
      engineVersion: 'PrusaSlicer-fixture-2.9.7', provenance: 'WORKER_OBSERVED',
      materialGrams: grams, durationSeconds: seconds, plateCount,
      artifactHash, profileSha256: selectedProfile.expectedProfileSha256 || profileHash
    } }, workerContext)).job;
  }
  const quote = async (overrides = {}) => (await command('quote', { modelId: model.id, qty: 3, unit: 'mm', material: 'PLA', quality: 'standard', ...overrides })).quotes;
  const order = async quoteId => (await command('order', { quoteId, demoAcknowledged: true })).order;
  async function changeProfile(patch = {}) {
    const latest = state.operations.profiles.find(p => p.id === profile.id);
    return (await operations('save-profile', { ...latest, expectedRevision: latest.revision, name: latest.name + '修订', ...patch })).profile;
  }
  async function pricing(patch = {}) {
    const current = getPricingProfile(state, 'f1');
    return (await command('pricing-profile', { farmId: 'f1', expectedRevision: current.revision, demoAcknowledged: true, profile: { ...editablePricing(current), ...patch } })).profile;
  }
  return { command, operations, model, profile, slice, quote, order, changeProfile, pricing, get state() { return state; } };
}

test('v9 quotes use trusted slice totals for the exact farm and keep the public estimate sandbox-only', async () => {
  const h = await harness();
  assert.ok((await h.quote()).every(q => q.estimateBasis === 'DEMO_GEOMETRY_ESTIMATE' && !q.sliceEvidence));
  const job = await h.slice();
  const quotes = await h.quote(), q = quotes.find(q => q.farm.id === 'f1');
  assert.equal(q.estimateBasis, 'SLICER_OUTPUT');
  assert.equal(q.productionHours, 2);
  assert.equal(q.weight * q.qty, 100);
  assert.equal(q.batch.plateCount, 2);
  assert.equal(q.batch.method, 'SLICER_OUTPUT_ESTIMATE');
  assert.equal(q.batch.verified, false);
  assert.equal(q.batch.partsPerPlate, null);
  assert.deepEqual(q.sliceEvidence, { jobId: job.id, inputHash: job.inputHash, modelHash: h.model.sha256, profileId: h.profile.id, profileRevision: 1, profileSha256: profileHash, artifactHash, engineVersion: 'PrusaSlicer-fixture-2.9.7', provenance: 'WORKER_OBSERVED' });
  assert.equal(q.payable, false);
  assert.equal(q.mode, 'DEMO_ONLY');
  assert.ok(quotes.filter(q => q.farm.id !== 'f1').every(q => q.estimateBasis === 'DEMO_GEOMETRY_ESTIMATE' && !q.sliceEvidence));
});

test('v9 quantity, units, material and quality mismatches cannot reuse completed slicing evidence', async t => {
  for (const [name, overrides] of Object.entries({ quantity: { qty: 2 }, units: { unit: 'inch' }, material: { material: 'PETG' }, quality: { quality: 'fine' } }))
    await t.test(name, async () => {
      const h = await harness(); await h.slice();
      const q = (await h.quote(overrides)).find(q => q.farm.id === 'f1');
      assert.notEqual(q.estimateBasis, 'SLICER_OUTPUT');
      assert.equal(q.sliceEvidence, undefined);
      if (!q.review) assert.equal(q.estimateBasis, 'DEMO_GEOMETRY_ESTIMATE');
    });
});

test('v9 simulated slice results never become trusted customer price evidence', async () => {
  const h = await harness(); await h.slice({ mode: 'SANDBOX' });
  const q = (await h.quote()).find(q => q.farm.id === 'f1');
  assert.equal(q.estimateBasis, 'DEMO_GEOMETRY_ESTIMATE');
  assert.equal(q.sliceEvidence, undefined);
});

test('v9 a revised or disabled process profile invalidates old quotes and excludes stale slicing evidence', async t => {
  for (const patch of [{ name: '新版工艺' }, { enabled: false }, { expectedProfileSha256: 'c'.repeat(64) }])
    await t.test(JSON.stringify(patch), async () => {
      const h = await harness(); await h.slice();
      const q = (await h.quote())[0];
      await h.changeProfile(patch);
      await assert.rejects(h.order(q.quoteId), { code: 'SLICE_PROFILE_CHANGED' });
      assert.equal(h.state.orders.length, 0);
      const fresh = (await h.quote())[0];
      assert.equal(fresh.estimateBasis, 'DEMO_GEOMETRY_ESTIMATE');
      assert.equal(fresh.sliceEvidence, undefined);
    });
});

test('v9 slice-based prices preserve cent splits and all merchant profit floors', async t => {
  const knownCosts = { materialCostCentsPerKg: { PLA: 10000, PETG: 10000 }, machineCostCentsPerHour: 200, electricityCentsPerKwh: 100, averagePowerWatts: 100, laborCentsPerHour: 600, orderSetupMinutes: 10, plateSetupMinutes: 5, finishingMinutesPerPart: 5, packagingCentsPerOrder: 100, riskReserveBps: 1000, targetMarginBps: 2500, minimumOrderProfitCents: 300, minimumProfitCentsPerMachineHour: 500 };
  // 100 g, 2 h, 2 plates, 3 parts: materials 1000 + machine 400 +
  // electricity 20 + labor 350 + packaging 100 = 1870; reserve 187 => 2057.
  for (const [name, patch, expectedSale] of [
    ['machine-hour floor', {}, 3057],
    ['per-order floor', { minimumOrderProfitCents: 5000 }, 7057],
    ['target margin floor', { targetMarginBps: 8000 }, 10285]
  ]) await t.test(name, async () => {
    const h = await harness();
    const profile = await h.pricing({ ...knownCosts, ...patch });
    await h.slice();
    const q = (await h.quote())[0], e = h.state.pricingEvidence[q.quoteId];
    assert.equal(e.estimatedCostCents, 2057);
    assert.equal(q.pricingSummary.manufacturingCents, expectedSale);
    assert.equal(e.estimatedProfitCents, expectedSale - 2057);
    assert.ok(e.estimatedProfitCents >= profile.minimumOrderProfitCents);
    assert.ok(e.estimatedProfitCents >= 2 * profile.minimumProfitCentsPerMachineHour);
    assert.ok(BigInt(e.estimatedProfitCents) * 10000n >= BigInt(expectedSale) * BigInt(profile.targetMarginBps));
    assert.equal(q.materialCents + q.machineCents + q.finishingCents, expectedSale);
    assert.equal(q.serviceCents, Math.ceil(expectedSale * 0.07));
    assert.equal(q.totalCents, expectedSale + q.serviceCents + q.shippingCents);
    assert.equal(q.pricingSummary.merchantReceivableCents, expectedSale + q.shippingCents);
    assert.equal(q.pricingSummary.merchantReceivableCents + q.pricingSummary.platformFeeCents, q.totalCents);
    assert.ok([q.materialCents, q.machineCents, q.finishingCents, q.serviceCents, q.totalCents].every(Number.isSafeInteger));
  });
});

test('v9 paid order price, slicing evidence and private cost snapshots remain frozen after reconfiguration and new slicing', async () => {
  const h = await harness(); await h.slice();
  const q = (await h.quote())[0], order = await h.order(q.quoteId);
  assert.equal(order.paymentState, 'SIMULATED_FROZEN');
  const snapshot = structuredClone(h.state.orders[0].quoteSnapshot);
  const merchantEvidence = structuredClone(getMerchantPricing(h.state).orderEconomics[0]);
  const updatedProfile = await h.changeProfile({ expectedProfileSha256: 'd'.repeat(64) });
  await h.pricing({ laborCentsPerHour: 9000 });
  await h.slice({ selectedProfile: updatedProfile, grams: 150, seconds: 10800, plateCount: 3 });
  const updatedQuote = (await h.quote())[0];
  assert.equal(updatedQuote.estimateBasis, 'SLICER_OUTPUT');
  assert.equal(updatedQuote.sliceEvidence.profileRevision, 2);
  assert.notEqual(updatedQuote.totalCents, q.totalCents);
  assert.deepEqual(h.state.orders[0].quoteSnapshot, snapshot);
  assert.equal(h.state.orders[0].totalCents, order.totalCents);
  assert.deepEqual(getMerchantPricing(h.state).orderEconomics[0], merchantEvidence);
  const publicState = getPublicWorkspace(h.state);
  assert.equal(publicState.orders[0].quoteSnapshot.estimateBasis, 'SLICER_OUTPUT');
  const exposed = JSON.stringify({ quote: updatedQuote, publicState });
  for (const privateKey of ['pricingEvidence', 'pricingProfiles', 'profileSnapshot', 'estimatedCostCents', 'estimatedProfitCents', 'costBreakdown', 'materialCostCentsPerKg', 'minimumOrderProfitCents'])
    assert.equal(exposed.includes('"' + privateKey + '"'), false, privateKey + ' must remain merchant-private');
});
