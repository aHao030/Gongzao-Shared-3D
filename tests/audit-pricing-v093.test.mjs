import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCommand, createWorkspace } from '../services/platform/core.mjs';
import { analyzeModel } from '../services/platform/geometry.mjs';
import { getCapabilities, getInquiries, termsDigest } from '../services/platform/inquiries.mjs';
import { handleApi } from '../services/platform/http.mjs';
import { canAcceptProposal } from '../dist/workflow-ui.js';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

async function sandbox() {
  let state = createWorkspace(), sequence = 0;
  state.merchant = { profile: { name: '测试商家' }, devices: [], gateways: [], scans: [], ledger: {} };
  async function command(type, payload) {
    const outcome = await applyCommand(state, { type, payload, idempotencyKey: 'pricing-audit-' + ++sequence }, { idFactory: () => 'audit-' + ++sequence, now: state.createdAt + sequence });
    state = outcome.workspace;
    return outcome.result;
  }
  await command('customer-profile', customerProfileFixture());
  const capability = getCapabilities(state).capabilities[0];
  const inquiry = (qty, changes = {}) => command('inquiry', { modelId: state.models[0].id, capabilityId: capability.id, unit: 'mm', qty, material: 'PLA', dimensionsConfirmed: true, demoAcknowledged: true, ...changes });
  const propose = (record, values) => command('proposal', { inquiryId: record.id, expectedInquiryRevision: record.revision, material: 'PLA', quality: 'standard', manufacturingCents: 100000, shippingCents: 1000, estimatedCostCents: 1, productionHours: 0.1, dispatchDays: [2, 5], transitDays: [1, 2], note: '请确认制造方案。', demoAcknowledged: true, ...values });
  return { get state() { return state; }, command, capability, inquiry, propose };
}

// Stored worker contract fixtures represent observed estimates; no machine is run.
function sliceFixture(s, { id, version = 1, deviceId = 'p1', grams = 600, seconds = 30 * 3600 }) {
  const model = s.state.models[0];
  const profile = { id: 'profile-' + id, revision: 1, enabled: true, material: 'PLA', farmId: 'f1', quality: 'standard', deviceId };
  const job = { id, kind: 'SLICE_MODEL', status: 'COMPLETED', mode: 'WORKER', modelId: model.id, modelHash: model.sha256, modelVersion: version, quantity: 3, unit: 'mm', configSnapshot: { ...profile }, profileId: profile.id, profileRevision: 1, inputHash: 'e'.repeat(64), result: { provenance: 'WORKER_OBSERVED', engineVersion: 'test slicer', profileSha256: 'a'.repeat(64), artifactHash: 'b'.repeat(64), plateCount: 3, durationSeconds: seconds, materialGrams: grams } };
  const operations = s.state.operations ??= { jobs: [], profiles: [] };
  operations.profiles.push(profile);
  operations.jobs.push(job);
  return job;
}

test('the customer quote and the merchant profit floor both account for the selected smaller batch envelope', async () => {
  const s = await sandbox();
  const loose = (await s.command('quote', { qty: 7 })).quotes[0];
  await s.command('capability', { capability: { ...s.capability, maxDimensions: [90, 90, 250] }, expectedRevision: 1, demoAcknowledged: true });
  const { inquiry } = await s.inquiry(7), offer = inquiry.proposals[0];
  const quote = s.state.quotes.find(q => q.quoteId === offer.quoteId);
  assert.equal(loose.batch.plateCount, 1);
  assert.deepEqual(quote.batch.usableSizeMm, [90, 90]);
  assert.equal(quote.batch.plateCount, 7);
  assert.equal(quote.batch.capacityPerPlate, 1);
  assert.ok(quote.pricingSummary.manufacturingCents > loose.pricingSummary.manufacturingCents);
  await assert.rejects(s.propose(inquiry, { manufacturingCents: loose.pricingSummary.manufacturingCents }), { code: 'PROFIT_FLOOR_NOT_MET' });
});

