import { ApiError, ensure, sha256 } from './geometry.mjs';
import { applyNodeAction, publicNodes, receiveNodeHeartbeat } from './admin-nodes.mjs';

export const ADMIN_AUDIT_LIMIT = 200;
const MEMBER_LIMIT = 64;
const CREATE = `CREATE TABLE IF NOT EXISTS platform_admin_control (
  id INTEGER PRIMARY KEY CHECK (id = 1), etag INTEGER NOT NULL, data TEXT NOT NULL
)`;
const READ = 'SELECT etag, data FROM platform_admin_control WHERE id = 1';
const INSERT = 'INSERT OR IGNORE INTO platform_admin_control (id, etag, data) VALUES (1, 1, ?)';
const UPDATE = 'UPDATE platform_admin_control SET etag = ?, data = ? WHERE id = 1 AND etag = ?';
const initialized = new WeakMap();
const validSubject = s => typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\s\u0000-\u001f\u007f]/u.test(s);
const initial = () => ({ revision: 0, members: [], nodes: [], intake: { paused: false }, audit: [], auditDropped: 0 });
const actions = new Map([
  ['member.grant', ['subject', 'role']], ['member.revoke', ['subject']],
  ['node.create', ['name', 'purpose']], ['node.rotate', ['nodeId']],
  ['node.disable', ['nodeId']], ['node.revoke', ['nodeId']],
  ['intake.set', ['paused', 'reason']]
]);

