import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyUpdate, prepareUpdate, permittedUpdatePath } from '../tools/update-local.mjs';

const projectName = 'gongzao-shared-fabrication';
async function write(root, name, content) {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), content);
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gongzao-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'new package 新版'), target = path.join(root, 'old package 旧版');
  const old = {
    'package.json': JSON.stringify({ name: projectName, version: '0.7.0' }),
    'services/platform/local.mjs': 'export const version = "old";\n',
    'dist/index.html': '<html>old</html>',
  };
  const fresh = { ...old,
    'package.json': JSON.stringify({ name: projectName, version: '0.8.0' }),
    'services/platform/local.mjs': 'export const version = "new";\n',
    'dist/index.html': '<html>new</html>',
    'dist/new-ui.js': 'export const feature = true;\n',
  };
  for (const [name, content] of Object.entries(old)) await write(target, name, content);
  for (const [name, content] of Object.entries(fresh)) await write(source, name, content);
  const manifest = { schema: 1, project: projectName, version: '0.8.0', files: Object.entries(fresh).map(([name, content]) => ({
    path: name, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
  })) };
  const saveManifest = () => write(source, 'UPDATE-MANIFEST.json', JSON.stringify(manifest));
  await saveManifest();
  return { root, source, target, old, fresh, manifest, saveManifest };
}

test('update backs up overwritten code and preserves data, private settings and user additions', async t => {
  const f = await fixture(t);
  const protectedFiles = ['data/platform.sqlite', 'data/platform.sqlite-wal', '.env', 'gateway.config.json',
    'farm.private.json', 'auth.private.json', 'node_modules/user-package/index.js', '.git/config', 'my-extra-file.txt'];
  for (const name of protectedFiles) { await write(f.target, name, 'old private content:' + name); await write(f.source, name, 'never copy:' + name); }
  const result = await applyUpdate(f);
  assert.equal(result.updatedFiles, 4);
  assert.equal(result.fromVersion, '0.7.0'); assert.equal(result.toVersion, '0.8.0');
  for (const [name, content] of Object.entries(f.fresh)) assert.equal(await fs.readFile(path.join(f.target, name), 'utf8'), content);
  for (const [name, content] of Object.entries(f.old)) assert.equal(await fs.readFile(path.join(result.backup, 'code', name), 'utf8'), content);
  for (const name of protectedFiles) assert.equal(await fs.readFile(path.join(f.target, name), 'utf8'), 'old private content:' + name);
  const receipt = JSON.parse(await fs.readFile(path.join(result.backup, 'UPDATE-RECEIPT.json'), 'utf8'));
  assert.equal(receipt.status, 'COMPLETE');
  assert.deepEqual(receipt.added, ['dist/new-ui.js']);
  await assert.rejects(fs.stat(path.join(result.backup, 'code/data')));
});

test('tampered package fails before any backup or target change', async t => {
  const f = await fixture(t);
  await write(f.source, 'dist/index.html', 'unexpected content');
  await assert.rejects(applyUpdate(f), /integrity check failed/);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['new package 新版', 'old package 旧版'].sort());
  assert.equal(await fs.readFile(path.join(f.target, 'package.json'), 'utf8'), f.old['package.json']);
});

test('manifest cannot target protected paths, Windows aliases or path traversal', async t => {
  const invalid = ['../outside.txt', '/absolute.txt', 'C:/windows/file', 'dist\\x.js', 'dist/file:stream',
    'data/platform.sqlite', 'DATA/file', 'node_modules/module.js', '.git/config', '.env', '.env.production',
    'config/device.secret.json', 'farm.private.json', 'gateway.config.json', 'gateway-config-farm.json',
    'foo.gateway.local.json', 'secrets/token.json', 'credentials.json', 'client.key', 'dist/CON.txt',
    'dist/file.', 'dist/file ', 'dist//file', 'dist/server/worker.js', 'native-api.config.json'];
  for (const name of invalid) assert.equal(permittedUpdatePath(name), false, name);
  const f = await fixture(t);
  f.manifest.files.push({ path: '../outside.txt', bytes: 0, sha256: '0'.repeat(64) });
  await f.saveManifest();
  await assert.rejects(applyUpdate(f), /Unsafe/);
});

