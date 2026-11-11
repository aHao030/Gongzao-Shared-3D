import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../tools/launch-local.mjs', import.meta.url));
const packageVersion = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
async function reservePort() {
  const server = createServer((req, res) => res.end('existing service'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}
function start(port, dbPath, cwd) {
  const process = spawn(globalThis.process.execPath, [launcher, '--port', String(port), '--no-open'], {
    cwd, env: { ...globalThis.process.env, DATA_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  process.stdout.on('data', chunk => { output += chunk; });
  process.stderr.on('data', chunk => { output += chunk; });
  const exited = once(process, 'exit');
  return { process, exited, output: () => output };
}
async function ready(child, port) {
  for (let i = 0; i < 100; i++) {
    if (child.output().includes(`http://127.0.0.1:${port}`)) return;
    if (child.process.exitCode !== null) throw new Error(child.output());
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Launcher did not start: ' + child.output());
}
async function stop(child) {
  if (child.process.exitCode === null) child.process.kill('SIGINT');
  const [code] = await child.exited;
  assert.equal(code, 0, child.output());
}

test('delivery launcher serves from any working directory and keeps SQLite sessions across restart', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gongzao-launch-'));
  const dbPath = path.join(temporary, 'state', 'platform.sqlite');
  const reservation = await reservePort(), port = reservation.port;
  await new Promise(resolve => reservation.server.close(resolve));
  let child;
  try {
    child = start(port, dbPath, temporary);
    await ready(child, port);
    const base = `http://127.0.0.1:${port}`;
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.version, packageVersion);
    assert.equal(health.persistence, 'sqlite');
    assert.equal(health.realPayments, false);
    assert.match(await (await fetch(base + '/')).text(), /<html/);
    const anonymous = await (await fetch(base + '/api/auth/session')).json();
    assert.equal(anonymous.authenticated, false);
    const sessionResponse = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ email: 'launcher-test@example.com', password: 'Temporary-fixture-Only-2026', displayName: '启动测试账号' }),
    });
    assert.equal(sessionResponse.status, 201);
    const session = await sessionResponse.json(), cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
    assert.equal(session.authenticated, true);
    await stop(child);
    assert.ok((await fs.stat(dbPath)).size > 0);
    child = start(port, dbPath, temporary);
    await ready(child, port);
    const resumed = await (await fetch(base + '/api/auth/session', { headers: { Cookie: cookie } })).json();
    assert.equal(resumed.authenticated, true);
    assert.equal(resumed.user.id, session.user.id);
    await stop(child);
  } finally {
    if (child?.process.exitCode === null) { child.process.kill('SIGTERM'); await child.exited; }
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('delivery launcher rejects a busy port without opening or stopping the existing service', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gongzao-port-'));
  const { server, port } = await reservePort();
  let child;
  try {
    child = start(port, path.join(temporary, 'platform.sqlite'), temporary);
    const [code] = await child.exited;
    assert.equal(code, 1);
    assert.match(child.output(), /already in use/);
    assert.doesNotMatch(child.output(), /Gongzao v0.7 - local sandbox/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing service');
  } finally {
    if (child?.process.exitCode === null) { child.process.kill('SIGTERM'); await child.exited; }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