test('inquiry selects matching device and model revision and gives the customer a consistent estimate source', async () => {
  const s = await sandbox();
  s.state.merchant.devices.push({ id: 'device-a' }, { id: 'device-b' });
  await s.command('capability', { capability: { ...s.capability, deviceIds: ['device-a'] }, expectedRevision: 1, demoAcknowledged: true });
  const useful = sliceFixture(s, { id: 'eligible', deviceId: 'device-a' });
  sliceFixture(s, { id: 'different-device', deviceId: 'device-b' });
  sliceFixture(s, { id: 'different-model-version', deviceId: 'device-a', version: 2 });
  const { inquiry } = await s.inquiry(3), offer = inquiry.proposals[0];
  const quote = s.state.quotes.find(q => q.quoteId === offer.quoteId);
  assert.equal(quote.sliceEvidence.jobId, useful.id);
  assert.equal(quote.estimation.method, 'SLICER_OUTPUT');
  assert.equal(quote.estimation.slicer, useful.result.engineVersion);
  assert.equal(quote.estimation.machineValidated, false);
  assert.doesNotMatch(quote.estimation.assumptions.join(' '), /未运行切片器|来自包围盒网格/);
  assert.match(offer.note, /切片结果/);
});

test('manual requotes enforce measured hours, cost, earliest dispatch and the saved slice profile before acceptance', async () => {
  const s = await sandbox();
  const job = sliceFixture(s, { id: 'manual-proof' });
  const { inquiry } = await s.inquiry(3, { requirements: { note: '需人工确认' } });
  await assert.rejects(s.propose(inquiry, { manufacturingCents: 5000 }), { code: 'PROFIT_FLOOR_NOT_MET' });
  await assert.rejects(s.propose(inquiry, { dispatchDays: [0, 5] }), { code: 'INVALID_LEAD_TIME' });
  const result = await s.propose(inquiry);
  assert.equal(result.proposal.productionHours, 30);
  assert.equal(result.proposal.sliceEvidence.jobId, job.id);
  const pricing = s.state.proposalEconomics[0];
  assert.equal(pricing.source, 'MERCHANT_WITH_SLICE_FLOOR');
  assert.ok(pricing.estimatedCostCents > 5000);
  assert.equal('estimatedCostCents' in result.proposal, false);
  s.state.operations.profiles[0].revision++;
  await assert.rejects(s.command('accept-inquiry', { inquiryId: inquiry.id, proposalRevision: 1, customerAccepted: true, demoAcknowledged: true }), { code: 'SLICE_PROFILE_CHANGED' });
  assert.equal(s.state.orders.length, 0);
});

const cubeSTL = await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url), 'utf8');
function transformedFacets(side, offset, inward = false) {
  return [...cubeSTL.matchAll(/facet normal[^]*?endfacet/g)].map(([facet]) => {
    const points = [...facet.matchAll(/vertex (\d+) (\d+) (\d+)/g)].map(([, ...coords]) => coords.map((value, axis) => offset[axis] + Number(value) * side / 20));
    if (inward) points.reverse();
    return 'facet normal 0 0 0\nouter loop\n' + points.map(v => 'vertex ' + v.join(' ')).join('\n') + '\nendloop\nendfacet';
  }).join('\n');
}
function mesh(...parts) {
  return new TextEncoder().encode('solid part\n' + parts.join('\n') + '\nendsolid part');
}

test('translated STL geometry retains the same volume and passes the upload registration path', async () => {
  const s = await sandbox();
  const result = await analyzeModel(mesh(transformedFacets(0.1, [900000, 900000, 900000])), 'translated.stl');
  assert.ok(Math.abs(result.volume - 1e-6) < 1e-12);
  const uploaded = (await s.command('register-model', result)).model;
  assert.equal(uploaded.review, false);
});

