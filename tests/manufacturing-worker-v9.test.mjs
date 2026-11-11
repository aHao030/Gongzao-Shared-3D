import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ManufacturingWorker, validateConfig, executeEngine } from '../services/manufacturing-worker/client.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENGINE = path.join(ROOT, 'services/manufacturing-worker/engine.py');
const PYTHON = process.env.GONGZAO_TEST_PYTHON || 'python3';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await fs.readFile(path.join(ROOT, 'tests/fixtures/cube-20mm.stl'));
const baseConfig = {platformOrigin:'http://127.0.0.1:3000', workerToken:'test-worker-token-that-is-not-a-real-secret', maxTaskSeconds:30};
const status = spawnSync(PYTHON, [ENGINE], {input:JSON.stringify({kind:'STATUS'}), encoding:'utf8'});
const available = status.status === 0 ? JSON.parse(status.stdout).result : {};
const native = { skip:!available.trimesh || !available.ortools };
const job = () => ({id:'job-first',kind:'ANALYZE_MODEL',mode:'WORKER',inputHash:'a'.repeat(64),modelId:'mdl_test',modelHash:sha(source),format:'stl',profileRevision:null,quantity:1,unit:'mm',leaseToken:'lease-123456789',attempt:1,configSnapshot:null});
const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json'}});
async function temporary(t) {const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gongzao-worker-v9-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
function python(request) {const response=spawnSync(PYTHON,[ENGINE],{input:JSON.stringify(request),encoding:'utf8',timeout:30000,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});assert.equal(response.error,undefined);return JSON.parse(response.stdout);}
function pythonFunction(name, value) {
  const script='import importlib.util,json,sys\ns=importlib.util.spec_from_file_location("engine",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntry:\n print(json.dumps({"ok":True,"result":getattr(m,sys.argv[2])(json.loads(sys.stdin.read()))}))\nexcept m.TaskError as e:\n print(json.dumps({"ok":False,"code":e.code}))';
  const response=spawnSync(PYTHON,['-c',script,ENGINE,name],{input:JSON.stringify(value),encoding:'utf8',timeout:10000});assert.equal(response.status,0,response.stderr);return JSON.parse(response.stdout);
}

test('worker config limits remote transport, job kinds and profile IDs', () => {
  assert.throws(()=>validateConfig({...baseConfig,platformOrigin:'http://192.168.1.2:3000'}),{code:'HTTPS_REQUIRED'});
  assert.throws(()=>validateConfig({...baseConfig,platformOrigin:'https://user:secret@example.com'}),{code:'INVALID_ORIGIN'});
  assert.throws(()=>validateConfig({...baseConfig,kinds:['START_PRINT']}),{code:'INVALID_KINDS'});
  assert.throws(()=>validateConfig({...baseConfig,profiles:{'../profile':{path:'a.ini',revision:1,sha256:'b'.repeat(64)}}}),{code:'INVALID_PROFILE'});
  const result=validateConfig({...baseConfig,profiles:{pla:{path:'a.ini',revision:1,sha256:'b'.repeat(64)}}},'/tmp/example');
  assert.equal(result.profiles.pla.path,'/tmp/example/a.ini');
});

test('slicer footer parser totals multi-material weight and validates time', () => {
  const result=pythonFunction('parse_gcode_metadata','; estimated printing time (normal mode) = 1d 2h 3m 4s\n; filament used [g] = 1.25, 2.5\n');
  assert.deepEqual(result,{ok:true,result:{durationSeconds:93784,materialGrams:3.75}});
  assert.equal(pythonFunction('parse_gcode_metadata','; filament used [g] = 4\n').code,'SLICER_METADATA_MISSING');
  assert.equal(pythonFunction('parse_gcode_metadata','; estimated printing time (normal mode) = 5s garbage\n; filament used [g] = 4\n').code,'SLICER_METADATA_INVALID');
  assert.equal(pythonFunction('parse_gcode_metadata','; estimated printing time (normal mode) = 5s\n; filament used [g] = NaN\n').code,'SLICER_METADATA_INVALID');
});

test('PrusaSlicer post-processing hooks and changed profile bytes are rejected', async t => {
  const directory=await temporary(t), file=path.join(directory,'profile.ini');
  const bad=Buffer.from('layer_height = 0.2\npost_process = python bad.py\n');await fs.writeFile(file,bad);
  const request={profilePath:file,profileDirectory:directory,profileSha256:sha(bad)};
  assert.equal(pythonFunction('validate_profile',request).code,'POST_PROCESS_FORBIDDEN');
  await fs.writeFile(file,'layer_height = 0.2\n');
  assert.equal(pythonFunction('validate_profile',request).code,'PROFILE_HASH_MISMATCH');
});

test('platform redirects are refused and worker credentials remain on the configured origin', async t => {
  const directory=await temporary(t);let calls=0;
  const worker=new ManufacturingWorker(validateConfig({...baseConfig,workDirectory:directory}),{fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.origin,'http://127.0.0.1:3000');assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{location:'https://unrelated.example/'}});
  }});
  await assert.rejects(worker.cycle(),{code:'REDIRECT_REFUSED'});assert.equal(calls,1);
});

