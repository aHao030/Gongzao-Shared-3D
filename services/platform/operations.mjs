import { ApiError, ensure, sha256 } from './geometry.mjs';
import { requireMerchant } from './merchant.mjs';
import { getPricingProfile } from './pricing.mjs';

// This module is deliberately IO-free: both stores may replay a CAS operation.
// External workers may only complete a currently held lease. Simulation never
// grants a physical command or a real payment capability.
export const OPERATIONS_VERSION = 1;
const copy = x => structuredClone(x);
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const fail = (code, message, status = 409) => { throw new ApiError(status, code, message); };
const text = (s, max = 120) => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const canonical = x => {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  ensure(x === null || ['string', 'boolean'].includes(typeof x) || typeof x === 'number' && Number.isFinite(x), 400, 'INVALID_INPUT', '只接受有效 JSON 值');
  return JSON.stringify(x);
};
const digest = x => sha256(new TextEncoder().encode(canonical(x)));
const materials = ['PLA', 'PETG', 'ABS', 'RESIN', 'ALUMINUM', 'CNC'];
const kinds = ['ANALYZE_MODEL', 'SLICE_MODEL', 'SCHEDULE'];
const activeProduction = x => !['CANCELLED', 'QC_PASSED', 'QC_FAILED'].includes(x.status);
const blank = () => ({ schemaVersion: OPERATIONS_VERSION, spools: [], profiles: [], jobs: [], productions: [], schedule: null, events: [], ledger: {} });
const stateOf = w => w.operations ?? blank();
const find = (list, id, kind) => { const value = list.find(x => x.id === id); ensure(value, 404, kind + '_NOT_FOUND', '未找到指定记录'); return value; };
const record = (s, type, id, now, detail = '') => { s.events.push({ type, id, at: now, detail }); if (s.events.length > 100) s.events.splice(0, s.events.length - 100); };
const ack = p => ensure(p.demoAcknowledged === true, 409, 'DEMO_ACK_REQUIRED', '请确认本次操作仅为生产流程模拟，不会驱动真机');
const deviceOf = (w, id) => w.merchant?.devices?.find(x => x.id === id) ?? w.devices?.find(x => x.id === id);
const publicJob = ({ leaseToken, ...job }) => copy(job);
function assertFreshProfile(s, j) {
  if (!j.profileId) return;
  const p = find(s.profiles, j.profileId, 'PROFILE');
  ensure(p.enabled && p.revision === j.profileRevision, 409, 'PROFILE_CHANGED', '工艺配置已更新，请重新切片');
}
function orderAllowed(order) {
  ensure(order.paymentState === 'SIMULATED_FROZEN', 409, 'PAYMENT_NOT_READY', '当前生产演练只接受已模拟付款的订单');
  ensure(order.disputeState !== 'OPEN' && !['REQUESTED', 'SIMULATED_REFUNDED'].includes(order.refundState), 409, 'ORDER_BLOCKED', '订单存在退款或争议，不能继续生产');
  ensure(order.logisticsState === 'NONE' && order.acceptanceState === 'PENDING', 409, 'ORDER_ALREADY_FULFILLED', '已发货或已验收的订单不能重新生产');
}

export function getOperations(workspace, now = Date.now()) {
  requireMerchant(workspace);
  const s = stateOf(workspace);
  return {
    schemaVersion: OPERATIONS_VERSION, revision: workspace.revision, mode: 'OPERATIONS_SANDBOX', realDispatchEnabled: false,
    spools: s.spools.map(x => ({ ...copy(x), availableGrams: x.remainingGrams - x.reservedGrams })),
    profiles: copy(s.profiles), jobs: s.jobs.map(publicJob), productions: copy(s.productions), schedule: copy(s.schedule), events: copy(s.events),
    models: (workspace.models ?? []).map(m => ({ id: m.id, name: m.name, format: m.format, sha256: m.sha256, isSample: !!m.isSample, dimensions: copy(m.dimensions), review: m.review })),
    orders: (workspace.orders ?? []).map(o => ({ id: o.id, modelId: o.modelId, modelName: o.modelName, farmId: o.farm, quantity: o.qty, material: o.material, quality: o.quality ?? 'standard', unit: o.unit, paymentState: o.paymentState, productionState: o.productionState, status: o.status })),
    devices: [...(workspace.devices ?? []).map(d => ({ id: d.id, name: d.name, farmId: d.farm, source: 'demo' })), ...(workspace.merchant?.devices ?? []).map(d => ({ id: d.id, name: d.name, farmId: null, source: d.source }))],
    summary: { spoolCount: s.spools.length, availableGrams: s.spools.filter(x => x.mode === 'SANDBOX').reduce((n, x) => n + x.remainingGrams - x.reservedGrams, 0), queuedJobs: s.jobs.filter(x => x.status === 'QUEUED').length, runningJobs: s.jobs.filter(x => x.status === 'LEASED' && x.leaseUntil > now).length, completedJobs: s.jobs.filter(x => x.status === 'COMPLETED').length, activeProductions: s.productions.filter(activeProduction).length, needsReview: s.productions.filter(x => ['UNKNOWN', 'WAITING_REMOVAL', 'QC_FAILED'].includes(x.status)).length },
  };
}

