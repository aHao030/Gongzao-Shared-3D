import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { ADMIN_AUDIT_LIMIT, createAdminControl } from '../services/platform/admin-control.mjs';

const grant = (subject, role, expectedRevision, requestId = 'grant-' + subject) => ({
  action: 'member.grant', subject, role, expectedRevision, requestId
});
const open = t => {
  const store = new SQLiteStore(':memory:');
  t.after(() => store.close());
  return { store, control: createAdminControl({ store, bootstrapOwnerId: 'root-account' }) };
};

test('bootstrap is fail-closed; delegated roles apply to verified subjects and cannot reassign the owner', async t => {
  const { store, control } = open(t);
  const locked = createAdminControl({ store, bootstrapOwnerId: '' });
  assert.equal((await locked.resolve('root-account')).authorized, false);
  await assert.rejects(locked.overview('root-account'), { status: 503 });
  await assert.rejects(control.overview(null), { status: 401 });
  await assert.rejects(control.overview('merchant-account'), { status: 403 });
  await assert.rejects(control.execute('root-account', grant('root-account','operator',0)), { code:'ADMIN_PROTECTED_OWNER' });
  await assert.rejects(control.execute('root-account', grant('merchant-account','owner',0)), { code:'ADMIN_INVALID_ROLE' });
  const assign = grant('merchant-account','operator',0);
  assert.equal((await control.execute('root-account', assign)).revision, 1);
  assert.equal((await control.execute('root-account', assign)).replayed, true);
  await assert.rejects(control.execute('root-account', {...assign, role:'auditor'}), { code:'ADMIN_REQUEST_CONFLICT' });
  await assert.rejects(control.execute('merchant-account',grant('someone','auditor',1)), { status:403 });
  assert.deepEqual((await control.overview('merchant-account')).members, []);
  await control.execute('root-account', grant('reader-account','auditor',1));
  await assert.rejects(control.execute('reader-account',{action:'node.create', name:'A',purpose:'监测',expectedRevision:2,requestId:'not-allowed'}),{status:403});
  await control.execute('root-account',{action:'member.revoke',subject:'merchant-account',expectedRevision:2,requestId:'revoke-member'});
  await assert.rejects(control.overview('merchant-account'),{status:403});
  assert.equal((await locked.resolve('reader-account')).authorized,false);
  const handover = createAdminControl({ store, bootstrapOwnerId:'successor' });
  assert.equal((await handover.resolve('root-account')).authorized,false);
  assert.equal((await handover.resolve('successor')).role,'owner');
  assert.equal((await store.load('root-account')).members,undefined);
});

test('heartbeat and replays do not regenerate a bearer, bump the operator view revision or reveal credentials in audit', async t => {
  const { store,control } = open(t);
  const action = { action:'node.create',name:'测试渲染机',purpose:'运算',expectedRevision:0,requestId:'create-node' };
  const created = await control.execute('root-account',action);
  assert.ok(created.credential);
  const [fresh, replay] = await Promise.all([control.heartbeat(created.credential,{agentVersion:'1.0'}),control.execute('root-account',action)]);
  assert.equal(fresh.nodeId,created.node.id);
  assert.equal(replay.credential,undefined);
  const reading = await control.overview('root-account');
  assert.equal(reading.revision,1);
  assert.equal(reading.nodes[0].status,'ONLINE');
  assert.equal(reading.audit.length,1);
  const stored = store.db.prepare('SELECT data FROM platform_admin_control WHERE id=1').get().data;
  assert.ok(!stored.includes(created.credential));
  for (const hidden of ['credential','tokenHash','requestId','digest']) assert.ok(!JSON.stringify(reading).includes('"'+hidden+'"'));
  assert.ok(!Object.hasOwn(await store.load('root-account'),'nodes'));
  await control.execute('root-account',{action:'node.revoke',nodeId:created.node.id,expectedRevision:1,requestId:'revoke-node'});
  await assert.rejects(control.heartbeat(created.credential,{agentVersion:'1.0'}),{status:401});
});

