import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { getCapabilities, getInquiries } from '../services/platform/inquiries.mjs';
import { saveCustomerProfile } from '../services/platform/customer.mjs';
import { getPricingProfile, settlementBreakdown } from '../services/platform/pricing.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

function sandbox() {
  let workspace = createWorkspace({now: Date.parse('2026-11-09T00:00:00Z')}), sequence = 0;
  workspace.merchant = { profile: {name:'领域测试工作室'}, devices:[], gateways:[], scans:[], ledger:{} };
  saveCustomerProfile(workspace, customerProfileFixture(), workspace.createdAt);
  const run = async (type, payload, key = 'domain-' + (++sequence)) => {
    const outcome = await applyCommand(workspace, {type, payload, idempotencyKey:key}, {now: workspace.createdAt + sequence, idFactory:()=>'d-' + (++sequence)});
    workspace = outcome.workspace; return outcome.result;
  };
  const inquiry = (extra = {}) => run('inquiry', {modelId:'sample-bracket', capabilityId:'cap-f1-standard', unit:'mm', qty:1, material:'AUTO', dimensionsConfirmed:true, demoAcknowledged:true, ...extra});
  const propose = (inquiry, extra = {}) => run('proposal', {inquiryId:inquiry.id, expectedInquiryRevision:inquiry.revision, material:'PLA', quality:'standard', manufacturingCents:100000, shippingCents:1200, estimatedCostCents:10000, productionHours:3, dispatchDays:[1,2], transitDays:[1,3], note:'按确认的方案加工并检验。', demoAcknowledged:true, ...extra});
  const accept = inquiry => run('accept-inquiry', {inquiryId:inquiry.id, proposalRevision:inquiry.currentProposalRevision, customerAccepted:true, demoAcknowledged:true});
  const save = (capability, extra={}) => run('capability',{capability, expectedRevision:capability.id ? capability.revision : 0, demoAcknowledged:true,...extra});
  const action = (action,id,extra={}) => run('action',{action,id,demoAcknowledged:true,...extra});
  return {run,inquiry,propose,accept,save,action,get workspace(){return workspace},set workspace(value){workspace=value}};
}

test('v8 capability saves are versioned, validate process/device ownership and cannot grant hardware authorization', async () => {
  const s = sandbox(), cap = getCapabilities(s.workspace).capabilities[0];
  await assert.rejects(s.save({...cap, deviceIds:['other-owner-device']}),{code:'INVALID_DEVICE'});
  await assert.rejects(s.save({...cap, process:'CNC', materials:['PLA']}),{code:'INVALID_MATERIAL'});
  await assert.rejects(s.save({...cap, process:'CNC', materials:['CNC']}),{code:'AUTO_ESTIMATE_UNSUPPORTED'});
  await assert.rejects(s.save({...cap, maxDimensions:[Infinity,200,200]}),{code:'INVALID_INPUT'});
  const saved = (await s.save({...cap, name:'我的 FDM 服务', hardwareVerified:true, startPrint:true, realProduction:true})).capability;
  assert.equal(saved.revision,2); assert.equal(saved.hardwareVerified,false); assert.equal(saved.startPrint,undefined);
  assert.equal(getCapabilities(s.workspace).realProduction,false);
  await assert.rejects(s.save({...cap, enabled:false}),{code:'CAPABILITY_CHANGED'});
});

test('v8 geometry normalization confirms units without mutating the uploaded model geometry', async () => {
  const s = sandbox();
  await assert.rejects(s.inquiry({unit:'inch'}),{code:'CAPABILITY_SIZE_EXCEEDED'});
  s.workspace.models[0].dimensions=[1,1,1];s.workspace.models[0].volume=.001;
  const result = await s.inquiry({unit:'inch'});
  assert.deepEqual(result.inquiry.dimensionsMm,[25.4,25.4,25.4]);
  assert.ok(Math.abs(result.inquiry.volumeCm3-16.387064)<1e-8);
  assert.deepEqual(result.inquiry.modelSnapshot.dimensions,[1,1,1]);
  assert.deepEqual(s.workspace.models[0].dimensions,[1,1,1]);
});

test('v8 requested dates are real calendar dates, target only, and force merchant review', async () => {
  const s=sandbox();
  for(const requestedDeliveryDate of ['2026-02-30','2026-11-08','2030-01-01','soon']) await assert.rejects(s.inquiry({requirements:{requestedDeliveryDate}}),{code:'INVALID_DELIVERY_DATE'});
  const {inquiry}=await s.inquiry({material:'PLA',requirements:{requestedDeliveryDate:'2026-11-20'}});
  assert.equal(inquiry.status,'AWAITING_MERCHANT');assert.equal(inquiry.currentProposalRevision,null);assert.equal(s.workspace.orders.length,0);
});

test('v8 manufacturing configuration is frozen per offer even when the merchant later changes its template', async () => {
  const s=sandbox(), created=(await s.inquiry()).inquiry, first=(await s.propose(created)).inquiry;
  const old=structuredClone(first.proposals[0]);
  const cap=getCapabilities(s.workspace).capabilities[0];
  await s.save({...cap,name:'新版制造能力',note:'更改工艺说明'});
  await assert.rejects(s.accept(first),{code:'CAPABILITY_CHANGED'});
  const second=(await s.propose(first,{material:'PETG',note:'改为 PETG，请客户重新确认。'})).inquiry;
  assert.equal(second.proposals[0].status,'SUPERSEDED');
  assert.deepEqual(second.proposals[0].capabilitySnapshot,old.capabilitySnapshot);
  assert.equal(second.proposals[1].capabilitySnapshot.name,'新版制造能力');
  assert.equal(second.proposals[1].material,'PETG');
  const order=(await s.accept(second)).order;
  assert.equal(order.capabilitySnapshot.name,'新版制造能力');
  assert.equal(order.proposalSnapshot.revision,2);assert.equal(order.paymentState,'SIMULATED_FROZEN');
  assert.equal(order.productionState,'REVIEW_REQUIRED');assert.equal(s.workspace.devices[0].orderId,null);
});

