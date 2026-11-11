import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, executeEngine, isRetryableWorkerError, ManufacturingWorker } from './client.mjs';

export async function runCli(args = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  if (!args.length || args.includes('--help')) {
    log('用法：node services/manufacturing-worker/cli.mjs --config worker.config.json [--once | --status]\n真实运算服务：模型分析、切片估算、排期建议；不会启动打印机或付款。沙盒任务请在商家工作台运行。'); return 0;
  }
  const at = args.indexOf('--config');
  if (at < 0 || !args[at + 1] || args.some((arg, index) => !['--config','--once','--status'].includes(arg) && index !== at + 1)) { error('参数无效，请使用 --help'); return 2; }
  let config;
  try { config = await loadConfig(args[at + 1]); }
  catch (failure) { error('运算服务配置未加载：' + (failure.code ?? 'INVALID_CONFIG')); return 2; }
  if (args.includes('--status')) {
    try { log(JSON.stringify(await executeEngine({kind:'STATUS', prusaSlicerExecutable:config.prusaSlicerExecutable}, config), null, 2)); return 0; }
    catch (failure) { error('运算依赖检查失败：' + (failure.code ?? 'ENGINE_FAILED')); return 3; }
  }
  const lock = path.join(config.workDirectory, 'worker.lock');
  try {
    await fs.mkdir(config.workDirectory, {recursive:true,mode:0o700});
    await fs.mkdir(lock, {mode:0o700});
    await fs.writeFile(path.join(lock, 'pid'), String(process.pid), {mode:0o600});
  } catch (failure) { error('工作目录已被另一服务占用，或不可写。请勿同时运行两个使用同一工作目录的服务。异常退出后请先确认旧进程已停止，再移除 worker.lock 目录。'); return 3; }
  const worker = new ManufacturingWorker(config); let stopped = false, timer, release;
  const stop = () => { stopped = true; clearTimeout(timer); release?.(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  log('共造制造运算服务已启动 · 持久任务与版本核对 · 不启动打印机 · Ctrl+C 停止');
  try {
    do {
      try { const result = await worker.cycle(); if (result.status !== 'IDLE') log(JSON.stringify(result)); }
      catch (failure) {
        error('任务未完成：' + (failure.code ?? 'WORKER_FAILED') + '。已保留本地任务凭据，请先排查后使用原配置重试。');
        // Expired leases and rejected evidence require reconciliation, not blind new claims.
        if (args.includes('--once') || !isRetryableWorkerError(failure)) return 3;
      }
      if (args.includes('--once') || stopped) break;
      await new Promise(resolve => { release = resolve; timer = setTimeout(resolve, config.pollSeconds * 1000); }); release = null;
    } while (!stopped);
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await fs.rm(lock,{recursive:true,force:true}); }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCli();