function saveSpool(w, s, p, now, idFactory) {
  const previous = p.id ? find(s.spools, p.id, 'SPOOL') : null;
  ensure(previous?.source !== 'SPOOLMAN', 409, 'EXTERNAL_INVENTORY_READ_ONLY', '此库存来自 Spoolman，请在原系统维护后重新同步');
  ensure(p.expectedRevision === (previous?.revision ?? 0), 409, 'SPOOL_CHANGED', '库存已更新，请刷新后保存');
  const mode = p.mode ?? previous?.mode ?? 'SANDBOX';
  ensure(text(p.name, 100) && materials.includes(p.material) && finite(p.remainingGrams, 0, 1e6) && int(p.costCentsPerKg, 0, 1e7) && ['SANDBOX', 'LIVE_INVENTORY'].includes(mode), 400, 'INVALID_SPOOL', '请填写有效的耗材名称、材料、余量和采购价');
  ensure(!previous || (previous.material === p.material && previous.mode === mode), 409, 'SPOOL_IDENTITY_IMMUTABLE', '已登记耗材的材料类型和库存模式不能变更，请新增耗材卷');
  ensure(p.remainingGrams >= (previous?.reservedGrams ?? 0), 409, 'STOCK_RESERVED', '剩余库存不能少于已预留用量');
  ensure(previous || s.spools.length < 100, 409, 'SPOOL_CAPACITY', '当前最多保存 100 卷耗材');
  const spool = { id: previous?.id ?? 'spool-' + idFactory(), name: p.name.trim(), material: p.material, mode, remainingGrams: p.remainingGrams, reservedGrams: previous?.reservedGrams ?? 0, consumedGrams: previous?.consumedGrams ?? 0, costCentsPerKg: p.costCentsPerKg, costConfigured: true, costSource: 'MERCHANT_ENTRY', revision: (previous?.revision ?? 0) + 1, updatedAt: now, source: 'MERCHANT_ENTRY' };
  if (previous) s.spools[s.spools.indexOf(previous)] = spool; else s.spools.push(spool);
  record(s, 'SPOOL_SAVED', spool.id, now); return { spool: copy(spool) };
}
function saveProfile(w, s, p, now, idFactory) {
  const previous = p.id ? find(s.profiles, p.id, 'PROFILE') : null;
  ensure(p.expectedRevision === (previous?.revision ?? 0), 409, 'PROFILE_CHANGED', '工艺配置已更新，请刷新后保存');
  ensure(text(p.name, 100) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(p.localProfileId ?? '') && ['PrusaSlicer', 'FreeCAD'].includes(p.engine) && ['FDM', 'CNC'].includes(p.process) && materials.includes(p.material) && typeof p.enabled === 'boolean', 400, 'INVALID_PROFILE', '工艺名称、配置标识、引擎、材料或启用状态无效');
  ensure(p.process === 'FDM' ? p.engine === 'PrusaSlicer' && ['PLA', 'PETG', 'ABS'].includes(p.material) : p.engine === 'FreeCAD' && p.material === 'CNC', 400, 'PROFILE_PROCESS_MISMATCH', '切片引擎与工艺材料不匹配');
  const device = deviceOf(w, p.deviceId);
  ensure(device, 400, 'INVALID_DEVICE', '只能使用当前商家已登记或沙盒设备');
  ensure(['f1', 'f2', 'f3'].includes(p.farmId), 400, 'INVALID_FARM', '请选择计价产线');
  ensure(!device.farm || device.farm === p.farmId, 400, 'DEVICE_FARM_MISMATCH', '设备不属于所选计价产线');
  ensure(['standard', 'fine'].includes(p.quality ?? 'standard'), 400, 'INVALID_QUALITY', '请选择标准或精细层高方案');
  ensure(p.expectedProfileSha256 == null || p.expectedProfileSha256 === '' || hash(p.expectedProfileSha256), 400, 'INVALID_PROFILE_HASH', '工艺文件校验值必须为 SHA-256');
  ensure(previous || s.profiles.length < 50, 409, 'PROFILE_CAPACITY', '当前最多保存 50 个切片配置');
  const profile = { id: previous?.id ?? 'profile-' + idFactory(), name: p.name.trim(), localProfileId: p.localProfileId, engine: p.engine, process: p.process, material: p.material, quality: p.quality ?? 'standard', farmId: p.farmId, deviceId: p.deviceId, expectedProfileSha256: p.expectedProfileSha256 || null, enabled: p.enabled, revision: (previous?.revision ?? 0) + 1, updatedAt: now, hardwareVerified: false, realDispatchEnabled: false };
  if (previous) s.profiles[s.profiles.indexOf(previous)] = profile; else s.profiles.push(profile);
  record(s, 'PROFILE_SAVED', profile.id, now); return { profile: copy(profile) };
}
function scheduleSnapshot(s, now) {
  return { baseAt: now, tasks: s.productions.filter(x => activeProduction(x) && x.status !== 'UNKNOWN').map(x => ({ jobId: x.id, deviceId: x.deviceId, durationSeconds: Math.ceil(x.estimatedDurationSeconds), createdAt: x.createdAt })) };
}
async function queueJob(w, s, p, now, idFactory) {
  ensure(kinds.includes(p.kind), 400, 'INVALID_JOB_KIND', '请选择模型分析、切片或排期任务');
  const mode = p.mode ?? 'WORKER';
  ensure(['WORKER', 'SANDBOX'].includes(mode), 400, 'INVALID_JOB_MODE', '任务模式无效');
  if (mode === 'SANDBOX') ack(p);
  ensure(s.jobs.length < 180, 409, 'JOB_CAPACITY', '当前最多保存 180 个制造任务');
  let terms;
  if (p.kind === 'SCHEDULE') {
    terms = { kind: p.kind, mode, modelId: null, modelHash: null, modelVersion: null, profileId: null, profileRevision: null, configSnapshot: scheduleSnapshot(s, now) };
  } else {
    const model = find(w.models ?? [], p.modelId, 'MODEL');
    ensure(['stl', '3mf'].includes(model.format), 409, 'MODEL_ENGINEERING_REVIEW', '此格式需要工程师审核，不能自动网格切片');
    ensure(mode === 'SANDBOX' || !model.isSample, 409, 'SAMPLE_HAS_NO_FILE', '演示模型没有真实文件，请先上传模型或选择演示任务');
    ensure(int(p.quantity ?? 1, 1, 50) && ['mm', 'inch'].includes(p.unit ?? 'mm'), 400, 'INVALID_CONFIGURATION', '数量需为 1–50，单位需为毫米或英寸');
    const profile = p.profileId ? find(s.profiles, p.profileId, 'PROFILE') : null;
    ensure(p.kind !== 'SLICE_MODEL' || profile, 400, 'PROFILE_REQUIRED', '切片前请先选择商家工艺配置');
    if (profile) ensure(profile.enabled && profile.process === 'FDM', 409, 'PROFILE_REVIEW_REQUIRED', '配置未启用或需要 CNC 工程审核');
    terms = { kind: p.kind, mode, modelId: model.id, modelHash: model.sha256, modelVersion: model.version ?? 1, format: model.format, quantity: p.quantity ?? 1, unit: p.unit ?? 'mm', profileId: profile?.id ?? null, profileRevision: profile?.revision ?? null, configSnapshot: profile ? copy(profile) : null };
  }
  const inputHash = await digest(terms);
  const existing = s.jobs.find(x => x.inputHash === inputHash && ['QUEUED', 'LEASED', 'COMPLETED'].includes(x.status));
  if (existing) return { job: publicJob(existing), alreadyQueued: true };
  const job = { id: 'job-' + idFactory(), ...terms, inputHash, status: 'QUEUED', attempt: 0, createdAt: now, updatedAt: now, result: null, error: null };
  if (mode === 'SANDBOX') {
    if (job.kind === 'SCHEDULE') job.result = basicSchedule(job.configSnapshot);
    else {
      const m = find(w.models, job.modelId, 'MODEL'), scale = job.unit === 'inch' ? 25.4 : 1;
      const volumeMm3 = m.volume * 1000 * scale ** 3;
      job.result = { inputHash, modelHash: m.sha256, profileRevision: job.profileRevision, engineVersion: 'sandbox-estimator-v1', provenance: 'SIMULATED', geometry: { dimensionsMm: m.dimensions.map(x => x * scale), volumeMm3, surfaceAreaMm2: 0, watertight: m.closed === true, windingConsistent: m.closed === true, isVolume: m.closed === true, bodyCount: 1, faceCount: m.faceCount ?? 0, requiresReview: m.review === true, warnings: ['仅使用演示体积估算，未运行真实切片器'] } };
      if (job.kind === 'SLICE_MODEL') Object.assign(job.result, { materialGrams: Math.max(.1, Math.ceil(volumeMm3 / 1000 * 1.24 * job.quantity * 100) / 100), durationSeconds: Math.max(60, Math.ceil(volumeMm3 / 1000 * 1.24 * job.quantity / 20 * 3600)), plateCount: 1, artifactHash: null });
    }
    job.status = 'COMPLETED'; job.completedAt = now;
  }
  s.jobs.push(job); record(s, 'JOB_QUEUED', job.id, now, job.mode); return { job: publicJob(job), alreadyQueued: false };
}
function expire(s, now) {
  let expired = 0;
  for (const job of s.jobs) if (job.status === 'LEASED' && job.leaseUntil <= now) {
    job.status = job.attempt >= 3 ? 'FAILED' : 'QUEUED'; job.error = { code: 'LEASE_EXPIRED', message: '计算服务未在租约期内返回结果' }; job.updatedAt = now; delete job.leaseToken; delete job.workerId; delete job.leaseUntil; expired++;
  }
  // A device start is never requeued on timeout: only reconciliation can resolve it.
  for (const p of s.productions) if (p.status === 'DISPATCHING' && p.dispatchLeaseUntil <= now) { p.status = 'UNKNOWN'; p.updatedAt = now; expired++; }
  return expired;
}
function worker(context) { ensure(text(context.workerId, 100), 403, 'WORKER_REQUIRED', '此操作仅允许已认证的后台计算服务'); }
function claimJob(s, p, now, idFactory, context) {
  worker(context); const expired = expire(s, now);
  const accepted = p.kinds ?? kinds;
  ensure(Array.isArray(accepted) && accepted.length > 0 && accepted.length <= 3 && accepted.every(x => kinds.includes(x)), 400, 'INVALID_JOB_KIND', '计算服务的任务类型无效');
  const allowed = context.workerKinds ?? kinds;
  ensure(accepted.every(x => allowed.includes(x)), 403, 'WORKER_KIND_DENIED', '计算服务未获授权执行该任务类型');
  const seconds = p.leaseSeconds ?? 300;
  ensure(int(seconds, 30, 900), 400, 'INVALID_LEASE', '租约需为 30–900 秒');
  const job = s.jobs.find(x => x.mode === 'WORKER' && x.status === 'QUEUED' && accepted.includes(x.kind));
  if (!job) return { job: null, expired, noChange: expired === 0 };
  job.status = 'LEASED'; job.attempt++; job.workerId = context.workerId; job.leaseToken = 'lease-' + idFactory(); job.leaseUntil = now + seconds * 1000; job.updatedAt = now; job.error = null;
  return { job: copy(job) };
}
function leased(s, p, now, context) {
  worker(context);
  const job = find(s.jobs, p.jobId, 'JOB');
  ensure(job.status === 'LEASED' && job.workerId === context.workerId && job.leaseToken === p.leaseToken && job.attempt === p.attempt && job.leaseUntil > now, 409, 'STALE_JOB_LEASE', '任务租约已过期、变更或不属于此计算服务');
  ensure(!context.workerKinds || context.workerKinds.includes(job.kind), 403, 'WORKER_KIND_DENIED', '计算服务无此任务权限');
  return job;
}
function sanitizeGeometry(g) {
  ensure(g && Array.isArray(g.dimensionsMm) && g.dimensionsMm.length === 3 && g.dimensionsMm.every(x => finite(x, 0, 1e6)) && (g.volumeMm3 === null || finite(g.volumeMm3, 0, 1e18)) && finite(g.surfaceAreaMm2, 0, 1e15) && ['watertight', 'windingConsistent', 'isVolume', 'requiresReview'].every(k => typeof g[k] === 'boolean') && int(g.bodyCount, 0, 1000000) && int(g.faceCount, 0, 10000000), 400, 'INVALID_GEOMETRY_RESULT', '模型分析结果无效');
  ensure(Array.isArray(g.warnings) && g.warnings.length <= 20 && g.warnings.every(x => text(x, 500)), 400, 'INVALID_GEOMETRY_RESULT', '分析提示无效');
  return Object.fromEntries(['dimensionsMm', 'volumeMm3', 'surfaceAreaMm2', 'watertight', 'windingConsistent', 'isVolume', 'bodyCount', 'faceCount', 'requiresReview', 'warnings'].map(k => [k, copy(g[k])]));
}
function validateSchedule(snapshot, schedule) {
  ensure(Array.isArray(schedule) && schedule.length === snapshot.tasks.length, 400, 'INVALID_SCHEDULE', '排期必须完整覆盖当前任务');
  const seen = new Set(), lanes = new Map();
  const normalized = schedule.map(item => {
    const task = snapshot.tasks.find(x => x.jobId === item.jobId);
    ensure(task && !seen.has(item.jobId) && item.deviceId === task.deviceId && finite(item.startAt, snapshot.baseAt, snapshot.baseAt + 366 * 86400000) && finite(item.endAt, item.startAt + task.durationSeconds * 1000, snapshot.baseAt + 366 * 86400000), 400, 'INVALID_SCHEDULE', '任务排期包含重复、错配设备或不足工时');
    seen.add(item.jobId); const lane = lanes.get(item.deviceId) ?? []; lane.push(item); lanes.set(item.deviceId, lane);
    return { jobId: item.jobId, deviceId: item.deviceId, startAt: item.startAt, endAt: item.endAt };
  });
  for (const lane of lanes.values()) { lane.sort((a, b) => a.startAt - b.startAt); for (let i = 1; i < lane.length; i++) ensure(lane[i].startAt >= lane[i - 1].endAt, 400, 'SCHEDULE_OVERLAP', '同一设备的任务不能重叠'); }
  return normalized;
}
function completeJob(w, s, p, now, context) {
  const job = leased(s, p, now, context), r = p.result;
  ensure(r && r.inputHash === job.inputHash && r.modelHash === job.modelHash && (r.profileRevision ?? null) === job.profileRevision && text(r.engineVersion, 100) && r.provenance === 'WORKER_OBSERVED', 400, 'JOB_RESULT_MISMATCH', '计算结果与模型或工艺版本不一致');
  assertFreshProfile(s, job);
  if (job.modelId) { const model = find(w.models, job.modelId, 'MODEL'); ensure(model.sha256 === job.modelHash && (model.version ?? 1) === job.modelVersion, 409, 'MODEL_CHANGED', '模型已更新，请重新分析'); }
  const result = { inputHash: job.inputHash, modelHash: job.modelHash, profileRevision: job.profileRevision, provenance: 'WORKER_OBSERVED', engineVersion: r.engineVersion };
  if (r.engine && text(r.engine.name, 80) && text(r.engine.version, 100)) result.engine = { name: r.engine.name, version: r.engine.version };
  if (job.kind === 'ANALYZE_MODEL') result.geometry = sanitizeGeometry(r.geometry);
  if (job.kind === 'SLICE_MODEL') {
    ensure(finite(r.durationSeconds, 1, 366 * 86400) && finite(r.materialGrams, .001, 1e6) && hash(r.artifactHash) && hash(r.profileSha256), 400, 'INVALID_SLICE_RESULT', '切片结果缺少有效工时、耗材或文件校验');
    if (job.configSnapshot.expectedProfileSha256) ensure(r.profileSha256 === job.configSnapshot.expectedProfileSha256, 409, 'PROFILE_HASH_MISMATCH', '本地切片配置文件校验值不匹配');
    Object.assign(result, { durationSeconds: r.durationSeconds, materialGrams: r.materialGrams, artifactHash: r.artifactHash, profileSha256: r.profileSha256, plateCount: int(r.plateCount, 1, 50) ? r.plateCount : 1 });
    if (r.geometry) result.geometry = sanitizeGeometry(r.geometry);
  }
  if (job.kind === 'SCHEDULE') {
    result.schedule = validateSchedule(job.configSnapshot, r.schedule); result.solverStatus = text(r.solverStatus, 60) ? r.solverStatus : 'FEASIBLE';
    const current = scheduleSnapshot(s, job.configSnapshot.baseAt);
    ensure(canonical(current) === canonical(job.configSnapshot), 409, 'SCHEDULE_STALE', '生产任务已变化，请重新排期');
    s.schedule = { ...copy(result), baseAt: job.configSnapshot.baseAt, generatedAt: now, confirmed: false };
  }
  job.result = result; job.status = 'COMPLETED'; job.completedAt = now; job.updatedAt = now; delete job.leaseToken; delete job.leaseUntil; delete job.workerId;
  record(s, 'JOB_COMPLETED', job.id, now); return { job: publicJob(job) };
}

