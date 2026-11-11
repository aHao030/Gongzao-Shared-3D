const demo = require('./demo');
const config = require('../config/service');
const { createApiClient, normalizeApiBase } = require('./api-client');
const { getAccessToken } = require('./auth');
const { wxTransport } = require('./transport');
const materialCodes = ['PLA', 'PETG', 'RESIN', 'ALUMINUM', 'CNC'];
const statusNames = { awaiting_pickup: '生产完成待取件', qc_failed: '质检未通过', ready_to_ship: '质检通过待发货', review: '工程审核中', queued: '等待设备', printing: '生产中', printed: '生产完成待取件', qc: '待质检', ready: '待发货', shipped: '运输中', delivered: '已签收待验收', settled: '模拟结算完成', cancelled: '已取消' };
let mode = 'local';
let client;
let selectedRemoteQuotes = [];
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
  return { mode, modeIndex: mode === 'server' ? 1 : 0, modeLabel: mode === 'server' ? '服务端沙盒' : '本机演示', isLocal: mode === 'local',
    modeNote: mode === 'server' ? '报价与订单来自服务端沙盒；未连接真实设备、支付或承运商。' : '仅本机示例数据；不会上传图纸、调用真实设备或收取费用。' };
}
function remoteClient() {
  if (!config.AUTH_ADAPTER_READY) { const error = new Error('当前服务端只支持 Sites 身份；微信小程序鉴权尚未接入。请先由开发者完成受支持的登录与令牌验证，不能复用 ChatGPT Cookie。'); error.code = 'AUTH_ADAPTER_NOT_READY'; throw error; }
  normalizeApiBase(config.API_BASE);
  if (!client) client = createApiClient({ apiBase: config.API_BASE, transport: wxTransport, getAccessToken });
  return client;
}
async function selectMode(nextMode) {
  if (nextMode !== 'local' && nextMode !== 'server') throw new Error('不支持的数据模式。');
  if (nextMode === 'server') await remoteClient().getSession();
  mode = nextMode; selectedRemoteQuotes = []; return getModeInfo();
}
function getSpec() { return demo.getSpec(); }
function saveSpec(materialIndex, quantity) { return demo.saveSpec(materialIndex, quantity); }
function priceText(value) { return typeof value === 'number' && Number.isFinite(value) ? '¥' + value.toFixed(2) : '待工程报价'; }
async function getQuotes(spec) {
  if (!spec) return [];
  if (mode === 'local') return demo.getQuotes(spec).map(quote => Object.assign({}, quote, { priceText: priceText(quote.price) }));
  const input = { modelId: 'sample-bracket', material: materialCodes[spec.materialIndex], quality: 'standard', qty: spec.quantity, unit: 'mm', destination: 'east' };
  const signature = JSON.stringify(input);
  const scope = config.API_BASE + ':quote:' + signature;
  const result = await remoteClient().getQuotes(input, retainedKey(scope));
  completeKey(scope);
  selectedRemoteQuotes = result.quotes;
  return result.quotes.map(quote => ({ id: quote.quoteId, name: quote.farm && quote.farm.name || '服务端工坊', tag: quote.review ? '需工程审核' : '服务端示例报价', priceText: priceText(quote.total),
    lead: Array.isArray(quote.days) ? quote.days.join('–') + ' 个工作日' : '待确认', production: typeof quote.productionHours === 'number' ? quote.productionHours.toFixed(1) + ' 小时' : '工程确认', review: !!quote.review }));
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
function remoteOrder(order) {
  const label = order.dispute ? '争议处理中' : (statusNames[order.status] || String(order.status || '等待服务端状态'));
  const events = Array.isArray(order.events) ? order.events : [];
  return { id: order.id, modelName: order.modelName || '服务端示例模型', material: order.material || '待确认', quantity: order.qty, farm: order.farmName || (typeof order.farm === 'object' ? order.farm.name : order.farm) || '服务端工坊', priceText: priceText(order.total), status: label,
    canAdvance: false, terminal: ['settled', 'cancelled'].includes(order.status), timeline: events.length ? events.map((event, index) => ({ label: event.label || event.action || '服务端事件', number: index + 1, done: true })) : [{ label, number: 1, done: true }],
    logistics: order.tracking ? '服务端沙盒单号：' + order.tracking : '尚无服务端物流信息', settlement: order.status === 'settled' ? '模拟结算完成；未转移真实资金' : '由服务端校验验收与结算条件',
    reviewNote: '服务端沙盒记录。小程序不提供生产、取件、质检或资金推进按钮。' };
}
async function listOrders() {
  if (mode === 'local') return demo.listOrders().map(order => Object.assign({}, order, { priceText: priceText(order.price), terminal: !order.canAdvance }));
  const result = await remoteClient().getWorkspace(); return result.workspace.orders.map(remoteOrder);
}
function advanceOrder(id) { if (mode !== 'local') throw new Error('服务端订单不能在本机推进。'); demo.advanceOrder(id); }
function clearOrders() { if (mode !== 'local') throw new Error('服务端订单不能在本机清空。'); demo.clearOrders(); }
module.exports = { materials: demo.materials, getMode, getModeInfo, selectMode, getSpec, saveSpec, getQuotes, createOrder, listOrders, advanceOrder, clearOrders };
