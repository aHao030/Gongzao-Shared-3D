import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function parseLaunchOptions(args, environmentPort) {
  let portValue = environmentPort || '3000', openBrowser = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-open') openBrowser = false;
    else if (args[i] === '--port') {
      if (!args[i + 1]) throw new Error('--port needs a number from 1 to 65535.');
      portValue = args[++i];
    } else if (args[i] === '--help') return { help: true };
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!/^\d+$/.test(String(portValue))) throw new Error('Port must be an integer from 1 to 65535.');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  return { port, openBrowser };
}

function openDefaultBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { shell: false, detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`Could not open a browser automatically. Open this address manually: ${url}`));
  child.on('exit', code => { if (code) console.log(`Browser opener returned ${code}. Open this address manually: ${url}`); });
  child.unref();
}

export async function launch(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('Node.js 24 or newer is required. Install it from https://nodejs.org/ and run this file again.');
  }
  const options = parseLaunchOptions(args, process.env.PORT);
  if (options.help) {
    console.log('Usage: node tools/launch-local.mjs [--port 3000] [--no-open]');
    return;
  }
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  process.chdir(projectRoot);
  const { createPlatformServer } = await import('../services/platform/local.mjs');
  const { server, store } = createPlatformServer({ dbPath: process.env.DATA_PATH || path.join(projectRoot, 'data/platform.sqlite') });
  let closing = false, closedStore = false;
  const closeStore = () => { if (!closedStore) { closedStore = true; store.close(); } };
  try {
    await new Promise((resolve, reject) => {
      const fail = error => reject(error);
      server.once('error', fail);
      server.listen(options.port, '127.0.0.1', () => { server.off('error', fail); resolve(); });
    });
  } catch (error) {
    closeStore();
    if (error.code === 'EADDRINUSE') {
      throw new Error(`Port ${options.port} is already in use. If Gongzao is already running, use that window; otherwise stop the program using this port or explicitly choose another port with --port 3001. No existing process was stopped.`);
    }
    throw error;
  }
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close(() => { clearTimeout(timer); closeStore(); console.log('Gongzao stopped. Local data has been kept.'); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', error => { console.error(`Server error: ${error.message}`); process.exitCode = 1; shutdown(); });
  const url = `http://127.0.0.1:${options.port}`;
  console.log(`\nGongzao v${version} - local sandbox\n${url}\nMerchant: ${url}/merchant/login\n`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
  console.log('Local data: data/platform.sqlite (or your DATA_PATH setting).');
  console.log('Printing, payments and logistics are simulated. No npm install is required.\n');
  if (options.openBrowser) openDefaultBrowser(url);
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launch().catch(error => { console.error(`\nCannot start Gongzao: ${error.message}\n`); process.exitCode = 1; });
}
