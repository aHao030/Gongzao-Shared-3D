import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { applyUpdate, permittedUpdatePath } from '../tools/update-local.mjs';

test('review v0.9: updater excludes new machine and provider credentials while permitting example configuration', () => {
  for (const name of ['worker.config.json', 'worker-access.config.json', 'integrations.config.json',
    'services/WORKER.CONFIG.JSON', 'services/worker-access.config.local.json', 'settings/farm.local.json',
    'services/manufacturing-worker/.venv/bin/python', '.venv-manufacturing/bin/python', 'services/.venv_test/config.json', 'services/manufacturing-worker/__pycache__/engine.pyc'])
    assert.equal(permittedUpdatePath(name), false, name);
  for (const name of ['services/manufacturing-worker/config.example.json', 'services/integrations/config.example.json',
    'services/manufacturing-worker/requirements.txt', 'services/platform/operations.mjs'])
    assert.equal(permittedUpdatePath(name), true, name);
});

test('review v0.9: an upgrade installs manufacturing code and leaves data, journals and private configuration bytes intact', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gongzao-upgrade-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'existing');
  const put = async (dir, name, content) => { await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), content); };
  const old = { 'package.json': JSON.stringify({ name: 'gongzao-shared-fabrication', version: '0.8.0' }),
    'services/platform/local.mjs': 'old local service', 'dist/index.html': 'old interface' };
  const next = { 'package.json': JSON.stringify({ name: 'gongzao-shared-fabrication', version: '0.9.0' }),
    'services/platform/local.mjs': 'new local service', 'dist/index.html': 'new interface',
    'services/platform/operations.mjs': 'new manufacturing operations', 'services/manufacturing-worker/config.example.json': '{}' };
  const protectedNames = ['data/platform.sqlite', 'data/platform.sqlite-wal', 'data/manufacturing-worker/worker-journal.json',
    'data/integration-commands.sqlite', 'worker.config.json', 'worker-access.config.json', 'integrations.config.json', 'auth.config.json'];
  for (const [name, content] of Object.entries(old)) await put(target, name, content);
  for (const [name, content] of Object.entries(next)) await put(source, name, content);
  for (const name of protectedNames) { await put(target, name, 'PRIVATE-FIXTURE-' + name); await put(source, name, 'must never overwrite existing fixture'); }
  const manifest = { schema: 1, project: 'gongzao-shared-fabrication', version: '0.9.0',
    files: Object.entries(next).map(([name, content]) => ({ path: name, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') })) };
  await put(source, 'UPDATE-MANIFEST.json', JSON.stringify(manifest));
  const result = await applyUpdate({ source, target });
  assert.equal(result.fromVersion, '0.8.0'); assert.equal(result.toVersion, '0.9.0');
  for (const name of protectedNames) assert.equal(await readFile(path.join(target, name), 'utf8'), 'PRIVATE-FIXTURE-' + name);
  for (const [name, content] of Object.entries(next)) assert.equal(await readFile(path.join(target, name), 'utf8'), content);
  for (const [name, content] of Object.entries(old)) assert.equal(await readFile(path.join(result.backup, 'code', name), 'utf8'), content);
  assert.equal(JSON.parse(await readFile(path.join(result.backup, 'UPDATE-RECEIPT.json'), 'utf8')).status, 'COMPLETE');
});
