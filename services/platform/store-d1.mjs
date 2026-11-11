import { createWorkspace } from './core.mjs';
import { decodeWorkspace, encodeWorkspace } from './workspace-storage.mjs';
import { workspaceWriteSQL, inspectOrderConflictSQL, pauseBlockedCurrentRevision } from './order-intake-store.mjs';
import { ApiError, sha256 } from './geometry.mjs';

export class D1Store {
  constructor(db, bucket) { this.db=db;this.bucket=bucket;this.kind='d1'; }
  async load(owner) {
    const row=await this.db.prepare('SELECT data FROM platform_workspaces WHERE owner = ?').bind(owner).first();
    return row ? await decodeWorkspace(row.data) : createWorkspace();
  }
  async transact(owner, operation, pendingFile, { requireOpenIntake = false } = {}) {
    const db = requireOpenIntake && this.db.withSession ? this.db.withSession('first-primary') : this.db;
    let fileWritten=false;
    for(let attempt=0;attempt<10;attempt++) {
      const row=await db.prepare('SELECT revision, data FROM platform_workspaces WHERE owner = ?').bind(owner).first();
      const current=row?await decodeWorkspace(row.data):createWorkspace();
      const outcome=await operation(current);
      if(outcome.replayed)return outcome;
      const data = await encodeWorkspace(outcome.workspace);
      if(pendingFile&&!fileWritten){await this.putFile(owner,pendingFile.id,pendingFile.bytes);fileWritten=true;}
      const sql = workspaceWriteSQL(Boolean(row), requireOpenIntake);
      const args = row ? [outcome.workspace.revision, data, Date.now(), owner, row.revision]
        : [owner, outcome.workspace.revision, data, Date.now()];
      const result = await db.prepare(sql).bind(...args).run();
      if (requireOpenIntake && !result.meta.changes) {
        const current = await db.prepare(inspectOrderConflictSQL).bind(owner).first();
        if (pauseBlockedCurrentRevision(current, row)) {
          throw new ApiError(503, 'ORDER_INTAKE_PAUSED', '平台已暂停受理新订单，请稍后再试。已有订单可继续履约和申请售后。');
        }
      }
      if(result.meta.changes===1)return outcome;
    }
    throw new ApiError(409,'CONCURRENT_UPDATE','其他请求正在更新订单，请使用同一请求标识重试');
  }
  async blobKey(owner,id) { return (await sha256(new TextEncoder().encode(owner)))+'/'+id; }
  async putFile(owner,id,bytes) { await this.bucket.put(await this.blobKey(owner,id),bytes,{httpMetadata:{contentType:'application/octet-stream'}}); }
  async getFile(owner,id) { const value=await this.bucket.get(await this.blobKey(owner,id));return value?new Uint8Array(await value.arrayBuffer()):null; }
}
