import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarket, getMarketCatalog } from '../services/platform/market.mjs';
import { normalizeShippingAddress, requireShippingAddress, getCustomerProfile } from '../services/platform/customer.mjs';
import { createWorkspace, applyCommand } from '../services/platform/core.mjs';

const sample = (countryCode, extra = {}) => ({
  recipient: 'Synthetic recipient', phone: '+1 202 555 0123', countryCode,
  province: 'Synthetic region', city: 'Synthetic town', district: 'Synthetic district',
  addressLine: '1 Synthetic Road, Unit 2', postalCode: 'A1B 2C3', ...extra
});
function harness() {
  let state = createWorkspace({ now: 1000 }), sequence = 0;
  return {
    get state() { return state; },
    async run(type, payload = {}) {
      const result = await applyCommand(state, { type, payload, idempotencyKey: `international-${++sequence}` }, { now: 2000, idFactory: () => `international-${++sequence}` });
      state = result.workspace; return result.result;
    },
    save(address) { return this.run('customer-profile', { displayName: 'Synthetic user', setupCompleted: true, shippingAddress: address }); }
  };
}

test('market catalogue covers configured markets with one complete visible field order', () => {
  const catalog = getMarketCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.accountingCurrency, 'CNY');
  assert.deepEqual(catalog.markets.map(m => m.countryCode), ['CN','HK','MO','TW','US','CA','GB','DE','FR','AU','NZ','JP','KR','SG','MY','TH','OTHER']);
  for (const market of catalog.markets) {
    const visibleFields = Object.entries(market.address.fields).filter(([, field]) => field.visible).map(([key]) => key).sort();
    assert.deepEqual([...market.address.fieldOrder].sort(), visibleFields, market.countryCode);
    assert.equal(new Set(market.address.fieldOrder).size, market.address.fieldOrder.length);
    assert.equal(market.payment.accountingCurrency, 'CNY');
    assert.equal(market.payment.livePaymentsEnabled, false);
    assert.equal(market.payment.exchangeRate, null);
    assert.ok(market.payment.methods.length > 0);
    assert.ok(market.payment.methods.every(method => method.enabled === false && method.status === 'NOT_CONFIGURED'));
  }
});

test('international address requirements follow local field conventions', () => {
  const required = {
    HK: ['addressLine','province'], MO: ['addressLine'], TW: ['addressLine','city','province','postalCode'],
    US: ['addressLine','city','province','postalCode'], CA: ['addressLine','city','province','postalCode'],
    GB: ['addressLine','city','postalCode'], DE: ['addressLine','city','postalCode'], FR: ['addressLine','city','postalCode'],
    AU: ['addressLine','city','province','postalCode'], NZ: ['addressLine','city','district','postalCode'],
    JP: ['addressLine','province','postalCode'], KR: ['addressLine','city','province','postalCode'],
    SG: ['addressLine','postalCode'], MY: ['addressLine','city','postalCode'], TH: ['addressLine','city'], OTHER: ['addressLine']
  };
  for (const [countryCode, expected] of Object.entries(required)) {
    const market = getMarket(countryCode);
    const keys = Object.entries(market.address.fields).filter(([key, field]) => !['recipient','phone','countryCode'].includes(key) && field.required).map(([key]) => key);
    assert.deepEqual(keys.sort(), [...expected].sort(), countryCode);
    const address = sample(countryCode === 'OTHER' ? 'BR' : countryCode);
    for (const key of Object.keys(market.address.fields)) {
      if (!market.address.fields[key].required) address[key] = '';
    }
    assert.doesNotThrow(() => normalizeShippingAddress(address), countryCode);
    for (const key of expected) assert.throws(() => normalizeShippingAddress({ ...address, [key]: '' }), { code: 'INVALID_ADDRESS' }, `${countryCode}.${key}`);
  }
});

test('Singapore, Hong Kong and Macao clear inapplicable mainland fields without changing phone', () => {
  for (const countryCode of ['SG','HK','MO']) {
    const input = sample(countryCode, { phone: '+86 13800000000' });
    const normalized = normalizeShippingAddress(input);
    for (const [field, rule] of Object.entries(getMarket(countryCode).address.fields)) {
      if (!rule.visible) assert.equal(normalized[field], '', `${countryCode}.${field}`);
    }
    assert.equal(normalized.phone, '+86 13800000000');
    assert.equal(input.city, 'Synthetic town', 'normalization does not mutate the caller');
  }
});

