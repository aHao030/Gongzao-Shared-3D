import { ApiError, ensure, sha256 } from './geometry.mjs';

// Merchant device inventory is deliberately separate from the legacy manufacturing
// sandbox. Pairing grants discovery/monitoring only and can never dispatch a print.
export const GATEWAY_FRESH_MS = 90_000;
export const SCAN_TTL_MS = 120_000;
export const DEVICE_OBSERVATION_FRESH_MS = 5 * 60_000;
export const TOKEN_TTL_MS = 30 * 86400_000;
const MAX_DEVICES = 200, MAX_GATEWAYS = 8, MAX_CANDIDATES = 100;
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
const capabilityDetails = () => ({ protocolRead: true, fileUpload: false, startPrint: false, cancelPrint: false });
const verification = d => ({ level: d.source === 'demo' ? 'DEMO' : d.probeEvidence ? 'PROTOCOL_PROBE_REPORTED' : 'LEGACY_PROTOCOL_REPORTED', modelConfirmed: false, hardwareVerified: false, processCertified: false });
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
  return { ...copy(d), connectionState: state, observedConnectionState: d.connectionState, connectionReason: reason, observationExpiresAt, freshUntil, verification: verification(d), capabilityDetails: capabilityDetails(), capabilities: ['monitor'], automaticPrinting: false };
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
export function publicScan(scan, workspace, now = Date.now()) {
  if (!scan) return null;
  const m = requireMerchant(workspace);
  const gateway = m.gateways.find(g => g.id === scan.gatewayId);
  const importBlockedReason = scan.expiresAt <= now ? 'SCAN_EXPIRED' : scan.status !== 'complete' ? 'SCAN_NOT_COMPLETE' : scan.scope === 'real' && (!gateway || !gatewayOnline(gateway, now)) ? 'GATEWAY_OFFLINE' : null;
  return { id: scan.id, importable: importBlockedReason === null, importBlockedReason, scope: scan.scope, gatewayId: scan.gatewayId, status: scanState(scan, now), createdAt: scan.createdAt, expiresAt: scan.expiresAt, completedAt: scan.completedAt ?? null, error: scan.error ?? null, candidates: scan.candidates.map(c => { const existing = m.devices.find(d => d.id === c.id), conflict = registrationConflict(m, c); return { ...copy(c), registered: Boolean(existing || conflict), existingDeviceId: existing?.id ?? conflict?.device.id ?? null, registrationConflict: conflict?.reason ?? null, verification: verification(c), capabilityDetails: capabilityDetails(), capabilities: ['monitor'], automaticPrinting: false }; }) };
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
function privateEndpoint(value) {
  ensure(validText(value, 220), 400, 'INVALID_DEVICE_ENDPOINT', '设备地址无效');
  let u; try { u = new URL(value); } catch { fail('INVALID_DEVICE_ENDPOINT', '设备地址无效', 400); }
  const octets = u.hostname.split('.').map(Number);
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) && octets.every(x => Number.isInteger(x) && x >= 0 && x <= 255);
  const privateIp = ipv4 && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  ensure(['http:', 'https:'].includes(u.protocol) && privateIp && !u.username && !u.password && !u.search && !u.hash && u.pathname.length <= 160 && /^\/[A-Za-z0-9_./-]*$/.test(u.pathname) && !u.pathname.includes('//') && !value.includes('\\'), 400, 'INVALID_DEVICE_ENDPOINT', '仅接受商家内网 IPv4 设备地址及安全路径前缀，不包含密码或查询参数');
  return u.origin + u.pathname.replace(/\/+$/, '');
}
async function candidateRecord(input, gatewayId, now) {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_CANDIDATE', '设备扫描结果无效');
  ensure(validText(input.deviceKey, 160) && validText(input.name, 100) && ['moonraker', 'octoprint', 'unknown'].includes(input.protocol) && ['online', 'offline', 'authorization_required'].includes(input.connectionState), 400, 'INVALID_CANDIDATE', '设备标识、协议或状态无效');
  ensure(input.model === undefined || (typeof input.model === 'string' && input.model.length <= 100 && !/[\u0000-\u001f\u007f]/.test(input.model)), 400, 'INVALID_CANDIDATE', '设备型号无效');
  const endpoint = privateEndpoint(input.endpoint);
  let probeEvidence;
  if (input.probeEvidence !== undefined) {
    const e = input.probeEvidence;
    ensure(e && typeof e === 'object' && !Array.isArray(e) && e.method === 'GET' && e.endpoint === (input.protocol === 'moonraker' ? '/server/info' : input.protocol === 'octoprint' ? '/api/version' : null) && e.serviceReachable === true && [true, false, null].includes(e.controllerConnected), 400, 'INVALID_PROBE_EVIDENCE', '只读识别信息无效');
    ensure([e.serviceVersion, e.controllerState].every(v => v === undefined || typeof v === 'string' && v.length <= 100 && !/[\u0000-\u001f\u007f]/.test(v)), 400, 'INVALID_PROBE_EVIDENCE', '识别版本或控制器状态无效');
    ensure(input.protocol === 'octoprint' ? e.controllerConnected === null : input.connectionState !== 'online' || e.controllerConnected === true, 400, 'INVALID_PROBE_EVIDENCE', '控制器连接观察与协议不匹配');
    probeEvidence = { method: 'GET', endpoint: e.endpoint, serviceReachable: e.serviceReachable, controllerConnected: e.controllerConnected, serviceVersion: e.serviceVersion ?? '', controllerState: e.controllerState ?? '' };
  }
  return { id: 'dev_' + (await digest(`${gatewayId}\0${input.protocol}\0${input.deviceKey}`)).slice(0, 32), deviceKey: input.deviceKey, name: input.name.trim(), protocol: input.protocol, model: input.model ?? '', endpoint, gatewayId, source: 'real', connectionState: input.connectionState, lastSeenAt: now, probeEvidence: probeEvidence ?? null, capabilities: ['monitor'], automaticPrinting: false };
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
  const poll = type === 'gateway-poll';
  const ledger = poll ? m.pollLedger : m.ledger, namespace = `${credential?.gatewayId ?? 'merchant'}:${idempotencyKey}`;
  const fingerprint = await digest(canonical({ type, payload }));
  if (own(ledger, namespace)) {
    const previous = ledger[namespace];
    ensure(previous.fingerprint === fingerprint, 409, 'IDEMPOTENCY_CONFLICT', '请求标识已经用于其他操作');
    return { workspace: next, result: copy(previous.result), replayed: true };
  }
  ensure(poll || Object.keys(m.ledger).length < 1000, 413, 'MERCHANT_CAPACITY', '商家工作空间已达到本阶段容量');
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
    let g;
    if (payload.scope === 'real') {
      ensure(typeof payload.gatewayId === 'string', 409, 'GATEWAY_REQUIRED', '请先连接商家本地网关');
      g = findGateway(m, payload.gatewayId);
      ensure(gatewayOnline(g, now), 409, 'GATEWAY_OFFLINE', '本地网关未在线，请启动网关后重试');
      const pending = m.scans.find(s => s.gatewayId === g.id && scanState(s, now) === 'pending');
      if (pending) result = { scan: publicScan(pending, next, now) };
    }
    if (!result) {
      m.scans = m.scans.filter(s => scanState(s, now) === 'pending' || now - s.createdAt < 24 * 3600_000).slice(-19);
      const scan = { id: 'scan_' + idFactory(), scope: payload.scope, gatewayId: g?.id ?? 'demo-gateway', status: payload.scope === 'demo' ? 'complete' : 'pending', createdAt: now, expiresAt: now + SCAN_TTL_MS, completedAt: payload.scope === 'demo' ? now : null, candidates: payload.scope === 'demo' ? demoCandidates(now) : [], error: null };
      m.scans.push(scan); result = { scan: publicScan(scan, next, now) };
    }
  } else if (type === 'import') {
    const scan = findScan(m, payload.scanId);
    ensure(scanState(scan, now) === 'complete' && scan.expiresAt > now, 409, 'SCAN_NOT_IMPORTABLE', '请重新扫描设备后添加，当前扫描未完成或已过期');
    if (scan.scope === 'real') ensure(gatewayOnline(findGateway(m, scan.gatewayId), now), 409, 'GATEWAY_OFFLINE', '网关已离线，请重新连接后扫描');
    ensure(Array.isArray(payload.candidateIds) && payload.candidateIds.length > 0 && payload.candidateIds.length <= MAX_CANDIDATES && payload.candidateIds.every(id => typeof id === 'string'), 400, 'INVALID_CANDIDATES', '请选择要添加的设备');
    const selected = [...new Set(payload.candidateIds)].map(id => { const c = scan.candidates.find(c => c.id === id); ensure(c, 404, 'CANDIDATE_NOT_FOUND', '扫描中不存在该设备'); ensure(['moonraker', 'octoprint'].includes(c.protocol) && c.connectionState === 'online', 409, 'DEVICE_NOT_AUTHORIZED', '设备尚未授权、离线或协议暂不支持'); return c; });
    ensure(!selected.some(c => registrationConflict(m, c)?.reason === 'OTHER_GATEWAY'), 409, 'DEVICE_ALREADY_REGISTERED_OTHER_GATEWAY', '该设备已在另一网关登记，请联系维护者核对并迁移，不能重复添加或自动抢绑');
    ensure(!selected.some(c => registrationConflict(m, c)?.reason === 'IDENTITY_CHANGED'), 409, 'DEVICE_IDENTITY_CONFLICT', '同一设备地址出现不同标识，请检查网关配置后重新检测，不能重复登记');
    const added = selected.filter(c => !m.devices.some(d => d.id === c.id));
    ensure(m.devices.length + added.length <= MAX_DEVICES, 413, 'DEVICE_CAPACITY', '本阶段最多登记 200 台设备');
    const imported = [], skipped = [];
    for (const c of selected) {
      const existing = m.devices.find(d => d.id === c.id);
      if (existing) { Object.assign(existing, copy(c)); skipped.push(existing.id); }
      else { const device = { ...copy(c), registeredAt: now }; m.devices.push(device); imported.push(device); }
    }
    result = { imported, skipped, ...merchantDevices(next, now) };
  } else if (type === 'gateway-poll') {
    ensure(Object.keys(payload).length === 0, 400, 'INVALID_POLL', '轮询请求体必须为空对象');
    const g = authenticateGateway(next, credential, now); g.lastSeenAt = now;
    result = { gatewayId: g.id, commands: m.scans.filter(s => s.gatewayId === g.id && scanState(s, now) === 'pending').map(s => ({ id: s.id, kind: 'discover', expiresAt: s.expiresAt })), pollAfterMs: 5000 };
    // Poll replay protection is bounded; reprocessing an old empty poll only
    // updates the heartbeat and never starts physical work.
    const keys = Object.keys(m.pollLedger); while (keys.length >= 128) delete m.pollLedger[keys.shift()];
  } else if (type === 'gateway-report') {
    const g = authenticateGateway(next, credential, now), scan = findScan(m, payload.scanId);
    ensure(scan.gatewayId === g.id && scan.scope === 'real', 404, 'SCAN_NOT_FOUND', '扫描不属于此网关');
    ensure(scanState(scan, now) === 'pending', 409, 'SCAN_CLOSED', '扫描已完成或已过期');
    ensure(Array.isArray(payload.candidates) && payload.candidates.length <= MAX_CANDIDATES, 400, 'INVALID_CANDIDATES', '扫描最多返回 100 台设备');
    const normalized = await Promise.all(payload.candidates.map(c => candidateRecord(c, g.id, now)));
    ensure(new Set(normalized.map(c => c.id)).size === normalized.length, 400, 'DUPLICATE_CANDIDATE', '扫描包含重复设备');
    ensure(new Set(normalized.map(c => `${c.protocol}|${c.endpoint}`)).size === normalized.length, 400, 'DUPLICATE_ENDPOINT', '同一协议地址出现多个设备标识，请检查配置后重新检测');
    if (payload.error) {
      ensure(payload.error && validText(payload.error.code, 60) && validText(payload.error.message, 200), 400, 'INVALID_SCAN_ERROR', '扫描错误信息无效');
      scan.status = 'failed'; scan.error = { code: payload.error.code, message: payload.error.message };
      // Failure details may come from a local adapter. The UI must render text.
    } else scan.status = 'complete';
    scan.candidates = normalized; scan.completedAt = now; g.lastSeenAt = now;
    for (const d of m.devices.filter(d => d.gatewayId === g.id && d.source === 'real')) {
      const c = normalized.find(c => c.id === d.id);
      if (!payload.error && c && !registrationConflict(m, c)) { Object.assign(d, copy(c)); d.observationConflict = false; d.lastScanFailed = false; }
      else { d.connectionState = 'offline'; d.observationConflict = Boolean(c && registrationConflict(m, c)); d.lastScanFailed = Boolean(payload.error); }
    }
    result = { accepted: true, scan: publicScan(scan, next, now) };
  } else fail('NOT_FOUND', '商家接口不存在', 404);
  const stored = copy(result); // Pairing result intentionally excludes raw token.
  (poll ? m.pollLedger : m.ledger)[namespace] = { fingerprint, result: stored, at: now };
  next.revision = (next.revision ?? 0) + 1; next.updatedAt = now;
  return { workspace: next, result, replayed: false };
}
