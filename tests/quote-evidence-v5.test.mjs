import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createWorkspace } from '../services/platform/core.mjs';
import { analyzeModel } from '../services/platform/geometry.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';
import { readFile } from 'node:fs/promises';

function context() {
  let state = createWorkspace({ now: 1700000000000 }), n = 0;
  saveCustomerProfile(state, customerProfileFixture(), 1700000000000);
  return { get state() { return state; }, async run(type, payload) {
    const response = await applyCommand(state, { type, payload, idempotencyKey: `evidence-${++n}` }, { now: 1700000000000, idFactory: () => `e-${++n}` });
    state = response.workspace; return response.result;
  } };
}

test('quote preserves actual parser evidence and labels dates as unverified estimates', async () => {
  const ctx = context();
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/cube-20mm.stl', import.meta.url)));
  const analyzed = await analyzeModel(bytes, 'cube.stl');
  const { model } = await ctx.run('register-model', analyzed);
  assert.equal(model.analysisVersion, analyzed.analysisVersion);
  assert.equal(model.analysisNote, analyzed.analysisNote);
  const { quotes } = await ctx.run('quote', { modelId: model.id });
  const q = quotes[0];
  assert.equal(q.estimation.method, 'GEOMETRY_HEURISTIC');
  assert.equal(q.estimation.slicer, null);
  assert.equal(q.estimation.machineValidated, false);
  assert.equal(q.estimation.capacityReserved, false);
  assert.equal(q.estimation.analysisVersion, analyzed.analysisVersion);
  assert.equal(Date.parse(q.estimation.estimatedArrival.earliest), q.issuedAt + q.days[0] * 86400000);
  assert.equal(Date.parse(q.estimation.estimatedArrival.latest), q.issuedAt + q.days[1] * 86400000);
  assert.ok(q.estimation.assumptions.some(value => value.includes('未运行切片器')));
  // Evidence cannot be edited after pricing without invalidating the signed snapshot.
  ctx.state.quotes[0].estimation.machineValidated = true;
  await assert.rejects(ctx.run('order', { quoteId: q.quoteId, demoAcknowledged: true }), { code: 'QUOTE_CHANGED' });
});

test('manual engineering quotes promise no arrival dates or production estimate', async () => {
  const ctx = context();
  const q = (await ctx.run('quote', { material: 'CNC' })).quotes[0];
  assert.equal(q.estimation.method, 'MANUAL_REVIEW');
  assert.equal(q.estimation.estimatedArrival, null);
  assert.equal(q.estimation.stages, null);
  assert.equal(q.totalCents, 0);
});

test('queue estimate includes active sandbox jobs from its farm only', async () => {
  const ctx = context();
  const first = (await ctx.run('quote', {})).quotes[0];
  await ctx.run('order', { quoteId: first.quoteId, demoAcknowledged: true });
  const next = (await ctx.run('quote', {})).quotes;
  assert.equal(next[0].estimation.queueJobs, 1);
  assert.equal(next[1].estimation.queueJobs, 0);
  assert.equal(next[0].estimation.stages.queueHours, first.productionHours);
  assert.equal(next[0].estimation.queueBasis, 'FULL_ESTIMATED_HOURS_OF_ACTIVE_SANDBOX_ORDERS');
});
