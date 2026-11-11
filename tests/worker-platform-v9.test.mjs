import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createPlatformServer } from '../services/platform/local.mjs';
import { ManufacturingWorker, validateConfig } from '../services/manufacturing-worker/client.mjs';

const python=process.env.GONGZAO_TEST_PYTHON||'python3';
const hasTrimesh=spawnSync(python,['-c','import trimesh'],{encoding:'utf8'}).status===0;
const sha=value=>createHash('sha256').update(value).digest('hex');

test('real HTTP upload → scoped lease → Python Trimesh → persisted completion survives platform restart', {skip:!hasTrimesh}, async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gongzao-worker-http-v9-'));
  const dbPath=path.join(directory,'platform.sqlite');let instance,origin;
  async function start(workerAccessConfig={workers:[]}) {
    instance=createPlatformServer({dbPath,workerAccessConfig,integrationConfig:{}});
    await new Promise((resolve,reject)=>{instance.server.once('error',reject);instance.server.listen(0,'127.0.0.1',resolve);});
    origin='http://127.0.0.1:'+instance.server.address().port;
  }
  async function stop(){if(instance){await new Promise(resolve=>instance.server.close(resolve));instance.store.close();instance=null;}}
  t.after(async()=>{await stop();await fs.rm(directory,{recursive:true,force:true});});
  await start();
  const post=async(route,payload,cookie)=>{
    const response=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(payload)});
    const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return{response,data};
  };
  const registration=await post('/api/auth/register',{email:'worker-'+randomUUID()+'@example.invalid',password:'Worker-test-password-v9',displayName:'制造服务测试账号'});
  const cookie=registration.response.headers.getSetCookie().filter(value=>!value.includes('Max-Age=0')).map(value=>value.split(';')[0]).join('; ');
  const session=await (await fetch(origin+'/api/v2/session',{headers:{Cookie:cookie}})).json();
  await post('/api/v2/merchant/enroll',{name:'测试工坊'},cookie);
  const bytes=await fs.readFile(new URL('./fixtures/cube-20mm.stl',import.meta.url));
  const upload=await fetch(origin+'/api/v2/models',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/octet-stream','X-File-Name':'worker-cube.stl','Idempotency-Key':randomUUID()},body:bytes});
  const uploaded=await upload.json();assert.equal(upload.status,201,JSON.stringify(uploaded));
  const queued=await post('/api/v2/merchant/operations/commands',{type:'queue-job',payload:{kind:'ANALYZE_MODEL',modelId:uploaded.model.id,quantity:1,unit:'mm',mode:'WORKER'}},cookie);
  const token=randomBytes(32).toString('base64url');
  const access={workers:[{ownerId:session.user.id,workerId:'real-analysis-test',kinds:['ANALYZE_MODEL'],tokenHash:sha(token),expiresAt:Date.now()+600000,enabled:true}]};
  await stop();await start(access);
  const worker=new ManufacturingWorker(validateConfig({platformOrigin:origin,workerToken:token,pythonExecutable:python,workDirectory:path.join(directory,'worker'),kinds:['ANALYZE_MODEL'],maxTaskSeconds:30}));
  const result=await worker.cycle();assert.equal(result.status,'COMPLETED');assert.equal(result.jobId,queued.data.job.id);
  const state=await (await fetch(origin+'/api/v2/merchant/operations',{headers:{Cookie:cookie}})).json();
  const completed=state.jobs.find(job=>job.id===result.jobId);
  assert.equal(completed.status,'COMPLETED');assert.equal(completed.result.modelHash,sha(bytes));assert.equal(completed.result.geometry.volumeMm3,8000);assert.equal(completed.result.engine.name,'Trimesh');assert.equal(completed.result.provenance,'WORKER_OBSERVED');assert.equal(completed.leaseToken,undefined);
  // A completed lease cannot be reused to download a private model.
  const denied=await fetch(origin+'/api/v2/worker/models/'+uploaded.model.id+'/download?jobId='+result.jobId,{headers:{Authorization:'Bearer '+token,'X-Job-Lease':'expired-lease','X-Job-Attempt':'1'}});assert.equal(denied.status,403);
  await stop();await start(access);
  const restored=await (await fetch(origin+'/api/v2/merchant/operations',{headers:{Cookie:cookie}})).json();
  assert.deepEqual(restored.jobs.find(job=>job.id===result.jobId).result,completed.result);
  const invalid=await fetch(origin+'/api/v2/worker/claim',{method:'POST',headers:{Authorization:'Bearer '+randomBytes(32).toString('base64url'),'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:'{}'});assert.equal(invalid.status,401);
});