test('separate solids with opposite winding require review instead of cancelling their material estimate', async () => {
  const s = await sandbox();
  const result = await analyzeModel(mesh(transformedFacets(20, [0, 0, 0]), transformedFacets(15, [25, 0, 0], true)), 'two-shells.stl');
  assert.equal(result.review, true);
  const uploaded = (await s.command('register-model', result)).model;
  const quote = (await s.command('quote', { modelId: uploaded.id })).quotes[0];
  assert.ok(quote.reviewReasons.includes('MODEL_REVIEW'));
  assert.equal(quote.totalCents, 0);
  const consistent = await analyzeModel(mesh(transformedFacets(20, [0, 0, 0]), transformedFacets(15, [25, 0, 0])), 'consistent.stl');
  assert.equal(consistent.review, false);
  assert.equal(consistent.volume, 8 + 3.375);
});

test('reuploading an old analysis preserves replay and paid order terms, and versions outstanding estimates', async () => {
  const s = await sandbox(), bytes = mesh(transformedFacets(20, [0, 0, 0]));
  const modern = await analyzeModel(bytes, 'legacy.stl');
  const old = { ...modern, analysisVersion: 'stl-server-v2' };
  const key = 'legacy-upload-key';
  const oldUpload = await applyCommand(s.state, { type: 'register-model', payload: old, idempotencyKey: key });
  // Seed the previously paid order. The persisted record and old upload's replay
  // result then have their original pre-upgrade analysis markers.
  oldUpload.workspace.models.find(m => m.id === modern.id).analysisVersion = modern.analysisVersion;
  const raw = await applyCommand(oldUpload.workspace, { type: 'quote', payload: { modelId: modern.id }, idempotencyKey: 'oldquote-one' });
  const ordered = await applyCommand(raw.workspace, { type: 'order', payload: { quoteId: raw.result.quotes[0].quoteId, demoAcknowledged: true }, idempotencyKey: 'paid-order' });
  assert.equal(ordered.result.order.paymentState, 'SIMULATED_FROZEN');
  ordered.workspace.models.find(m => m.id === modern.id).analysisVersion = old.analysisVersion;
  const replay = await applyCommand(ordered.workspace, { type: 'register-model', payload: modern, idempotencyKey: key });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.model.version, 1);
  const upgrade = await applyCommand(replay.workspace, { type: 'register-model', payload: modern, idempotencyKey: 'fresh-upload' });
  assert.equal(upgrade.result.model.version, 2);
  assert.deepEqual(upgrade.workspace.orders[0], ordered.workspace.orders[0]);
  await assert.rejects(applyCommand(upgrade.workspace, { type: 'order', payload: { quoteId: raw.result.quotes[1].quoteId, demoAcknowledged: true }, idempotencyKey: 'outdated-order' }), { code: 'MODEL_CHANGED' });
  const unchanged = await applyCommand(upgrade.workspace, { type: 'register-model', payload: modern, idempotencyKey: 'same-analysis' });
  assert.equal(unchanged.result.model.version, 2);
});

test('accepted merchant offer reports its own frozen cost and profit after a rejected earlier offer', async () => {
  const { getMerchantPricing } = await import('../services/platform/pricing.mjs');
  const s = await sandbox(), { inquiry } = await s.inquiry(1, { material: 'AUTO' });
  const previous = await s.propose(inquiry, { estimatedCostCents: 50000 });
  const current = await s.propose(previous.inquiry, { estimatedCostCents: 60000 });
  const { order } = await s.command('accept-inquiry', { inquiryId: inquiry.id, proposalRevision: current.proposal.revision, customerAccepted: true, demoAcknowledged: true });
  const snapshot = getMerchantPricing(s.state).orderEconomics.find(row => row.orderId === order.id).economics;
  assert.equal(snapshot.estimatedCostCents, 60000);
  assert.equal(snapshot.estimatedProfitCents, 40000);
  assert.equal(snapshot.estimatedMarginBps, 4000);
  assert.equal(snapshot.costBreakdown, undefined);
});

