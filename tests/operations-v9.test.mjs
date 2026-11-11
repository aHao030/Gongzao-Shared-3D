import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, applyCommand, getPublicWorkspace } from '../services/platform/core.mjs';
import { getOperations, applyOperationsCommand, findSliceEvidence } from '../services/platform/operations.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

function harness() {
  let state = createWorkspace({now:1000000}), sequence = 0, now = 1000000;
  state.merchant = {profile:{name:'测试农场'},devices:[],gateways:[],scans:[],ledger:{}};
  saveCustomerProfile(state,customerProfileFixture(),now);
  const run = async (type,payload={},context={},key='ops-test-'+(++sequence)) => {
    const outcome = await applyOperationsCommand(state,{type,payload,idempotencyKey:key},{now,idFactory:()=>String(++sequence),...context});
    state=outcome.workspace;return outcome;
  };
  const profile = async (extra={}) => (await run('save-profile',{name:'PLA 标准',localProfileId:'pla-standard',engine:'PrusaSlicer',process:'FDM',material:'PLA',quality:'standard',deviceId:'p1',farmId:'f1',expectedRevision:0,enabled:true,...extra})).result.profile;
  const spool = async (extra={}) => (await run('save-spool',{name:'PLA 白色',material:'PLA',remainingGrams:1000,costCentsPerKg:6000,expectedRevision:0,mode:'SANDBOX',...extra})).result.spool;
  const order = async () => { const q=await applyCommand(state,{type:'quote',payload:{material:'PLA'},idempotencyKey:'quote-'+(++sequence)},{now,idFactory:()=>String(++sequence)});state=q.workspace;const o=await applyCommand(state,{type:'order',payload:{quoteId:q.result.quotes[0].quoteId,demoAcknowledged:true},idempotencyKey:'order-'+(++sequence)},{now,idFactory:()=>String(++sequence)});state=o.workspace;return o.result.order; };
  const sandboxSlice = async profileId => (await run('queue-job',{kind:'SLICE_MODEL',modelId:'sample-bracket',profileId,quantity:1,unit:'mm',mode:'SANDBOX',demoAcknowledged:true})).result.job;
  return {run,profile,spool,order,sandboxSlice,get state(){return state},set state(x){state=x},get now(){return now},set now(x){now=x}};
}
const geometry={dimensionsMm:[20,20,20],volumeMm3:8000,surfaceAreaMm2:2400,watertight:true,windingConsistent:true,isVolume:true,bodyCount:1,faceCount:12,requiresReview:false,warnings:[]};

test('v9 read lazily initializes no state and keeps merchant costs outside customer workspace',async()=>{
  const h=harness(),before=JSON.stringify(h.state);
  assert.equal(getOperations(h.state).summary.spoolCount,0);assert.equal(JSON.stringify(h.state),before);
  await h.spool();
  assert.equal(getPublicWorkspace(h.state).operations,undefined);
  h.state.orders.push({id:'fine-order',quality:'fine'},{id:'legacy-order'});
  assert.deepEqual(getOperations(h.state).orders.map(order=>order.quality),['fine','standard']);
  const customer=createWorkspace();assert.throws(()=>getOperations(customer),{code:'MERCHANT_REQUIRED'});
});

test('v9 production workflow reserves stock once, records actual cost, requires QC and preserves paid quote',async()=>{
  const h=harness(),profile=await h.profile(),spool=await h.spool(),job=await h.sandboxSlice(profile.id),order=await h.order();
  const frozen=JSON.stringify(h.state.orders[0].quoteSnapshot);
  const production=(await h.run('create-production',{orderId:order.id,sliceJobId:job.id,spoolId:spool.id,adoptExistingSimulation:true,demoAcknowledged:true})).result.production;
  assert.equal(h.state.operations.spools[0].reservedGrams,production.reservedGrams);
  await assert.rejects(h.run('create-production',{orderId:order.id,sliceJobId:job.id,spoolId:spool.id,adoptExistingSimulation:true,demoAcknowledged:true}),{code:'PRODUCTION_EXISTS'});
  await assert.rejects(h.run('dispatch-production',{productionId:production.id,demoAcknowledged:true}),{code:'READINESS_REQUIRED'});
  await h.run('readiness',{productionId:production.id,bedClear:true,materialReady:true,deviceClear:true,loadedMaterial:'PLA',demoAcknowledged:true});
  await h.run('dispatch-production',{productionId:production.id,demoAcknowledged:true});
  await assert.rejects(h.run('dispatch-production',{productionId:production.id,demoAcknowledged:true}),{code:'READINESS_REQUIRED'});
  await assert.rejects(h.run('qc-production',{productionId:production.id,partRemoved:true,bedClear:true,passed:true,demoAcknowledged:true}),{code:'INVALID_PRODUCTION_STATE'});
  const done=(await h.run('finish-production',{productionId:production.id,actualMaterialGrams:30,actualDurationSeconds:7200,demoAcknowledged:true})).result.production;
  assert.equal(h.state.operations.spools[0].remainingGrams,970);assert.equal(h.state.operations.spools[0].reservedGrams,0);
  assert.equal(done.reservationState,'CONSUMED');assert.equal(done.actuals.provenance,'MERCHANT_SIMULATED_ENTRY');assert.ok(Number.isInteger(done.actuals.actualCostCents));
  await h.run('qc-production',{productionId:production.id,partRemoved:true,bedClear:true,passed:true,demoAcknowledged:true});
  assert.equal(h.state.orders[0].productionState,'QC_PASSED');assert.equal(h.state.devices[0].orderId,null);
  assert.equal(JSON.stringify(h.state.orders[0].quoteSnapshot),frozen);
  assert.equal(h.state.operations.productions[0].physicalCommandsSent,0);
});

