import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createWorkspace, getPublicWorkspace } from '../services/platform/core.mjs';
import { normalizeShippingAddress, destinationForAddress } from '../services/platform/customer.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';

function sandbox() {
  let workspace = createWorkspace({ now: 1000 }), sequence = 0;
  return {
    get workspace() { return workspace; },
    async run(type, payload = {}, idempotencyKey = `customer-${++sequence}`) {
      const outcome = await applyCommand(workspace, { type, payload, idempotencyKey }, { now: 2000, idFactory: () => `id-${++sequence}` });
      workspace = outcome.workspace;
      return outcome;
    }
  };
}

test('customer: old workspace starts without an invented address and quotes require one', async () => {
  const h = sandbox();
  assert.equal(getPublicWorkspace(h.workspace).customerProfile, null);
  const before = structuredClone(h.workspace);
  await assert.rejects(h.run('quote', { destination: 'east' }), { code: 'ADDRESS_REQUIRED', status: 409 });
  assert.deepEqual(h.workspace, before);
  const saved = await h.run('customer-profile', customerProfileFixture({ shippingAddress: null }));
  assert.equal(saved.result.profile.setupCompleted, true);
  assert.equal(saved.result.profile.destination, null);
  assert.equal(saved.result.profile.addressRevision, 0);
  await assert.rejects(h.run('quote'), { code: 'ADDRESS_REQUIRED' });
});

test('customer: validates full delivery details atomically and does not trust supplied destination', async () => {
  const h = sandbox();
  for (const shippingAddress of [[], {}, { recipient: ' ' }, { phone: 'mail@example.com' }, { countryCode: 'CHINA' }, { province: 'not-a-province' }, { district: '' }, { city: '' }, { addressLine: 'x\nwrong' }, { postalCode: 'x'.repeat(21) }]) {
    const payload = customerProfileFixture({ shippingAddress });
    if (Array.isArray(shippingAddress)) payload.shippingAddress = shippingAddress;
    if (Object.keys(shippingAddress).length === 0 && !Array.isArray(shippingAddress)) payload.shippingAddress = {};
    await assert.rejects(h.run('customer-profile', payload), { code: 'INVALID_ADDRESS' });
    assert.equal(h.workspace.revision, 0);
  }
  for (const payload of [{}, { ...customerProfileFixture(), displayName: [] }, { ...customerProfileFixture(), setupCompleted: 'yes' }]) {
    await assert.rejects(h.run('customer-profile', payload), { code: 'INVALID_PROFILE' });
  }
  const saved = await h.run('customer-profile', { ...customerProfileFixture(), destination: 'north', addressRevision: 99 });
  assert.equal(saved.result.profile.destination, 'east');
  assert.equal(saved.result.profile.addressRevision, 1);
});

test('customer: routing uses recognized province groups and sends unsupported destinations to review', () => {
  const expected = {
    east: ['上海', '江苏省', '浙江', '安徽省', '福建省', '江西省', '山东省'],
    south: ['广东', '广西', '海南省'],
    north: ['北京', '天津市', '河北省', '山西省', '内蒙古'],
    other: ['辽宁省', '吉林省', '黑龙江省', '河南省', '湖北省', '湖南省', '重庆市', '四川省', '贵州省', '云南省', '西藏', '陕西省', '甘肃省', '青海省', '宁夏', '新疆']
  };
  for (const [destination, provinces] of Object.entries(expected)) {
    for (const province of provinces) {
      const address = normalizeShippingAddress(customerProfileFixture({ shippingAddress: { province } }).shippingAddress);
      assert.equal(destinationForAddress(address), destination, province);
    }
  }
  const international = normalizeShippingAddress(customerProfileFixture({ shippingAddress: { countryCode: 'JP', province: '東京都', city: '新宿区', district: '', phone: '+81 (3) 1234-5678' } }).shippingAddress);
  assert.equal(destinationForAddress(international), 'other');
});