test('v8 direct old order endpoint cannot bypass exact proposal confirmation',async()=>{
  const s=sandbox(), {inquiry}=await s.inquiry({material:'PLA'}), proposal=inquiry.proposals[0];
  await assert.rejects(s.run('order',{quoteId:proposal.quoteId,demoAcknowledged:true}),{code:'PROPOSAL_CONFIRMATION_REQUIRED'});
  assert.equal(s.workspace.orders.length,0);
  const result=await s.accept(inquiry);assert.equal(result.order.inquiryId,inquiry.id);assert.equal(result.physicalCommandsSent,0);assert.equal(result.moneyTransferred,0);
});

test('v8 legacy quotes cannot bypass paused capabilities and invalidate pre-configuration quotes',async()=>{
  const s=sandbox();
  const old=(await s.run('quote',{material:'PLA'})).quotes[0];
  const cap=getCapabilities(s.workspace).capabilities[0];
  await s.save({...cap,enabled:false});
  await assert.rejects(s.run('order',{quoteId:old.quoteId,demoAcknowledged:true}),{code:'CAPABILITY_UNAVAILABLE'});
  const latest=(await s.run('quote',{material:'PLA'})).quotes.find(q=>q.farm.id==='f1');
  assert.equal(latest.review,true);assert.ok(latest.reviewReasons.includes('CAPABILITY_UNAVAILABLE'));
  await assert.rejects(s.run('order',{quoteId:latest.quoteId,demoAcknowledged:true}),{code:'CAPABILITY_UNAVAILABLE'});
  await assert.rejects(s.inquiry(),{code:'CAPABILITY_DISABLED'});
});

test('v8 selected template cannot be shadowed by another matching template on the same demo farm',async()=>{
  const s=sandbox(), standard=getCapabilities(s.workspace).capabilities[0];
  await s.save({...standard,quoteMode:'MERCHANT_REVIEW'});
  const {id,revision,...newTemplate}=standard;
  const custom=(await s.save({...newTemplate,name:'另一套标准模板'})).capability;
  const {inquiry}=await s.inquiry({capabilityId:custom.id,material:'PLA'});
  assert.equal(inquiry.status,'AWAITING_CUSTOMER');
  assert.equal(inquiry.proposals[0].capabilityId,custom.id);
  const {order}=await s.accept(inquiry);assert.equal(order.quoteSnapshot.capabilityId,custom.id);
});

test('v8 manual manufacturing estimate cannot undercut known modeled cost or per-hour profit floor',async()=>{
  const s=sandbox(), {inquiry}=await s.inquiry({qty:20});
  await assert.rejects(s.propose(inquiry,{manufacturingCents:1000,estimatedCostCents:1,productionHours:.01,dispatchDays:[1,3]}),{code:'PROFIT_FLOOR_NOT_MET'});
  await assert.rejects(s.propose(inquiry,{estimatedCostCents:1,productionHours:.01,dispatchDays:[0,1]}),{code:'INVALID_LEAD_TIME'});
  const proposal=(await s.propose(inquiry,{estimatedCostCents:1,productionHours:.01,dispatchDays:[1,3]})).proposal;
  const economics=getInquiries(s.workspace,true).proposalEconomics[0];
  assert.ok(economics.estimatedCostCents>1);assert.ok(proposal.productionHours>20);
  assert.equal(proposal.productionHours,economics.productionHoursForFloor);
  assert.doesNotMatch(JSON.stringify(getPublicWorkspace(s.workspace)),/estimatedCostCents|profitFloorCents|minimumManufacturingCents|targetMarginBps/);
});

test('v8 approved standard order retains balanced settlement through simulated fulfillment',async()=>{
  const s=sandbox(), {inquiry}=await s.inquiry({material:'PLA'}), {order}=await s.accept(inquiry);
  const snapshot=structuredClone(order.proposalSnapshot), terms=settlementBreakdown(order);
  assert.equal(terms.source,'V0_8_PROPOSAL');assert.equal(terms.customerTotalCents,order.totalCents);
  await s.action('complete-print',order.deviceId);
  await s.action('collect-and-qc',order.id,{partRemoved:true,qcPassed:true,bedClear:true,materialReady:true,loadedMaterial:'PLA'});
  await s.action('ship',order.id,{carrier:'模拟快递',trackingNumber:'DEMO-V8-SETTLEMENT'});
  await s.action('deliver',order.id);
  await s.action('accept',order.id,{customerAccepted:true});
  const requested=(await s.action('request-settlement',order.id)).order;
  assert.equal(requested.settlementAttempt.amountCents,terms.merchantReceivableCents);
  const done=(await s.action('resolve-settlement',order.id,{attemptId:requested.settlementAttempt.id,outcome:'succeeded'})).order;
  assert.equal(done.paymentState,'SIMULATED_RELEASED');assert.deepEqual(done.proposalSnapshot,snapshot);
});