test('v9 cannot use real inventory or changed profile to simulate paid production',async()=>{
  const h=harness(),profile=await h.profile(),spool=await h.spool({mode:'LIVE_INVENTORY'}),job=await h.sandboxSlice(profile.id),order=await h.order();
  await assert.rejects(h.run('create-production',{orderId:order.id,sliceJobId:job.id,spoolId:spool.id,adoptExistingSimulation:true,demoAcknowledged:true}),{code:'SIMULATION_INVENTORY_REQUIRED'});
  await h.profile({...profile,expectedRevision:profile.revision,name:'新版'});
  await assert.rejects(h.run('create-production',{orderId:order.id,sliceJobId:job.id,spoolId:spool.id,adoptExistingSimulation:true,demoAcknowledged:true}),{code:'PROFILE_CHANGED'});
});

test('v9 worker result is bound to lease, file hash, profile revision and worker provenance',async()=>{
  const h=harness(),profile=await h.profile({expectedProfileSha256:'a'.repeat(64)});
  const model={...h.state.models[0],id:'mdl_test',isSample:false,sha256:'b'.repeat(64)};h.state.models.push(model);
  const job=(await h.run('queue-job',{kind:'SLICE_MODEL',modelId:model.id,profileId:profile.id,quantity:2,unit:'mm',mode:'WORKER'})).result.job;
  await assert.rejects(h.run('claim-job',{}),{code:'WORKER_REQUIRED'});
  const claim=(await h.run('claim-job',{kinds:['SLICE_MODEL']},{workerId:'worker-one'})).result.job;
  assert.equal(claim.id,job.id);assert.ok(claim.leaseToken);assert.equal(getOperations(h.state).jobs[0].leaseToken,undefined);
  const completion={jobId:job.id,leaseToken:claim.leaseToken,attempt:claim.attempt,result:{inputHash:job.inputHash,modelHash:model.sha256,profileRevision:profile.revision,engineVersion:'PrusaSlicer-test',provenance:'WORKER_OBSERVED',materialGrams:40,durationSeconds:3600,artifactHash:'c'.repeat(64),profileSha256:'a'.repeat(64),geometry}};
  await assert.rejects(h.run('complete-job',completion,{workerId:'worker-two'}),{code:'STALE_JOB_LEASE'});
  await assert.rejects(h.run('complete-job',{...completion,result:{...completion.result,modelHash:'d'.repeat(64)}},{workerId:'worker-one'}),{code:'JOB_RESULT_MISMATCH'});
  await h.run('complete-job',completion,{workerId:'worker-one'});
  assert.equal(h.state.operations.jobs[0].result.durationSeconds,3600);
  const evidence=findSliceEvidence(h.state,{modelId:model.id,modelHash:model.sha256,qty:2,unit:'mm',material:'PLA',farmId:'f1',quality:'standard'});
  assert.equal(evidence.job.id,job.id);assert.ok(evidence.economics.suggestedManufacturingCents>0);
  assert.equal(findSliceEvidence(h.state,{modelId:model.id,modelHash:model.sha256,qty:2,unit:'mm',material:'PLA',farmId:'f1',quality:'fine'}),null);
});

