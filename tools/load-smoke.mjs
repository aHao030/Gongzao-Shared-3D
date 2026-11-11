import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createPlatformServer } from '../services/platform/local.mjs';

// A bounded local smoke sample, not a production capacity test or hosted D1 benchmark.
// Every run uses a disposable SQLite database and loopback HTTP only.
function option(name, fallback, maximum) {
  const offset = process.argv.indexOf(name);
  const value = offset < 0 ? fallback : Number(process.argv[offset + 1]);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return value;
}
const requests = option('--requests', 64, 100);
const concurrency = Math.min(requests, option('--concurrency', 8, 32));
const directory = await mkdtemp(path.join(tmpdir(), 'coforge-load-smoke-'));
const { server, store } = createPlatformServer({ dbPath: path.join(directory, 'sample.sqlite') });
let listening = false;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  listening = true;
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(base + '/api/v2/session');
  if (!sessionResponse.ok) throw new Error(`session failed: ${sessionResponse.status}`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('session did not set a cookie');
  const profileResponse = await fetch(base + '/api/v2/customer/profile', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ displayName: '负载测试', setupCompleted: true, shippingAddress: { recipient: '测试收件人', phone: '00000000000', countryCode: 'CN', province: '浙江省', city: '测试市', district: '测试区', addressLine: '测试地址 1 号', postalCode: '' } }) });
  if (!profileResponse.ok) throw new Error(`profile setup failed: ${profileResponse.status}`);
  const wsResponse = await fetch(base + '/api/v2/workspace', { headers: { Cookie: cookie } });
  const initial = await wsResponse.json();
  const modelId = initial.workspace.models.find(model => model.isSample)?.id;
  if (!modelId) throw new Error('sample model unavailable');
  const payload = JSON.stringify({ modelId, material: 'PLA', qty: 1, quality: 'standard', unit: 'mm' });
  const postQuote = () => fetch(base + '/api/v2/quotes', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: payload });
  const warmup = await postQuote(); await warmup.arrayBuffer();
  if (!warmup.ok) throw new Error(`warmup failed: ${warmup.status}`);
  let cursor = 0;
  const durations = [], statusCounts = {}, failures = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < requests) {
      const number = cursor++;
      const start = performance.now();
      try {
        const response = await postQuote(), body = await response.json();
        durations.push(performance.now() - start);
        statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
        if (!response.ok || body.quotes?.length !== 3) failures.push({ request: number, status: response.status, code: body.error?.code ?? 'INVALID_QUOTE_RESPONSE' });
      } catch (error) {
        durations.push(performance.now() - start);
        statusCounts.NETWORK_ERROR = (statusCounts.NETWORK_ERROR ?? 0) + 1;
        failures.push({ request: number, status: 'NETWORK_ERROR', code: error.name });
      }
    }
  }));
  const elapsed = performance.now() - started;
  durations.sort((a, b) => a - b);
  const percentile = p => Math.round(durations[Math.max(0, Math.ceil(durations.length * p) - 1)] * 100) / 100;
  const finalResponse = await fetch(base + '/api/v2/workspace', { headers: { Cookie: cookie } });
  const final = (await finalResponse.json()).workspace;
  const successful = requests - failures.length;
  const retainedAllWrites = final.revision === initial.workspace.revision + 1 + successful;
  const summary = {
    scope: 'LOCAL_LOOPBACK_SQLITE_SMOKE_ONLY',
    claim: 'Small local sample; not a production capacity, native-client or hosted D1 validation.',
    node: process.version,
    requestCount: requests,
    concurrency,
    elapsedMs: Math.round(elapsed * 100) / 100,
    latencyMs: { p50: percentile(.50), p95: percentile(.95), max: percentile(1) },
    statusCounts,
    successes: successful,
    failures: failures.length,
    retainedAllWrites,
    observedRevision: final.revision,
    expectedRevision: initial.workspace.revision + 1 + successful,
    firstFailures: failures.slice(0, 5),
    physicalCommandsSent: 0,
    moneyTransferred: 0
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length || !retainedAllWrites) process.exitCode = 1;
} finally {
  if (listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  store.close();
  await rm(directory, { recursive: true, force: true });
}
