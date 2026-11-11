const SPEC_KEY = 'shared_fabrication_demo_spec_v1';
const ORDERS_KEY = 'shared_fabrication_demo_orders_v1';
const materials = ['PLA 塑料', 'PETG 塑料', '工程树脂', '铝合金（金属打印）', 'CNC 铝件'];
const basePrices = [48, 58, 68, 368, 228];
function stepsFor(order) {
  return ['已保存演示订单'].concat(order.requiresReview ? ['待商家工程审核', '模拟工程审核通过'] : []).concat(['待商家检查材料与设备', '模拟生产中', '模拟打印 / 加工完成', '模拟取件与后处理', '模拟质检通过', '模拟物流运输', '模拟客户收货', '模拟结算完成']);
}
function getSpec() { return wx.getStorageSync(SPEC_KEY) || null; }
function saveSpec(materialIndex, quantity) {
  const index = Number(materialIndex);
  const count = Number(quantity);
  if (!Number.isInteger(index) || index < 0 || index >= materials.length || !Number.isInteger(count) || count < 1 || count > 100) throw new Error('INVALID_SPEC');
  const spec = { modelName: '桌面连接件 · 示例模型', dimensions: '40 × 30 × 20 mm', materialIndex: index, material: materials[index], quantity: count };
  wx.setStorageSync(SPEC_KEY, spec);
  return spec;
}
function getQuotes(spec) {
  if (!spec) return [];
  const base = basePrices[spec.materialIndex] * spec.quantity;
  const extraDays = spec.materialIndex > 2 ? 4 : 0;
  return [
    { id: 'a', name: '示例工坊 A', tag: '经济方案', price: base, lead: (4 + extraDays) + '–' + (6 + extraDays) + ' 天', production: (2 + extraDays) + '–' + (3 + extraDays) + ' 天' },
    { id: 'b', name: '示例工坊 B', tag: '均衡方案', price: Math.round(base * 1.22), lead: (3 + extraDays) + '–' + (5 + extraDays) + ' 天', production: (1 + extraDays) + '–' + (2 + extraDays) + ' 天' },
    { id: 'c', name: '示例工坊 C', tag: '加急方案', price: Math.round(base * 1.45), lead: (2 + extraDays) + '–' + (4 + extraDays) + ' 天', production: (1 + extraDays) + ' 天' }
  ];
}
function readOrders() { const value = wx.getStorageSync(ORDERS_KEY); return Array.isArray(value) ? value : []; }
function decorate(order) {
  const steps = stepsFor(order);
  return Object.assign({}, order, { status: steps[order.stage], canAdvance: order.stage < steps.length - 1, timeline: steps.map((label, index) => ({ label, number: index + 1, done: index <= order.stage })), logistics: order.stage >= steps.indexOf('模拟物流运输') ? '模拟运输节点 · 未连接承运商' : '尚未模拟发货', settlement: order.stage === steps.length - 1 ? '演示已完成；未发生任何资金转移' : '待模拟收货；无真实支付或结算', reviewNote: order.requiresReview ? '金属 / CNC：须完成模型、工艺、支撑或夹具/刀路审核，再确认现场条件。' : '生产前须由商家检查设备、材料与任务配置。' });
}
function listOrders() { return readOrders().map(decorate); }
function createOrder(quoteId) {
  const spec = getSpec();
  const quote = getQuotes(spec).find(item => item.id === quoteId);
  if (!quote) throw new Error('NO_QUOTE');
  const id = 'DEMO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const order = { id, modelName: spec.modelName, material: spec.material, quantity: spec.quantity, farm: quote.name, price: quote.price, lead: quote.lead, requiresReview: spec.materialIndex > 2, stage: 0 };
  wx.setStorageSync(ORDERS_KEY, [order].concat(readOrders()).slice(0, 20));
  return order;
}
function advanceOrder(id) {
  const updated = readOrders().map(order => order.id === id ? Object.assign({}, order, { stage: Math.min(order.stage + 1, stepsFor(order).length - 1) }) : order);
  wx.setStorageSync(ORDERS_KEY, updated);
}
function clearOrders() { wx.removeStorageSync(ORDERS_KEY); }
module.exports = { materials, getSpec, saveSpec, getQuotes, listOrders, createOrder, advanceOrder, clearOrders };
