import fs from 'node:fs/promises';
import { isServerNodeId } from '../services/platform/admin-nodes.mjs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function createWorkerConfig({ ownerId, serverNodeId, directory = '.', platformOrigin = 'http://127.0.0.1:3000', now = Date.now() }) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 300 || /[\u0000-\u001f\u007f]/.test(ownerId)) throw new Error('需要从已登录的 /api/v2/session 获取账号 user.id');
  if (serverNodeId !== undefined && !isServerNodeId(serverNodeId)) throw new Error('请填写管理员后台显示的完整节点 ID。');
  const url = new URL(platformOrigin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('平台地址必须为 HTTPS 或本机 HTTP origin');
  const workerToken = randomBytes(32).toString('base64url'), workerId = 'manufacturing-' + randomBytes(6).toString('hex');
  const kinds = ['ANALYZE_MODEL','SLICE_MODEL','SCHEDULE'];
  const serverFile = path.resolve(directory, 'worker-access.config.json'), workerFile = path.resolve(directory, 'worker.config.json');
  const server = { workers: [{ ownerId, workerId, enabled: true, kinds, ...(serverNodeId ? { serverNodeId } : {}), tokenHash: createHash('sha256').update(workerToken).digest('hex'), expiresAt: now + 30 * 86400000 }] };
  const worker = { platformOrigin: url.origin, workerToken, pythonExecutable: 'python3', pollSeconds: 5, kinds,
    workDirectory: 'data/manufacturing-worker', prusaSlicerExecutable: 'prusa-slicer', maxTaskSeconds: 240, profiles: {} };
  await fs.mkdir(path.dirname(serverFile), { recursive: true });
  await fs.writeFile(serverFile, JSON.stringify(server, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { await fs.writeFile(workerFile, JSON.stringify(worker, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { await fs.unlink(serverFile); throw error; }
  return { serverFile, workerFile, workerId, ...(serverNodeId ? { serverNodeId } : {}), expiresAt: server.workers[0].expiresAt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const usage = 'node tools/create-worker-config.mjs --owner ID [--directory PATH] [--origin URL] [--server-node NODE_ID]';
  try {
    if (args.length === 1 && args[0] === '--help') console.log(usage);
    else {
      const keys = new Map([['--owner','ownerId'], ['--directory','directory'], ['--origin','platformOrigin'], ['--server-node','serverNodeId']]);
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = keys.get(args[i]), value = args[i+1];
        if (!key || Object.hasOwn(options,key) || !value || value.startsWith('--')) throw new Error('启动参数不完整或重复。用法：'+usage);
        options[key] = value;
      }
      console.log(JSON.stringify(await createWorkerConfig(options), null, 2));
    }
  } catch (error) { console.error(error.code === 'EEXIST' ? '配置已存在，保留现有凭据；需要轮换时先备份并移走这两个配置文件。' : error.message); process.exitCode = 1; }
}
