import fs from 'node:fs';
import path from 'node:path';
import { validateWorkerAccess } from './worker-access.mjs';

export function readPrivateJSON(filename, { optional = false } = {}) {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error('Private configuration must be a bounded ordinary file');
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw new Error('服务端配置无法读取或无效：' + path.basename(filename));
  }
}

export function loadWorkerAccess(config) {
  if (config !== undefined) return validateWorkerAccess(config);
  const specified = process.env.WORKER_ACCESS_CONFIG;
  return validateWorkerAccess(readPrivateJSON(specified || 'worker-access.config.json', { optional: !specified }) || { workers: [] });
}
