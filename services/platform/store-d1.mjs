import { createWorkspace } from './core.mjs';
import { ApiError, sha256 } from './geometry.mjs';

export class D1Store {
  constructor(db, bucket) { this.db=db;this.bucket=bucket;this.kind='d1'; }
  async load(owner) {
    const row=await this.db.prepare('SELECT data FROM platform_workspaces WHERE owner = ?').bind(owner).first();
    return row ? JSON.parse(row.data) : createWorkspace();
  }
  async transact(owner, operation, pendingFile) {
    let fileWritten=false;
    for(let attempt=0;attempt<10;attempt++) {
      const row=await this.db.prepare('SELECT revision, data FROM platform_workspaces WHERE owner = ?').bind(owner).first();
      const current=row?JSON.parse(row.data):createWorkspace();
      const outcome=await operation(current);
      if(outcome.replayed)return outcome;
      const data=JSON.stringify(outcome.workspace);
      if(new TextEncoder().encode(data).byteLength>1024*1024)throw new ApiError(413,'WORKSPACE_CAPACITY','工作空间已达到本阶段容量，请联系维护者扩容');
      if(pendingFile&&!fileWritten){await this.putFile(owner,pendingFile.id,pendingFile.bytes);fileWritten=true;}
      const result=row
        ?await this.db.prepare('UPDATE platform_workspaces SET revision = ?, data = ?, updated_at = ? WHERE owner = ? AND revision = ?').bind(outcome.workspace.revision,data,Date.now(),owner,row.revision).run()
        :await this.db.prepare('INSERT OR IGNORE INTO platform_workspaces (owner,revision,data,updated_at) VALUES (?,?,?,?)').bind(owner,outcome.workspace.revision,data,Date.now()).run();
      if(result.meta.changes===1)return outcome;
    }
    throw new ApiError(409,'CONCURRENT_UPDATE','其他请求正在更新订单，请使用同一请求标识重试');
  }
  async blobKey(owner,id) { return (await sha256(new TextEncoder().encode(owner)))+'/'+id; }
  async putFile(owner,id,bytes) { await this.bucket.put(await this.blobKey(owner,id),bytes,{httpMetadata:{contentType:'application/octet-stream'}}); }
  async getFile(owner,id) { const value=await this.bucket.get(await this.blobKey(owner,id));return value?new Uint8Array(await value.arrayBuffer()):null; }
}
