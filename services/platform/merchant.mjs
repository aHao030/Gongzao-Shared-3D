import { ApiError, ensure, sha256 } from './geometry.mjs';
import { sanitizePartialDiagnostics, incompleteForProtocol } from '../device-gateway/coverage.mjs';

// Merchant device inventory is deliberately separate from the legacy manufacturing
// sandbox. Pairing grants discovery/monitoring only and can never dispatch a print.
export const GATEWAY_FRESH_MS = 90_000;
export const SCAN_TTL_MS = 120_000;
export const DEVICE_OBSERVATION_FRESH_MS = 5 * 60_000;
export const TOKEN_TTL_MS = 30 * 86400_000;
const MAX_DEVICES = 200, MAX_GATEWAYS = 8, MAX_CANDIDATES = 100;
export const BAMBU_MONITOR_INTERVAL_MS = 120_000;
const BAMBU_MONITOR_BATCH = 32;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const copy = value => structuredClone(value);
const validText = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const utf8 = value => new TextEncoder().encode(value);
const digest = value => sha256(utf8(value));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const merchantState = workspace => workspace.merchant ?? { profile: null, gateways: [], devices: [], scans: [], ledger: {}, pollLedger: {} };
const fail = (code, message, status = 409) => { throw new ApiError(status, code, message); };
const findGateway = (m, id) => { const g = m.gateways.find(g => g.id === id); ensure(g, 404, 'GATEWAY_NOT_FOUND', '网关不存在'); return g; };
const findScan = (m, id) => { const s = m.scans.find(s => s.id === id); ensure(s, 404, 'SCAN_NOT_FOUND', '扫描记录不存在'); return s; };
const gatewayActive = (g, now) => g.revokedAt == null && g.expiresAt > now;
const gatewayOnline = (g, now) => gatewayActive(g, now) && Number.isFinite(g.lastSeenAt) && g.lastSeenAt <= now && now - g.lastSeenAt < GATEWAY_FRESH_MS;
const capabilityDetails = protocolRead => ({ protocolRead, fileUpload: false, startPrint: false, cancelPrint: false });
function observeDevice(d, state, fresh = true) {
  const view = copy(d);
  delete view.authenticatedEndpoint;
  let level = d.source === 'demo' ? 'DEMO' : d.probeEvidence ? 'PROTOCOL_PROBE_REPORTED' : 'LEGACY_PROTOCOL_REPORTED';
  let protocolRead = true;
  if (d.protocol === 'bambu') {
    // A broadcast advertises inventory. Only a fresh authorized status report
    // establishes the read capability or supplies current job telemetry.
    protocolRead = fresh && state === 'online' && d.probeEvidence?.method === 'MQTT_TLS';
    if (!protocolRead && (!fresh || d.probeEvidence?.method === 'MQTT_TLS')) view.probeEvidence = null;
    level = protocolRead ? 'BAMBU_READONLY_REPORTED' : view.probeEvidence?.advertised ? 'BAMBU_ADVERTISED' : 'BAMBU_UNVERIFIED';
  }
  return { ...view, connectionState: state, verification: { level, modelConfirmed: false, hardwareVerified: false, processCertified: false },
    capabilityDetails: capabilityDetails(protocolRead), capabilities: protocolRead ? ['monitor'] : [], automaticPrinting: false };
}
const scanState = (s, now) => s.status === 'pending' && s.expiresAt <= now ? 'expired' : s.status;