test('the current rules replace pending v0.9.2 merchant, automatic and quick quotes without changing order history', async () => {
  const s = await sandbox();
  const legacy = (await s.command('quote', { qty: 7 })).quotes[0];
  const storedQuote = s.state.quotes.find(q => q.quoteId === legacy.quoteId);
  storedQuote.pricingVersion = 'batch-margin-sandbox-v1';
  delete storedQuote.fingerprint;
  storedQuote.fingerprint = await termsDigest(storedQuote);
  await assert.rejects(s.command('order', { quoteId: legacy.quoteId, demoAcknowledged: true }), { code: 'PRICING_CHANGED' });
  for (const manual of [false, true]) {
    let { inquiry } = await s.inquiry(7, { material: manual ? 'AUTO' : 'PLA' });
    if (manual) inquiry = (await s.propose(inquiry)).inquiry;
    const record = s.state.inquiries.find(item => item.id === inquiry.id);
    delete record.proposals[0].pricingVersion;
    const displayed = getInquiries(s.state).inquiries.find(item => item.id === inquiry.id);
    assert.match(displayed.proposals[0].requoteReason, /重新报价/);
    assert.equal(canAcceptProposal(displayed), false);
    assert.equal(record.proposals[0].requoteReason, undefined); // display-only validity
    await assert.rejects(s.command('accept-inquiry', { inquiryId: inquiry.id, proposalRevision: 1, customerAccepted: true, demoAcknowledged: true }), { code: 'PRICING_CHANGED' });
    const next = await s.propose(inquiry);
    const result = await s.command('accept-inquiry', { inquiryId: inquiry.id, proposalRevision: next.proposal.revision, customerAccepted: true, demoAcknowledged: true });
    assert.equal(result.order.proposalSnapshot.revision, 2);
    assert.equal(result.order.proposalSnapshot.pricingVersion, 'batch-margin-sandbox-v2');
  }
});

test('HTTP new quotes reuse verified stored originals once; absent files only receive engineering review', async () => {
  const bytes = mesh(transformedFacets(20, [0, 0, 0]));
  const modern = await analyzeModel(bytes, 'saved.stl');
  const s = await sandbox();
  await s.command('register-model', { ...modern, analysisVersion: 'stl-server-v2', volume: 2 });
  let state = s.state, stored = null, reads = [];
  const store = {
    async transact(owner, operation) { const outcome = await operation(state); state = outcome.workspace; return outcome; },
    async getFile(owner, id) { reads.push([owner, id]); return stored; },
  };
  async function post(path, payload, key) {
    const response = await handleApi(new Request('https://example.test/api/v2/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) }), { store, ownerId: 'simulated-creator' });
    assert.equal(response.status, 200);
    return response.json();
  }
  const req = { modelId: modern.id, material: 'PLA' };
  const missing = await post('quotes', req, 'missing-file-quote');
  assert.ok(missing.quotes.every(q => q.review && q.totalCents === 0));
  assert.match(missing.quotes[0].estimation.analysisNote, /重新上传/);
  const draft = { ...req, qty: 1, unit: 'mm', capabilityId: s.capability.id, dimensionsConfirmed: true, demoAcknowledged: true };
  const manual = await post('inquiries', draft, 'review-request');
  assert.equal(manual.inquiry.status, 'AWAITING_MERCHANT');
  stored = bytes;
  const priced = await post('quotes', req, 'priced-after-migration');
  assert.ok(priced.quotes.every(q => !q.review && q.volume === 8 && q.modelVersion === 2));
  assert.ok(reads.every(([owner, id]) => owner === 'simulated-creator' && id === modern.id));
  const readCount = reads.length;
  assert.equal((await post('quotes', req, 'priced-after-migration')).replayed, true);
  assert.equal((await post('inquiries', draft, 'new-inquiry')).inquiry.status, 'AWAITING_CUSTOMER');
  await post('quotes', { modelId: 'sample-bracket' }, 'sample-quote');
  assert.equal(reads.length, readCount);
});