test('postal codes accept local alphanumeric and hyphen conventions without a mainland regex', () => {
  for (const [countryCode, postalCode] of [['CA','K1A 0B1'],['GB','SW1A 1AA'],['US','94105-1234'],['JP','100-0001'],['SG','018956']]) {
    assert.equal(normalizeShippingAddress(sample(countryCode, { postalCode })).postalCode, postalCode);
  }
  assert.throws(() => normalizeShippingAddress(sample('US', { postalCode: 'invalid\nvalue' })), { code: 'INVALID_ADDRESS' });
  assert.throws(() => normalizeShippingAddress(sample('US', { postalCode: 'x'.repeat(21) })), { code: 'INVALID_ADDRESS' });
});

test('other-country template preserves actual code without inventing local currency', () => {
  const catalog = getMarketCatalog('BR');
  assert.equal(catalog.market.countryCode, 'BR');
  assert.equal(catalog.market.referenceCurrency, null);
  assert.equal(catalog.market.payment.countryCode, 'BR');
  assert.equal(catalog.market.payment.accountingCurrency, 'CNY');
  assert.equal(normalizeShippingAddress(sample('br')).countryCode, 'BR');
  assert.throws(() => normalizeShippingAddress(sample('OTHER')), { code: 'INVALID_ADDRESS' });
});

test('market catalogue reads are isolated from caller mutation', () => {
  const before = getMarket('CN');
  const mutated = getMarket('CN');
  mutated.address.fields.province.required = false;
  mutated.payment.methods[0].enabled = true;
  assert.deepEqual(getMarket('CN'), before);
});

test('saved v0.6 foreign address remains readable and asks for completion instead of failing internally', () => {
  const legacy = { displayName: 'Legacy user', setupCompleted: true, addressRevision: 1, shippingAddress: sample('US', { postalCode: '' }) };
  const workspace = { customerProfile: legacy };
  assert.deepEqual(getCustomerProfile(workspace), legacy);
  assert.throws(() => requireShippingAddress(workspace), { code: 'ADDRESS_INCOMPLETE', status: 409 });
  assert.deepEqual(workspace.customerProfile, legacy);
  const complete = { customerProfile: { ...legacy, shippingAddress: sample('US') } };
  assert.equal(requireShippingAddress(complete).destination, 'other');
});

test('foreign market and payment snapshots ignore all client country, provider and currency claims', async () => {
  const h = harness();
  await h.save(sample('US'));
  const result = await h.run('quote', { countryCode: 'CN', currency: 'USD', provider: 'paypal', market: { countryCode: 'CN' }, paymentContext: { payable: true, livePaymentsEnabled: true } });
  const quote = result.quotes[0];
  assert.equal(quote.market.countryCode, 'US');
  assert.equal(quote.market.referenceCurrency, 'USD');
  assert.equal(quote.currency, 'CNY');
  assert.equal(quote.priceStatus, 'REVIEW_REQUIRED');
  assert.equal(quote.payable, false);
  assert.equal(quote.paymentContext.livePaymentsEnabled, false);
  assert.equal(quote.paymentContext.payable, false);
  assert.equal(quote.paymentContext.action, 'REQUEST_REVIEW');
  assert.equal(quote.estimation.estimatedArrival, null);
  assert.deepEqual(quote.days, []);
  assert.deepEqual(quote.transitDays, []);
  assert.equal(quote.review, true);
  assert.ok(quote.reviewReasons.includes('DESTINATION_REVIEW'));
  assert.equal(quote.totalCents, 0, 'legacy placeholder must not be presented as an available zero-price quote');
  assert.equal(quote.shippingCents, 0);
  const { order } = await h.run('order', { quoteId: quote.quoteId, demoAcknowledged: true, currency: 'USD', countryCode: 'CN' });
  assert.equal(order.paymentState, 'UNPAID');
  assert.equal(order.productionState, 'REVIEW_REQUIRED');
  assert.equal(order.currency, 'CNY');
  assert.deepEqual(order.market, quote.market);
  assert.deepEqual(order.paymentContext, quote.paymentContext);
  assert.equal(order.shippingAddress.countryCode, 'US');
  assert.equal(order.deviceId, undefined);
});

test('market quote snapshots are fingerprint-protected and country changes invalidate old quotes', async () => {
  const h = harness();
  await h.save(sample('US'));
  const { quotes } = await h.run('quote');
  h.state.quotes[0].paymentContext.livePaymentsEnabled = true;
  await assert.rejects(h.run('order', { quoteId: quotes[0].quoteId, demoAcknowledged: true }), { code: 'QUOTE_CHANGED' });
  await h.save(sample('SG'));
  await assert.rejects(h.run('order', { quoteId: quotes[1].quoteId, demoAcknowledged: true }), { code: 'ADDRESS_CHANGED' });
  const [fresh] = (await h.run('quote')).quotes;
  assert.equal(fresh.market.countryCode, 'SG');
  assert.equal(fresh.market.referenceCurrency, 'SGD');
  assert.equal(h.state.customerProfile.shippingAddress.province, '');
  assert.equal(h.state.customerProfile.addressSchemaVersion, 1);
});
