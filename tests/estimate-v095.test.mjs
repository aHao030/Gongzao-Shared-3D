import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBudget } from '../services/platform/budget-estimate.mjs';
import { applyCommand, createWorkspace } from '../services/platform/core.mjs';
import { getCapabilities } from '../services/platform/inquiries.mjs';
import { getPricingProfile, platformFeeForManufacturing } from '../services/platform/pricing.mjs';
import { findSliceEvidence } from '../services/platform/operations.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

const now = 1_600_000;
const input = { modelId:'sample-bracket', qty:3, unit:'mm', material:'PLA', quality:'standard' };
function makeShop() {
  const shop = createWorkspace();
  shop.merchant = {profile:{name:'估价测试商家'}};
  shop.pricingProfiles = {f1:{...getPricingProfile(shop, 'f1'), minimumOrderProfitCents:2400}};
  return shop;
}
function observedSlice(shop, model) {
  const profile = {id:'private-profile',revision:1,enabled:true,material:'PLA',farmId:'f1',quality:'standard',deviceId:'private-device'};
  const job = {id:'private-slice',kind:'SLICE_MODEL',status:'COMPLETED',mode:'WORKER',
    modelId:model.id,modelHash:model.sha256,modelVersion:model.version,quantity:3,unit:'mm',
    configSnapshot:{...profile},profileId:profile.id,profileRevision:1,inputHash:'e'.repeat(64),
    result:{provenance:'WORKER_OBSERVED',engineVersion:'test slicer',profileSha256:'a'.repeat(64),artifactHash:'b'.repeat(64),
      plateCount:2,durationSeconds:108000,materialGrams:600}};
  shop.operations = {jobs:[job],profiles:[profile]};
  return job;
}

test('unaddressed reference budget matches the comparable quote, excludes delivery, and has no write side effects', async () => {
  const buyer = createWorkspace(), snapshot = structuredClone(buyer), chosen = {...input,capabilityId:'cap-f1-standard'};
  const preview = estimateBudget(buyer, chosen, {now});
  assert.equal(preview.calculatedAt,now); assert.equal(preview.isSample,true);
  assert.equal(preview.status,'ESTIMATED'); assert.equal(preview.basis,'GEOMETRY');
  assert.equal(preview.shippingCents,null); assert.equal(preview.taxCents,null);
  assert.deepEqual(preview.materialsCompared,['PLA']); assert.equal(preview.lowCents,preview.highCents);
  assert.deepEqual(buyer,snapshot);
  const saved = await applyCommand(buyer,{type:'customer-profile',payload:customerProfileFixture(),idempotencyKey:'budget-address'});
  const quotes = await applyCommand(saved.workspace,{type:'quote',payload:chosen,idempotencyKey:'budget-formal-quote'});
  const formal = quotes.result.quotes.find(item=>item.farm.id==='f1');
  assert.equal(preview.lowCents,formal.totalCents-formal.shippingCents);
  assert.equal(preview.unitLowCents,Math.round(preview.lowCents/input.qty));
  const automatic = estimateBudget(buyer,{...input,material:'AUTO'});
  const prices = ['PLA','PETG'].map(material=>estimateBudget(buyer,{...input,material}));
  assert.deepEqual(automatic.materialsCompared,['PLA','PETG']);
  assert.equal(automatic.lowCents,Math.min(...prices.map(p=>p.lowCents)));
  assert.equal(automatic.highCents,Math.max(...prices.map(p=>p.highCents)));
});

