// Keep the public methodology consistent with the measurements used to price the quote.
// All evidence is added before the quote fingerprint is generated.
export function addQuoteEvidence(quote, { model, device, orders, now }) {
  const review = quote.review === true;
  const sliced = !review && quote.estimateBasis === 'SLICER_OUTPUT' && quote.sliceEvidence;
  const queue = orders.filter(order => order.farm === quote.farm.id && ['PRINTING', 'QUEUED'].includes(order.productionState));
  const dateAt = days => new Date(now + days * 86400000).toISOString();
  quote.estimation = {
    schemaVersion: 1,
    method: review ? 'MANUAL_REVIEW' : sliced ? 'SLICER_OUTPUT' : 'GEOMETRY_HEURISTIC',
    confidence: 'UNVERIFIED',
    slicer: sliced ? quote.sliceEvidence.engineVersion : null,
    machineValidated: false,
    analysisVersion: model.analysisVersion || (model.isSample ? 'sandbox-fixture-v1' : 'legacy-analysis-unknown'),
    analysisNote: model.analysisNote || '几何检查不代表可制造性验证；尚未验证自相交、壁厚、公差或支撑。',
    queueJobs: queue.length,
    queueBasis: 'FULL_ESTIMATED_HOURS_OF_ACTIVE_SANDBOX_ORDERS',
    deviceState: device.state,
    capacityReserved: false,
    estimatedArrival: review ? null : { earliest: dateAt(quote.days[0]), latest: dateAt(quote.days[1]) },
    stages: review ? null : {
      productionHours: quote.productionHours,
      queueHours: quote.queueHours,
      preparationDays: quote.preparationDays,
      transitDays: [...quote.transitDays],
    },
    assumptions: review ? [
      '需工程审核后再确定价格和交期；本报价未收款、未预约产能。',
    ] : [
      sliced ? '耗材与制造工时采用本次匹配的切片结果，成本与利润按商家计价参数估算。' : '材料量按实体体积和密度估算，机时按商家演示出料速度及每板预热估算，未运行切片器。',
      '排队时长按当前演示订单的完整预计工时累计，未扣除已加工时长；按每天 8 小时演示产能计算。',
      sliced ? '板数来自本次切片任务，仍需验证设备和实际排版。' : '板数按成型范围与模型包围盒估算，不跨客户合板，也不等待其他订单凑板。',
      '未校准实机速度、支撑、填充、损耗、返工、节假日和实际承运商时效。',
      '到货日期为测算时点的预计区间，不是交付承诺，也不锁定设备产能。',
    ],
  };
  return quote;
}
