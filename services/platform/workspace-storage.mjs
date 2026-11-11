// Small and legacy workspaces keep their original JSON representation. Once a
// row would overflow, pack only quote history, which contains repeated price
// assumptions, immutable snapshots and replay receipts. Order and other state
// still count at their full size toward the same per-row budget.
import { ApiError } from './geometry.mjs';

const ROW_LIMIT = 1024 * 1024;
const EXPANDED_LIMIT = 6 * ROW_LIMIT;
const PREFIX = 'GONGZAO-QUOTE-HISTORY-1\n';
const encoder = new TextEncoder();

function capacityError() {
  return new ApiError(413, 'WORKSPACE_CAPACITY', '工作空间已达到本阶段容量，请联系维护者扩容');
}

function base64(bytes) {
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  }
  return btoa(pieces.join(''));
}

export async function encodeWorkspace(workspace) {
  const raw = JSON.stringify(workspace);
  const length = encoder.encode(raw).byteLength;
  if (length <= ROW_LIMIT) return raw;
  if (length > EXPANDED_LIMIT || !workspace.quotes?.length) throw capacityError();

  const { quotes, pricingEvidence, idempotency, ...remaining } = workspace;
  const quoteReceipts = [];
  const otherReceipts = [];
  for (const entry of Object.entries(idempotency)) {
    if (Array.isArray(entry[1]?.result?.quotes)) quoteReceipts.push(entry);
    else otherReceipts.push(entry);
  }
  const history = encoder.encode(JSON.stringify({ quotes, pricingEvidence, quoteReceipts }));
  if (history.byteLength > EXPANDED_LIMIT) throw capacityError();
  const state = { ...remaining, idempotency: Object.fromEntries(otherReceipts) };
  if (encoder.encode(JSON.stringify(state)).byteLength >= ROW_LIMIT) throw capacityError();
  const compressed = new Blob([history]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  const packed = PREFIX + JSON.stringify({ state, historySize: history.length, gzip: base64(bytes) });
  if (encoder.encode(packed).byteLength > ROW_LIMIT) throw capacityError();
  return packed;
}

export async function decodeWorkspace(row) {
  if (!row.startsWith(PREFIX)) return JSON.parse(row);
  const { state, historySize, gzip } = JSON.parse(row.slice(PREFIX.length));
  if (!Number.isSafeInteger(historySize) || historySize <= 0 || historySize > EXPANDED_LIMIT) {
    throw new Error('Invalid stored quote history length');
  }
  const compressed = Uint8Array.from(atob(gzip), c => c.charCodeAt(0));
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const history = new Uint8Array(historySize);
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length > historySize - offset) {
        await reader.cancel();
        throw new Error('Stored quote history exceeds its declared length');
      }
      history.set(value, offset);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== historySize) throw new Error('Incomplete stored quote history');
  const { quotes, pricingEvidence, quoteReceipts } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(history));
  state.quotes = quotes;
  if (pricingEvidence !== undefined) state.pricingEvidence = pricingEvidence;
  state.idempotency = Object.fromEntries([...Object.entries(state.idempotency), ...quoteReceipts]);
  return state;
}
