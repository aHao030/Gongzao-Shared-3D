import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const api = createRequire(import.meta.url)('../shared/api-client.js');

async function service({ quotes = [], orders = [] } = {}) {
  const storage = new Map();
  const modules = {
    './demo': { materials: [] },
    '../config/service': { API_BASE: 'https://sandbox-api.example.test', AUTH_ADAPTER_READY: true },
    './api-client': api,
    './auth': { getAccessToken: () => 'test-only-token' },
    './transport': { wxTransport: async request => ({ status: 200, data:
      request.url.endsWith('/session') ? { authenticated: true, mode: 'SERVER_SANDBOX' }
        : request.url.endsWith('/customer/profile') ? { profile: { shippingAddress: { countryCode: 'CN' }, addressRevision: 1 } }
          : request.url.endsWith('/quotes') ? { quotes } : { workspace: { orders } }
    }) }
  };
  const context = vm.createContext({ module: { exports: {} }, require: name => modules[name], wx: {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value)
  } });
  vm.runInContext(await readFile(new URL('../weapp/utils/service.js', import.meta.url), 'utf8'), context);
  return context.module.exports;
}

test('v0.6 mini-program shows only customer batch and unit-price fields', async () => {
  const client = await service({ quotes: [{ quoteId: 'q1', total: 100, days: [2, 4], productionHours: 8,
    farm: { name: '测试工坊' }, batch: { plateCount: 2, capacityPerPlate: 30 },
    pricingSummary: { averageUnitManufacturingCents: 250 },
    estimatedCostCents: 12345, targetMarginBps: 6000, costBreakdown: { materialCents: 99999 }
  }] });
  await client.selectMode('server');
  const [view] = await client.getQuotes({ materialIndex: 0, quantity: 31 });
  assert.equal(view.priceText, '¥100.00');
  assert.match(view.batchNote, /预计 2 板，每板最多 30 件/);
  assert.match(view.batchNote, /未执行真实排版或切片/);
  assert.match(view.unitPriceText, /¥2.50/);
  assert.match(view.unitPriceText, /运费和平台费另列/);
  assert.match(view.lead, /演示预计/);
  assert.doesNotMatch(JSON.stringify(view), /estimatedCostCents|targetMarginBps|costBreakdown|12345|99999/);
});

test('review-only quotes never look free or promise an automated production estimate', async () => {
  const client = await service({ quotes: [{ quoteId: 'review', review: true, total: 0, days: [2, 4], productionHours: 8,
    batch: { plateCount: 1, capacityPerPlate: 30 }, pricingSummary: { averageUnitManufacturingCents: 0 }
  }] });
  await client.selectMode('server');
  const [view] = await client.getQuotes({ materialIndex: 4, quantity: 1 });
  assert.equal(view.priceText, '待工程报价'); assert.equal(view.lead, '待确认');
  assert.equal(view.production, '工程确认'); assert.equal(view.batchNote, ''); assert.equal(view.unitPriceText, '');
});

test('v0.6 mini-program explains price breakdown while keeping legacy orders readable', async () => {
  const client = await service({ orders: [
    { id: 'new', total: 100, status: 'printing', settlementBreakdown: { manufacturingCents: 8000, platformFeeCents: 1000, shippingCents: 1000 }, estimatedProfitCents: 54321 },
    { id: 'old', total: 50, status: 'settled' },
    { id: 'review', total: 0, status: 'review', paymentState: 'UNPAID' }
  ] });
  await client.selectMode('server');
  const views = await client.listOrders();
  assert.equal(views[0].priceBreakdown, '制造 ¥80.00 · 平台费 ¥10.00 · 运费 ¥10.00');
  assert.doesNotMatch(JSON.stringify(views), /estimatedProfitCents|54321/);
  assert.equal(views[1].priceBreakdown, ''); assert.equal(views[1].priceText, '¥50.00');
  assert.equal(views[2].priceText, '待工程报价');
});

test('offline sample makes clear that its historical example is not the server batch algorithm', async () => {
  const client = await service();
  assert.equal(client.getModeInfo().isLocal, true);
  assert.match(client.getModeInfo().modeNote, /旧版本机示例计价，不使用服务端批量成本算法/);
});
