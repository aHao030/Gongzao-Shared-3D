import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { publicNodes, applyNodeAction, receiveNodeHeartbeat, NODE_ONLINE_WINDOW_MS } from '../services/platform/admin-nodes.mjs';
import { loadAgentConfig, parseAgentArgs, sendHeartbeat, runAgent } from '../tools/server-agent.mjs';

import { randomBytes, createHash } from 'node:crypto';
import { createWorkerConfig } from '../tools/create-worker-config.mjs';
import { validateWorkerAccess } from '../services/platform/worker-access.mjs';
import { handleProductionWorkerApi } from '../services/platform/operations-http.mjs';
import { createAdminControl } from '../services/platform/admin-control.mjs';
import { applyOperationsCommand } from '../services/platform/operations.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';

const body = { agentVersion: '0.9.4-test' };
async function provision() {
  const state = { nodes: [] };
  const { result: { credential, node } } = await applyNodeAction(state, 'node.create', { name: '运算节点一', purpose: '模型计算' }, 1000);
  return { state, credential, node };
}

test('operator sees status based on current credential heartbeats and public records never include secrets', async () => {
  const { state, credential, node } = await provision();
  assert.equal(node.status, 'NEVER_CONNECTED');
  assert.equal(JSON.stringify(state).includes(credential), false);
  assert.equal(Object.hasOwn(publicNodes(state, 1000)[0], 'tokenHash'), false);
  await receiveNodeHeartbeat(state, credential, body, 1500);
  await receiveNodeHeartbeat(state, credential, { agentVersion: 'prior' }, 1490);
  const live = publicNodes(state, 1510)[0];
  assert.deepEqual([live.status, live.lastSeenAt, live.agentVersion], ['ONLINE', 1500, body.agentVersion]);
  assert.equal(publicNodes(state, 1500 + NODE_ONLINE_WINDOW_MS)[0].status, 'OFFLINE');
  await assert.rejects(receiveNodeHeartbeat(state, credential, { ...body, lastSeenAt: Date.now() }, 1600), { status: 400 });
  assert.equal(publicNodes(state, 1600)[0].lastSeenAt, 1500);
});

test('disable, rotate and permanent revocation invalidate all older credentials', async () => {
  const { state, credential, node } = await provision();
  const input = { nodeId: node.id };
  await receiveNodeHeartbeat(state, credential, body, 1200);
  const paused = await applyNodeAction(state, 'node.disable', input, 1300);
  assert.equal(paused.result.node.status, 'DISABLED');
  await assert.rejects(receiveNodeHeartbeat(state, credential, body, 1400), { status: 401 });
  const rotated = (await applyNodeAction(state, 'node.rotate', input, 1500)).result;
  assert.notEqual(rotated.credential, credential);
  assert.deepEqual([rotated.node.status, rotated.node.lastSeenAt], ['NEVER_CONNECTED', null]);
  await assert.rejects(receiveNodeHeartbeat(state, credential, body, 1600), { status: 401 });
  await receiveNodeHeartbeat(state, rotated.credential, body, 1600);
  const next = (await applyNodeAction(state, 'node.rotate', input, 1650)).result;
  await assert.rejects(receiveNodeHeartbeat(state, rotated.credential, body, 1670), { status: 401 });
  await receiveNodeHeartbeat(state, next.credential, body, 1680);
  await applyNodeAction(state, 'node.revoke', input, 1700);
  await assert.rejects(receiveNodeHeartbeat(state, next.credential, body, 1800), { status: 401 });
  await assert.rejects(applyNodeAction(state, 'node.rotate', input, 1800), { code: 'NODE_REVOKED' });
  assert.equal(publicNodes(state, 1800)[0].status, 'REVOKED');
});

test('a healthy one-shot local agent posts its actual version and verifies the node-specific platform receipt', async t => {
  const { state, node, credential } = await provision();
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/api/admin/nodes/heartbeat');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks));
      assert.deepEqual(Object.keys(data), ['agentVersion']);
      const receipt = await receiveNodeHeartbeat(state, req.headers.authorization.slice(7), data, Date.now());
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(receipt));
    } catch { res.writeHead(400); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = await loadAgentConfig(null, { GONGZAO_SERVER_URL: 'http://127.0.0.1:' + server.address().port, GONGZAO_SERVER_TOKEN: credential });
  const logs = [];
  const receipt = await runAgent(config, { once: true, log: value => logs.push(value) });
  assert.equal(receipt.nodeId, node.id);
  assert.equal(publicNodes(state)[0].status, 'ONLINE');
  assert.equal(logs.join('').includes(credential), false);
  await assert.rejects(sendHeartbeat(config, { fetchImpl: async () => Response.json({ ...receipt, nodeId: 'different' }) }), /不匹配/);
});