test('download hash mismatch fails the job before the Python engine can run', async t => {
  const directory=await temporary(t);let calls=0,report;
  const worker=new ManufacturingWorker(validateConfig({...baseConfig,workDirectory:directory}),{engine:async()=>{calls++;},fetchImpl:async(url,options)=>{
    if(url.pathname.endsWith('/claim'))return json({job:job()});
    if(url.pathname.endsWith('/download')){
      assert.equal(url.searchParams.get('jobId'),'job-first');assert.equal(options.headers['X-Job-Lease'],'lease-123456789');assert.equal(options.headers['X-Job-Attempt'],'1');
      return new Response('changed model');
    }
    report=JSON.parse(options.body);return json({accepted:true});
  }});
  assert.equal((await worker.cycle()).status,'FAILED');assert.equal(calls,0);assert.equal(report.errorCode,'MODEL_HASH_MISMATCH');
});

test('a lost completion response is retried with the saved key after process restart, without recomputing', async t => {
  const directory=await temporary(t), config=validateConfig({...baseConfig,workDirectory:directory});let computations=0,first=true;const reports=[];
  const fetchImpl=async(url,options)=>{
    if(url.pathname.endsWith('/claim'))return json({job:job()});
    if(url.pathname.endsWith('/download'))return new Response(source);
    reports.push({key:options.headers['Idempotency-Key'],payload:JSON.parse(options.body)});
    if(first){first=false;throw new Error('connection ended after server committed');}return json({accepted:true});
  };
  const engine=async()=>{computations++;return{inputHash:'a'.repeat(64),modelHash:sha(source),profileRevision:null,engineVersion:'test',provenance:'WORKER_OBSERVED'};};
  await assert.rejects(new ManufacturingWorker(config,{fetchImpl,engine}).cycle(),{code:'PLATFORM_UNAVAILABLE'});
  assert.equal((await new ManufacturingWorker(config,{fetchImpl,engine}).cycle()).status,'REPORTED');
  assert.equal(computations,1);assert.equal(reports.length,2);assert.deepEqual(reports[0],reports[1]);
});

test('job mode and allow-listed profile versions prevent sandbox work or wrong-profile slicing', async t => {
  const directory=await temporary(t), worker=new ManufacturingWorker(validateConfig({...baseConfig,workDirectory:directory}),{fetchImpl:async()=>new Response(source)});
  assert.throws(()=>worker.validateJob({...job(),mode:'SANDBOX'}),{code:'JOB_MODE_INVALID'});
  await assert.rejects(worker.compute({...job(),kind:'SLICE_MODEL',profileRevision:2,configSnapshot:{localProfileId:'missing'}}),{code:'PROFILE_NOT_CONFIGURED'});
});

test('Trimesh analyzes actual cube bytes, records volume and applies explicitly confirmed inch units', native, async t => {
  const directory=await temporary(t), modelPath=path.join(directory,'model.stl');await fs.writeFile(modelPath,source);
  const request={...job(),modelPath,jobDirectory:directory};
  const result=python(request);assert.equal(result.ok,true);assert.deepEqual(result.result.geometry.dimensionsMm,[20,20,20]);assert.equal(result.result.geometry.volumeMm3,8000);assert.equal(result.result.geometry.requiresReview,false);
  const inch=python({...request,unit:'inch'});assert.equal(inch.ok,true);assert.deepEqual(inch.result.geometry.dimensionsMm,[508,508,508]);assert.equal(inch.result.geometry.volumeMm3,508**3);
  assert.equal(result.result.printReady,false);
});

test('actual model analysis rejects path escape, bad hash and non-finite STL coordinates', native, async t => {
  const directory=await temporary(t), modelPath=path.join(directory,'model.stl');await fs.writeFile(modelPath,source);
  const request={...job(),modelPath,jobDirectory:directory};
  assert.equal(python({...request,modelHash:'0'.repeat(64)}).error.code,'MODEL_HASH_MISMATCH');
  const child=path.join(directory,'inside');await fs.mkdir(child);
  assert.equal(python({...request,jobDirectory:child}).error.code,'PATH_OUTSIDE_ROOT');
  const malformed=Buffer.from(source.toString().replace(/vertex\s+\S+/, 'vertex nan'));await fs.writeFile(modelPath,malformed);
  assert.equal(python({...request,modelHash:sha(malformed)}).ok,false);
});

