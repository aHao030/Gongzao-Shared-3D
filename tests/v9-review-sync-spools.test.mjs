import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlatformServer } from '../services/platform/local.mjs';

// Real loopback provider HTTP, platform HTTP, account sessions and SQLite. The
// upstream data is a fixture; no commercial service or real inventory is used.
async function harness(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'gongzao-sync-review-v9-'));
  let calls=0, offline=false, rows=[{id:1,remaining_weight:800,filament:{name:'原始库存',material:'PLA'}}];
  const upstream=http.createServer((req,res)=>{
    calls++;
    res.setHeader('Content-Type','application/json');
    if(offline){res.writeHead(503);res.end('{}');return;}
    const offset=Number(new URL(req.url,'http://localhost').searchParams.get('offset')||0);
    res.end(JSON.stringify(rows.slice(offset,offset+100)));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+upstream.address().port;
  let instance,origin,integrationConfig={};
  async function start(){
    instance=createPlatformServer({dbPath:path.join(directory,'platform.sqlite'),authConfig:{},workerAccessConfig:{workers:[]},integrationConfig});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
    origin='http://127.0.0.1:'+instance.server.address().port;
  }
  async function stop(){
    if(!instance)return;
    await new Promise(resolve=>instance.server.close(resolve));instance.store.close();instance=null;
  }
  t.after(async()=>{await stop();await new Promise(resolve=>upstream.close(resolve));await rm(directory,{recursive:true,force:true});});
  await start();
  async function request(route,{cookie,payload,key=randomUUID()}={}){
    const response=await fetch(origin+route,{method:payload===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(payload===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    return {status:response.status,headers:response.headers,data:await response.json()};
  }
  async function account(){
    const registered=await request('/api/auth/register',{payload:{email:'sync-'+randomUUID()+'@example.invalid',password:'Review-sync-spools-only-2026'}});
    success(registered);
    const cookie=registered.headers.getSetCookie().find(value=>value.startsWith('coforge_account=')).split(';')[0];
    const ownerId=success(await request('/api/v2/session',{cookie})).user.id;
    success(await request('/api/v2/merchant/enroll',{cookie,payload:{name:'库存审查工坊'}}));
    return {cookie,ownerId};
  }
  const a=await account(),b=await account();
  integrationConfig={ownerId:a.ownerId,allowPrivateOrigins:[providerOrigin],services:{spoolman:{baseUrl:providerOrigin}}};
  await stop();await start();
  return {a,b,request,get store(){return instance.store;},get calls(){return calls;},set rows(value){rows=value;},set offline(value){offline=value;},
    sync:(account,key,payload={})=>request('/api/v2/merchant/integrations/sync-spools',{cookie:account.cookie,payload,key}),
    restart:async()=>{await stop();await start();}};
}
function success(response){assert.ok([200,201].includes(response.status),JSON.stringify(response.data));return response.data;}
function receipt(data){const {requestId,operations,replayed,...saved}=data;return saved;}

test('review v0.9 sync: same request replays its saved observation after time/data changes and an offline restart',async t=>{
  const h=await harness(t),key=randomUUID();
  const first=success(await h.sync(h.a,key));
  assert.equal(first.replayed,false);assert.equal(h.calls,1);
  const firstRevision=first.operations.revision;
  await delay(5);
  assert.ok(Date.now()>first.observedAt,'use an actual later wall-clock time');
  h.rows=[{id:1,remaining_weight:300,filament:{name:'上游已经变化',material:'PLA'}}];
  const repeated=success(await h.sync(h.a,key));
  assert.equal(repeated.replayed,true);assert.deepEqual(receipt(repeated),receipt(first));
  assert.equal(repeated.operations.revision,firstRevision);assert.equal(h.calls,1);
  await h.restart();h.offline=true;
  const restarted=success(await h.sync(h.a,key));
  assert.equal(restarted.replayed,true);assert.deepEqual(receipt(restarted),receipt(first));
  assert.equal(restarted.operations.revision,firstRevision);assert.equal(h.calls,1);
  assert.equal((await h.sync(h.a,randomUUID())).status,502);
  assert.equal(h.calls,2,'a genuinely new sync still reads the provider');
});

test('review v0.9 sync: owner and original-request boundaries hold before returning cached private observations',async t=>{
  const h=await harness(t),key=randomUUID();
  success(await h.sync(h.a,key));
  assert.equal((await h.sync(h.a,key,{ownerId:h.b.ownerId})).status,400);
  assert.equal((await h.sync(h.a,key,{spools:[]})).status,400);
  assert.equal((await h.sync(h.b,key)).status,403);
  assert.equal((await h.store.load(h.b.ownerId)).operations?.spools?.length??0,0);
  assert.equal(h.calls,1);
  const save={type:'save-spool',payload:{name:'沙盒库存',material:'PLA',remainingGrams:10,costCentsPerKg:10000,expectedRevision:0,mode:'SANDBOX'}};
  const conflict=await h.request('/api/v2/merchant/operations/commands',{cookie:h.a.cookie,payload:save,key});
  assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'IDEMPOTENCY_CONFLICT');
  const otherKey=randomUUID();
  success(await h.request('/api/v2/merchant/operations/commands',{cookie:h.a.cookie,payload:save,key:otherKey}));
  const reverse=await h.sync(h.a,otherKey);
  assert.equal(reverse.status,409);assert.equal(reverse.data.error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(h.calls,1,'conflicting original requests fail before another provider read');
});

test('review v0.9 sync: concurrent same-key observations survive a forced SQLite CAS retry with one saved receipt',async t=>{
  const h=await harness(t),key=randomUUID(),transact=h.store.transact.bind(h.store);
  let arrivals=0,callbacks=0,release;
  const barrier=new Promise(resolve=>{release=resolve;});
  h.store.transact=(ownerId,operation)=>transact(ownerId,async workspace=>{
    callbacks++;
    if(arrivals<2){arrivals++;if(arrivals===2)release();await barrier;}
    assert.equal(h.calls,2,'CAS retries must not perform provider I/O');
    return operation(workspace);
  });
  const results=await Promise.all([h.sync(h.a,key),h.sync(h.a,key)]);
  const a=success(results[0]),b=success(results[1]);
  assert.ok(callbacks>2,'fixture must force a stale version and retry');
  assert.deepEqual(receipt(a),receipt(b));assert.notEqual(a.replayed,b.replayed);
  assert.equal(h.calls,2);
  const state=await h.store.load(h.a.ownerId);
  assert.equal(state.operations.spools.length,1);assert.equal(state.operations.spools[0].revision,1);
  assert.equal(state.operations.events.filter(event=>event.type==='SPOOLMAN_SYNCED').length,1);
  assert.equal(Object.keys(state.operations.ledger).length,1);
});

test('review v0.9 sync: stored observation receipts remain subject to the final workspace size limit',async t=>{
  const h=await harness(t);
  await h.store.transact(h.a.ownerId,workspace=>{
    const next={...workspace,revision:workspace.revision+1,reviewPadding:''};
    next.reviewPadding='x'.repeat(1024*1024-512-Buffer.byteLength(JSON.stringify(next)));
    return {workspace:next,result:{},replayed:false};
  });
  const before=await h.store.load(h.a.ownerId),response=await h.sync(h.a,randomUUID());
  assert.equal(response.status,413);assert.equal(response.data.error.code,'WORKSPACE_CAPACITY');
  assert.deepEqual(await h.store.load(h.a.ownerId),before,'failed sync must not partially import inventory or a replay receipt');
});
