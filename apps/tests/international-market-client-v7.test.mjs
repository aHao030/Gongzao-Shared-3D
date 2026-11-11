import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { getMarketCatalog } from '../../services/platform/market.mjs';
const require = createRequire(import.meta.url);
const { createApiClient } = require('../shared/api-client.js');
const base = 'https://sandbox-api.example.test';
const make = transport => createApiClient({ apiBase: base, transport, getAccessToken: () => 'test-only-token' });

test('market client reads the shared server catalog and preserves planned-only payment information', async () => {
  const requests = [];
  const client = make(async request => {
    requests.push(request);
    const country = new URL(request.url).searchParams.get('country');
    return { status: 200, data: getMarketCatalog(country ?? undefined) };
  });
  const all = await client.getMarkets();
  assert.equal(all.markets.length, 17);
  assert.equal(requests[0].url, base + '/api/v2/markets');
  assert.equal(requests[0].method, 'GET');
  for (const country of ['CN', 'US', 'SG', 'HK', 'OTHER', 'BR']) {
    const { market } = await client.getMarkets(country);
    assert.equal(market.countryCode, country);
    assert.equal(market.payment.accountingCurrency, 'CNY');
    assert.equal(market.payment.livePaymentsEnabled, false);
    assert.equal(market.payment.exchangeRate, null);
    assert.ok(market.payment.methods.every(method => method.enabled === false && method.status === 'NOT_CONFIGURED'));
  }
});

test('market client rejects malformed form/payment metadata and invalid selectors before rendering', async () => {
  const corruptions = [
    data => { data.schemaVersion = 2; },
    data => { data.markets = []; },
    data => { data.markets[0].address.fields.phone.visible = false; },
    data => { data.markets[0].address.fieldOrder.push('untrustedField'); },
    data => { data.markets[0].payment.livePaymentsEnabled = true; },
    data => { data.markets[0].payment.exchangeRate = 7; },
    data => { data.markets[0].payment.methods[0].enabled = true; }
  ];
  for (const corrupt of corruptions) {
    const data = getMarketCatalog(); corrupt(data);
    await assert.rejects(make(async () => ({ status: 200, data })).getMarkets(), { code: 'INVALID_RESPONSE' });
  }
  let calls = 0;
  await assert.rejects(make(async () => { calls++; }).getMarkets('US&currency=USD'), { code: 'INVALID_COUNTRY' });
  assert.equal(calls, 0);
  await assert.rejects(make(async () => ({ status: 200, data: getMarketCatalog('CN') })).getMarkets('US'), { code: 'INVALID_RESPONSE' });
});

async function profilePage({ local = false, profile = null, getMarkets } = {}) {
  const source = await readFile(new URL('../weapp/pages/profile/index.js', import.meta.url), 'utf8');
  const saved = [], calls = [];
  const service = {
    getModeInfo: () => ({ isLocal: local }),
    getCustomerProfile: async () => { calls.push('profile'); return { profile }; },
    getMarkets: getMarkets || (async () => { calls.push('markets'); return getMarketCatalog(); }),
    saveCustomerProfile: async body => { saved.push(structuredClone(body)); return { profile: body }; }
  };
  let page;
  const context = vm.createContext({ require: () => service, Page: value => { page = value; }, wx: { showToast() {}, switchTab() {} } });
  vm.runInContext(source, context);
  page.setData = function (updates) {
    for (const [key, value] of Object.entries(updates)) {
      const parts = key.split('.'); let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = value;
    }
  };
  const field = (name, value) => page.changeField({ currentTarget: { dataset: { field: name } }, detail: { value } });
  const country = code => page.changeCountry({ detail: { value: page.data.countryOptions.findIndex(option => option.countryCode === code) } });
  return { page, calls, saved, field, country };
}

test('WeChat country changes rebuild required fields from server metadata and preserve telephone', async () => {
  const h = await profilePage({ profile: { displayName: '测试', shippingAddress: { countryCode: 'CN', recipient: '测试收件人', phone: '+86 13800000000', province: '浙江省', city: '杭州', district: '西湖', addressLine: '测试地址1号', postalCode: '310000' } } });
  await h.page.onShow();
  h.country('SG');
  assert.equal(h.page.data.form.phone, '+86 13800000000');
  assert.equal(h.page.data.form.addressLine, '测试地址1号');
  assert.deepEqual(Array.from(h.page.data.addressFields, value => value.key), ['recipient', 'phone', 'addressLine', 'postalCode']);
  assert.equal(h.page.data.form.province, ''); assert.equal(h.page.data.form.city, ''); assert.equal(h.page.data.form.district, ''); assert.equal(h.page.data.form.postalCode, '');
  await h.page.saveProfile(); assert.equal(h.saved.length, 0); assert.match(h.page.data.error, /Postal code/);
  h.field('postalCode', '018956'); await h.page.saveProfile();
  assert.equal(h.saved[0].shippingAddress.countryCode, 'SG'); assert.equal(h.saved[0].shippingAddress.city, '');
  assert.match(h.page.data.currencyNote, /SGD/); assert.match(h.page.data.currencyNote, /CNY/);
  assert.ok(h.page.data.paymentMethods.every(method => !method.enabled));
  h.country('HK');
  assert.ok(!h.page.data.addressFields.some(field => field.key === 'postalCode'));
  assert.equal(h.page.data.addressFields.find(field => field.key === 'province').required, true);
});

test('WeChat OTHER requires an actual country code and applies supported metadata when entered', async () => {
  const h = await profilePage(); await h.page.onShow();
  h.country('OTHER');
  h.field('recipient', 'Test recipient'); h.field('phone', '+55 123456789'); h.field('addressLine', 'Synthetic street 1');
  await h.page.saveProfile(); assert.equal(h.saved.length, 0);
  h.field('countryCode', 'br'); await h.page.saveProfile();
  assert.equal(h.saved[0].shippingAddress.countryCode, 'BR'); assert.equal(h.page.data.otherCountry, true);
  h.field('countryCode', 'us');
  assert.equal(h.page.data.otherCountry, false);
  assert.equal(h.page.data.form.countryCode, 'US');
  assert.equal(h.page.data.addressFields.find(field => field.key === 'postalCode').required, true);
});

test('WeChat local mode does not request or retain address/market data and stale loads cannot restore PII', async () => {
  const local = await profilePage({ local: true }); await local.page.onShow();
  assert.deepEqual(local.calls, []); assert.equal(local.page.data.marketsReady, false);
  const service = require('../weapp/utils/service.js');
  const localMarkets = await service.getMarkets();
  assert.equal(localMarkets.localOnly, true); assert.equal(localMarkets.markets.length, 0);
  let resolveMarkets;
  const h = await profilePage({ profile: { shippingAddress: { recipient: 'Should disappear' } }, getMarkets: () => new Promise(resolve => { resolveMarkets = resolve; }) });
  const pending = h.page.onShow(); h.page.onUnload(); resolveMarkets(getMarketCatalog()); await pending;
  assert.equal(h.page.data.form.recipient, ''); assert.equal(h.page.data.marketsReady, false);
});
