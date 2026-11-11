import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createApiClient } = createRequire(import.meta.url)('../shared/api-client.js');
const base = 'https://sandbox-api.example.test';
const make = (transport, getAccessToken = () => 'test-only-token') => createApiClient({ apiBase: base, transport, getAccessToken });
const inquiryInput = {
  modelId: 'mdl_uploaded-part', capabilityId: 'cap-f1-standard', unit: 'mm', qty: 10,
  material: 'AUTO', dimensionsConfirmed: true,
  requirements: { purpose: '装配验证', color: '白色', toleranceMm: 0.15, note: '请确认孔径', requestedDeliveryDate: '2027-01-20' }
};
const capabilityInput = {
  capability: { id: 'cap-f1-standard', name: '标准打印', farmId: 'f1', process: 'FDM', materials: ['PLA', 'PETG'], maxDimensions: [220, 220, 240], qualities: ['standard'], enabled: true, quoteMode: 'MERCHANT_REVIEW', deviceIds: [], note: '' },
  expectedRevision: 3
};
const proposalInput = {
  inquiryId: 'INQ-1', expectedInquiryRevision: 2, material: 'PETG', quality: 'standard',
  manufacturingCents: 12345, shippingCents: 1500, estimatedCostCents: 4000,
  productionHours: 8.5, dispatchDays: [2, 3], transitDays: [1, 2], note: '使用 PETG，按模型尺寸加工'
};
const acceptanceInput = { inquiryId: 'INQ-1', proposalRevision: 4, customerAccepted: true };
const successful = { inquiry: { id: 'INQ-1' }, order: { id: 'DEMO-1' }, capability: { id: 'cap-f1-standard' } };

test('workflow list methods use role-specific routes and reject missing or malformed lists', async () => {
  const routes = [
    ['getCapabilities', '/capabilities', 'capabilities'],
    ['getMerchantCapabilities', '/merchant/capabilities', 'capabilities'],
    ['getInquiries', '/inquiries', 'inquiries'],
    ['getMerchantInquiries', '/merchant/inquiries', 'inquiries']
  ];
  for (const [method, path, key] of routes) {
    let captured;
    const client = make(async request => { captured = request; return { status: 200, data: { [key]: [{ id: 'record-1' }] } }; });
    assert.equal((await client[method]())[key][0].id, 'record-1');
    assert.equal(captured.url, base + '/api/v2' + path);
    assert.equal(captured.method, 'GET');
    assert.equal(captured.data, undefined);
    for (const data of [{}, { [key]: {} }, { [key]: [null] }, { [key]: [{ id: '' }] }]) {
      await assert.rejects(make(async () => ({ status: 200, data }))[method](), { code: 'INVALID_RESPONSE' });
    }
    assert.deepEqual((await make(async () => ({ status: 200, data: { [key]: [] } }))[method]())[key], []);
  }
});

test('model-first inquiry preserves recommendation, dimensions, quantity and customer tolerance without machine settings', async () => {
  let captured;
  const original = structuredClone(inquiryInput);
  const result = await make(async request => { captured = request; return { status: 201, data: successful }; }).createInquiry(inquiryInput, 'inquiry-create-1');
  assert.equal(result.inquiry.id, 'INQ-1');
  assert.equal(captured.url, base + '/api/v2/inquiries');
  assert.equal(captured.method, 'POST');
  assert.deepEqual(captured.data, { ...inquiryInput, demoAcknowledged: true });
  assert.deepEqual(inquiryInput, original);
  assert.equal(captured.data.requirements.toleranceMm, 0.15);
  assert.equal(Object.hasOwn(captured.data, 'quality'), false);
  assert.equal(Object.hasOwn(captured.data, 'temperature'), false);
});

test('merchant changes carry the exact expected revision and costs to merchant-only endpoints', async () => {
  const calls = [];
  const client = make(async request => { calls.push(request); return { status: 200, data: successful }; });
  await client.saveCapability(capabilityInput, 'capability-save-1');
  await client.submitProposal(proposalInput, 'proposal-submit-1');
  assert.equal(calls[0].url, base + '/api/v2/merchant/capabilities');
  assert.deepEqual(calls[0].data, { ...capabilityInput, demoAcknowledged: true });
  assert.equal(calls[1].url, base + '/api/v2/merchant/proposals');
  assert.deepEqual(calls[1].data, { ...proposalInput, demoAcknowledged: true });
  assert.equal(calls[1].data.estimatedCostCents, 4000);
  assert.equal(calls[1].data.expectedInquiryRevision, 2);
});