test('intake has a required reason, survives new instances, and retains accountable windowed history', async t => {
  const { store, control } = open(t);
  await control.execute('root-account',grant('operator-id','operator',0));
  await control.execute('root-account',grant('auditor-id','auditor',1));
  const pause = { action:'intake.set', paused:true, reason:'设备检修', expectedRevision:2, requestId:'pause-first' };
  await assert.rejects(control.execute('auditor-id', pause), { status:403 });
  await assert.rejects(control.execute('operator-id', {...pause,reason:' '}), { status:400 });
  await control.execute('operator-id', pause);
  assert.deepEqual(await createAdminControl({store,bootstrapOwnerId:null}).intakeStatus(),{paused:true,reason:'设备检修'});
  for (let i=0; i<ADMIN_AUDIT_LIMIT; i++) {
    await control.execute('operator-id',{action:'intake.set',paused:i%2===1,reason:'班次检查',expectedRevision:i+3,requestId:'intake-window-'+i});
  }
  const result = await control.overview('auditor-id');
  assert.deepEqual(result.members, []);
  assert.equal(result.auditDropped,3);
  assert.equal(result.audit.length,ADMIN_AUDIT_LIMIT);
  assert.equal(result.audit[0].revision,ADMIN_AUDIT_LIMIT+3);
  assert.equal(result.audit.at(-1).revision,4);
  assert.equal(result.audit.at(-1).intake.paused,false);
  await assert.rejects(control.execute('operator-id',pause),{code:'ADMIN_REVISION_CONFLICT'});
});

// D1 interface and generated SQL are exercised against SQLite. The barrier
// forces a competing request to commit after an operator read but before its CAS.
test('D1 migration and CAS recheck revoked privileges on an in-flight operator action', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  sqlite.exec(await readFile(new URL('../drizzle/0001_platform_admin_control.sql',import.meta.url),'utf8'));
  let blocked = false, allowWrite, arrived;
  const readied = new Promise(resolve => { arrived = resolve; });
  const pause = new Promise(resolve => { allowWrite = resolve; });
  const d1 = {
    withSession(consistency) { assert.equal(consistency,'first-primary'); return this; },
    prepare(sql) {
      assert.doesNotMatch(sql,/^(?:CREATE|ALTER)/);
      const statement=sqlite.prepare(sql);
      return { first:async()=>statement.get(), bind:(...args)=>({run:async()=>{
        if(blocked && sql.startsWith('UPDATE') && args[1].includes('pending-operator')) {
          arrived(); await pause;
        }
        return {meta:{changes:statement.run(...args).changes}};
      }}) };
    }
  };
  const control=createAdminControl({store:{kind:'d1',db:d1},bootstrapOwnerId:'root-account'});
  await control.execute('root-account',grant('operator-id','operator',0));
  blocked=true;
  const ongoing=control.execute('operator-id',{action:'intake.set',paused:true,reason:'test',requestId:'pending-operator',expectedRevision:1});
  await readied;
  await control.execute('root-account',{action:'member.revoke',subject:'operator-id',requestId:'revoke-access',expectedRevision:1});
  allowWrite();
  await assert.rejects(ongoing,{status:403});
  assert.deepEqual(await control.intakeStatus(),{paused:false});
  assert.equal((await control.overview('root-account')).audit.length,2);
});

test('an already-open local request cannot mutate after an installation owner handover', async t => {
  const {store,control} = open(t);
  let current = 'root-account';
  const pending = createAdminControl({store,bootstrapOwnerId:current,verifyBootstrap:()=>current});
  assert.equal((await pending.resolve(current)).role,'owner');
  current = 'next-account';
  await assert.rejects(pending.execute('root-account',grant('staff','operator',0)),{code:'ADMIN_BOOTSTRAP_CHANGED'});
  assert.equal((await control.overview('root-account')).revision,0);
});

test('internal worker binding reads the clocked lifecycle state and fails closed for missing enrollment', async t => {
  const {store} = open(t);
  let now=200000;
  const control=createAdminControl({store,bootstrapOwnerId:'root-account',clock:()=>now});
  const joined=await control.execute('root-account',{action:'node.create',name:'测试机',purpose:'计算',expectedRevision:0,requestId:'node-enroll'});
  assert.equal(await control.nodeStatus(joined.node.id),'NEVER_CONNECTED');
  assert.equal(await control.nodeStatus('unknown-node'),null);
  assert.equal(await createAdminControl({store}).nodeStatus(joined.node.id),null);
  await control.heartbeat(joined.credential,{agentVersion:'0.9.4'});
  assert.equal(await control.nodeStatus(joined.node.id),'ONLINE');
  now+=90001;
  assert.equal(await control.nodeStatus(joined.node.id),'OFFLINE');
  await control.execute('root-account',{action:'node.disable',nodeId:joined.node.id,expectedRevision:1,requestId:'node-disable'});
  assert.equal(await control.nodeStatus(joined.node.id),'DISABLED');
  await control.execute('root-account',{action:'node.revoke',nodeId:joined.node.id,expectedRevision:2,requestId:'node-revoke'});
  assert.equal(await control.nodeStatus(joined.node.id),'REVOKED');
});