test('customer: normalized equivalent address and display name changes keep valid quotes', async () => {
  const h = sandbox();
  await h.run('customer-profile', customerProfileFixture({ shippingAddress: { province: '浙江', recipient: ' 测试收件人 ' } }));
  const [quote] = (await h.run('quote')).result.quotes;
  assert.equal(quote.destination, 'east');
  assert.equal(quote.addressRevision, 1);
  assert.equal(Object.hasOwn(quote, 'shippingAddress'), false);
  const updated = (await h.run('customer-profile', customerProfileFixture({ displayName: '新名称' }))).result.profile;
  assert.equal(updated.addressRevision, 1);
  const order = (await h.run('order', { quoteId: quote.quoteId, demoAcknowledged: true })).result.order;
  assert.deepEqual(order.shippingAddress, updated.shippingAddress);
});

test('customer: client cannot choose a cheaper region and external addresses get manual review', async () => {
  const h = sandbox();
  await h.run('customer-profile', customerProfileFixture({ shippingAddress: { province: '北京市', city: '北京市', district: '朝阳区' } }));
  await assert.rejects(h.run('quote', { destination: 'east' }), { code: 'DESTINATION_MISMATCH' });
  const [north] = (await h.run('quote')).result.quotes;
  assert.equal(north.destination, 'north');
  await h.run('customer-profile', customerProfileFixture({ shippingAddress: { countryCode: 'US', province: 'California', city: 'San Francisco', district: '' } }));
  const [other] = (await h.run('quote')).result.quotes;
  assert.equal(other.review, true);
  assert.equal(other.destination, 'other');
  assert.ok(other.reviewReasons.includes('DESTINATION_REVIEW'));
});

test('customer: changing street or recipient invalidates quotes while created orders retain snapshots', async () => {
  const h = sandbox();
  await h.run('customer-profile', customerProfileFixture());
  const [quote, pending] = (await h.run('quote')).result.quotes;
  const original = (await h.run('order', { quoteId: quote.quoteId, demoAcknowledged: true })).result.order;
  const changed = await h.run('customer-profile', customerProfileFixture({ shippingAddress: { addressLine: '另一条测试路2号' } }));
  assert.equal(changed.result.profile.addressRevision, 2);
  await assert.rejects(h.run('order', { quoteId: pending.quoteId, demoAcknowledged: true }), { code: 'ADDRESS_CHANGED' });
  assert.deepEqual(h.workspace.orders[0].shippingAddress, original.shippingAddress);
  assert.equal(h.workspace.orders[0].shippingAddress.addressLine, '测试路1号');
  const [newQuote] = (await h.run('quote')).result.quotes;
  await h.run('customer-profile', customerProfileFixture({ shippingAddress: { addressLine: '另一条测试路2号', recipient: '另一收件人' } }));
  await assert.rejects(h.run('order', { quoteId: newQuote.quoteId, demoAcknowledged: true }), { code: 'ADDRESS_CHANGED' });
});

test('customer: clear and restore cannot resurrect an earlier quote', async () => {
  const h = sandbox();
  await h.run('customer-profile', customerProfileFixture());
  const [quote] = (await h.run('quote')).result.quotes;
  await h.run('customer-profile', customerProfileFixture({ shippingAddress: null }));
  await assert.rejects(h.run('order', { quoteId: quote.quoteId, demoAcknowledged: true }), { code: 'ADDRESS_REQUIRED' });
  await h.run('customer-profile', customerProfileFixture());
  assert.equal(h.workspace.customerProfile.addressRevision, 3);
  await assert.rejects(h.run('order', { quoteId: quote.quoteId, demoAcknowledged: true }), { code: 'ADDRESS_CHANGED' });
});

test('customer: retries are idempotent and sandbox reset preserves account delivery details', async () => {
  const h = sandbox(), payload = customerProfileFixture();
  const first = await h.run('customer-profile', payload, 'save-profile-once');
  const retry = await h.run('customer-profile', payload, 'save-profile-once');
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.result.profile, first.result.profile);
  assert.equal(h.workspace.revision, 1);
  await assert.rejects(h.run('customer-profile', customerProfileFixture({ displayName: '另一个名字' }), 'save-profile-once'), { code: 'IDEMPOTENCY_CONFLICT' });
  await h.run('action', { action: 'reset', confirm: 'RESET_DEMO', demoAcknowledged: true });
  assert.deepEqual(h.workspace.customerProfile, first.result.profile);
  const visible = getPublicWorkspace(h.workspace);
  visible.customerProfile.shippingAddress.addressLine = 'mutated response';
  assert.equal(h.workspace.customerProfile.shippingAddress.addressLine, '测试路1号');
});
