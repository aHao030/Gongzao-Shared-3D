import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import project from '../package.json' with { type: 'json' };

const URL_PATH = '/api/admin/nodes/heartbeat';
const tokenPattern = /^gzn1\.(node_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[0-9a-f]{64}$/;
const help = [
  '服务器心跳代理',
  'node tools/server-agent.mjs --config server-agent.private.json [--once]',
  '也可设置 GONGZAO_SERVER_URL 和 GONGZAO_SERVER_TOKEN，再运行 node tools/server-agent.mjs。',
  '配置文件包含 platformUrl 和 token。私有托管站点的服务访问凭据可由 GONGZAO_SITE_ACCESS_TOKEN 提供。',
  '使用 --once 验证一次接入，持续运行时按 Ctrl+C 停止。'
].join('\n');

class AgentError extends Error {
  constructor(message, retryable = false) { super(message); this.retryable = retryable; }
}

export function parseAgentArgs(argv) {
  const options = { once: false, filename: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--once') options.once = true;
    else if (argv[index] === '--help') options.help = true;
    else if (argv[index] === '--config' && !options.filename && argv[index + 1] && !argv[index + 1].startsWith('-')) {
      options.filename = argv[++index];
    } else throw new AgentError('不支持的启动参数，请使用 --help 查看用法。');
  }
  return options;
}

async function readConfig(filename) {
  let file;
  try {
    file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await file.stat();
    if (!info.isFile() || info.size > 16_384) throw new AgentError('配置文件应小于 16 KiB。');
    if (process.platform !== 'win32' && (info.mode & 0o077)) {
      throw new AgentError('配置文件包含节点凭据，请将文件权限设为 600 后重试。');
    }
    const config = JSON.parse(await file.readFile('utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new AgentError('配置文件应为 JSON 对象。');
    return config;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('无法读取节点私有配置，请检查路径和 JSON 格式。');
  } finally { await file?.close(); }
}

export async function loadAgentConfig(filename, env = process.env) {
  const config = filename ? await readConfig(filename) : { platformUrl: env.GONGZAO_SERVER_URL, token: env.GONGZAO_SERVER_TOKEN };
  let url;
  try { url = new URL(config.platformUrl); } catch { throw new AgentError('请填写完整的平台 HTTPS 根地址。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) throw new AgentError('远程平台需使用 HTTPS 根地址，本机可使用 HTTP。');
  const match = typeof config.token === 'string' && tokenPattern.exec(config.token);
  if (!match) throw new AgentError('请填写由管理员为此节点签发的完整凭据。');
  const siteAccessToken = config.siteAccessToken ?? env.GONGZAO_SITE_ACCESS_TOKEN;
  if (siteAccessToken !== undefined && (typeof siteAccessToken !== 'string' || !/^[\x21-\x7e]{16,8192}$/.test(siteAccessToken))) {
    throw new AgentError('站点服务访问凭据格式无效。');
  }
  return { platformUrl: url.origin, nodeId: match[1], token: config.token, siteAccessToken };
}

async function readReceipt(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError('未收到平台的心跳回执。');
  const data = new Uint8Array(8192);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > data.length - size) {
        await reader.cancel();
        throw new AgentError('平台返回的心跳回执过大。');
      }
      data.set(value, size);
      size += value.length;
    }
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('接收心跳回执时网络中断。', true);
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder().decode(data.subarray(0, size))); }
  catch { throw new AgentError('未收到有效的心跳回执，请检查平台地址和私有站点访问配置。'); }
}

export async function sendHeartbeat(config, { fetchImpl = fetch, signal } = {}) {
  const headers = { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' };
  if (config.siteAccessToken) headers['OAI-Sites-Authorization'] = 'Bearer ' + config.siteAccessToken;
  let response;
  const timeout = AbortSignal.timeout(10_000);
  try {
    response = await fetchImpl(config.platformUrl + URL_PATH, {
      method: 'POST', headers, body: JSON.stringify({ agentVersion: project.version }),
      redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  } catch { throw new AgentError('平台暂时不可达，请检查网络和平台地址。', true); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new AgentError('平台拒绝了心跳，请检查节点状态、节点凭据和私有站点访问配置。');
    }
    if (response.status >= 300 && response.status < 400) throw new AgentError('平台返回重定向，请直接配置最终平台地址及私有站点访问凭据。');
    throw new AgentError('心跳未被接受，HTTP ' + response.status + '。', [408, 409, 429].includes(response.status) || response.status >= 500);
  }
  const receipt = await readReceipt(response);
  if (receipt?.nodeId !== config.nodeId || !Number.isSafeInteger(receipt.receivedAt) || receipt.receivedAt < 0 ||
      !Number.isInteger(receipt.heartbeatIntervalSeconds) || receipt.heartbeatIntervalSeconds < 5 || receipt.heartbeatIntervalSeconds > 300) {
    throw new AgentError('心跳回执与本节点不匹配，请检查平台地址。');
  }
  return receipt;
}

export async function runAgent(config, { once = false, signal, send = sendHeartbeat, sleep = delay, log = console.log } = {}) {
  let retrySeconds = 5, connected = false;
  while (!signal?.aborted) {
    let waitSeconds;
    try {
      const receipt = await send(config, { signal });
      if (!connected || once) log('平台已收到本节点心跳。');
      if (once) return receipt;
      connected = true;
      retrySeconds = 5;
      waitSeconds = receipt.heartbeatIntervalSeconds;
    } catch (error) {
      if (signal?.aborted) return;
      if (!error.retryable || once) throw error;
      connected = false;
      waitSeconds = retrySeconds;
      retrySeconds = Math.min(retrySeconds * 2, 120);
      log('心跳暂未送达，' + waitSeconds + ' 秒后重试。');
    }
    try { await sleep(waitSeconds * 1000, undefined, { signal }); }
    catch (error) { if (signal?.aborted) return; throw error; }
  }
}

async function main() {
  const { once, filename, help: showHelp } = parseAgentArgs(process.argv.slice(2));
  if (showHelp) { console.log(help); return; }
  const config = await loadAgentConfig(filename);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try { await runAgent(config, { once, signal: controller.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof AgentError ? error.message : '代理启动失败，请核对运行环境。'); process.exitCode = 1; });
}
