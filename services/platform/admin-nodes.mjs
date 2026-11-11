import { ApiError, ensure, sha256 } from './geometry.mjs';

export const NODE_HEARTBEAT_INTERVAL_SECONDS = 30;
export const NODE_ONLINE_WINDOW_MS = 90_000;
const MAX_NODES = 256;
const TOKEN_PATTERN = /^gzn1\.(node_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[0-9a-f]{64}$/;
export function isServerNodeId(value) {
  return typeof value === 'string' && /^node_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
const versionPattern = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/;

function validFields(input, fields) {
  ensure(input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length === fields.length && fields.every(key => Object.hasOwn(input, key)),
    400, 'NODE_INPUT_INVALID', '节点字段不完整或包含不支持的项目');
}

function label(value, maximum, title) {
  ensure(typeof value === 'string' && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) &&
    value.trim().length > 0 && [...value.trim()].length <= maximum, 400, 'NODE_INPUT_INVALID',
    title + '应为 1–' + maximum + ' 个字符');
  return value.trim();
}

function view(node, now) {
  let status = node.state;
  if (node.state === 'ACTIVE') {
    if (node.lastSeenAt === null) status = 'NEVER_CONNECTED';
    else status = now >= node.lastSeenAt && now - node.lastSeenAt < NODE_ONLINE_WINDOW_MS ? 'ONLINE' : 'OFFLINE';
  }
  return {
    id: node.id, name: node.name, purpose: node.purpose, state: node.state, status,
    createdAt: node.createdAt, updatedAt: node.updatedAt, lastSeenAt: node.lastSeenAt, agentVersion: node.agentVersion
  };
}

export function publicNodes(state, now = Date.now()) {
  return (state.nodes ?? []).map(node => view(node, now));
}

async function newCredential(node) {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const credential = 'gzn1.' + node.id + '.' + secret;
  node.tokenHash = await sha256(new TextEncoder().encode(credential));
  return credential;
}

export async function applyNodeAction(state, action, input, now = Date.now()) {
  const nodes = state.nodes ??= [];
  if (action === 'node.create') {
    validFields(input, ['name', 'purpose']);
    const name = label(input.name, 64, '服务器名称'), purpose = label(input.purpose, 100, '用途');
    if (nodes.length >= MAX_NODES) {
      // Prefer a revoked tombstone when reusing a slot. Its old credential can
      // never become valid again because each new node has a fresh random ID.
      const retired = nodes.filter(node => node.state === 'REVOKED').sort((a, b) => a.updatedAt - b.updatedAt)[0];
      ensure(retired, 409, 'NODE_CAPACITY', '最多登记 256 个节点，请先撤销已退役的节点');
      nodes.splice(nodes.indexOf(retired), 1);
    }
    const node = { id: 'node_' + crypto.randomUUID(), name, purpose, state: 'ACTIVE',
      createdAt: now, updatedAt: now, lastSeenAt: null, agentVersion: null, tokenHash: null };
    const credential = await newCredential(node);
    nodes.push(node);
    return { result: { node: view(node, now), credential }, targetId: node.id };
  }
  ensure(['node.rotate', 'node.disable', 'node.revoke'].includes(action), 400, 'NODE_ACTION_INVALID', '节点操作无效');
  validFields(input, ['nodeId']);
  const node = nodes.find(item => item.id === input.nodeId);
  ensure(node, 404, 'NODE_NOT_FOUND', '节点不存在');
  ensure(node.state !== 'REVOKED', 409, 'NODE_REVOKED', '节点已撤销，请重新登记');
  let credential;
  if (action === 'node.rotate') {
    credential = await newCredential(node);
    node.state = 'ACTIVE';
    // The new credential must report independently; do not imply it is online.
    node.lastSeenAt = null;
    node.agentVersion = null;
  } else {
    if (action === 'node.disable') ensure(node.state === 'ACTIVE', 409, 'NODE_DISABLED', '节点已停用');
    node.state = action === 'node.disable' ? 'DISABLED' : 'REVOKED';
    node.tokenHash = null;
  }
  node.updatedAt = now;
  return { result: { node: view(node, now), ...(credential ? { credential } : {}) }, targetId: node.id };
}

function sameDigest(left, right) {
  if (typeof right !== 'string' || right.length !== left.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function receiveNodeHeartbeat(state, bearer, body, now = Date.now()) {
  const match = typeof bearer === 'string' && TOKEN_PATTERN.exec(bearer);
  const node = match && state.nodes?.find(item => item.id === match[1]);
  const denied = () => new ApiError(401, 'NODE_AUTH_INVALID', '节点凭据无效或已停用');
  if (!node || node.state !== 'ACTIVE') throw denied();
  const digest = await sha256(new TextEncoder().encode(bearer));
  if (!sameDigest(digest, node.tokenHash)) throw denied();
  validFields(body, ['agentVersion']);
  ensure(typeof body.agentVersion === 'string' && versionPattern.test(body.agentVersion),
    400, 'NODE_AGENT_VERSION_INVALID', '代理版本格式无效');
  if (node.lastSeenAt === null || now >= node.lastSeenAt) {
    node.lastSeenAt = now;
    node.agentVersion = body.agentVersion;
  }
  return { nodeId: node.id, receivedAt: node.lastSeenAt, heartbeatIntervalSeconds: NODE_HEARTBEAT_INTERVAL_SECONDS };
}