test('duplicate and case-colliding manifest entries are rejected', async t => {
  const f = await fixture(t);
  f.manifest.files.push({ ...f.manifest.files[2], path: 'DIST/INDEX.HTML' });
  await f.saveManifest();
  await assert.rejects(prepareUpdate(f), /duplicate/);
});

test('same, nested, root, mismatched and newer target projects are rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareUpdate({ source: f.source, target: f.source }), /separate folder/);
  await fs.mkdir(path.join(f.source, 'nested'));
  await assert.rejects(prepareUpdate({ source: f.source, target: path.join(f.source, 'nested') }), /separate folder/);
  await assert.rejects(prepareUpdate({ source: f.source, target: path.parse(f.root).root }), /disk root/);
  await write(f.target, 'package.json', JSON.stringify({ name: 'another-project', version: '0.7.0' }));
  await assert.rejects(prepareUpdate(f), /Not a supported/);
  await write(f.target, 'package.json', JSON.stringify({ name: projectName, version: '9.0.0' }));
  await assert.rejects(prepareUpdate(f), /downgrade/);
});

test('source and destination symlinks are refused without following them', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside.html');
  await fs.writeFile(outside, 'untouched');
  await fs.unlink(path.join(f.target, 'dist/index.html'));
  await fs.symlink(outside, path.join(f.target, 'dist/index.html'));
  await assert.rejects(applyUpdate(f), /Symlink/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
  await fs.unlink(path.join(f.target, 'dist/index.html'));
  await write(f.target, 'dist/index.html', f.old['dist/index.html']);
  await fs.unlink(path.join(f.source, 'dist/index.html'));
  await fs.symlink(outside, path.join(f.source, 'dist/index.html'));
  await assert.rejects(applyUpdate(f), /Symlink/);
});

test('failure after the first file replacement restores code and keeps a readable backup receipt', async t => {
  const f = await fixture(t);
  await write(f.target, 'data/platform.sqlite', 'persistent user data');
  const originalRename = fs.rename;
  let renames = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++renames === 2) throw Object.assign(new Error('simulated locked code file'), { code: 'EACCES' });
    return originalRename(...args);
  });
  await assert.rejects(applyUpdate(f), /Update failed:[\s\S]*Code backup:[\s\S]*rolled back/);
  for (const [name, content] of Object.entries(f.old)) assert.equal(await fs.readFile(path.join(f.target, name), 'utf8'), content);
  assert.equal(await fs.readFile(path.join(f.target, 'data/platform.sqlite'), 'utf8'), 'persistent user data');
  const backupName = (await fs.readdir(f.root)).find(name => name.includes('.backup-'));
  assert.ok(backupName);
  const receipt = JSON.parse(await fs.readFile(path.join(f.root, backupName, 'UPDATE-RECEIPT.json'), 'utf8'));
  assert.equal(receipt.status, 'FAILED_ROLLED_BACK');
  assert.equal(receipt.rollbackErrors.length, 0);
  assert.deepEqual((await fs.readdir(path.join(f.target, 'services/platform'))), ['local.mjs']);
});

test('Windows delivery wrappers preserve encoding and do not kill processes or set global policy', async () => {
  const ps = await fs.readFile(new URL('../tools/update-windows.ps1', import.meta.url));
  assert.deepEqual([...ps.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const script = ps.toString('utf8');
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /FileShare\]::None/);
  assert.doesNotMatch(script, /Stop-Process|taskkill|Set-ExecutionPolicy/i);
  const cmd = await fs.readFile(new URL('../UPDATE-WINDOWS.cmd', import.meta.url), 'utf8');
  assert.match(cmd, /-NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(cmd, /\r\n/);
});