test('remote endpoints require TLS, redirects are not followed and denied agents stop without logging credentials', async () => {
  const { credential } = await provision();
  const env = { GONGZAO_SERVER_URL: 'http://farm.example.test', GONGZAO_SERVER_TOKEN: credential };
  await assert.rejects(loadAgentConfig(null, env), /HTTPS/);
  const config = await loadAgentConfig(null, { ...env, GONGZAO_SERVER_URL: 'https://control.example.test' });
  let calls = 0;
  await assert.rejects(sendHeartbeat(config, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://control.example.test/api/admin/nodes/heartbeat');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 307, headers: { Location: 'https://other.example.test/' } });
  } }), /重定向/);
  assert.equal(calls, 1);
  let retries = 0;
  await assert.rejects(runAgent(config, { send: () => sendHeartbeat(config, { fetchImpl: async () => Response.json({}, { status: 401 }) }),
    sleep: async () => { retries++; }, log: () => {} }), /拒绝/);
  assert.equal(retries, 0);
  assert.throws(() => parseAgentArgs(['--token', credential]), error => !error.message.includes(credential));
});

test('interrupted agents can stop while waiting to retry and private JSON stays separate from conflicting environment config', async t => {
  const { state, credential } = await provision();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gongzao-server-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'server-agent.private.json');
  await writeFile(filename, JSON.stringify({ platformUrl: 'https://control.example.test', token: credential }), { mode: 0o600 });
  const clean = await loadAgentConfig(filename, { GONGZAO_SERVER_URL: 'https://other.example.test', GONGZAO_SERVER_TOKEN: 'different' });
  assert.equal(clean.platformUrl, 'https://control.example.test');
  const abort = new AbortController(), waits = [];
  await runAgent(clean, { signal: abort.signal, send: () => sendHeartbeat(clean, { fetchImpl: async () => Response.json({}, { status: 503 }) }),
    sleep: async ms => { waits.push(ms); if (waits.length === 2) abort.abort(); }, log: () => {} });
  assert.deepEqual(waits, [5000, 10000]); assert.equal(publicNodes(state)[0].status, 'NEVER_CONNECTED');
  if (process.platform !== 'win32') {
    await chmod(filename, 0o644);
    await assert.rejects(loadAgentConfig(filename, {}), /600/);
  }
});

test('a dropped response body retries the same node and recovers without printing private configuration', async () => {
  const { node, credential } = await provision();
  const config = await loadAgentConfig(null, { GONGZAO_SERVER_URL: 'https://example.test', GONGZAO_SERVER_TOKEN: credential });
  const controller = new AbortController(), logs = [], waits = [];
  let posts = 0;
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + credential);
    if (++posts === 1) return new Response(new ReadableStream({ start(stream) { stream.error(new Error('connection reset')); } }));
    return Response.json({ nodeId: node.id, receivedAt: Date.now(), heartbeatIntervalSeconds: 30 });
  };
  await runAgent(config, {
    signal: controller.signal,
    send: () => sendHeartbeat(config, { fetchImpl }),
    sleep: async ms => { waits.push(ms); if (posts === 2) controller.abort(); },
    log: s => logs.push(s)
  });
  assert.deepEqual(waits, [5000, 30000]);
  assert.equal(logs.join('').includes(credential), false);
});

