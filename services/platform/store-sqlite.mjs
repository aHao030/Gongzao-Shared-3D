import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createWorkspace } from './core.mjs';
import { decodeWorkspace, encodeWorkspace } from './workspace-storage.mjs';
import { workspaceWriteSQL, inspectOrderConflictSQL, pauseBlockedCurrentRevision } from './order-intake-store.mjs';
import { ApiError } from './geometry.mjs';

export class SQLiteStore {
  constructor(filename) {
    this.pendingWrites = new Map();
    if (filename && filename !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') {
        // SQLite derives journal permissions from the database. Create new files
        // privately without chmod'ing a pre-existing deployment's shared file.
        try {
          fs.closeSync(fs.openSync(filename, 'wx', 0o600));
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          // A dangling link is not an existing database to reuse.
          fs.statSync(filename);
        }
      }
    }
    this.db=new DatabaseSync(filename);this.kind='sqlite';
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    // Explicit local initialization; hosted D1 uses tracked migrations instead.
    this.db.exec(`CREATE TABLE IF NOT EXISTS platform_workspaces(owner TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS local_sessions(token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS local_model_files(owner TEXT NOT NULL,id TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(owner,id));`);
  }
  async load(owner) { const row=this.db.prepare('SELECT data FROM platform_workspaces WHERE owner=?').get(owner);return row?await decodeWorkspace(row.data):createWorkspace(); }
  async transact(owner, operation, pendingFile, { queueQuote = false, requireOpenIntake = false } = {}) {
    // Quotations are pure computations. Queue them per owner to avoid serializing
    // large histories for speculative writes that would lose the revision check.
    // Other operations, including remote inventory reads, keep their CAS flow.
    if (!queueQuote) return this.writeWorkspace(owner, operation, pendingFile, requireOpenIntake);
    const previous = this.pendingWrites.get(owner) ?? Promise.resolve();
    const transaction = previous.then(() => this.writeWorkspace(owner, operation, pendingFile, requireOpenIntake));
    const tail = transaction.catch(() => {});
    this.pendingWrites.set(owner, tail);
    try {
      return await transaction;
    } finally {
      if (this.pendingWrites.get(owner) === tail) this.pendingWrites.delete(owner);
    }
  }
  async writeWorkspace(owner, operation, pendingFile, requireOpenIntake) {
    for(let attempt=0;attempt<40;attempt++) {
      const row=this.db.prepare('SELECT revision,data FROM platform_workspaces WHERE owner=?').get(owner);
      const current=row?await decodeWorkspace(row.data):createWorkspace();
      const outcome=await operation(current);if(outcome.replayed)return outcome;
      const data = await encodeWorkspace(outcome.workspace);
      this.db.exec('BEGIN IMMEDIATE');
      try {
      const sql = workspaceWriteSQL(Boolean(row), requireOpenIntake);
      const args = row ? [outcome.workspace.revision, data, Date.now(), owner, row.revision]
        : [owner, outcome.workspace.revision, data, Date.now()];
      const result = this.db.prepare(sql).run(...args);
      if (requireOpenIntake && !result.changes && pauseBlockedCurrentRevision(this.db.prepare(inspectOrderConflictSQL).get(owner), row)) {
        throw new ApiError(503, 'ORDER_INTAKE_PAUSED', '平台已暂停受理新订单，请稍后再试。已有订单可继续履约和申请售后。');
      }
      if(result.changes===1){
        if(pendingFile)this.db.prepare('INSERT OR IGNORE INTO local_model_files(owner,id,bytes) VALUES (?,?,?)').run(owner,pendingFile.id,pendingFile.bytes);
        this.db.exec('COMMIT');return outcome;
      }
      this.db.exec('ROLLBACK');
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }
    throw new ApiError(409,'CONCURRENT_UPDATE','并发更新冲突，请使用同一请求标识重试');
  }
  async putFile(owner,id,bytes) { this.db.prepare('INSERT OR IGNORE INTO local_model_files(owner,id,bytes) VALUES (?,?,?)').run(owner,id,bytes); }
  async getFile(owner,id) { return this.db.prepare('SELECT bytes FROM local_model_files WHERE owner=? AND id=?').get(owner,id)?.bytes ?? null; }
  saveSession(hash,owner,expires) { this.db.prepare('INSERT INTO local_sessions(token_hash,owner,expires_at) VALUES (?,?,?)').run(hash,owner,expires); }
  getSession(hash,now=Date.now()) { return this.db.prepare('SELECT owner FROM local_sessions WHERE token_hash=? AND expires_at>?').get(hash,now)?.owner ?? null; }
  close(){this.db.close();}
}