test('v9 expired computation can retry with a new lease while stale claim and completion are rejected',async()=>{
  const h=harness();h.state.models.push({...h.state.models[0],id:'mdl_uploaded',isSample:false});
  await h.run('queue-job',{kind:'ANALYZE_MODEL',modelId:'mdl_uploaded',mode:'WORKER'});
  const first=await h.run('claim-job',{leaseSeconds:30},{workerId:'worker-one'},'persistent-claim');
  h.now+=31000;
  const stale=await h.run('claim-job',{leaseSeconds:30},{workerId:'worker-one'},'persistent-claim');assert.equal(stale.result.job,null);assert.equal(stale.result.staleClaim,true);
  const second=(await h.run('claim-job',{leaseSeconds:30},{workerId:'worker-two'})).result.job;
  assert.equal(second.attempt,2);assert.notEqual(second.leaseToken,first.result.job.leaseToken);
  await assert.rejects(h.run('fail-job',{jobId:second.id,leaseToken:first.result.job.leaseToken,attempt:1,errorCode:'FAILED',errorMessage:'old'},{workerId:'worker-one'}),{code:'STALE_JOB_LEASE'});
});

test('v9 idle worker polls and no-op expiry do not fill ledger or increment workspace revision',async()=>{
  const h=harness(),revision=h.state.revision;
  for(let i=0;i<1600;i++) {const r=await h.run('claim-job',{}, {workerId:'idle-worker'});assert.equal(r.result.job,null);}
  assert.equal(h.state.revision,revision);assert.equal(h.state.operations,undefined);
  const r=await h.run('expire-leases',{}, {workerId:'idle-worker'});assert.equal(r.result.expired,0);assert.equal(h.state.revision,revision);
});

test('v9 trusted Spoolman sync keeps separate live inventory and rejects forged browser source',async()=>{
  const h=harness(),spools=[{externalId:'42',name:'实际 PLA',material:'PLA',remainingGrams:500,costCentsPerKg:8000}];
  await assert.rejects(h.run('sync-spools',{spools}),{code:'INTEGRATION_REQUIRED'});
  await h.run('sync-spools',{spools},{integration:'spoolman'});
  const live=h.state.operations.spools[0];assert.equal(live.mode,'LIVE_INVENTORY');assert.equal(live.source,'SPOOLMAN');
  await h.run('sync-spools',{spools:[{...spools[0],remainingGrams:480}]},{integration:'spoolman'});
  assert.equal(h.state.operations.spools.length,1);assert.equal(h.state.operations.spools[0].remainingGrams,480);
  await assert.rejects(h.run('save-spool',{...h.state.operations.spools[0],expectedRevision:2}),{code:'EXTERNAL_INVENTORY_READ_ONLY'});
});

test('v9 unknown external material cost is not zero and merchant price survives later sync',async()=>{
  const h=harness(),item={externalId:'unknown-price',name:'未定采购价耗材',material:'PLA',remainingGrams:500};
  await h.run('sync-spools',{spools:[item]},{integration:'spoolman'});
  let spool=h.state.operations.spools[0];assert.equal(spool.costConfigured,false);assert.equal(spool.costCentsPerKg,null);
  await h.run('set-spool-cost',{id:spool.id,expectedRevision:spool.revision,costCentsPerKg:7500});
  await h.run('sync-spools',{spools:[{...item,remainingGrams:450,costCentsPerKg:6000}]},{integration:'spoolman'});
  spool=h.state.operations.spools[0];assert.equal(spool.source,'SPOOLMAN');assert.equal(spool.externalId,'unknown-price');assert.equal(spool.remainingGrams,450);assert.equal(spool.costCentsPerKg,7500);assert.equal(spool.costSource,'MERCHANT_ENTRY');
});

test('v9 idempotency preserves durable results and rejects changed input',async()=>{
  const h=harness(),p={name:'卷一',material:'PLA',remainingGrams:100,costCentsPerKg:5000,expectedRevision:0};
  const a=await h.run('save-spool',p,{},'same-request');h.state=JSON.parse(JSON.stringify(h.state));
  const b=await h.run('save-spool',p,{},'same-request');assert.equal(b.replayed,true);assert.equal(b.result.spool.id,a.result.spool.id);
  await assert.rejects(h.run('save-spool',{...p,remainingGrams:200},{},'same-request'),{code:'IDEMPOTENCY_CONFLICT'});
});

test('v9 schedule estimates are non-overlapping and cannot claim a physical dispatch',async()=>{
  const h=harness(),profile=await h.profile(),spool=await h.spool(),job=await h.sandboxSlice(profile.id),order=await h.order();
  const production=(await h.run('create-production',{orderId:order.id,sliceJobId:job.id,spoolId:spool.id,adoptExistingSimulation:true,demoAcknowledged:true})).result.production;
  const schedule=(await h.run('schedule',{})).result.schedule;
  assert.equal(schedule.schedule[0].jobId,production.id);assert.equal(schedule.confirmed,false);assert.equal(schedule.solverStatus,'HEURISTIC');
  await assert.rejects(h.run('create-production',{orderId:order.id,sliceJobId:job.id,spoolId:spool.id,mode:'LIVE',demoAcknowledged:true}),{code:'REAL_DISPATCH_DISABLED'});
});