test('3MF geometry loads with its declared units and rejects an inconsistent customer unit', native, async t => {
  const directory=await temporary(t),modelPath=path.join(directory,'model.3mf');
  const build=spawnSync(PYTHON,['-c','import trimesh,sys\nm=trimesh.creation.box(extents=[20,20,20])\nopen(sys.argv[1],"wb").write(trimesh.exchange.threemf.export_3MF(m))',modelPath],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);const bytes=await fs.readFile(modelPath);
  const request={...job(),format:'3mf',modelPath,jobDirectory:directory,modelHash:sha(bytes)};
  const result=python(request);assert.equal(result.ok,true);assert.equal(result.result.geometry.volumeMm3,8000);
  assert.equal(python({...request,unit:'inch'}).error.code,'MODEL_UNIT_MISMATCH');
});

test('OR-Tools produces non-overlapping, duration-preserving fixed-device schedules', native, () => {
  const request={kind:'SCHEDULE',inputHash:'a'.repeat(64),modelHash:null,profileRevision:null,configSnapshot:{baseAt:1000000,tasks:[{jobId:'one',deviceId:'p1',durationSeconds:120},{jobId:'two',deviceId:'p1',durationSeconds:60},{jobId:'three',deviceId:'p2',durationSeconds:90}]}};
  const result=python(request);assert.equal(result.ok,true);assert.equal(result.result.schedule.length,3);
  const lane=result.result.schedule.filter(row=>row.deviceId==='p1').sort((a,b)=>a.startAt-b.startAt);assert.ok(lane[1].startAt>=lane[0].endAt);
  for(const row of result.result.schedule){const input=request.configSnapshot.tasks.find(task=>task.jobId===row.jobId);assert.equal(row.endAt-row.startAt,input.durationSeconds*1000);}
  assert.equal(python({...request,configSnapshot:{baseAt:1000000,tasks:[]}}).result.solverStatus,'EMPTY');
});

test('unavailable slicer fails explicitly instead of using an invented estimate', native, async t => {
  const directory=await temporary(t), modelPath=path.join(directory,'model.stl'), profilePath=path.join(directory,'profile.ini'), profile=Buffer.from('layer_height = 0.2\npost_process =\n');
  await fs.writeFile(modelPath,source);await fs.writeFile(profilePath,profile);
  const result=python({...job(),kind:'SLICE_MODEL',modelPath,jobDirectory:directory,profilePath,profileDirectory:directory,profileSha256:sha(profile),prusaSlicerExecutable:'gongzao-not-installed-prusa-slicer'});
  assert.equal(result.ok,false);assert.equal(result.error.code,'SLICER_UNAVAILABLE');
});

test('Node worker can run a real Trimesh computation and return evidence bound to its job', native, async t => {
  const directory=await temporary(t),config=validateConfig({...baseConfig,pythonExecutable:PYTHON,workDirectory:directory});let report;
  const worker=new ManufacturingWorker(config,{fetchImpl:async(url,options)=>{
    if(url.pathname.endsWith('/claim'))return json({job:job()});
    if(url.pathname.endsWith('/download'))return new Response(source);
    report=JSON.parse(options.body);return json({accepted:true});
  }});
  assert.equal((await worker.cycle()).status,'COMPLETED');assert.equal(report.result.modelHash,sha(source));assert.equal(report.result.geometry.volumeMm3,8000);assert.equal(report.result.provenance,'WORKER_OBSERVED');
});

test('installed PrusaSlicer generates actual multi-copy G-code and measured metadata', {skip:native.skip || !process.env.GONGZAO_TEST_PRUSA}, async t => {
  const directory=await temporary(t),modelPath=path.join(directory,'cube.stl'),profilePath=path.join(directory,'profile.ini');
  await fs.writeFile(modelPath,source);
  const saved=spawnSync(process.env.GONGZAO_TEST_PRUSA,['--save',profilePath,'--layer-height','0.2','--first-layer-height','0.2','--filament-diameter','1.75','--filament-density','1.24','--fill-density','15%','--nozzle-diameter','0.4','--bed-shape','0x0,250x0,250x210,0x210','--max-print-height','210','--gcode-flavor','marlin'],{encoding:'utf8',timeout:30000});
  assert.equal(saved.status,0,saved.stderr);const profile=await fs.readFile(profilePath);
  const result=python({...job(),kind:'SLICE_MODEL',quantity:3,profileRevision:1,modelPath,jobDirectory:directory,profilePath,profileDirectory:directory,profileSha256:sha(profile),expectedProfileSha256:sha(profile),prusaSlicerExecutable:process.env.GONGZAO_TEST_PRUSA});
  assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.result.engineVersion,/^PrusaSlicer-/);assert.ok(result.result.durationSeconds>0);assert.ok(result.result.materialGrams>0);assert.equal(result.result.profileSha256,sha(profile));assert.equal(result.result.quantity,3);assert.equal(result.result.printReady,false);
  const artifact=await fs.readFile(path.join(directory,'toolpath.gcode'));assert.equal(result.result.artifactHash,sha(artifact));assert.equal(result.result.artifactBytes,artifact.length);
});