export function estimateSliceEconomics(workspace, sliceJob, costCentsPerKg, frozenPricingProfile) {
  ensure(sliceJob?.kind === 'SLICE_MODEL' && sliceJob.status === 'COMPLETED' && sliceJob.result, 409, 'SLICE_REQUIRED', '请先完成切片估算');
  const p = frozenPricingProfile ?? getPricingProfile(workspace, sliceJob.configSnapshot.farmId), r = sliceJob.result, hours = r.durationSeconds / 3600;
  const materialPrice = costCentsPerKg ?? p.materialCostCentsPerKg[sliceJob.configSnapshot.material];
  ensure(int(materialPrice, 0, 1e7), 409, 'MATERIAL_COST_REQUIRED', '此材料需先填写采购成本');
  const costs = { materialCents: Math.ceil(r.materialGrams * materialPrice / 1000), machineCents: Math.ceil(hours * p.machineCostCentsPerHour), electricityCents: Math.ceil(hours * p.averagePowerWatts / 1000 * p.electricityCentsPerKwh), laborCents: Math.ceil((p.orderSetupMinutes + (r.plateCount ?? 1) * p.plateSetupMinutes + sliceJob.quantity * p.finishingMinutesPerPart) / 60 * p.laborCentsPerHour), packagingCents: p.packagingCentsPerOrder };
  const base = Object.values(costs).reduce((a, b) => a + b, 0), riskReserveCents = Math.ceil(base * p.riskReserveBps / 10000), estimatedCostCents = base + riskReserveCents;
  const minimumProfitCents = Math.max(p.minimumOrderProfitCents, Math.ceil(hours * p.minimumProfitCentsPerMachineHour));
  const suggestedManufacturingCents = Math.max(Math.ceil(estimatedCostCents * 10000 / (10000 - p.targetMarginBps)), estimatedCostCents + minimumProfitCents, 1);
  return { currency: 'CNY', provenance: r.provenance, pricingRevision: p.revision, durationSeconds: r.durationSeconds, materialGrams: r.materialGrams, costBreakdown: { ...costs, riskReserveCents }, estimatedCostCents, suggestedManufacturingCents, estimatedProfitCents: suggestedManufacturingCents - estimatedCostCents, targetMarginBps: p.targetMarginBps, minimumProfitCents, estimatedOnly: true };
}

