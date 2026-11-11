import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function createWorkerConfig({ ownerId, directory = '.', platformOrigin = 'http://127.0.0.1:3000', now = Date.now() }) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 300 || /[\u0000-\u001f\u007f]/.test(ownerId)) throw new Error('需要从已登录的 /api/v2/session 获取账号 user.id');
  const url = new URL(platformOrigin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('平台地址必须为 HTTPS 或本机 HTTP origin');
  const workerToken = randomBytes(32).toString('base64url'), workerId = 'manufacturing-' + randomBytes(6).toString('hex');
  const kinds = ['ANALYZE_MODEL','SLICE_MODEL','SCHEDULE'];
  const serverFile = path.resolve(directory, 'worker-access.config.json'), workerFile = path.resolve(directory, 'worker.config.json');
  const server = { workers: [{ ownerId, workerId, enabled: true, kinds, tokenHash: createHash('sha256').update(workerToken).digest('hex'), expiresAt: now + 30 * 86400000 }] };
  const worker = { platformOrigin: url.origin, workerToken, pythonExecutable: 'python3', pollSeconds: 5, kinds,
    workDirectory: 'data/manufacturing-worker', prusaSlicerExecutable: 'prusa-slicer', maxTaskSeconds: 240, profiles: {} };
  await fs.mkdir(path.dirname(serverFile), { recursive: true });
  await fs.writeFile(serverFile, JSON.stringify(server, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { await fs.writeFile(workerFile, JSON.stringify(worker, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { await fs.unlink(serverFile); throw error; }
  return { serverFile, workerFile, workerId, expiresAt: server.workers[0].expiresAt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), value = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  try { console.log(JSON.stringify(await createWorkerConfig({ ownerId: value('--owner'), directory: value('--directory'), platformOrigin: value('--origin') }), null, 2)); }
  catch (error) { console.error(error.code === 'EEXIST' ? '配置已存在，保留现有凭据；需要轮换时先备份并移走这两个配置文件。' : error.message); process.exitCode = 1; }
}
