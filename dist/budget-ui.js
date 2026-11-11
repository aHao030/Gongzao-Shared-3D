// Model budgets are read-only estimates. The next selection immediately retires the old result.
import { tradeInboxHref } from './trade-return.js';

export function createBudgetController({request, changed, delay = 220}) {
  let version = 0;
  let timer;
  let lastKey;
  let view;

  function reset() {
    clearTimeout(timer);
    version++;
    lastKey = undefined;
    view = undefined;
  }

  function select({model, qty, unit, material, quality, connection, workspace}, retry = false) {
    const payload = {modelId: model?.id, qty: Number(qty), unit, material, quality};
    const key = JSON.stringify([payload, connection, workspace, model?.version, model?.localOnly, model?.isSample]);
    if (!retry && key === lastKey) return view;
    reset();
    lastKey = key;
    const current = version;
    const phase = connection === 'loading' ? 'connecting' : connection !== 'online' ? 'offline'
      : !model?.id || model.localOnly ? 'upload' : !Number.isInteger(payload.qty) || payload.qty < 1 || payload.qty > 50 ? 'quantity' : 'pending';
    view = {phase, payload, sample: Boolean(model?.isSample)};
    if (phase !== 'pending') return view;
    timer = setTimeout(async () => {
      try {
        const {estimate} = await request(payload);
        if (current !== version) return;
        const validRange = (a, b) => Number.isSafeInteger(a) && Number.isSafeInteger(b) && a >= 0 && b >= a;
        if (!estimate || !['ESTIMATED','REVIEW_REQUIRED'].includes(estimate.status)
          || (estimate.status === 'ESTIMATED' && (estimate.currency !== 'CNY'
            || !validRange(estimate.lowCents, estimate.highCents) || !validRange(estimate.unitLowCents, estimate.unitHighCents)))) {
          throw new Error('预算数据不完整，请重试。');
        }
        view = {...view, phase: estimate.status === 'ESTIMATED' ? 'ready' : 'review', estimate};
      } catch (error) {
        if (current !== version) return;
        view = {...view, phase: 'error', message: error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR'
          ? '估算服务暂时无法连接。' : error.message || '暂时无法取得预算。'};
      }
      changed(view);
    }, delay);
    return view;
  }
  return {select, reset};
}

const amount = cents => '¥' + (cents / 100).toFixed(2);
const range = (low, high) => low === high ? amount(low) : amount(low) + ' – ' + amount(high);
const materialNames = {AUTO:'商家推荐', RESIN:'工程树脂', ALUMINUM:'铝合金', CNC:'CNC 铝件'};
const basisNames = {GEOMETRY:'模型几何估算', SLICER:'切片数据估算', MIXED:'切片与几何估算', MANUAL:'需工程审核'};
const statusText = {connecting:'正在连接工作空间…', offline:'连接服务后可估算预算。', upload:'上传模型后可估算预算。', quantity:'请输入 1–50 的整数件数。', pending:'正在估算…'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export function renderBudget({phase, payload, sample, estimate, message}, detailsOpen = false, routed = true) {
  const complete = phase === 'ready' || phase === 'review';
  const contact = complete || phase === 'pending' || phase === 'error';
  const body = phase === 'ready'
    ? '<p class="budget-amount">' + range(estimate.lowCents, estimate.highCents) + '</p><p class="budget-meta">' +
      payload.qty + ' 件合计 · 每件 ' + range(estimate.unitLowCents, estimate.unitHighCents) + '</p>'
    : '<p class="budget-state">' + esc(phase === 'review' ? '待商家审核模型' : phase === 'error' ? message : statusText[phase]) + '</p>';
  let details = '';
  if (complete) {
    const rows = [];
    function row(label, value) {
      if (value) rows.push('<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>');
    }
    row('计价来源', estimate.source === 'SHOP_CONFIG' ? '商家配置' : '平台参考费率');
    row('估算方式', basisNames[estimate.basis]);
    const compared = Array.isArray(estimate.materialsCompared) ? estimate.materialsCompared.join(' / ') : '';
    row('材料', payload.material === 'AUTO' && compared ? '自动比较 ' + compared : materialNames[payload.material] || payload.material);
    row('层高档位', payload.quality === 'fine' ? '精细' : '标准');
    row('包含', Array.isArray(estimate.includes) && estimate.includes.join('、'));
    row('另计', Array.isArray(estimate.excludes) && estimate.excludes.join('、'));
    details = '<details class="budget-details"' + (detailsOpen ? ' open' : '') + '><summary data-budget-focus="details">估算依据与费用范围</summary><dl>' + rows.join('') +
      '</dl>' + (estimate.explanation ? '<p>' + esc(estimate.explanation) + '</p>' : '') + '</details>';
  }
  const link = contact ? '<a class="budget-contact" data-budget-focus="contact" href="' + esc(tradeInboxHref('buyer', payload, routed)) + '">选店并联系商家 <span aria-hidden="true">↗</span></a>' : '';
  const retry = phase === 'error' ? '<button class="text-link budget-retry" type="button" data-action="retry-budget" data-budget-focus="retry">重新估算</button>' : '';
  return '<div class="budget-heading"><h3>' + (sample ? '示例模型预算' : '模型预算') + '</h3>' + link + '</div><div role="status" aria-live="polite">' +
    body + (phase === 'ready' ? '<p class="budget-scope">含平台服务费，运费及税费另计。最终金额以商家方案为准。</p>' : '') + '</div>' + retry + details;
}