export function requireMerchant(workspace) {
  const m = merchantState(workspace);
  ensure(m.profile, 403, 'MERCHANT_REQUIRED', '请先开通商家工作台');
  return m;
}
export function publicGateway(g, now) {
  return { id: g.id, name: g.name, createdAt: g.createdAt, lastSeenAt: g.lastSeenAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt, status: g.revokedAt != null ? 'revoked' : g.expiresAt <= now ? 'expired' : gatewayOnline(g, now) ? 'online' : 'offline', capabilities: ['discover', 'monitor'], automaticPrinting: false, freshUntil: gatewayOnline(g, now) ? Math.min(g.lastSeenAt + GATEWAY_FRESH_MS, g.expiresAt) : null };
}
function publicDevice(d, m, now) {
  const gateway = m.gateways.find(g => g.id === d.gatewayId);
  const validObservation = Number.isFinite(d.lastSeenAt) && d.lastSeenAt <= now;
  const observationExpiresAt = validObservation ? d.lastSeenAt + DEVICE_OBSERVATION_FRESH_MS : null;
  const gatewayExpiresAt = gateway && Number.isFinite(gateway.lastSeenAt) ? Math.min(gateway.lastSeenAt + GATEWAY_FRESH_MS, gateway.expiresAt) : null;
  const freshUntil = d.source === 'demo' ? null : observationExpiresAt !== null && gatewayExpiresAt !== null ? Math.min(observationExpiresAt, gatewayExpiresAt) : null;
  const reason = d.source === 'demo' ? 'DEMO' : d.observationConflict ? 'IDENTITY_CONFLICT' : d.lastScanFailed ? 'SCAN_FAILED' : !gateway || !gatewayOnline(gateway, now) ? 'GATEWAY_OFFLINE' : !validObservation || now >= observationExpiresAt ? 'OBSERVATION_EXPIRED' : d.connectionState === 'authorization_required' ? 'AUTHORIZATION_REQUIRED' : d.connectionState !== 'online' ? 'DEVICE_UNREACHABLE' : 'PROTOCOL_OBSERVED';
  const state = d.source === 'demo' ? d.connectionState : ['IDENTITY_CONFLICT', 'SCAN_FAILED', 'GATEWAY_OFFLINE', 'OBSERVATION_EXPIRED'].includes(reason) ? 'offline' : d.connectionState;
  const fresh = d.source === 'demo' || (freshUntil !== null && now < freshUntil && !d.observationConflict && !d.lastScanFailed && validObservation && gatewayOnline(gateway, now));
  return { ...observeDevice(d, state, fresh), observedConnectionState: d.connectionState, connectionReason: reason, observationExpiresAt, freshUntil };
}
export function merchantDevices(workspace, now = Date.now()) {
  const m = requireMerchant(workspace), devices = m.devices.map(d => publicDevice(d, m, now));
  const real = devices.filter(d => d.source === 'real');
  return { serverNow: now, devices, counts: { total: devices.length, real: real.length, online: real.filter(d => d.connectionState === 'online').length, offline: real.filter(d => d.connectionState !== 'online').length, demo: devices.length - real.length }, gateways: m.gateways.map(g => publicGateway(g, now)) };
}
export function merchantSession(workspace) {
  return { mode: 'MERCHANT_SANDBOX', profile: copy(merchantState(workspace).profile), capabilities: { deviceDiscovery: true, realPrinting: false, realPayments: false, commercialMerchantVerification: false } };
}
function registrationConflict(m, candidate) {
  if (candidate.source !== 'real') return null;
  const device = m.devices.find(d => d.source === 'real' && d.id !== candidate.id && d.protocol === candidate.protocol && (d.endpoint === candidate.endpoint || d.gatewayId !== candidate.gatewayId && d.deviceKey === candidate.deviceKey));
  return device ? { device, reason: device.gatewayId === candidate.gatewayId ? 'IDENTITY_CHANGED' : 'OTHER_GATEWAY' } : null;
}
function registrable(candidate) {
  if (candidate.protocol === 'bambu') return candidate.probeEvidence?.advertised === true ||
    (candidate.probeEvidence?.method === 'MQTT_TLS' && candidate.connectionState === 'online');
  return ['moonraker', 'octoprint'].includes(candidate.protocol) && candidate.connectionState === 'online';
}
function registerBambuBatch(m, scan, now) {
  const totals = { added: 0, existing: 0, blocked: 0 };
  for (const c of scan.candidates.filter(c => c.protocol === 'bambu')) {
    if (registrationConflict(m, c)) {
      totals.blocked++;
    } else if (m.devices.some(d => d.id === c.id)) {
      totals.existing++;
    } else if (!registrable(c) || m.devices.length >= MAX_DEVICES) {
      totals.blocked++;
    } else {
      m.devices.push({ ...copy(c), registeredAt: now });
      totals.added++;
    }
  }
  return totals;
}
function nextMonitor(m, gateway, now, idFactory) {
  if (gateway.monitorJob?.expiresAt > now) return gateway.monitorJob;
  gateway.monitorJob = null;
  if (gateway.nextMonitorAt > now) return null;
  const keys = m.devices.filter(d => d.gatewayId === gateway.id && d.protocol === 'bambu' && d.source === 'real').map(d => d.deviceKey).sort();
  if (!keys.length) return null;
  const start = keys.findIndex(key => key > (gateway.monitorCursor ?? ''));
  const batch = keys.slice(Math.max(start, 0), Math.max(start, 0) + BAMBU_MONITOR_BATCH);
  const job = { id: 'monitor_' + idFactory(), kind: 'monitor-bambu', deviceKeys: batch, expiresAt: now + SCAN_TTL_MS };
  gateway.monitorCursor = batch.at(-1);
  gateway.nextMonitorAt = now + Math.floor(BAMBU_MONITOR_INTERVAL_MS / Math.ceil(keys.length / BAMBU_MONITOR_BATCH));
  gateway.monitorJob = job;
  return job;
}
// Scan order is the committed append order, even if two checks share a clock tick.
function latestGatewayScan(merchant, scan) {
  return merchant.scans.findLast(item => item.gatewayId === scan.gatewayId)?.id === scan.id;
}
function trimBambuScanHistory(scans) {
  // The active scan on each gateway must still support manual import. Keep a
  // bounded amount of superseded Bambu detail for inspection; the receipt and
  // per-scan counts remain available even after those observations are old.
  const seenGateways = new Set();
  let historicalSlots = MAX_CANDIDATES;
  for (let i = scans.length - 1; i >= 0; i--) {
    const scan = scans[i];
    if (!seenGateways.has(scan.gatewayId)) { seenGateways.add(scan.gatewayId); continue; }
    const bambuCount = scan.candidates.filter(c => c.protocol === 'bambu').length;
    if (bambuCount <= historicalSlots) { historicalSlots -= bambuCount; continue; }
    scan.candidates = scan.candidates.filter(c => c.protocol !== 'bambu');
    scan.archivedCandidateCount = (scan.archivedCandidateCount ?? 0) + bambuCount;
  }
}
export function publicScan(scan, workspace, now = Date.now()) {
  if (!scan) return null;
  const m = requireMerchant(workspace);
  const gateway = m.gateways.find(g => g.id === scan.gatewayId);
  const importBlockedReason = scan.expiresAt <= now ? 'SCAN_EXPIRED' : !latestGatewayScan(m, scan) ? 'SCAN_SUPERSEDED' : scan.status !== 'complete' ? 'SCAN_NOT_COMPLETE' : scan.scope === 'real' && (!gateway || !gatewayOnline(gateway, now)) ? 'GATEWAY_OFFLINE' : null;
  return { id: scan.id, importable: importBlockedReason === null, importBlockedReason, scope: scan.scope, gatewayId: scan.gatewayId, status: scanState(scan, now), createdAt: scan.createdAt, expiresAt: scan.expiresAt, completedAt: scan.completedAt ?? null, error: scan.error ?? null,
    autoRegister: scan.autoRegister ?? null, registrationResult: copy(scan.registrationResult ?? null), partialDiagnostics: copy(scan.partialDiagnostics ?? []),
    candidateCount: scan.candidates.length + (scan.archivedCandidateCount ?? 0), candidatesArchived: (scan.archivedCandidateCount ?? 0) > 0,
    candidates: scan.candidates.map(c => {
      const existing = m.devices.find(d => d.id === c.id), conflict = registrationConflict(m, c);
      const fresh = importBlockedReason === null;
      return { ...observeDevice(c, c.protocol === 'bambu' && !fresh ? 'offline' : c.connectionState, fresh),
        canRegister: fresh && registrable(c) && !existing && !conflict && m.devices.length < MAX_DEVICES, registered: Boolean(existing || conflict),
        existingDeviceId: existing?.id ?? conflict?.device.id ?? null, registrationConflict: conflict?.reason ?? null };
    }) };
}
export function merchantScanResult(workspace, scanId, now = Date.now()) {
  const m = requireMerchant(workspace), scan = scanId ? findScan(m, scanId) : m.scans.at(-1);
  return { scan: publicScan(scan, workspace, now) };
}
function encodedOwner(owner) {
  ensure(validText(owner, 300), 400, 'INVALID_OWNER', '身份无效');
  const bytes = utf8(owner); ensure(bytes.length <= 300, 400, 'INVALID_OWNER', '身份过长');
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function createGatewayCredential(owner, now = Date.now()) {
  const id = 'gw_' + crypto.randomUUID(), secret = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
  const token = `gw1.${encodedOwner(owner)}.${id}.${secret}`;
  return { id, token, tokenHash: await digest(token), createdAt: now, expiresAt: now + TOKEN_TTL_MS };
}
export async function parseGatewayCredential(header) {
  ensure(typeof header === 'string' && /^Bearer /i.test(header) && header.length < 1024, 401, 'GATEWAY_AUTH_REQUIRED', '需要有效的网关凭据');
  const token = header.slice(7), pieces = token.split('.');
  ensure(pieces.length === 4 && pieces[0] === 'gw1' && /^[A-Za-z0-9_-]{1,400}$/.test(pieces[1]) && /^gw_[a-f0-9-]{36}$/.test(pieces[2]) && /^[a-f0-9]{64}$/.test(pieces[3]), 401, 'GATEWAY_AUTH_INVALID', '网关凭据无效');
  let owner;
  try { owner = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(pieces[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); }
  catch { fail('GATEWAY_AUTH_INVALID', '网关凭据无效', 401); }
  ensure(validText(owner, 300) && encodedOwner(owner) === pieces[1], 401, 'GATEWAY_AUTH_INVALID', '网关凭据无效');
  return { owner, gatewayId: pieces[2], tokenHash: await digest(token) };
}
function hashesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
export function authenticateGateway(workspace, credential, now = Date.now()) {
  const m = merchantState(workspace), g = m.gateways.find(g => g.id === credential.gatewayId);
  ensure(m.profile && g && hashesEqual(g.tokenHash, credential.tokenHash) && gatewayActive(g, now), 401, 'GATEWAY_AUTH_INVALID', '网关凭据无效、已过期或已撤销');
  return g;
}
function privateIPv4(hostname) {
  const octets = hostname.split('.').map(Number);
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && octets.every(x => Number.isInteger(x) && x >= 0 && x <= 255);
  return ipv4 && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
}
function privateEndpoint(value, protocol) {
  ensure(validText(value, 220), 400, 'INVALID_DEVICE_ENDPOINT', '设备地址无效');
  if (protocol === 'bambu') {
    const host = /^mqtts:\/\/([0-9.]+):8883\/?$/.exec(value)?.[1];
    ensure(host && privateIPv4(host) && host.split('.').map(Number).join('.') === host,
      400, 'INVALID_DEVICE_ENDPOINT', '拓竹设备地址须为商家内网的加密 MQTT 端点');
    return 'mqtts://' + host + ':8883';
  }
  let u; try { u = new URL(value); } catch { fail('INVALID_DEVICE_ENDPOINT', '设备地址无效', 400); }
  ensure(['http:', 'https:'].includes(u.protocol) && privateIPv4(u.hostname) && !u.username && !u.password && !u.search && !u.hash && u.pathname.length <= 160 && /^\/[A-Za-z0-9_./-]*$/.test(u.pathname) && !u.pathname.includes('//') && !value.includes('\\'), 400, 'INVALID_DEVICE_ENDPOINT', '仅接受商家内网 IPv4 设备地址及安全路径前缀，不包含密码或查询参数');
  return u.origin + u.pathname.replace(/\/+$/, '');
}
const bambuPrintStates = new Set(['IDLE', 'PREPARE', 'RUNNING', 'PAUSE', 'FINISH', 'FAILED', 'UNKNOWN']);
function bambuEvidence(input) {
  ensure(/^[a-f0-9]{64}$/.test(input.deviceKey), 400, 'INVALID_CANDIDATE', '拓竹设备需要匿名稳定标识');
  const evidence = input.probeEvidence;
  if (evidence == null) {
    ensure(input.connectionState !== 'online', 400, 'INVALID_PROBE_EVIDENCE', '在线拓竹设备需要已授权的状态报告');
    return null;
  }
  ensure(typeof evidence === 'object' && !Array.isArray(evidence) && typeof evidence.advertised === 'boolean',
    400, 'INVALID_PROBE_EVIDENCE', '拓竹设备识别依据无效');
  if (evidence.method === 'SSDP') {
    ensure(evidence.advertised && input.connectionState !== 'online' && evidence.printState === undefined && evidence.progressPercent === undefined,
      400, 'INVALID_PROBE_EVIDENCE', '设备广播没有提供可验证的打印状态');
    return { method: 'SSDP', advertised: true, ...(evidence.deferred === true ? { deferred: true } : {}) };
  }
  ensure(evidence.method === 'MQTT_TLS' && input.connectionState === 'online' && bambuPrintStates.has(evidence.printState),
    400, 'INVALID_PROBE_EVIDENCE', '拓竹设备状态与只读连接不匹配');
  const result = { method: 'MQTT_TLS', advertised: evidence.advertised, printState: evidence.printState };
  if (evidence.progressPercent !== undefined) {
    ensure(Number.isInteger(evidence.progressPercent) && evidence.progressPercent >= 0 && evidence.progressPercent <= 100,
      400, 'INVALID_PROBE_EVIDENCE', '打印进度必须是 0–100 的整数');
    result.progressPercent = evidence.progressPercent;
  }
  return result;
}
async function candidateRecord(input, gatewayId, now) {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_CANDIDATE', '设备扫描结果无效');
  ensure(validText(input.deviceKey, 160) && validText(input.name, 100) && ['moonraker', 'octoprint', 'bambu', 'unknown'].includes(input.protocol) && ['online', 'offline', 'authorization_required'].includes(input.connectionState), 400, 'INVALID_CANDIDATE', '设备标识、协议或状态无效');
  ensure(input.model === undefined || (typeof input.model === 'string' && input.model.length <= 100 && !/[\u0000-\u001f\u007f]/.test(input.model)), 400, 'INVALID_CANDIDATE', '设备型号无效');
  const endpoint = privateEndpoint(input.endpoint, input.protocol);
  let probeEvidence;
  if (input.protocol === 'bambu') {
    probeEvidence = bambuEvidence(input);
  } else if (input.probeEvidence !== undefined) {
    const e = input.probeEvidence;
    ensure(e && typeof e === 'object' && !Array.isArray(e) && e.method === 'GET' && e.endpoint === (input.protocol === 'moonraker' ? '/server/info' : input.protocol === 'octoprint' ? '/api/version' : null) && e.serviceReachable === true && [true, false, null].includes(e.controllerConnected), 400, 'INVALID_PROBE_EVIDENCE', '只读识别信息无效');
    ensure([e.serviceVersion, e.controllerState].every(v => v === undefined || typeof v === 'string' && v.length <= 100 && !/[\u0000-\u001f\u007f]/.test(v)), 400, 'INVALID_PROBE_EVIDENCE', '识别版本或控制器状态无效');
    ensure(input.protocol === 'octoprint' ? e.controllerConnected === null : input.connectionState !== 'online' || e.controllerConnected === true, 400, 'INVALID_PROBE_EVIDENCE', '控制器连接观察与协议不匹配');
    probeEvidence = { method: 'GET', endpoint: e.endpoint, serviceReachable: e.serviceReachable, controllerConnected: e.controllerConnected, serviceVersion: e.serviceVersion ?? '', controllerState: e.controllerState ?? '' };
  }
  const capabilities = input.protocol === 'bambu' && probeEvidence?.method !== 'MQTT_TLS' ? [] : ['monitor'];
  return { id: 'dev_' + (await digest(`${gatewayId}\0${input.protocol}\0${input.deviceKey}`)).slice(0, 32), deviceKey: input.deviceKey, name: input.name.trim(), protocol: input.protocol, model: input.model ?? '', endpoint, gatewayId, source: 'real', connectionState: input.connectionState, lastSeenAt: now, probeEvidence: probeEvidence ?? null,
    ...(probeEvidence?.method === 'MQTT_TLS' ? { authenticatedEndpoint: endpoint } : {}), capabilities, automaticPrinting: false };
}
async function readReport(payload, gatewayId, now) {
  ensure(Array.isArray(payload.candidates) && payload.candidates.length <= MAX_CANDIDATES, 400, 'INVALID_CANDIDATES', '扫描最多返回 100 台设备');
  const normalized = await Promise.all(payload.candidates.map(c => candidateRecord(c, gatewayId, now)));
  ensure(new Set(normalized.map(c => c.id)).size === normalized.length, 400, 'DUPLICATE_CANDIDATE', '扫描包含重复设备');
  ensure(new Set(normalized.map(c => `${c.protocol}|${c.endpoint}`)).size === normalized.length, 400, 'DUPLICATE_ENDPOINT', '同一协议地址出现多个设备标识，请检查配置后重新检测');
  const partial = payload.partialDiagnostics === undefined ? [] : payload.partialDiagnostics;
  ensure(Array.isArray(partial) && partial.length <= 16, 400, 'INVALID_DIAGNOSTICS', '扫描范围诊断无效');
  const partialDiagnostics = sanitizePartialDiagnostics(partial);
  ensure(partialDiagnostics.length === partial.length, 400, 'INVALID_DIAGNOSTICS', '扫描范围诊断包含未知或重复项目');
  if (payload.error) ensure(validText(payload.error.code, 60) && validText(payload.error.message, 200), 400, 'INVALID_SCAN_ERROR', '扫描错误信息无效');
  return { normalized, partialDiagnostics };
}
function applyObservations(m, devices, candidates, error, partialDiagnostics) {
  for (const d of devices) {
    const candidate = candidates.find(c => c.id === d.id);
    const conflict = candidate ? registrationConflict(m, candidate) : null;
    // An SSDP advertisement can move a provisional inventory entry, but
    // cannot replace an endpoint at which the gateway previously verified TLS.
    const unauthenticatedMove = candidate && d.protocol === 'bambu' && d.authenticatedEndpoint &&
      candidate.endpoint !== d.authenticatedEndpoint && candidate.probeEvidence?.method !== 'MQTT_TLS';
    if (!error && !conflict && !unauthenticatedMove && candidate?.probeEvidence?.deferred && d.probeEvidence?.method === 'MQTT_TLS') {
      // The printer was advertised, but its certificate/status were not sampled
      // in this batch. Keep the previous observation until its original expiry.
      continue;
    }
    if (!error && candidate && !conflict && !unauthenticatedMove) {
      Object.assign(d, copy(candidate), { observationConflict: false, lastScanFailed: false });
    } else if (!candidate && incompleteForProtocol(partialDiagnostics, d.protocol)) {
      // An incomplete listen or a capped batch cannot establish absence.
      // Keep the original timestamp so that a heartbeat cannot extend its TTL.
      continue;
    } else {
      d.connectionState = 'offline';
      d.observationConflict = Boolean(conflict || unauthenticatedMove);
      d.lastScanFailed = Boolean(error);
      if (d.protocol === 'bambu') { d.probeEvidence = null; d.capabilities = []; }
    }
  }
}
function demoCandidates(now) {
  return [
    { id: 'demo_device_moonraker', deviceKey: 'demo-moonraker-01', name: '演示 · Moonraker 一号', protocol: 'moonraker', model: 'Klipper / FDM', endpoint: 'demo://moonraker-01', gatewayId: 'demo-gateway', source: 'demo', connectionState: 'online', lastSeenAt: now },
    { id: 'demo_device_octoprint', deviceKey: 'demo-octoprint-01', name: '演示 · OctoPrint 二号', protocol: 'octoprint', model: 'OctoPrint / FDM', endpoint: 'demo://octoprint-01', gatewayId: 'demo-gateway', source: 'demo', connectionState: 'online', lastSeenAt: now },
    { id: 'demo_device_authorization', deviceKey: 'demo-octoprint-02', name: '演示 · 待授权设备', protocol: 'octoprint', model: 'OctoPrint / FDM', endpoint: 'demo://octoprint-02', gatewayId: 'demo-gateway', source: 'demo', connectionState: 'authorization_required', lastSeenAt: now }
  ];
}
export async function applyMerchantCommand(workspace, { type, payload, idempotencyKey }, { ownerId, now = Date.now(), credential, pairing, idFactory = () => crypto.randomUUID() } = {}) {
  ensure(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey), 400, 'IDEMPOTENCY_REQUIRED', '请提供 8–128 位唯一请求标识');
  ensure(payload && typeof payload === 'object' && !Array.isArray(payload), 400, 'INVALID_PAYLOAD', '请求体必须为对象');
  const next = copy(workspace), m = next.merchant = copy(merchantState(workspace));
  if (type.startsWith('gateway-')) authenticateGateway(next, credential, now);
  else ensure(ownerId, 401, 'AUTH_REQUIRED', '请先登录');
  if (type !== 'enroll') requireMerchant(next);
  const monitorReport = type === 'gateway-report' && typeof payload.scanId === 'string' && payload.scanId.startsWith('monitor_');
  const transient = type === 'gateway-poll' || monitorReport;
  const ledger = transient ? m.pollLedger : m.ledger, namespace = `${credential?.gatewayId ?? 'merchant'}:${idempotencyKey}`;
  const fingerprint = await digest(canonical({ type, payload }));
  if (own(ledger, namespace)) {
    const previous = ledger[namespace];
    ensure(previous.fingerprint === fingerprint, 409, 'IDEMPOTENCY_CONFLICT', '请求标识已经用于其他操作');
    const replay = copy(previous.result);
    // Replay the mutation receipt while projecting status at the current time.
    // A lost HTTP response must not revive an old authorized printer status.
    if (replay.scan && (previous.compactScan || replay.scan.autoRegister === 'bambu' || replay.scan.candidates?.some(c => c.protocol === 'bambu'))) {
      replay.scan = publicScan(m.scans.find(s => s.id === replay.scan.id) ?? replay.scan, next, now);
    }
    if (previous.compactInventory || replay.devices?.some(d => d.protocol === 'bambu')) {
      const view = merchantDevices(next, now);
      replay.imported = replay.imported.map(item => view.devices.find(d => d.id === item.id) ?? item);
      Object.assign(replay, view);
    }
    return { workspace: next, result: replay, replayed: true };
  }
  ensure(transient || Object.keys(m.ledger).length < 1000, 413, 'MERCHANT_CAPACITY', '商家工作空间已达到本阶段容量');
  let result;
  if (type === 'enroll') {
    ensure(validText(payload.name, 80), 400, 'INVALID_MERCHANT_NAME', '请输入 1–80 字的商家名称');
    if (m.profile) ensure(m.profile.name === payload.name.trim(), 409, 'MERCHANT_EXISTS', '当前账号已经开通商家工作台');
    else m.profile = { id: 'merchant_' + idFactory(), name: payload.name.trim(), role: 'merchant_owner', verification: 'sandbox_unverified', createdAt: now };
    result = { profile: copy(m.profile) };
  } else if (type === 'pairing') {
    ensure(validText(payload.name, 80), 400, 'INVALID_GATEWAY_NAME', '请输入网关名称');
    ensure(m.gateways.filter(g => gatewayActive(g, now)).length < MAX_GATEWAYS && m.gateways.length < 40, 409, 'GATEWAY_CAPACITY', '最多同时保留 8 个有效网关，本阶段最多保留 40 条网关记录');
    ensure(pairing?.tokenHash && pairing?.id && pairing.expiresAt > now, 500, 'PAIRING_UNAVAILABLE', '暂时无法创建网关凭据');
    const g = { id: pairing.id, name: payload.name.trim(), tokenHash: pairing.tokenHash, createdAt: now, expiresAt: pairing.expiresAt, lastSeenAt: null, revokedAt: null };
    m.gateways.push(g); result = { gateway: publicGateway(g, now), tokenShownOnce: true };
  } else if (type === 'revoke') {
    const g = findGateway(m, payload.gatewayId); g.revokedAt = g.revokedAt ?? now;
    for (const s of m.scans) if (s.gatewayId === g.id && s.status === 'pending') { s.status = 'failed'; s.error = { code: 'GATEWAY_REVOKED', message: '网关连接已撤销' }; }
    result = { gateway: publicGateway(g, now) };
  } else if (type === 'scan') {
    ensure(['real', 'demo'].includes(payload.scope), 400, 'SCAN_SCOPE_REQUIRED', '请明确选择真实设备扫描或演示扫描');
    ensure(payload.autoRegister === undefined || payload.scope === 'real' && payload.autoRegister === 'bambu', 400, 'INVALID_AUTO_REGISTER', '自动登记仅用于已配对网关的拓竹设备');
    let g;
    if (payload.scope === 'real') {
      ensure(typeof payload.gatewayId === 'string', 409, 'GATEWAY_REQUIRED', '请先连接商家本地网关');
      g = findGateway(m, payload.gatewayId);
      ensure(gatewayOnline(g, now), 409, 'GATEWAY_OFFLINE', '本地网关未在线，请启动网关后重试');
      // A subsequent reply from an interrupted background sample must not
      // overwrite a more recent interactive observation.
      g.monitorJob = null;
      const pending = m.scans.find(s => s.gatewayId === g.id && scanState(s, now) === 'pending');
      if (pending) {
        if (payload.autoRegister === 'bambu') pending.autoRegister = 'bambu';
        result = { scan: publicScan(pending, next, now) };
      }
    }
    if (!result) {
      m.scans = m.scans.filter(s => scanState(s, now) === 'pending' || now - s.createdAt < 24 * 3600_000).slice(-19);
      const scan = { id: 'scan_' + idFactory(), scope: payload.scope, gatewayId: g?.id ?? 'demo-gateway', status: payload.scope === 'demo' ? 'complete' : 'pending', createdAt: now, expiresAt: now + SCAN_TTL_MS, completedAt: payload.scope === 'demo' ? now : null, candidates: payload.scope === 'demo' ? demoCandidates(now) : [], error: null };
      if (payload.autoRegister === 'bambu') scan.autoRegister = 'bambu';
      m.scans.push(scan);
      trimBambuScanHistory(m.scans);
      result = { scan: publicScan(scan, next, now) };
    }
  } else if (type === 'import') {
    const scan = findScan(m, payload.scanId);
    ensure(latestGatewayScan(m, scan), 409, 'SCAN_SUPERSEDED', '该网关已有更新的扫描，请刷新并从最新结果添加设备');
    ensure(scanState(scan, now) === 'complete' && scan.expiresAt > now, 409, 'SCAN_NOT_IMPORTABLE', '请重新扫描设备后添加，当前扫描未完成或已过期');
    if (scan.scope === 'real') ensure(gatewayOnline(findGateway(m, scan.gatewayId), now), 409, 'GATEWAY_OFFLINE', '网关已离线，请重新连接后扫描');
    ensure(Array.isArray(payload.candidateIds) && payload.candidateIds.length > 0 && payload.candidateIds.length <= MAX_CANDIDATES && payload.candidateIds.every(id => typeof id === 'string'), 400, 'INVALID_CANDIDATES', '请选择要添加的设备');
    const selected = [...new Set(payload.candidateIds)].map(id => { const c = scan.candidates.find(c => c.id === id); ensure(c, 404, 'CANDIDATE_NOT_FOUND', '扫描中不存在该设备'); ensure(registrable(c), 409, 'DEVICE_NOT_AUTHORIZED', '设备尚未发现、离线或协议暂不支持'); return c; });
    ensure(!selected.some(c => registrationConflict(m, c)?.reason === 'OTHER_GATEWAY'), 409, 'DEVICE_ALREADY_REGISTERED_OTHER_GATEWAY', '该设备已在另一网关登记，请联系维护者核对并迁移，不能重复添加或自动抢绑');
    ensure(!selected.some(c => registrationConflict(m, c)?.reason === 'IDENTITY_CHANGED'), 409, 'DEVICE_IDENTITY_CONFLICT', '同一设备地址出现不同标识，请检查网关配置后重新检测，不能重复登记');
    const added = selected.filter(c => !m.devices.some(d => d.id === c.id));
    ensure(m.devices.length + added.length <= MAX_DEVICES, 413, 'DEVICE_CAPACITY', '本阶段最多登记 200 台设备');
    const imported = [], skipped = [];
    for (const c of selected) {
      const existing = m.devices.find(d => d.id === c.id);
      if (existing) {
        // A monitor may already have observed newer telemetry than this scan.
        if (c.protocol !== 'bambu') Object.assign(existing, copy(c));
        skipped.push(existing.id);
      }
      else { const device = { ...copy(c), registeredAt: now }; m.devices.push(device); imported.push(device); }
    }
    result = { imported, skipped, ...merchantDevices(next, now) };
  } else if (type === 'gateway-poll') {
    ensure(Object.keys(payload).length === 0, 400, 'INVALID_POLL', '轮询请求体必须为空对象');
    const g = authenticateGateway(next, credential, now); g.lastSeenAt = now;
    const commands = m.scans.filter(s => s.gatewayId === g.id && scanState(s, now) === 'pending').map(s => ({
      id: s.id, kind: 'discover', expiresAt: s.expiresAt, ...(s.autoRegister === 'bambu' ? { autoRegister: 'bambu' } : {})
    }));
    if (!commands.length) {
      const job = nextMonitor(m, g, now, idFactory);
      if (job) commands.push(copy(job));
    }
    result = { gatewayId: g.id, commands, pollAfterMs: 5000 };
  } else if (monitorReport) {
    const g = authenticateGateway(next, credential, now), job = g.monitorJob;
    ensure(job?.id === payload.scanId && now < job.expiresAt, 409, 'MONITOR_SUPERSEDED', '此监控采样已结束，请轮询最新任务');
    const { normalized, partialDiagnostics } = await readReport(payload, g.id, now);
    ensure(normalized.every(c => c.protocol === 'bambu' && job.deviceKeys.includes(c.deviceKey)),
      400, 'INVALID_MONITOR_DEVICE', '监控报告仅接受本批已登记拓竹设备');
    const devices = m.devices.filter(d => d.gatewayId === g.id && d.protocol === 'bambu' && job.deviceKeys.includes(d.deviceKey));
    applyObservations(m, devices, normalized, payload.error, partialDiagnostics);
    g.lastSeenAt = now; g.monitorJob = null;
    result = { accepted: true };
  } else if (type === 'gateway-report') {
    const g = authenticateGateway(next, credential, now), scan = findScan(m, payload.scanId);
    ensure(scan.gatewayId === g.id && scan.scope === 'real', 404, 'SCAN_NOT_FOUND', '扫描不属于此网关');
    ensure(scanState(scan, now) === 'pending', 409, 'SCAN_CLOSED', '扫描已完成或已过期');
    const { normalized, partialDiagnostics } = await readReport(payload, g.id, now);
    scan.partialDiagnostics = partialDiagnostics;
    if (payload.error) {
      scan.status = 'failed'; scan.error = { code: payload.error.code, message: payload.error.message };
      // Failure details may come from a local adapter. The UI must render text.
    } else scan.status = 'complete';
    scan.candidates = normalized; scan.completedAt = now; g.lastSeenAt = now;
    const devices = m.devices.filter(d => d.gatewayId === g.id && d.source === 'real' &&
      (scan.autoRegister !== 'bambu' || d.protocol === 'bambu' || normalized.some(c => c.id === d.id)));
    applyObservations(m, devices, normalized, payload.error, partialDiagnostics);
    if (scan.autoRegister === 'bambu' && !payload.error) scan.registrationResult = registerBambuBatch(m, scan, now);
    if (normalized.some(c => c.protocol === 'bambu')) g.nextMonitorAt = now + BAMBU_MONITOR_INTERVAL_MS;
    result = { accepted: true, scan: publicScan(scan, next, now) };
  } else fail('NOT_FOUND', '商家接口不存在', 404);
  const stored = copy(result); // Pairing result intentionally excludes raw token.
  const compactScan = Boolean(stored.scan?.candidates.some(c => c.protocol === 'bambu'));
  if (compactScan) {
    stored.scan.archivedCandidateCount = stored.scan.candidateCount;
    stored.scan.candidates = [];
  }
  const compactInventory = Boolean(stored.devices?.some(d => d.protocol === 'bambu'));
  if (compactInventory) {
    stored.imported = stored.imported.map(d => ({ id: d.id }));
    delete stored.devices;
  }
  if (transient) {
    const keys = Object.keys(m.pollLedger);
    while (keys.length >= 128) delete m.pollLedger[keys.shift()];
  }
  ledger[namespace] = { fingerprint, result: stored, at: now, ...(compactScan ? { compactScan: true } : {}), ...(compactInventory ? { compactInventory: true } : {}) };
  next.revision = (next.revision ?? 0) + 1; next.updatedAt = now;
  return { workspace: next, result, replayed: false };
}