test('acceptance requires explicit customer confirmation and pins the selected proposal revision', async () => {
  let captured, calls = 0;
  const client = make(async request => { calls++; captured = request; return { status: 201, data: successful }; });
  for (const customerAccepted of [undefined, false, 'true']) {
    await assert.rejects(client.acceptProposal({ ...acceptanceInput, customerAccepted }, 'accept-plan-1'), { code: 'CUSTOMER_CONFIRMATION_REQUIRED' });
  }
  for (const proposalRevision of [undefined, 0, -1, 1.5, '4']) {
    await assert.rejects(client.acceptProposal({ ...acceptanceInput, proposalRevision }, 'accept-plan-1'), { code: 'REVISION_REQUIRED' });
  }
  assert.equal(calls, 0);
  const result = await client.acceptProposal({ ...acceptanceInput, demoAcknowledged: false }, 'accept-plan-1');
  assert.equal(captured.url, base + '/api/v2/inquiries/accept');
  assert.deepEqual(captured.data, { ...acceptanceInput, demoAcknowledged: true });
  assert.equal(result.order.id, 'DEMO-1');
});

test('all workflow mutations require a reusable idempotency key and never retry a network failure themselves', async () => {
  for (const [method, input] of [['saveCapability', capabilityInput], ['createInquiry', inquiryInput], ['submitProposal', proposalInput], ['acceptProposal', acceptanceInput]]) {
    const calls = [];
    const client = make(async request => { calls.push(request); throw new Error('ambiguous response'); });
    await assert.rejects(client[method](input), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
    assert.equal(calls.length, 0);
    await assert.rejects(client[method](input, 'workflow-retry-1'), { code: 'NETWORK_ERROR' });
    assert.equal(calls.length, 1, 'network failures must not trigger automatic replay');
    await assert.rejects(client[method](input, 'workflow-retry-1'), { code: 'NETWORK_ERROR' });
    assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
    assert.deepEqual(calls[0].data, calls[1].data);
  }
});

test('workflow mutations validate confirmations and concurrency versions before any transport', async () => {
  let calls = 0;
  const client = make(async () => { calls++; return { status: 200, data: successful }; });
  for (const input of [null, undefined, [], 'invalid']) {
    await assert.rejects(client.saveCapability(input, 'test-invalid-1'), { code: 'CAPABILITY_REQUIRED' });
    await assert.rejects(client.createInquiry(input, 'test-invalid-1'), { code: 'INQUIRY_REQUIRED' });
    await assert.rejects(client.submitProposal(input, 'test-invalid-1'), { code: 'PROPOSAL_REQUIRED' });
    await assert.rejects(client.acceptProposal(input, 'test-invalid-1'), { code: 'PROPOSAL_REQUIRED' });
  }
  for (const expectedRevision of [undefined, -1, 1.2, '2']) {
    await assert.rejects(client.saveCapability({ ...capabilityInput, expectedRevision }, 'test-invalid-1'), { code: 'REVISION_REQUIRED' });
  }
  for (const expectedInquiryRevision of [undefined, 0, 1.2, '2']) {
    await assert.rejects(client.submitProposal({ ...proposalInput, expectedInquiryRevision }, 'test-invalid-1'), { code: 'REVISION_REQUIRED' });
  }
  await assert.rejects(client.createInquiry({ ...inquiryInput, dimensionsConfirmed: false }, 'test-invalid-1'), { code: 'DIMENSIONS_CONFIRMATION_REQUIRED' });
  await assert.rejects(client.createInquiry({ ...inquiryInput, modelId: '' }, 'test-invalid-1'), { code: 'MODEL_CAPABILITY_REQUIRED' });
  assert.equal(calls, 0);
  await client.saveCapability({ ...capabilityInput, expectedRevision: 0 }, 'test-new-capability');
  assert.equal(calls, 1);
});

test('workflow never falls back to local success when identity, permission, stale-version or profit-floor checks fail', async () => {
  let calls = 0;
  await assert.rejects(make(async () => { calls++; }, () => null).acceptProposal(acceptanceInput, 'accept-no-auth'), { code: 'AUTH_REQUIRED' });
  assert.equal(calls, 0);
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'], [409, 'PROPOSAL_SUPERSEDED'], [409, 'PROFIT_FLOOR_REQUIRED']]) {
    const client = make(async () => ({ status, data: { error: { code, message: '拒绝本次操作' } } }));
    await assert.rejects(client.acceptProposal(acceptanceInput, 'accept-rejected'), { code, status });
  }
});

test('mutation success payload must contain actual server records before clients can show completion', async () => {
  for (const [method, input, key] of [['saveCapability', capabilityInput, 'capability'], ['createInquiry', inquiryInput, 'inquiry'], ['submitProposal', proposalInput, 'inquiry'], ['acceptProposal', acceptanceInput, 'order']]) {
    for (const record of [null, [], {}, { id: '' }]) {
      await assert.rejects(make(async () => ({ status: 200, data: { ...successful, [key]: record } }))[method](input, 'invalid-success'), { code: 'INVALID_RESPONSE' });
    }
  }
});
