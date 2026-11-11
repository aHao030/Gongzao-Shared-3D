import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('./engine.py', import.meta.url));
const KINDS = ['ANALYZE_MODEL', 'SLICE_MODEL', 'SCHEDULE'];
const HASH = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function isRetryableWorkerError(error) {
  return ['PLATFORM_TIMEOUT', 'PLATFORM_UNAVAILABLE', 'PLATFORM_REQUEST_FAILED',
    'WORKER_NODE_OFFLINE', 'WORKER_NODE_UNAVAILABLE'].includes(error.code);
}
export class WorkerError extends Error {
  constructor(code, message, status) { super(message); this.name = 'WorkerError'; this.code = code; this.status = status; }
}
const require = (condition, code, message) => { if (!condition) throw new WorkerError(code, message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateConfig(input, directory = process.cwd()) {
  require(object(input), 'INVALID_CONFIG', 'Worker configuration must be an object');
  let origin;
  try { origin = new URL(input.platformOrigin); } catch { throw new WorkerError('INVALID_ORIGIN', 'A platform origin is required'); }
  require(['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/', 'INVALID_ORIGIN', 'Use an origin without credentials, path or query');
  require(origin.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'HTTPS_REQUIRED', 'Remote workers require HTTPS');
  require(typeof input.workerToken === 'string' && input.workerToken.length >= 24 && input.workerToken.length <= 2048 && !/\s/.test(input.workerToken), 'INVALID_TOKEN', 'A scoped worker token is required');
  require(!input.siteAccessToken || (typeof input.siteAccessToken === 'string' && input.siteAccessToken.length >= 16 && input.siteAccessToken.length <= 8192 && !/\s/.test(input.siteAccessToken)), 'INVALID_SITE_TOKEN', 'Invalid hosted-site access token');
  const kinds = input.kinds ?? KINDS;
  require(Array.isArray(kinds) && kinds.length > 0 && kinds.length <= 3 && kinds.every(kind => KINDS.includes(kind)), 'INVALID_KINDS', 'The worker only accepts analysis, slicing and scheduling tasks');
  const maxTaskSeconds = input.maxTaskSeconds ?? 240;
  require(Number.isInteger(maxTaskSeconds) && maxTaskSeconds >= 30 && maxTaskSeconds <= 600, 'INVALID_TIMEOUT', 'Task timeout must be 30–600 seconds');
  const profiles = {};
  require(input.profiles === undefined || object(input.profiles), 'INVALID_PROFILES', 'Profiles must be an ID-to-local-file map');
  for (const [id, profile] of Object.entries(input.profiles ?? {})) {
    require(/^[A-Za-z0-9_-]{1,80}$/.test(id) && object(profile) && typeof profile.path === 'string' && Number.isInteger(profile.revision) && profile.revision > 0 && HASH.test(profile.sha256), 'INVALID_PROFILE', 'Each allow-listed profile needs a file, revision and SHA-256');
    profiles[id] = { path:path.resolve(directory, profile.path), revision:profile.revision, sha256:profile.sha256, verified:profile.verified === true };
  }
  const apiPrefix = input.apiPrefix ?? '/api/v2/worker';
  require(['/api/v2/worker', '/api/v2/production-worker'].includes(apiPrefix), 'INVALID_API_PREFIX', 'Unsupported worker API prefix');
  const executable = (value, fallback) => {
    const result = value ?? fallback;
    require(typeof result === 'string' && result.length > 0 && result.length <= 1024 && !/[\r\n\0]/.test(result), 'INVALID_EXECUTABLE', 'Executable must be a local program name or path');
    return result.includes('/') || result.includes('\\') ? path.resolve(directory, result) : result;
  };
  return {
    platformOrigin:origin.origin, workerToken:input.workerToken, siteAccessToken:input.siteAccessToken,
    apiPrefix, kinds:[...new Set(kinds)], maxTaskSeconds,
    pollSeconds:Math.max(1, Math.min(60, Number(input.pollSeconds) || 5)),
    pythonExecutable:executable(input.pythonExecutable, 'python3'),
    prusaSlicerExecutable:executable(input.prusaSlicerExecutable, 'prusa-slicer'),
    workDirectory:path.resolve(directory, input.workDirectory ?? 'data/manufacturing-worker'), profiles,
  };
}

export async function loadConfig(filename) {
  const absolute = path.resolve(filename), stat = await fs.stat(absolute);
  require(stat.size <= 65536, 'CONFIG_TOO_LARGE', 'Worker configuration exceeds 64 KiB');
  const input = JSON.parse(await fs.readFile(absolute, 'utf8'));
  if (!input.siteAccessToken && process.env.GONGZAO_SITE_ACCESS_TOKEN) input.siteAccessToken = process.env.GONGZAO_SITE_ACCESS_TOKEN;
  return validateConfig(input, path.dirname(absolute));
}

export async function readBounded(response, limit) {
  require(!Number.isFinite(Number(response.headers.get('content-length'))) || Number(response.headers.get('content-length')) <= limit, 'RESPONSE_TOO_LARGE', 'Platform response exceeds the size limit');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new WorkerError('RESPONSE_TOO_LARGE', 'Platform response exceeds the size limit'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function executeEngine(request, config, { spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, bytes = 0, stdout = '', stderrBytes = 0;
    const child = spawnProcess(config.pythonExecutable, [ENGINE], { stdio:['pipe','pipe','pipe'], shell:false, detached:process.platform !== 'win32', windowsHide:true, env:{...process.env, OPENBLAS_NUM_THREADS:'1', OMP_NUM_THREADS:'1'} });
    const kill = () => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { kill(); finish(new WorkerError('ENGINE_TIMEOUT', 'Manufacturing computation exceeded its time limit')); }, config.maxTaskSeconds * 1000);
    child.on('error', () => finish(new WorkerError('PYTHON_UNAVAILABLE', 'The configured Python executable could not be started')));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { kill(); finish(new WorkerError('ENGINE_OUTPUT_LIMIT', 'Manufacturing output exceeded its limit')); return; }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 1024 * 1024) { kill(); finish(new WorkerError('ENGINE_OUTPUT_LIMIT', 'Manufacturing diagnostics exceeded their limit')); } });
    child.on('close', () => {
      if (settled) return;
      let value; try { value = JSON.parse(stdout); } catch { finish(new WorkerError('ENGINE_RESPONSE_INVALID', 'Manufacturing engine did not return valid JSON')); return; }
      if (value.ok !== true) { finish(new WorkerError(value.error?.code ?? 'ENGINE_FAILED', value.error?.message ?? 'Manufacturing computation failed')); return; }
      finish(null, value.result);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export class ManufacturingWorker {
  constructor(config, { fetchImpl = fetch, engine = executeEngine } = {}) {
    this.config = config; this.fetch = fetchImpl; this.engine = engine;
    this.journalPath = path.join(config.workDirectory, 'worker-journal.json');
  }
  async request(route, { payload, key, download = false, headers = {} } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await this.fetch(new URL(this.config.apiPrefix + route, this.config.platformOrigin), {
        method:payload === undefined ? 'GET' : 'POST', redirect:'manual', signal:controller.signal,
        headers:{ 'Authorization':'Bearer ' + this.config.workerToken,
          ...(this.config.siteAccessToken ? { 'OAI-Sites-Authorization':'Bearer ' + this.config.siteAccessToken } : {}),
          ...(payload === undefined ? {} : { 'Content-Type':'application/json', 'Idempotency-Key':key }), ...headers },
        ...(payload === undefined ? {} : { body:JSON.stringify(payload) }),
      });
      require(response.status < 300 || response.status >= 400, 'REDIRECT_REFUSED', 'The platform redirected the worker; check its origin and hosted-site access');
      const bytes = await readBounded(response, download && response.ok ? 20 * 1024 * 1024 : 1024 * 1024);
      if (download && response.ok) return bytes;
      let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new WorkerError('PLATFORM_RESPONSE_INVALID', 'The platform did not return JSON; check authentication'); }
      if (!response.ok || data.error) throw new WorkerError(data.error?.code ?? 'PLATFORM_REQUEST_FAILED', data.error?.message ?? 'Platform request failed', response.status);
      return data;
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError(error.name === 'AbortError' ? 'PLATFORM_TIMEOUT' : 'PLATFORM_UNAVAILABLE', 'Platform connection failed; the saved request will be retried');
    } finally { clearTimeout(timer); }
  }
  async readJournal() {
    try { const value = JSON.parse(await fs.readFile(this.journalPath, 'utf8')); require(object(value), 'JOURNAL_INVALID', 'Worker journal is invalid'); return value; }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async saveJournal(value) {
    await fs.mkdir(this.config.workDirectory, { recursive:true, mode:0o700 });
    const temporary = this.journalPath + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(value), { mode:0o600 });
    await fs.rename(temporary, this.journalPath);
  }
  validateJob(job) {
    require(object(job) && typeof job.id === 'string' && job.id.length <= 160 && KINDS.includes(job.kind) && this.config.kinds.includes(job.kind) && HASH.test(job.inputHash) && typeof job.leaseToken === 'string' && job.leaseToken.length >= 8 && Number.isInteger(job.attempt) && job.attempt > 0, 'JOB_INVALID', 'The platform returned an invalid task');
    require(job.kind === 'SCHEDULE' || (typeof job.modelId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(job.modelId) && HASH.test(job.modelHash) && ['stl','3mf','step','stp','png','jpg','jpeg','webp'].includes(job.format)), 'JOB_INVALID', 'The task model reference is invalid');
    require(job.mode === 'WORKER' || job.mode === 'REAL', 'JOB_MODE_INVALID', 'The external worker does not execute sandbox jobs');
  }
  async compute(job) {
    this.validateJob(job);
    const directory = path.join(this.config.workDirectory, hash(Buffer.from(job.id + ':' + job.attempt)).slice(0, 24));
    await fs.mkdir(directory, { recursive:true, mode:0o700 });
    const request = { kind:job.kind, inputHash:job.inputHash, modelHash:job.modelHash, profileRevision:job.profileRevision,
      quantity:job.quantity, unit:job.unit, format:job.format, jobDirectory:directory,
      configSnapshot:job.configSnapshot, scheduleSnapshot:job.kind === 'SCHEDULE' ? job.configSnapshot : job.scheduleSnapshot,
      timeoutSeconds:Math.max(10, this.config.maxTaskSeconds - 20), prusaSlicerExecutable:this.config.prusaSlicerExecutable };
    if (job.kind !== 'SCHEDULE') {
      const modelPath = path.join(directory, 'model.' + job.format);
      let bytes; try { bytes = await fs.readFile(modelPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!bytes || hash(bytes) !== job.modelHash) {
        bytes = await this.request('/models/' + encodeURIComponent(job.modelId) + '/download?jobId=' + encodeURIComponent(job.id), {
          download:true, headers:{'X-Job-Lease':job.leaseToken, 'X-Job-Attempt':String(job.attempt)} });
        require(hash(bytes) === job.modelHash, 'MODEL_HASH_MISMATCH', 'Downloaded model bytes do not match the task');
        await fs.writeFile(modelPath, bytes, { mode:0o600 });
      }
      request.modelPath = modelPath;
    }
    if (job.kind === 'SLICE_MODEL') {
      const profile = this.config.profiles[job.configSnapshot?.localProfileId];
      require(profile && profile.revision === job.profileRevision, 'PROFILE_NOT_CONFIGURED', 'The task profile and revision must be installed in the local worker allow-list');
      const stat = await fs.stat(profile.path);
      require(stat.size <= 1024 * 1024, 'PROFILE_SIZE_LIMIT', 'Slicer profile exceeds 1 MiB');
      const profileBytes = await fs.readFile(profile.path);
      require(hash(profileBytes) === profile.sha256, 'PROFILE_HASH_MISMATCH', 'The local profile changed after configuration');
      request.profilePath = profile.path; request.profileDirectory = path.dirname(profile.path); request.profileSha256 = profile.sha256;
      request.expectedProfileSha256 = job.configSnapshot?.expectedProfileSha256;
    }
    return this.engine(request, this.config);
  }
  async submitReport(journal, replay = false) {
    const report = journal.report;
    const jobId = journal.job.id;
    try {
      await this.request('/' + report.route, {payload: report.payload, key: report.key});
    } catch (error) {
      if ((error.status === 409 && error.code === 'STALE_JOB_LEASE') || (error.status === 404 && error.code === 'JOB_NOT_FOUND')) {
        // The platform retired this attempt. It owns the next lease and may already have reassigned it.
        await this.saveJournal({});
        return {status: 'LEASE_RELEASED', jobId, code: error.code};
      }
      const invalidResult = ['JOB_RESULT_MISMATCH', 'INVALID_GEOMETRY_RESULT', 'INVALID_SLICE_RESULT',
        'INVALID_SCHEDULE', 'SCHEDULE_OVERLAP', 'PROFILE_CHANGED', 'MODEL_CHANGED',
        'PROFILE_HASH_MISMATCH', 'SCHEDULE_STALE'];
      if (report.route === 'complete' && [400, 409].includes(error.status) && invalidResult.includes(error.code)) {
        journal.report = {route: 'fail', key: 'worker-fail:' + randomUUID(), payload: {
          jobId, leaseToken: journal.job.leaseToken, attempt: journal.job.attempt,
          errorCode: error.code, errorMessage: 'The platform rejected this computation result: ' + error.code
        }};
        await this.saveJournal(journal);
        return this.submitReport(journal);
      }
      throw error;
    }
    await this.saveJournal({});
    return {status: replay ? 'REPORTED' : report.route === 'complete' ? 'COMPLETED' : 'FAILED',
      jobId, ...(report.payload.errorCode ? {code: report.payload.errorCode} : {})};
  }
  async cycle() {
    let journal = await this.readJournal();
    if (journal.report) return this.submitReport(journal, true);
    if (!journal.job) {
      journal.claim ??= { key:'worker-claim:' + randomUUID(), payload:{ kinds:this.config.kinds, leaseSeconds:Math.min(900, this.config.maxTaskSeconds + 90) } };
      await this.saveJournal(journal);
      const response = await this.request('/claim', { payload:journal.claim.payload, key:journal.claim.key });
      if (!response.job) { await this.saveJournal({}); return { status:'IDLE' }; }
      this.validateJob(response.job);
      journal = { job:response.job }; await this.saveJournal(journal);
    }
    const job = journal.job;
    let report;
    try {
      const result = await this.compute(job);
      report = { route:'complete', key:'worker-complete:' + randomUUID(), payload:{ jobId:job.id, leaseToken:job.leaseToken, attempt:job.attempt, result } };
    } catch (error) {
      if (isRetryableWorkerError(error) || error.code === 'WORKER_NODE_INACTIVE') throw error;
      report = { route:'fail', key:'worker-fail:' + randomUUID(), payload:{ jobId:job.id, leaseToken:job.leaseToken, attempt:job.attempt,
        errorCode:error instanceof WorkerError ? error.code : 'LOCAL_COMPUTATION_FAILED',
        errorMessage:error instanceof WorkerError ? error.message.slice(0, 300) : 'Local computation failed; inspect worker configuration' } };
    }
    journal.report = report; await this.saveJournal(journal);
    return this.submitReport(journal);
  }
}