test('worker bindings use distinct node and worker credentials; old configurations continue to validate', async t => {
  const { node, credential } = await provision(), directory = await mkdtemp(path.join(os.tmpdir(), 'gongzao-bound-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(createWorkerConfig({ ownerId: 'owner-a', directory, serverNodeId: 'typo' }), /节点 ID/);
  const paths = await createWorkerConfig({ ownerId: 'owner-a', directory, serverNodeId: node.id });
  const access = JSON.parse(await readFile(paths.serverFile, 'utf8')), worker = JSON.parse(await readFile(paths.workerFile, 'utf8'));
  assert.equal(validateWorkerAccess(access).workers[0].serverNodeId, node.id);
  assert.equal(access.workers[0].tokenHash, createHash('sha256').update(worker.workerToken).digest('hex'));
  assert.notEqual(worker.workerToken, credential);
  assert.equal(JSON.stringify(access).includes(worker.workerToken), false);
  delete access.workers[0].serverNodeId;
  assert.ok(validateWorkerAccess(access));
  access.workers[0].serverNodeId = 'typo';
  assert.throws(() => validateWorkerAccess(access), { code: 'WORKER_CONFIG_INVALID' });
});

test('bound worker may claim only while online and may report its valid prior lease after a heartbeat outage', async () => {
  let now = 1000000;
  const store = new SQLiteStore(':memory:'), owner = 'owner-fixture';
  const adminControl = createAdminControl({ store, bootstrapOwnerId: owner, clock: () => now });
  const workerToken = randomBytes(32).toString('base64url');
  const adminAction = (command, expectedRevision) => adminControl.execute(owner,{ ...command, expectedRevision, requestId: crypto.randomUUID() });
  try {
    const node = await adminAction({action:'node.create', name:'试点', purpose:'模型分析'},0);
    const workerAccess = validateWorkerAccess({workers:[{ownerId:owner,workerId:'worker-test',enabled:true,
      expiresAt:now+3600000,serverNodeId:node.node.id,kinds:['ANALYZE_MODEL'],tokenHash:createHash('sha256').update(workerToken).digest('hex')}]});
    const raw = new TextEncoder().encode('test model bytes');
    const modelId = 'mdl_worker_node', modelHash = createHash('sha256').update(raw).digest('hex');
    await store.transact(owner, async ws => {
      ws.merchant={profile:{name:'虚拟商家'},devices:[],gateways:[],scans:[],ledger:{}};
      ws.models.push({...ws.models[0],id:modelId,sha256:modelHash,isSample:false});
      return applyOperationsCommand(ws,{type:'queue-job',payload:{kind:'ANALYZE_MODEL',modelId,quantity:1,unit:'mm',mode:'WORKER'},idempotencyKey:crypto.randomUUID()},{now});
    },{id:modelId,bytes:raw});
    const request = (route, {token=workerToken,method='POST',value={},headers={}}={}) =>
      handleProductionWorkerApi(new Request('https://platform.example.test/api/v2/worker/'+route, {
        method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),...headers},
        ...(method==='POST'?{body:JSON.stringify(value)}:{})
      }),{store,workerAccess,clock:()=>now,adminControl});
    assert.equal((await request('claim',{token:node.credential})).status,401);
    assert.equal((await (await request('claim')).json()).error.code,'WORKER_NODE_OFFLINE');
    await adminControl.heartbeat(node.credential,body);
    const claim=await (await request('claim')).json(), job=claim.job;
    assert.equal(job.modelId,modelId);
    const download='models/'+modelId+'/download?jobId='+encodeURIComponent(job.id);
    const headers={'X-Job-Lease':job.leaseToken,'X-Job-Attempt':String(job.attempt)};
    assert.equal((await request(download,{method:'GET',headers})).status,200);
    now+=NODE_ONLINE_WINDOW_MS;
    assert.equal((await request('claim')).status,409);
    assert.equal((await request(download,{method:'GET',headers})).status,409);
    const finish={jobId:job.id,leaseToken:job.leaseToken,attempt:job.attempt,result:{
      inputHash:job.inputHash,modelHash,profileRevision:null,engineVersion:'fixture',provenance:'WORKER_OBSERVED',
      geometry:{dimensionsMm:[20,20,20],volumeMm3:8000,surfaceAreaMm2:2400,watertight:true,windingConsistent:true,isVolume:true,bodyCount:1,faceCount:12,requiresReview:false,warnings:[]}}};
    assert.equal((await request('complete',{value:{...finish,leaseToken:'wrong'}})).status,409);
    const result=await (await request('complete',{value:finish})).json();
    assert.equal(result.job?.status,'COMPLETED',JSON.stringify(result.error));
    await adminAction({action:'node.disable',nodeId:node.node.id},1);
    assert.equal((await request('claim')).status,403);
    assert.equal((await request('complete',{value:finish})).status,403);
    await adminAction({action:'node.revoke',nodeId:node.node.id},2);
    assert.equal((await request(download,{method:'GET',headers})).status,403);
    delete workerAccess.workers[0].serverNodeId;
    assert.equal((await request('claim')).status,200);
  } finally { store.close(); }
});

test('a temporarily disconnected bound worker keeps its lease instead of recording an input download error as failed production', async t => {
  const { ManufacturingWorker, validateConfig, isRetryableWorkerError } = await import('../services/manufacturing-worker/client.mjs');
  const workDirectory = await mkdtemp(path.join(os.tmpdir(),'gongzao-bind-recovery-'));
  t.after(()=>rm(workDirectory,{recursive:true,force:true}));
  const model=new TextEncoder().encode('demo-model');
  const job={id:'job-abc',kind:'ANALYZE_MODEL',mode:'WORKER',modelId:'mdl_1',format:'stl',modelHash:createHash('sha256').update(model).digest('hex'),
    inputHash:'a'.repeat(64),leaseToken:'lease-abc',attempt:1};
  let claims=0, step=0;
  const worker=new ManufacturingWorker(validateConfig({platformOrigin:'http://127.0.0.1',workDirectory,workerToken:'synthetic-test-worker-credential'}),{
    engine:async()=>({}), fetchImpl:async url=>{
      if(url.pathname.endsWith('/claim')){claims++;return Response.json({job});}
      if(url.pathname.endsWith('/download')){
        if(++step===1)return Response.json({error:{code:'WORKER_NODE_OFFLINE',message:'offline'}},{status:409});
        if(step===2)return Response.json({error:{code:'WORKER_NODE_INACTIVE',message:'disabled'}},{status:403});
        return new Response(model);
      }
      assert.ok(url.pathname.endsWith('/complete'));
      return Response.json({accepted:true});
    }
  });
  await assert.rejects(worker.cycle(),error=>error.code==='WORKER_NODE_OFFLINE' && isRetryableWorkerError(error));
  await assert.rejects(worker.cycle(),error=>error.code==='WORKER_NODE_INACTIVE' && !isRetryableWorkerError(error));
  assert.equal((await worker.readJournal()).job.id,job.id);
  assert.equal((await worker.cycle()).status,'COMPLETED');
  assert.equal(claims,1);
});
