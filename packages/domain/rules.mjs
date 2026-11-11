// Portable pure rules: no Node APIs, browser globals, I/O or cryptography.
export class DomainError extends Error {
  constructor(code, message) { super(message); this.name = 'DomainError'; this.code = code; }
}
export function assert(condition, code, message) {
  if (!condition) throw new DomainError(code, message);
}
export const TRANSITIONS = Object.freeze({
  RESERVED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['UPLOADED', 'CANCEL_REQUESTED', 'FAILED'],
  UPLOADED: ['READY', 'CANCEL_REQUESTED', 'FAILED'],
  READY: ['STARTING', 'CANCEL_REQUESTED'],
  STARTING: ['RUNNING', 'EXECUTION_UNKNOWN', 'CANCEL_REQUESTED'],
  EXECUTION_UNKNOWN: ['RUNNING', 'STOP_CONFIRMED', 'CANCEL_REQUESTED', 'FAILED'],
  RUNNING: ['PAUSED', 'WAITING_REMOVAL', 'CANCEL_REQUESTED', 'FAILED'],
  PAUSED: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED'],
  CANCEL_REQUESTED: ['STOP_CONFIRMED', 'RUNNING', 'EXECUTION_UNKNOWN'],
  STOP_CONFIRMED: ['CANCELLED'],
  WAITING_REMOVAL: ['QC_PENDING'],
  QC_PENDING: ['QC_PASSED', 'QC_FAILED'],
  QC_FAILED: ['REWORK_REQUIRED'],
  REWORK_REQUIRED: [], // A new production attempt is required; do not reset this history.
  QC_PASSED: [], CANCELLED: [], FAILED: []
});
export function transition(state, next) {
  assert(TRANSITIONS[state]?.includes(next), 'INVALID_TRANSITION', `不允许从 ${state} 转为 ${next}`);
  return next;
}

// Reservation = commercial capacity/material hold. Lease = dispatch ownership.
// Neither an expired lease nor a lost heartbeat is evidence that a machine stopped.
export function reserve(machine, orderId, materialGrams, now = Date.now(), ttlMs = 900000) {
  assert(machine.state === 'IDLE' && !machine.reservation, 'MACHINE_UNAVAILABLE', '设备尚未可用');
  assert(materialGrams > 0 && machine.availableGrams >= materialGrams, 'MATERIAL_UNAVAILABLE', '材料不足');
  return { ...machine, reservation: { orderId, materialGrams, expiresAt: now + ttlMs, confirmed: false } };
}
export function confirmReservation(machine, orderId, now = Date.now()) {
  assert(machine.reservation?.orderId === orderId && now < machine.reservation.expiresAt, 'RESERVATION_EXPIRED', '预留不存在或已超时，付款需人工核对或退款');
  return { ...machine, reservation: { ...machine.reservation, confirmed: true } };
}
export function claimLease(machine, orderId, owner, now = Date.now(), ttlMs = 30000, leaseToken) {
  assert(machine.reservation?.orderId === orderId && machine.reservation.confirmed, 'NO_CONFIRMED_RESERVATION', '必须先确认预约');
  assert(machine.state === 'IDLE' && !machine.activeJobId, 'MACHINE_UNAVAILABLE', '设备执行状态不允许派发');
  assert(!machine.lease || machine.lease.expiresAt <= now, 'LEASE_CONFLICT', '设备派发权已被占用');
  assert(typeof leaseToken === 'string' && leaseToken.length > 0, 'LEASE_TOKEN_REQUIRED', '由调用方提供不可预测的租约令牌');
  return { ...machine, lease: { orderId, owner, token: leaseToken, expiresAt: now + ttlMs } };
}
export function readinessIssues(check, expected) {
  const issues = [];
  for (const key of ['online', 'bedClear', 'operatorReady', 'noFault', 'doorInterlockOk', 'sufficientMaterial']) if (check[key] !== true) issues.push(key);
  for (const key of ['modelHash', 'profileVersion', 'recipeVersion']) if (check[key] !== expected[key]) issues.push(`${key}Mismatch`);
  if (!Number.isFinite(check.observedAt) || Math.abs((expected.now ?? Date.now()) - check.observedAt) > 10000) issues.push('staleReadiness');
  return issues;
}
export function canReleaseMachine(state, evidence = {}) {
  return (state === 'CANCELLED' && evidence.stopConfirmed === true && evidence.bedClear === true) ||
    (['QC_PENDING', 'QC_PASSED', 'QC_FAILED'].includes(state) && evidence.partRemoved === true && evidence.bedClear === true);
}
export function settlementEligibility(order) {
  const reasons = [];
  if (order.productionState !== 'QC_PASSED') reasons.push('productionQualityRequired');
  if (order.acceptanceState !== 'ACCEPTED') reasons.push('customerAcceptanceRequired');
  if (order.logisticsState !== 'DELIVERED') reasons.push('deliveryRequired');
  if (order.paymentState !== 'PAID_FROZEN_DEMO') reasons.push('confirmedPaymentRequired');
  if (order.disputeOpen) reasons.push('disputeOpen');
  if (order.refundState && order.refundState !== 'NONE') reasons.push('refundUnresolved');
  if (order.settlementState !== 'NOT_REQUESTED') reasons.push('settlementAlreadyRequested');
  return { eligible: reasons.length === 0, reasons };
}

