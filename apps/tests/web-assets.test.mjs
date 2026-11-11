import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareWebAssets } from '../tools/prepare-web-assets.mjs';

test('native preparation excludes hosted server output and validates the browser resource closure', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'gongzao-browser-assets-'));
  const sourceDir = path.join(temporary, 'dist'); const targetDir = path.join(temporary, 'apps/shared/web');
  try {
    await mkdir(path.join(sourceDir, 'server'), { recursive: true }); await mkdir(path.join(sourceDir, '.openai'));
    await writeFile(path.join(sourceDir, 'index.html'), '<html><head><link href="styles.css" rel="stylesheet"><link href="manifest.webmanifest" rel="manifest"></head><body><script src="app.js"></script></body></html>');
    await writeFile(path.join(sourceDir, 'app.js'), 'console.log("browser fixture");');
    await writeFile(path.join(sourceDir, 'styles.css'), 'body { background-image: url("icon.svg"); }');
    await writeFile(path.join(sourceDir, 'icon.svg'), '<svg/>');
    await writeFile(path.join(sourceDir, 'manifest.webmanifest'), JSON.stringify({ start_url: './', icons: [{ src: 'icon.svg' }] }));
    await writeFile(path.join(sourceDir, 'server/index.js'), 'DO_NOT_SHIP_SERVER_CODE');
    await writeFile(path.join(sourceDir, '.openai/hosting.json'), '{"private":"do-not-ship"}');
    await writeFile(path.join(sourceDir, '.env'), 'SECRET=do-not-ship');
    await writeFile(path.join(sourceDir, 'metadata.json'), '{"do-not-ship":true}');
    const result = await prepareWebAssets({ sourceDir, targetDir }); assert.equal(result.count, 5);
    assert.deepEqual((await readdir(targetDir)).sort(), ['app.js', 'icon.svg', 'index.html', 'manifest.webmanifest', 'styles.css']);
    await prepareWebAssets({ sourceDir, targetDir, checkOnly: true });
    await mkdir(path.join(targetDir, 'server'));
    await assert.rejects(prepareWebAssets({ sourceDir, targetDir, checkOnly: true }), /extra|Disallowed/);
    await prepareWebAssets({ sourceDir, targetDir }); assert.equal((await readdir(targetDir)).includes('server'), false);
    await writeFile(path.join(sourceDir, 'index.html'), '<script src="nested/missing.js"></script>');
    await assert.rejects(prepareWebAssets({ sourceDir, targetDir }), /absent from the native allowlist/);
    assert.equal((await readdir(targetDir)).length, 5, 'invalid source must not destroy the previous valid prepared output');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