export function findSliceEvidence(workspace, { modelId, modelHash, qty, unit, material, farmId, quality = 'standard' }) {
  const s = stateOf(workspace);
  const job = [...s.jobs].reverse().find(j => j.kind === 'SLICE_MODEL' && j.status === 'COMPLETED' && j.mode === 'WORKER' && j.result?.provenance === 'WORKER_OBSERVED' && j.modelId === modelId && j.modelHash === modelHash && j.quantity === qty && j.unit === unit && j.configSnapshot.material === material && j.configSnapshot.farmId === farmId && j.configSnapshot.quality === quality && s.profiles.some(p => p.id === j.profileId && p.enabled && p.revision === j.profileRevision));
  if (!job) return null;
  try { return { job: publicJob(job), economics: estimateSliceEconomics(workspace, job) }; }
  catch { return null; }
}

function syncSpools(s, p, now, idFactory, context) {
  ensure(context.integration === 'spoolman', 403, 'INTEGRATION_REQUIRED', '仅允许后端 Spoolman 连接同步库存');
  ensure(Array.isArray(p.spools) && p.spools.length <= 100, 400, 'INVALID_SPOOL_SYNC', '同步耗材列表无效');
  const ids = new Set(), synced = [];
  for (const item of p.spools) {
    const externalId = String(item.externalId ?? item.id ?? '');
    ensure(/^[A-Za-z0-9_-]{1,80}$/.test(externalId) && !ids.has(externalId) && text(item.name, 100) && materials.includes(item.material) && finite(item.remainingGrams, 0, 1e6) && (item.costCentsPerKg == null || int(item.costCentsPerKg, 0, 1e7)), 400, 'INVALID_SPOOL_SYNC', '同步耗材缺少有效标识、材料或余量');
    ids.add(externalId);
    const previous = s.spools.find(x => x.source === 'SPOOLMAN' && x.externalId === externalId);
    ensure(previous || s.spools.length < 100, 409, 'SPOOL_CAPACITY', '当前最多保存 100 卷耗材');
    const manualCost = previous?.costSource === 'MERCHANT_ENTRY', costCentsPerKg = manualCost ? previous.costCentsPerKg : item.costCentsPerKg ?? previous?.costCentsPerKg ?? null;
    const spool = { id: previous?.id ?? 'spool-' + idFactory(), externalId, name: item.name, material: item.material, mode: 'LIVE_INVENTORY', remainingGrams: item.remainingGrams, reservedGrams: 0, consumedGrams: previous?.consumedGrams ?? 0, costCentsPerKg, costConfigured: costCentsPerKg !== null, costSource: manualCost ? 'MERCHANT_ENTRY' : costCentsPerKg === null ? 'UNCONFIGURED' : 'CONNECTOR', revision: (previous?.revision ?? 0) + 1, updatedAt: now, source: 'SPOOLMAN', lastSyncedAt: now };
    if (previous) s.spools[s.spools.indexOf(previous)] = spool; else s.spools.push(spool); synced.push(copy(spool));
  }
  record(s, 'SPOOLMAN_SYNCED', 'spoolman', now, String(synced.length)); return { spools: synced, syncedCount: synced.length };
}
function createProduction(w, s, p, now, idFactory) {
  ack(p); ensure(p.mode === undefined || p.mode === 'SIMULATED', 409, 'REAL_DISPATCH_DISABLED', '真实付款、设备认证和派单尚未验收，不能启动真机');
  const order = find(w.orders ?? [], p.orderId, 'ORDER'); orderAllowed(order);
  ensure(!['WAITING_REMOVAL', 'QC_PASSED', 'QC_FAILED', 'CANCELLED'].includes(order.productionState), 409, 'ORDER_ALREADY_PRODUCED', '此订单已进入取件、质检或取消阶段');
  ensure(order.productionState !== 'PRINTING' || p.adoptExistingSimulation === true, 409, 'SIMULATION_ADOPTION_REQUIRED', '此订单已在旧流程模拟打印，请明确确认迁入生产台账并重新备机');
  ensure(!s.productions.some(x => x.orderId === order.id), 409, 'PRODUCTION_EXISTS', '此订单已经建立生产台账，请继续原任务');
  const job = find(s.jobs, p.sliceJobId, 'JOB');
  ensure(job.kind === 'SLICE_MODEL' && job.status === 'COMPLETED' && job.result, 409, 'SLICE_REQUIRED', '请先完成对应模型的切片估算');
  assertFreshProfile(s, job);
  ensure(job.modelHash === order.modelHash && job.modelId === order.modelId && job.quantity === order.qty && job.unit === order.unit && job.configSnapshot.material === order.material && job.configSnapshot.farmId === order.farm && job.configSnapshot.quality === (order.quality ?? 'standard'), 409, 'SLICE_ORDER_MISMATCH', '切片模型、数量、单位、材料、层高或产线与订单不匹配');
  const spool = find(s.spools, p.spoolId, 'SPOOL');
  ensure(spool.mode === 'SANDBOX', 409, 'SIMULATION_INVENTORY_REQUIRED', '生产演练只使用演示库存，不扣减真实耗材');
  ensure(spool.material === order.material, 409, 'MATERIAL_MISMATCH', '耗材与订单材料不匹配');
  const grams = Math.ceil(job.result.materialGrams * 1000) / 1000;
  ensure(spool.remainingGrams - spool.reservedGrams >= grams, 409, 'INSUFFICIENT_STOCK', '可用耗材不足，请补充库存或选择另一卷耗材');
  ensure(s.productions.length < 100, 409, 'PRODUCTION_CAPACITY', '当前最多保存 100 个生产台账');
  spool.reservedGrams += grams; spool.revision++; spool.updatedAt = now;
  const economics = estimateSliceEconomics(w, job, spool.costCentsPerKg);
  const production = { id: 'prod-' + idFactory(), orderId: order.id, modelId: order.modelId, modelHash: order.modelHash, sliceJobId: job.id, sliceInputHash: job.inputHash, profileId: job.profileId, profileRevision: job.profileRevision, deviceId: job.configSnapshot.deviceId, spoolId: spool.id, material: spool.material, quantity: order.qty, mode: 'SIMULATED', status: 'AWAITING_READINESS', reservedGrams: grams, reservationState: 'RESERVED', estimatedDurationSeconds: job.result.durationSeconds, estimatedMaterialGrams: job.result.materialGrams, estimatedEconomics: economics, stockCostCentsPerKg: spool.costCentsPerKg, orderManufacturingCents: order.settlementBreakdown?.manufacturingCents ?? order.quoteSnapshot?.pricingSummary?.manufacturingCents ?? null, createdAt: now, updatedAt: now, readiness: null, attempts: [], physicalCommandsSent: 0, actuals: null };
  production.pricingProfileSnapshot = getPricingProfile(w, job.configSnapshot.farmId);
  if (order.productionState === 'PRINTING') {
    // Explicitly migrate the old simulator record; this never stops a real device.
    const oldDevice = (w.devices ?? []).find(d => d.orderId === order.id);
    if (oldDevice) { oldDevice.orderId = null; oldDevice.state = 'ready'; oldDevice.bedClear = false; }
    order.productionState = 'QUEUED'; order.status = 'queued';
    production.adoptedLegacySimulation = true;
    (order.events ??= []).push({ label: '已将旧模拟任务迁入生产台账，等待重新确认备机', time: new Date(now).toISOString(), at: now, simulated: true });
  }
  s.productions.push(production); s.schedule = null; record(s, 'PRODUCTION_CREATED', production.id, now); return { production: copy(production) };
}
function release(s, production, now) {
  if (production.reservationState !== 'RESERVED') return;
  const spool = find(s.spools, production.spoolId, 'SPOOL');
  spool.reservedGrams = Math.max(0, spool.reservedGrams - production.reservedGrams); spool.revision++; spool.updatedAt = now; production.reservationState = 'RELEASED';
}
function productionCommand(w, s, type, p, now, idFactory) {
  ack(p); const production = find(s.productions, p.productionId, 'PRODUCTION'), order = find(w.orders, production.orderId, 'ORDER');
  ensure(production.mode === 'SIMULATED', 409, 'REAL_DISPATCH_DISABLED', '此版本不能通过运营按钮控制真实设备');
  if (type !== 'cancel-production') orderAllowed(order);
  const job = find(s.jobs, production.sliceJobId, 'JOB');
  if (type === 'readiness') {
    ensure(['AWAITING_READINESS', 'READY'].includes(production.status), 409, 'INVALID_PRODUCTION_STATE', '当前任务不能确认备机'); assertFreshProfile(s, job);
    ensure(p.bedClear === true && p.materialReady === true && p.deviceClear === true && p.loadedMaterial === production.material, 409, 'READINESS_REQUIRED', '需确认清台、设备无报警、耗材和材料匹配');
    production.readiness = { bedClear: true, materialReady: true, deviceClear: true, loadedMaterial: p.loadedMaterial, confirmedAt: now, expiresAt: now + 300000 };
    production.status = 'READY';
  } else if (type === 'dispatch-production') {
    ensure(production.status === 'READY' && production.readiness?.expiresAt > now, 409, 'READINESS_REQUIRED', '请重新确认设备与材料准备状态'); assertFreshProfile(s, job);
    ensure(!s.productions.some(x => x.id !== production.id && x.deviceId === production.deviceId && ['PRINTING', 'DISPATCHING', 'UNKNOWN', 'WAITING_REMOVAL'].includes(x.status)), 409, 'DEVICE_OCCUPIED', '该设备正在生产或等待取件、对账');
    const device = deviceOf(w, production.deviceId);
    ensure(device, 409, 'DEVICE_NOT_FOUND', '已关联设备不存在');
    ensure(!device.orderId || device.orderId === order.id, 409, 'DEVICE_OCCUPIED', '该设备已被另一订单占用');
    production.status = 'PRINTING'; production.startedAt = now; production.attempts.push({ id: 'attempt-' + idFactory(), sequence: production.attempts.length + 1, state: 'SIMULATED_STARTED', at: now });
    order.productionState = 'PRINTING'; order.status = 'printing'; order.deviceId = production.deviceId;
    if (w.devices?.includes(device)) { device.orderId = order.id; device.state = 'printing'; device.bedClear = false; }
  } else if (type === 'finish-production') {
    ensure(production.status === 'PRINTING', 409, 'INVALID_PRODUCTION_STATE', '任务尚未打印或已经结束');
    ensure(finite(p.actualMaterialGrams, 0, 1e6) && finite(p.actualDurationSeconds, 1, 366 * 86400), 400, 'INVALID_ACTUALS', '请输入有效的实际耗材与打印时长');
    const spool = find(s.spools, production.spoolId, 'SPOOL');
    ensure(production.reservationState === 'RESERVED' && spool.remainingGrams - (spool.reservedGrams - production.reservedGrams) >= p.actualMaterialGrams, 409, 'INSUFFICIENT_STOCK', '实耗超过本卷可用余量，需先校正库存');
    spool.reservedGrams = Math.max(0, spool.reservedGrams - production.reservedGrams); spool.remainingGrams -= p.actualMaterialGrams; spool.consumedGrams += p.actualMaterialGrams; spool.revision++; spool.updatedAt = now; production.reservationState = 'CONSUMED';
    const actualJob = { ...job, result: { ...job.result, materialGrams: p.actualMaterialGrams, durationSeconds: p.actualDurationSeconds } };
    const economics = estimateSliceEconomics(w, actualJob, production.stockCostCentsPerKg, production.pricingProfileSnapshot);
    const actualCostCents = economics.estimatedCostCents - economics.costBreakdown.riskReserveCents;
    production.actuals = { materialGrams: p.actualMaterialGrams, durationSeconds: p.actualDurationSeconds, materialVarianceGrams: p.actualMaterialGrams - production.estimatedMaterialGrams, durationVarianceSeconds: p.actualDurationSeconds - production.estimatedDurationSeconds, actualCostCents, profitCents: Number.isSafeInteger(production.orderManufacturingCents) ? production.orderManufacturingCents - actualCostCents : null, costBreakdown: { ...economics.costBreakdown, riskReserveCents: 0 }, provenance: 'MERCHANT_SIMULATED_ENTRY', recordedAt: now };
    production.status = 'WAITING_REMOVAL'; production.completedAt = now; order.productionState = 'WAITING_REMOVAL'; order.status = 'awaiting_pickup';
    const device = deviceOf(w, production.deviceId); if (w.devices?.includes(device)) device.state = 'waiting';
  } else if (type === 'qc-production') {
    ensure(production.status === 'WAITING_REMOVAL', 409, 'INVALID_PRODUCTION_STATE', '需先完成生产并等待取件');
    ensure(p.partRemoved === true && p.bedClear === true && typeof p.passed === 'boolean' && (p.note === undefined || typeof p.note === 'string' && p.note.length <= 500), 400, 'QC_EVIDENCE_REQUIRED', '请确认取件、清台并记录质检结果');
    production.status = p.passed ? 'QC_PASSED' : 'QC_FAILED'; production.qc = { passed: p.passed, note: (p.note ?? '').trim(), partRemoved: true, bedClear: true, at: now };
    order.productionState = production.status; order.status = p.passed ? 'ready_to_ship' : 'qc_failed';
    const device = deviceOf(w, production.deviceId); if (w.devices?.includes(device)) { device.state = 'ready'; device.orderId = null; device.bedClear = true; device.clearanceEpoch = (device.clearanceEpoch ?? 0) + 1; }
  } else if (type === 'cancel-production') {
    ensure(['AWAITING_READINESS', 'READY'].includes(production.status), 409, 'PRODUCTION_CANCEL_BLOCKED', '打印中、已完工或结果未知的任务不能直接取消释放库存');
    release(s, production, now); production.status = 'CANCELLED';
  } else if (type === 'reconcile-production') {
    ensure(production.status === 'UNKNOWN' && ['not-started', 'printing', 'finished'].includes(p.observedState), 409, 'RECONCILIATION_REQUIRED', '仅可对结果未知的任务进行人工对账');
    ensure(text(p.note, 500), 400, 'RECONCILIATION_EVIDENCE_REQUIRED', '请记录设备核验依据');
    production.reconciliation = { observedState: p.observedState, note: p.note, at: now };
    production.status = p.observedState === 'not-started' ? 'AWAITING_READINESS' : 'PRINTING'; production.readiness = null;
  } else fail('UNKNOWN_COMMAND', '未知生产命令', 400);
  production.updatedAt = now; s.schedule = null; record(s, type.toUpperCase(), production.id, now);
  if (!['readiness', 'cancel-production', 'reconcile-production'].includes(type)) (order.events ??= []).push({ label: '生产中心 · ' + ({ 'dispatch-production': '已开始模拟打印', 'finish-production': '模拟打印完成，等待取件质检', 'qc-production': p.passed ? '已取件清台，模拟质检通过' : '已取件清台，模拟质检不通过' }[type]), time: new Date(now).toISOString(), at: now, simulated: true });
  return { production: copy(production) };
}
function basicSchedule(snapshot) {
  const lanes = new Map();
  const schedule = snapshot.tasks.map(t => { const startAt = Math.max(snapshot.baseAt, lanes.get(t.deviceId) ?? 0), endAt = startAt + t.durationSeconds * 1000; lanes.set(t.deviceId, endAt); return { jobId: t.jobId, deviceId: t.deviceId, startAt, endAt }; });
  return { schedule, engineVersion: 'fifo-capacity-v1', provenance: 'SIMULATED', solverStatus: 'HEURISTIC', confirmed: false, baseAt: snapshot.baseAt };
}

