import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { createLocalAuth } from '../services/platform/auth-local.mjs';
import { localBootstrapOwner, localBootstrapStatus, setLocalBootstrap, localBootstrapHistory } from '../services/platform/admin-bootstrap-local.mjs';
import { openExistingAccountDatabase, findAccounts } from '../tools/admin-access.mjs';
import { permittedUpdatePath } from '../tools/update-local.mjs';

const cli = fileURLToPath(new URL('../tools/admin-access.mjs',import.meta.url));
const password = 'private-test-password-only';
function createFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(),'coforge-admin-access-'));
  const filename = path.join(dir,'账号 2.sqlite');
  const store = new SQLiteStore(filename);
  const auth = createLocalAuth(store,{authConfig:{}});
  t.after(() => { store.close(); rmSync(dir,{recursive:true,force:true}); });
  async function register(email) {
    const request = new Request('http://localhost/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const response = await auth.handle(request); assert.equal(response.status,201);
    return (await response.json()).user.id;
  }
  return {dir,filename,store,register};
}
function runCli(filename,...args) {
  const env = {...process.env}; delete env.GONGZAO_ADMIN_OWNER;
  return spawnSync(process.execPath,[cli,...args,'--db',filename],{encoding:'utf8',env});
}

test('operator selects an existing account in the specified database; mailbox and workspace do not grant a role',async t=>{
  const a=createFixture(t), b=createFixture(t);
  const first=await a.register('first@example.test'), selected=await a.register('responsible@example.test');
  assert.equal(localBootstrapOwner(a.store,{}),null);
  assert.deepEqual(findAccounts(a.store.db,' RESPONSIBLE@example.test ').map(r=>r.id),[selected]);
  const workspaceOwner=a.store.db.prepare('SELECT owner FROM auth_users WHERE id=?').get(selected).owner;
  for(const wrong of ['responsible@example.test',workspaceOwner]) {
    assert.throws(()=>setLocalBootstrap(a.store.db,{action:'set',subject:wrong,env:{}}));
  }
  const command=runCli(a.filename,'set','--id',selected);
  assert.equal(command.status,0,command.stderr);
  assert.equal(localBootstrapOwner(a.store,{}),selected);
  assert.notEqual(localBootstrapOwner(a.store,{}),first);
  assert.equal(localBootstrapOwner(b.store,{}),null);
  assert.throws(()=>setLocalBootstrap(b.store.db,{action:'set',subject:selected,env:{}}),/没有找到/);
  const reopened=openExistingAccountDatabase(a.filename,true);
  try {assert.equal(localBootstrapOwner(reopened,{}),selected);} finally {reopened.db.close();}
  const missing=path.join(a.dir,'mistyped.sqlite');
  const bad=runCli(missing,'set','--id',selected);
  assert.notEqual(bad.status,0); assert.equal(existsSync(missing),false);
});

test('handover, recovery after loss of the previous account, revocation and environment override fail closed',async t=>{
  const {store,register}=createFixture(t);
  const one=await register('first@example.test'), two=await register('second@example.test');
  const change=(action,subject,previous)=>setLocalBootstrap(store.db,{action,subject,previous,env:{}});
  change('set',one);
  assert.equal(change('set',one).changed,false);
  assert.throws(()=>change('set',two),/已有首管/);
  assert.throws(()=>change('replace',two,two),/不一致/);
  assert.equal(localBootstrapOwner(store,{GONGZAO_ADMIN_OWNER:two}),two);
  assert.equal(localBootstrapOwner(store,{GONGZAO_ADMIN_OWNER:'bad'}),null);
  assert.throws(()=>setLocalBootstrap(store.db,{action:'set',subject:two,env:{GONGZAO_ADMIN_OWNER:one}}),/环境/);
  store.db.prepare('DELETE FROM auth_users WHERE id=?').run(one);
  assert.equal(localBootstrapOwner(store,{}),null);
  assert.equal(localBootstrapStatus(store.db,{}).stored,one);
  change('replace',two,one);
  assert.equal(localBootstrapOwner(store,{}),two);
  assert.throws(()=>change('clear',undefined,one),/不一致/);
  change('clear',undefined,two);
  assert.equal(localBootstrapOwner(store,{}),null);
  const history=localBootstrapHistory(store.db);
  assert.deepEqual(history.map(x=>x.action),['clear','replace','set']);
  assert.ok(history.every(row=>Object.keys(row).every(k=>['sequence','changed_at','action','old_subject','new_subject'].includes(k))));
});

test('an email lookup never selects an arbitrary external login and installation files keep deployment data private',async t=>{
  const {store,filename,register}=createFixture(t), subject=await register('candidate@example.test');
  const add=store.db.prepare("INSERT INTO auth_users(id,owner,provider,issuer,subject,external_email,email_verified,display_name,created_at) VALUES (?,?, 'oidc', ?, ?, 'candidate@example.test', ?, '第三方', ?)");
  add.run('account_00000000-0000-4000-8000-000000000001','workspace-a','issuer-a','subject-a',1,1);
  add.run('account_00000000-0000-4000-8000-000000000002','workspace-b','issuer-b','subject-b',0,2);
  const found=findAccounts(store.db,'candidate@example.test');
  assert.equal(found.length,2); assert.ok(found.some(x=>x.id===subject));
  assert.ok(!found.some(x=>x.id.endsWith('000002')));
  const result=runCli(filename,'lookup','--email','candidate@example.test');
  assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes(subject));
  assert.ok(!result.stdout.includes(password));
  assert.equal(localBootstrapOwner(store,{}),null);
  assert.equal(permittedUpdatePath('ADMIN-WINDOWS.cmd'),true);
  assert.equal(permittedUpdatePath('tools/admin-access.mjs'),true);
  for(const name of ['data/platform.sqlite','server-agent.private.json','secrets/server-agent.json']) assert.equal(permittedUpdatePath(name),false);
});
