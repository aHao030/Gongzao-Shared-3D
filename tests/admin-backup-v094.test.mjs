import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSnapshot, verifySnapshot, restoreSnapshot } from '../tools/admin-backup.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { createLocalAuth } from '../services/platform/auth-local.mjs';
import { setLocalBootstrap, localBootstrapOwner } from '../services/platform/admin-bootstrap-local.mjs';

async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'gongzao-backup-test-'));
  const dbFile=path.join(dir,'live.sqlite');
  const store=new SQLiteStore(dbFile);
  createLocalAuth(store,{authConfig:{}});
  store.db.exec('PRAGMA wal_autocheckpoint=0');
  const subject='account_00000000-0000-4000-8000-000000000001';
  store.db.prepare("INSERT INTO auth_users(id,owner,email,display_name,provider,created_at) VALUES(?,?,?,'运维测试','email',1)").run(subject,'owner-test','fixture@example.test');
  setLocalBootstrap(store.db,{action:'set',subject,env:{}});
  const bytes=Uint8Array.from([12,31,54,120]);
  store.db.prepare('INSERT INTO local_model_files(owner,id,bytes) VALUES (?,?,?)').run('owner-test','copied-model',bytes);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  return {store,dbFile,dir,subject,bytes,backupDir:path.join(dir,'快照'),restored:path.join(dir,'恢复副本')};
}

test('online SQLite snapshot includes committed WAL, account authorization and model bytes while preserving the running source',async t=>{
  const f=await fixture(t);
  assert.ok((await stat(f.dbFile+'-wal')).size>0);
  const saved=await createSnapshot({database:f.dbFile,out:f.backupDir});
  assert.match(saved.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual((await readdir(f.backupDir)).sort(),['gongzao-backup.private.json','platform.sqlite']);
  const checked=await verifySnapshot({from:f.backupDir,expectedHash:saved.sha256});
  assert.equal(checked.bytes,saved.bytes);
  setLocalBootstrap(f.store.db,{action:'clear',previous:f.subject,env:{}});
  f.store.db.prepare('DELETE FROM local_model_files WHERE id=?').run('copied-model');
  const copy=await restoreSnapshot({from:f.backupDir,out:f.restored,expectedHash:saved.sha256});
  const restoredDb=new DatabaseSync(copy.database,{readOnly:true});
  try {
    assert.equal(localBootstrapOwner({db:restoredDb},{}),f.subject);
    assert.deepEqual(restoredDb.prepare('SELECT bytes FROM local_model_files WHERE id=?').get('copied-model').bytes,f.bytes);
    assert.equal(localBootstrapOwner(f.store,{}),null);
    assert.equal(await f.store.getFile('owner-test','copied-model'),null);
  } finally {restoredDb.close();}
  if(process.platform!=='win32'){
    assert.equal((await stat(f.backupDir)).mode & 0o077,0);
    assert.equal((await stat(copy.database)).mode & 0o077,0);
  }
});

test('snapshot integrity and output exclusivity protect the existing deployment and detect wrong backups',async t=>{
  const f=await fixture(t);
  const saved=await createSnapshot({database:f.dbFile,out:f.backupDir});
  await assert.rejects(createSnapshot({database:f.dbFile,out:f.backupDir}),/已存在/);
  await assert.rejects(restoreSnapshot({from:f.backupDir,out:f.dir}),/已存在/);
  await assert.rejects(verifySnapshot({from:f.backupDir,expectedHash:'1'.repeat(64)}),/不匹配/);
  const filename=path.join(f.backupDir,'platform.sqlite');
  await writeFile(filename+'-wal',Buffer.alloc(8));
  await assert.rejects(verifySnapshot({from:f.backupDir}),/额外/);
  await rm(filename+'-wal');
  const data=await readFile(filename); data[data.length-1]^=1; await writeFile(filename,data);
  await assert.rejects(restoreSnapshot({from:f.backupDir,out:f.restored,expectedHash:saved.sha256}),/SHA-256/);
  await assert.rejects(stat(f.restored),{code:'ENOENT'});
  assert.equal(localBootstrapOwner(f.store,{}),f.subject);
});