export async function applyOperationsCommand(original, command, context = {}) {
  requireMerchant(original);
  ensure(command && typeof command === 'object' && !Array.isArray(command), 400, 'INVALID_INPUT', '命令无效');
  const { type, payload: p = {}, idempotencyKey } = command, { now = Date.now(), idFactory = () => crypto.randomUUID() } = context;
  ensure(text(type, 80) && p && typeof p === 'object' && !Array.isArray(p) && typeof idempotencyKey === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey) && finite(now, 0, 8.64e15), 400, 'INVALID_INPUT', '命令、幂等标识或时间无效');
  const workerTypes = ['claim-job', 'complete-job', 'fail-job', 'expire-leases'];
  if (workerTypes.includes(type)) {
    worker(context);
    if (context.workerKinds) {
      ensure(Array.isArray(context.workerKinds) && context.workerKinds.length > 0 && context.workerKinds.every(k => kinds.includes(k)), 403, 'WORKER_KIND_DENIED', '计算服务任务权限无效');
      if (type === 'claim-job') ensure(Array.isArray(p.kinds ?? kinds) && (p.kinds ?? kinds).every(k => context.workerKinds.includes(k)), 403, 'WORKER_KIND_DENIED', '计算服务未获授权执行该任务类型');
      if (['complete-job','fail-job'].includes(type)) { const target = find(stateOf(original).jobs, p.jobId, 'JOB'); ensure(context.workerKinds.includes(target.kind), 403, 'WORKER_KIND_DENIED', '计算服务无此任务权限'); }
    }
  }
  if (type === 'sync-spools') ensure(context.integration === 'spoolman', 403, 'INTEGRATION_REQUIRED', '仅允许后台 Spoolman 连接同步');
  const requestDigest = await digest({ type, payload: p, workerId: context.workerId ?? null, integration: context.integration ?? null });
  const current = stateOf(original);
  if (own(current.ledger, idempotencyKey)) {
    const cached = current.ledger[idempotencyKey]; ensure(cached.digest === requestDigest, 409, 'IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同操作或计算服务');
    if (type === 'claim-job' && cached.result.job) {
      const live = current.jobs.find(x => x.id === cached.result.job.id);
      if (!live || live.status !== 'LEASED' || live.workerId !== context.workerId || live.leaseToken !== cached.result.job.leaseToken || live.leaseUntil <= now) return { workspace: original, result: { job: null, staleClaim: true, realDispatchEnabled: false }, replayed: true };
    }
    return { workspace: original, result: copy(cached.result), replayed: true };
  }
  const w = copy(original), s = w.operations ??= blank(); let result;
  if (type === 'save-spool') result = saveSpool(w, s, p, now, idFactory);
  else if (type === 'set-spool-cost') {
    const spool = find(s.spools, p.id, 'SPOOL');
    ensure(p.expectedRevision === spool.revision, 409, 'SPOOL_CHANGED', '库存已更新，请刷新后保存');
    ensure(int(p.costCentsPerKg, 0, 1e7), 400, 'INVALID_SPOOL_COST', '采购价需为有效的人民币分/千克');
    spool.costCentsPerKg = p.costCentsPerKg; spool.costConfigured = true; spool.costSource = 'MERCHANT_ENTRY'; spool.revision++; spool.updatedAt = now; result = { spool: copy(spool) }; record(s, 'SPOOL_COST_SAVED', spool.id, now);
  }
  else if (type === 'sync-spools') result = syncSpools(s, p, now, idFactory, context);
  else if (type === 'save-profile') result = saveProfile(w, s, p, now, idFactory);
  else if (type === 'queue-job') result = await queueJob(w, s, p, now, idFactory);
  else if (type === 'claim-job') result = claimJob(s, p, now, idFactory, context);
  else if (type === 'complete-job') result = completeJob(w, s, p, now, context);
  else if (type === 'fail-job') {
    const job = leased(s, p, now, context); ensure(text(p.errorCode, 80) && text(p.errorMessage, 400), 400, 'INVALID_JOB_ERROR', '任务失败原因无效');
    job.status = 'FAILED'; job.error = { code: p.errorCode, message: p.errorMessage }; job.updatedAt = now; delete job.leaseToken; delete job.workerId; delete job.leaseUntil; result = { job: publicJob(job) };
  } else if (type === 'expire-leases') result = { expired: expire(s, now) };
  else if (type === 'cancel-job') { const job = find(s.jobs, p.jobId, 'JOB'); ensure(['QUEUED', 'LEASED', 'FAILED'].includes(job.status), 409, 'JOB_CANCEL_BLOCKED', '已完成或已取消的任务不能再次取消'); job.status = 'CANCELLED'; job.updatedAt = now; delete job.leaseToken; delete job.workerId; delete job.leaseUntil; result = { job: publicJob(job) }; }
  else if (type === 'create-production') result = createProduction(w, s, p, now, idFactory);
  else if (['readiness', 'dispatch-production', 'finish-production', 'qc-production', 'cancel-production', 'reconcile-production'].includes(type)) result = productionCommand(w, s, type, p, now, idFactory);
  else if (type === 'schedule') { ensure(p.baseAt === undefined || finite(p.baseAt, now, now + 30 * 86400000), 400, 'INVALID_SCHEDULE_TIME', '排期起点需为未来 30 天内'); s.schedule = { ...basicSchedule(scheduleSnapshot(s, p.baseAt ?? now)), generatedAt: now }; result = { schedule: copy(s.schedule) }; }
  else fail('UNKNOWN_COMMAND', '未知生产中心命令', 400);
  if (type === 'claim-job' && result.noChange === true || type === 'expire-leases' && result.expired === 0) return { workspace: original, result: { ...result, physicalCommandsSent: 0, realDispatchEnabled: false, moneyTransferred: 0 }, replayed: true };
  ensure(Object.keys(current.ledger).length < 1500, 409, 'OPERATIONS_CAPACITY', '生产操作记录已达到本版本容量，请归档后再继续');
  w.revision = original.revision + 1; w.updatedAt = now;
  result = { ...result, realDispatchEnabled: false, physicalCommandsSent: 0, moneyTransferred: 0 };
  Object.defineProperty(s.ledger, idempotencyKey, { value: { digest: requestDigest, result: copy(result), at: now }, enumerable: true, configurable: true, writable: true });
  return { workspace: w, result: copy(result), replayed: false };
}