// Use the primary for D1 authorization reads, including revocations. Each CAS
// also tests the same storage version that was used for the permission check.
function persistence(store, validateBinding) {
  ensure(store && ['sqlite', 'd1'].includes(store.kind) && store.db, 503, 'ADMIN_STORAGE_UNAVAILABLE', '管理数据库尚未配置');
  const sqlite = store.kind === 'sqlite';
  const db = !sqlite && store.db.withSession ? store.db.withSession('first-primary') : store.db;
  async function ready() {
    if (!sqlite) return; // Hosted D1 tables are created by the tracked migration.
    let setup = initialized.get(store.db);
    if (!setup) {
      setup = Promise.resolve().then(() => db.exec(CREATE));
      initialized.set(store.db, setup);
      setup.catch(() => initialized.delete(store.db));
    }
    await setup;
  }
  async function read() {
    await ready();
    const row = sqlite ? db.prepare(READ).get() : await db.prepare(READ).first();
    return { etag: row?.etag ?? 0, state: row ? JSON.parse(row.data) : initial() };
  }
  async function commit(etag, state) {
    const data = JSON.stringify(state);
    ensure(new TextEncoder().encode(data).length < 1024 * 1024, 413, 'ADMIN_CAPACITY', '管理记录超过当前存储容量');
    const sql = etag === 0 ? INSERT : UPDATE;
    const args = etag === 0 ? [data] : [etag + 1, data, etag];
    if (!sqlite) return (await db.prepare(sql).bind(...args).run()).meta?.changes === 1;
    if (!validateBinding) return db.prepare(sql).run(...args).changes === 1;
    // The installation CLI changes the bootstrap account in this same SQLite
    // database. Hold its write lock across the final binding check and the CAS.
    db.exec('BEGIN IMMEDIATE');
    try {
      validateBinding();
      const committed = db.prepare(sql).run(...args).changes === 1;
      db.exec('COMMIT');
      return committed;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { read, commit };
}

function session(state, bootstrap, actor) {
  let role = null;
  if (bootstrap && validSubject(actor)) {
    if (actor === bootstrap) role = 'owner';
    else {
      const assigned = state.members.find(member => member.subject === actor)?.role;
      if (assigned === 'operator' || assigned === 'auditor') role = assigned;
    }
  }
  return {
    configured: Boolean(bootstrap), authorized: role !== null, role,
    actorId: validSubject(actor) ? actor : null,
    permissions: { manageMembers: role === 'owner', manageNodes: role === 'owner' || role === 'operator', manageIntake: role === 'owner' || role === 'operator', viewAudit: role !== null }
  };
}
function requireMember(access) {
  ensure(access.configured, 503, 'ADMIN_NOT_CONFIGURED', '尚未开通首位平台管理员');
  ensure(access.actorId, 401, 'ADMIN_LOGIN_REQUIRED', '请先登录管理员账号');
  ensure(access.authorized, 403, 'ADMIN_FORBIDDEN', '当前账号没有平台管理权限');
}
function publicEvent(event) {
  const { at, actor, action, target, role, revision } = event;
  const row = { at, actor, action, target, revision };
  if (role) row.role = role;
  if (action === 'intake.set') row.intake = event.receipt.intake;
  return row;
}

function applyIntake(state, { paused, reason }) {
  ensure(typeof paused === 'boolean', 400, 'ADMIN_INVALID_INTAKE', '请明确是否暂停受理新订单');
  const note = typeof reason === 'string' ? reason.trim() : '';
  ensure(reason === undefined || (typeof reason === 'string' && reason.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(reason)), 400, 'ADMIN_INVALID_INTAKE_REASON', '原因应为 160 字以内的单行文字');
  ensure(!paused || note, 400, 'ADMIN_INVALID_INTAKE_REASON', '暂停时请填写原因');
  const next = paused ? { paused: true, reason: note } : { paused: false };
  const prior = state.intake ?? { paused: false };
  ensure(next.paused !== prior.paused || next.reason !== prior.reason, 409, 'ADMIN_INTAKE_UNCHANGED', '受理状态未变化');
  state.intake = next;
  return { result: { intake: next }, targetId: 'order-intake' };
}

function applyMember(state, action, input, bootstrap, actor) {
  const { subject, role } = input;
  ensure(validSubject(subject), 400, 'ADMIN_INVALID_MEMBER', '请填写有效的账号主体标识');
  ensure(subject !== bootstrap && subject !== actor, 409, 'ADMIN_PROTECTED_OWNER', '部署负责人只能在服务器上变更');
  const index = state.members.findIndex(item => item.subject === subject);
  if (action === 'member.revoke') {
    ensure(index !== -1, 404, 'ADMIN_MEMBER_NOT_FOUND', '该账号没有可撤销的管理角色');
    state.members.splice(index, 1);
    return { result: { subject }, targetId: subject };
  }
  ensure(role === 'operator' || role === 'auditor', 400, 'ADMIN_INVALID_ROLE', '请选择运维或审计角色');
  ensure(index === -1 || state.members[index].role !== role, 409, 'ADMIN_MEMBER_UNCHANGED', '该账号已拥有所选角色');
  ensure(index !== -1 || state.members.length < MEMBER_LIMIT, 409, 'ADMIN_MEMBER_CAPACITY', '已达到管理员数量上限');
  const member = { subject, role };
  if (index === -1) state.members.push(member);
  else state.members[index] = member;
  return { result: member, targetId: subject };
}

export function createAdminControl({ store, bootstrapOwnerId, verifyBootstrap, clock = Date.now }) {
  const bootstrap = validSubject(bootstrapOwnerId) ? bootstrapOwnerId : null;
  const validateBinding = verifyBootstrap ? () => ensure(
    verifyBootstrap() === bootstrap, 409, 'ADMIN_BOOTSTRAP_CHANGED', '首管绑定已更新，请重新登录并核对权限'
  ) : null;
  const storage = persistence(store, validateBinding);
  async function resolve(actor) {
    if (!bootstrap || !validSubject(actor)) return session(initial(), bootstrap, actor);
    const { state } = await storage.read();
    validateBinding?.();
    return session(state, bootstrap, actor);
  }
  async function overview(actor) {
    if (!bootstrap || !validSubject(actor)) requireMember(session(initial(), bootstrap, actor));
    const { state } = await storage.read();
    validateBinding?.();
    const access = session(state, bootstrap, actor);
    requireMember(access);
    return {
      session: access, revision: state.revision,
      members: access.permissions.manageMembers ? [
        { subject: bootstrap, role: 'owner' }, ...state.members.filter(member => member.subject !== bootstrap)
      ] : [],
      nodes: publicNodes(state, clock()), intake: state.intake ?? { paused: false },
      audit: state.audit.map(publicEvent).reverse(),
      auditLimit: ADMIN_AUDIT_LIMIT, auditDropped: state.auditDropped
    };
  }
  async function execute(actor, command) {
    if (!bootstrap || !validSubject(actor)) requireMember(session(initial(), bootstrap, actor));
    // Shape errors do not disclose any stored state. Domain validation is
    // performed after checking the actor's role, inside the CAS loop.
    ensure(command && typeof command === 'object' && !Array.isArray(command), 400, 'ADMIN_INVALID_INPUT', '管理操作格式不正确');
    const { requestId, expectedRevision, action, ...input } = command;
    const fields = actions.get(action);
    ensure(fields, 400, 'ADMIN_UNKNOWN_ACTION', '未知的管理操作');
    ensure(typeof requestId === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(requestId), 400, 'ADMIN_REQUEST_ID', '缺少有效的操作标识');
    ensure(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 400, 'ADMIN_EXPECTED_REVISION', '请先刷新管理状态');
    ensure(Object.keys(input).every(key => fields.includes(key)), 400, 'ADMIN_INVALID_INPUT', '操作包含不支持的字段');
    ensure(fields.every(key => input[key] === undefined || typeof input[key] === (key === 'paused' ? 'boolean' : 'string')), 400, 'ADMIN_INVALID_INPUT', '操作字段格式不正确');
    const digest = await sha256(new TextEncoder().encode(JSON.stringify([action, expectedRevision, ...fields.map(key => input[key] ?? null)])));
    const memberAction = action.startsWith('member.');
    const nodeAction = action.startsWith('node.');
    for (let attempt = 0; attempt < 12; attempt++) {
      const { etag, state } = await storage.read();
      validateBinding?.();
      const access = session(state, bootstrap, actor);
      requireMember(access);
      const permission = memberAction ? 'manageMembers' : nodeAction ? 'manageNodes' : 'manageIntake';
      ensure(access.permissions[permission], 403, 'ADMIN_FORBIDDEN', '当前角色无法执行此操作');
      const previous = state.audit.find(event => event.actor === actor && event.requestId === requestId);
      if (previous) {
        ensure(previous.digest === digest, 409, 'ADMIN_REQUEST_CONFLICT', '该操作标识已用于其他请求');
        return { ...previous.receipt, revision: previous.revision, replayed: true };
      }
      ensure(expectedRevision === state.revision, 409, 'ADMIN_REVISION_CONFLICT', '管理配置已变更，请刷新后重新核对');
      const now = clock();
      const change = memberAction ? applyMember(state, action, input, bootstrap, actor)
        : nodeAction ? await applyNodeAction(state, action, input, now) : applyIntake(state, input);
      // Only the explicitly public node projection can enter a replay receipt.
      // A freshly issued bearer credential is returned once, after the CAS wins.
      const receipt = nodeAction ? { node: publicNodes(state, now).find(node => node.id === change.targetId) } : change.result;
      const revision = ++state.revision;
      state.audit.push({ actor, action, target: change.targetId, at: now, revision, requestId, digest, receipt, ...(action === 'member.grant' ? { role: input.role } : {}) });
      if (state.audit.length > ADMIN_AUDIT_LIMIT) { state.audit.shift(); state.auditDropped++; }
      if (await storage.commit(etag, state)) return { ...change.result, revision, replayed: false };
    }
    ensure(false, 409, 'ADMIN_CONCURRENT_UPDATE', '管理状态正在更新，请重试');
  }
  async function heartbeat(bearer, body) {
    ensure(bootstrap, 503, 'ADMIN_NOT_CONFIGURED', '尚未开通平台节点管理');
    for (let attempt = 0; attempt < 12; attempt++) {
      const { etag, state } = await storage.read();
      const result = await receiveNodeHeartbeat(state, bearer, body, clock());
      if (await storage.commit(etag, state)) return result;
    }
    ensure(false, 409, 'ADMIN_CONCURRENT_UPDATE', '节点状态正在更新，请稍后重试');
  }
  async function intakeStatus() {
    try {
      return (await storage.read()).state.intake ?? { paused: false };
    } catch {
      throw new ApiError(503, 'ORDER_INTAKE_UNAVAILABLE', '暂时无法核对受理状态，请稍后使用同一请求重试');
    }
  }
  async function nodeStatus(id) {
    if (!bootstrap || typeof id !== 'string' || !id || id.length > 100) return null;
    if (verifyBootstrap && verifyBootstrap() !== bootstrap) return null;
    return publicNodes((await storage.read()).state, clock()).find(node => node.id === id)?.status ?? null;
  }
  return { resolve, overview, execute, heartbeat, intakeStatus, nodeStatus };
}
