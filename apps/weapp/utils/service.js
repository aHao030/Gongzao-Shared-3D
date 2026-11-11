const demo = require('./demo');
const config = require('../config/service');
const { createApiClient, normalizeApiBase } = require('./api-client');
const { getAccessToken } = require('./auth');
const { wxTransport } = require('./transport');
const materialCodes = ['PLA', 'PETG', 'RESIN', 'ALUMINUM', 'CNC'];
const statusNames = { awaiting_pickup: '生产完成待取件', qc_failed: '质检未通过', ready_to_ship: '质检通过待发货', review: '工程审核中', queued: '等待设备', printing: '生产中', printed: '生产完成待取件', qc: '待质检', ready: '待发货', shipped: '运输中', delivered: '已签收待验收', accepted: '已验收待模拟结算', settling: '模拟结算处理中', settlement_failed: '模拟结算失败', refund_pending: '退款申请处理中', refunded: '模拟退款完成', settled: '模拟结算完成', cancelled: '已取消' };
let mode = 'local';
let client;
let selectedRemoteQuotes = [];
let quoteGeneration = 0;
const serverSample = { modelName: '桌面设备固定支架.stl', dimensions: '72 × 48 × 58 mm' };
const localSample = { modelName: '桌面连接件 · 示例模型', dimensions: '40 × 30 × 20 mm' };
function invalidateQuotes() {
  selectedRemoteQuotes = [];
  return ++quoteGeneration;
}
let pendingProfileMutation = null;
const pendingStorageKey = 'shared_fabrication_pending_api_keys_v1';
function storedKeys() { const value = wx.getStorageSync(pendingStorageKey); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function retainedKey(scope) {
  const keys = storedKeys();
  if (!keys[scope]) { keys[scope] = requestKey(); wx.setStorageSync(pendingStorageKey, keys); }
  return keys[scope];
}
function completeKey(scope) { const keys = storedKeys(); delete keys[scope]; wx.setStorageSync(pendingStorageKey, keys); }
function getMode() { return mode; }
function getModeInfo() {
  return { maxQuantity: mode === 'server' ? 50 : 100, sample: mode === 'server' ? serverSample : localSample, mode, modeIndex: mode === 'server' ? 1 : 0, modeLabel: mode === 'server' ? '服务端沙盒' : '本机演示', isLocal: mode === 'local',
    modeNote: mode === 'server' ? '报价与订单来自服务端沙盒；未连接真实设备、支付或承运商。' : '旧版本机示例计价，不使用服务端批量成本算法；不会上传图纸、调用真实设备或收取费用。' };
}
function remoteClient() {
  if (!config.AUTH_ADAPTER_READY) { const error = new Error('微信小程序鉴权尚未配置。请先由开发者完成受支持的登录与令牌验证，不能复用 ChatGPT Cookie。'); error.code = 'AUTH_ADAPTER_NOT_READY'; throw error; }
  normalizeApiBase(config.API_BASE);
  if (!client) client = createApiClient({ apiBase: config.API_BASE, transport: wxTransport, getAccessToken });
  return client;
}
async function selectMode(nextMode) {
  if (nextMode !== 'local' && nextMode !== 'server') throw new Error('不支持的数据模式。');
  if (nextMode === 'server') await remoteClient().getSession();
  mode = nextMode; invalidateQuotes(); pendingProfileMutation = null; return getModeInfo();
}
function getSpec() {
  const spec = demo.getSpec();
  return spec && mode === 'server' ? Object.assign({}, spec, serverSample) : spec;
}
function checkQuantity(quantity) {
  const max = mode === 'server' ? 50 : 100;
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > max) throw new Error('数量请输入 1–' + max + ' 的整数。');
}
function saveSpec(materialIndex, quantity) {
  checkQuantity(quantity);
  demo.saveSpec(materialIndex, quantity);
  invalidateQuotes();
  return getSpec();
}
function priceText(value) { return typeof value === 'number' && Number.isFinite(value) ? '¥' + value.toFixed(2) : '待工程报价'; }
function batchDescription(quote) {
  const batch = quote.batch;
  if (quote.review || !batch || !Number.isInteger(batch.plateCount)) return '';
  if (quote.estimateBasis === 'SLICER_OUTPUT' || batch.method === 'SLICER_OUTPUT_ESTIMATE')
    return '切片估算 ' + batch.plateCount + ' 板，实际机时与交期仍需商家确认。';
  const capacity = Number.isInteger(batch.capacityPerPlate) ? '，每板最多 ' + batch.capacityPerPlate + ' 件' : '';
  return '预计 ' + batch.plateCount + ' 板' + capacity + '；未执行真实排版或切片。';
}
async function getQuotes(spec) {
  if (!spec) return [];
  if (mode === 'local') return demo.getQuotes(spec).map(quote => Object.assign({}, quote, { priceText: priceText(quote.price) }));
  const generation = invalidateQuotes();
  checkQuantity(spec.quantity);
  const { profile } = await remoteClient().getCustomerProfile();
  if (generation !== quoteGeneration) return [];
  if (!profile || !profile.shippingAddress) { const error = new Error('请先完善账号资料中的收货地址，再测算费用。'); error.code = 'ADDRESS_REQUIRED'; throw error; }
  const input = { modelId: 'sample-bracket', material: materialCodes[spec.materialIndex], quality: 'standard', qty: spec.quantity, unit: 'mm' };
  const signature = JSON.stringify({ input, addressRevision: profile.addressRevision });
  const scope = config.API_BASE + ':quote:' + signature;
  const result = await remoteClient().getQuotes(input, retainedKey(scope));
  completeKey(scope);
  if (generation !== quoteGeneration) return [];
  selectedRemoteQuotes = result.quotes;
  return result.quotes.map(quote => ({ id: quote.quoteId, name: quote.farm && quote.farm.name || '服务端工坊', tag: quote.review ? '需工程审核' : '服务端示例报价', priceText: quote.review ? '待工程报价' : priceText(quote.total),
    lead: !quote.review && Array.isArray(quote.days) ? quote.days.join('–') + ' 天（演示预计）' : '待确认', production: !quote.review && typeof quote.productionHours === 'number' ? quote.productionHours.toFixed(1) + ' 小时' : '工程确认', review: !!quote.review,
    batchNote: batchDescription(quote),
    unitPriceText: !quote.review && quote.pricingSummary && typeof quote.pricingSummary.averageUnitManufacturingCents === 'number' ? '平均制造单价 ' + priceText(quote.pricingSummary.averageUnitManufacturingCents / 100) + '，运费和平台费另列。' : '' }));
}
function requestKey() { return 'weapp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + '-' + Math.random().toString(36).slice(2, 12); }
async function createOrder(quoteId) {
  if (mode === 'local') return demo.createOrder(quoteId);
  if (!selectedRemoteQuotes.some(quote => quote.quoteId === quoteId)) throw new Error('请先重新获取服务端报价。');
  const scope = config.API_BASE + ':order:' + quoteId;
  const result = await remoteClient().createOrder(quoteId, retainedKey(scope));
  completeKey(scope);
  return result.order;
}
async function getCustomerProfile() {
  if (mode !== 'server') return { profile: null, localOnly: true };
  return remoteClient().getCustomerProfile();
}
async function getMarkets() {
  if (mode !== 'server') return { markets: [], localOnly: true };
  return remoteClient().getMarkets();
}
async function saveCustomerProfile(input) {
  if (mode !== 'server') { const error = new Error('本机演示不采集或保存真实收货地址，请先接通服务端模式。'); error.code = 'SERVER_MODE_REQUIRED'; throw error; }
  // Address bodies stay in memory. Never put personal details in a persistent retry-key scope.
  const signature = JSON.stringify(input);
  if (!pendingProfileMutation || pendingProfileMutation.signature !== signature) pendingProfileMutation = { signature, key: requestKey() };
  const mutation = pendingProfileMutation;
  const result = await remoteClient().saveCustomerProfile(input, mutation.key);
  if (pendingProfileMutation === mutation) pendingProfileMutation = null;
  invalidateQuotes();
  return result;
}
function remoteOrder(order) {
  const disputed = order.disputeState === 'OPEN' || order.dispute === true;
  const label = order.refundState === 'REQUESTED' ? statusNames.refund_pending : order.refundState === 'SIMULATED_REFUNDED' ? statusNames.refunded : (statusNames[order.status] || String(order.status || '等待服务端状态'));
  const settlementNames = { NOT_REQUESTED: '尚未验收；未申请结算', READY: '客户已验收，尚未申请结算', REQUESTED: '模拟结算申请处理中', FAILED: '模拟结算失败，等待处理', CANCELLED: '结算已取消', SIMULATED_SETTLED: '模拟结算完成；不代表银行到账' };
  let settlement = settlementNames[order.settlementState] || (order.status === 'settled' ? '模拟结算完成；不代表银行到账' : '等待服务端资金状态');
  if (order.refundState === 'REQUESTED') settlement = '退款申请处理中，暂停结算';
  else if (order.refundState === 'SIMULATED_REFUNDED') settlement = '模拟退款完成';
  else if (disputed && order.settlementState !== 'CANCELLED') settlement = '争议处理中，暂停结算';
  else if (order.refundState === 'REJECTED') settlement += '；退款申请已驳回';
  if (order.paymentState === 'UNPAID') settlement = '尚未付款';
  const events = Array.isArray(order.events) ? order.events : [];
  return { id: order.id, modelName: order.modelName || '服务端示例模型', material: order.material || '待确认', quantity: order.qty, farm: order.farmName || (typeof order.farm === 'object' ? order.farm.name : order.farm) || '服务端工坊', priceText: order.paymentState === 'UNPAID' && order.status === 'review' ? '待工程报价' : priceText(order.total), status: label, disputeNote: disputed ? '争议处理中' : '',
    canAdvance: false, terminal: ['settled', 'cancelled', 'refunded'].includes(order.status), timeline: events.length ? events.map((event, index) => ({ label: event.label || event.action || '服务端事件', number: index + 1, done: true })) : [{ label, number: 1, done: true }],
    logistics: order.tracking ? '服务端沙盒单号：' + order.tracking : '尚无服务端物流信息', settlement: settlement + '；未转移真实资金',
    priceBreakdown: order.settlementBreakdown ? '制造 ' + priceText(order.settlementBreakdown.manufacturingCents / 100) + ' · 平台费 ' + priceText(order.settlementBreakdown.platformFeeCents / 100) + ' · 运费 ' + priceText(order.settlementBreakdown.shippingCents / 100) : '',
    reviewNote: '服务端沙盒记录。物流签收与客户验收分开；验收、售后及商家履约模拟请在已登录的网页端操作。' };
}
async function listOrders() {
  if (mode === 'local') return demo.listOrders().map(order => Object.assign({}, order, { priceText: priceText(order.price), terminal: !order.canAdvance }));
  const result = await remoteClient().getWorkspace(); return result.workspace.orders.map(remoteOrder);
}
function advanceOrder(id) { if (mode !== 'local') throw new Error('服务端订单不能在本机推进。'); demo.advanceOrder(id); }
function clearOrders() { if (mode !== 'local') throw new Error('服务端订单不能在本机清空。'); demo.clearOrders(); }
module.exports = { materials: demo.materials, getMode, getModeInfo, selectMode, getSpec, saveSpec, getQuotes, createOrder, getCustomerProfile, getMarkets, saveCustomerProfile, listOrders, advanceOrder, clearOrders };