test('only the selected merchant supplies costs, limits and manufacturing profit floors', () => {
  const buyer = createWorkspace(), shop = makeShop();
  const normal = estimateBudget(buyer,input,{now});
  buyer.pricingProfiles = {f1:{...getPricingProfile({},'f1'),minimumOrderProfitCents:1000000}};
  assert.deepEqual(estimateBudget(buyer,input,{now}),normal);
  const smallBed = {...getCapabilities(shop).capabilities[0],maxDimensions:[90,90,250],revision:2,updatedAt:now};
  shop.manufacturingCapabilities = [smallBed,...getCapabilities({}).capabilities.slice(1)];
  const quantity = 7;
  const low = estimateBudget(buyer,{...input,qty:quantity},{merchantWorkspace:shop,now});
  assert.equal(low.source,'SHOP_CONFIG'); assert.equal(low.lowCents,low.highCents);
  const frozen = JSON.stringify(low);
  smallBed.maxDimensions[0] = 240; smallBed.maxDimensions[1] = 240;
  const large = estimateBudget(buyer,{...input,qty:quantity},{merchantWorkspace:shop,now});
  assert.ok(low.lowCents > large.lowCents);
  shop.pricingProfiles.f1.minimumOrderProfitCents=100000;
  const expensive=estimateBudget(buyer,input,{merchantWorkspace:shop,now});
  assert.ok(expensive.lowCents >= 100000 + platformFeeForManufacturing(100000));
  assert.equal(JSON.stringify(low),frozen);
  assert.doesNotMatch(JSON.stringify(expensive),/materialCost|minimumProfit|riskReserve|targetMargin|private-/);
  smallBed.enabled = false;
  assert.equal(estimateBudget(buyer,input,{merchantWorkspace:shop,now}).status,'REVIEW_REQUIRED');
  assert.equal(estimateBudget(buyer,input,{merchantWorkspace:createWorkspace(),now}).source,'PLATFORM_REFERENCE');
});

test('matching slicer output covers the whole batch and foreign prices and job identifiers remain private', () => {
  const buyer=createWorkspace(), shop=makeShop(), job=observedSlice(shop,buyer.models[0]);
  const snapshot=estimateBudget(buyer,input,{merchantWorkspace:shop,now});
  const match=findSliceEvidence(shop,{...input,modelHash:buyer.models[0].sha256,modelVersion:1,farmId:'f1'});
  const measured=match.economics.suggestedManufacturingCents;
  assert.equal(snapshot.basis,'SLICER'); assert.equal(snapshot.lowCents,measured+platformFeeForManufacturing(measured));
  assert.ok(snapshot.lowCents < measured * input.qty);
  assert.doesNotMatch(JSON.stringify(snapshot),/private-slice|private-device|private-profile|artifactHash|modelHash|estimatedCost/);
  assert.equal(estimateBudget(buyer,{...input,qty:2},{merchantWorkspace:shop}).basis,'GEOMETRY');
  job.modelVersion++;
  assert.equal(estimateBudget(buyer,input,{merchantWorkspace:shop}).basis,'GEOMETRY');
});

test('unavailable geometry, uncertain process, stale analysis, invalid inputs and oversize models never return a zero price', () => {
  const owner=createWorkspace(), part=owner.models[0];
  for (const request of [{...input,material:'CNC'}, {...input,material:'RESIN'}, {...input,unit:'inch'}, {...input,capabilityId:'absent'}]) {
    const result=estimateBudget(owner,request);assert.equal(result.status,'REVIEW_REQUIRED');
    assert.equal(result.lowCents,null);assert.equal(result.highCents,null);
  }
  for (const invalid of [{qty:0},{qty:1.5},{qty:51},{qty:'3'},{material:'UNKNOWN'},{material:['PLA']},{unit:'cm'},{quality:'FAST'}]) {
    assert.throws(()=>estimateBudget(owner,{...input,...invalid}),e=>e.status===400);
  }
  assert.throws(()=>estimateBudget(owner,{...input,modelId:'absent'}),{code:'MODEL_NOT_FOUND'});
  part.isSample=false; part.analysisVersion='stl-server-v2';
  assert.equal(estimateBudget(owner,input).reasonCode,'LEGACY_ANALYSIS');
  part.analysisVersion='stl-server-v3'; part.closed=false;
  assert.equal(estimateBudget(owner,input).reasonCode,'MODEL_REVIEW');
});
