#!/usr/bin/env node
/** Copy browser assets only; never bundle hosted Worker output into native apps. */
import { readdir, readFile, writeFile, mkdir, lstat, rm, mkdtemp, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allowed = /\.(?:html|js|css|svg|webmanifest)$/i;
const generatedDirectoryNames = new Set(['server', '.openai']);
function localReference(value, files, owner) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return;
  let clean = value.split(/[?#]/)[0];
  if (!clean || clean === '.' || clean === './' || clean === '/') clean = 'index.html';
  clean = clean.replace(/^\.\//, '').replace(/^\//, '');
  if (!files.has(clean)) throw new Error(`${owner}: browser asset reference ${value} is absent from the native allowlist output`);
}
function validateReferences(files) {
  if (!files.has('index.html')) throw new Error('Source dist/index.html is required');
  for (const [name, bytes] of files) {
    const text = bytes.toString('utf8');
    if (/\.html$/i.test(name)) for (const match of text.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) localReference(match[1], files, name);
    if (/\.css$/i.test(name)) for (const match of text.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) localReference(match[1], files, name);
    if (/\.js$/i.test(name)) for (const match of text.matchAll(/(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) localReference(match[1], files, name);
    if (/\.webmanifest$/i.test(name)) {
      const manifest = JSON.parse(text);
      for (const icon of manifest.icons || []) localReference(icon.src, files, name);
      if (manifest.start_url) localReference(manifest.start_url, files, name);
      for (const shortcut of manifest.shortcuts || []) {
        if (shortcut.url) localReference(shortcut.url, files, name);
        for (const icon of shortcut.icons || []) localReference(icon.src, files, name);
      }
    }
  }
}
export async function prepareWebAssets({ sourceDir = path.join(repo, 'dist'), targetDir = path.join(repo, 'apps/shared/web'), checkOnly = false } = {}) {
  const files = new Map();
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (entry.isFile() && allowed.test(entry.name)) files.set(entry.name, await readFile(path.join(sourceDir, entry.name)));
    // Directories (including hosted server/.openai output), symlinks and other suffixes are intentionally excluded.
  }
  validateReferences(files);
  const targetInfo = await lstat(targetDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) throw new Error('Native web target must be a normal directory');
  if (checkOnly) {
    if (!targetInfo) throw new Error('Native web assets are missing; run node apps/tools/prepare-web-assets.mjs');
    const entries = await readdir(targetDir, { withFileTypes: true });
    if (entries.length !== files.size) throw new Error('Native web directory has stale or extra files');
    for (const entry of entries) {
      if (!entry.isFile() || generatedDirectoryNames.has(entry.name) || !files.has(entry.name)) throw new Error(`Disallowed native web entry: ${entry.name}`);
      if (!(await readFile(path.join(targetDir, entry.name))).equals(files.get(entry.name))) throw new Error(`Stale native web asset: ${entry.name}`);
    }
  } else {
    await mkdir(path.dirname(targetDir), { recursive: true });
    const staging = await mkdtemp(path.join(path.dirname(targetDir), '.native-web-stage-'));
    try {
      for (const [name, bytes] of files) await writeFile(path.join(staging, name), bytes);
      if (targetInfo) await rm(targetDir, { recursive: true });
      await rename(staging, targetDir);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  return { count: files.size, files: [...files.keys()].sort() };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: node apps/tools/prepare-web-assets.mjs [--check]');
  const result = await prepareWebAssets({ checkOnly: args.includes('--check') });
  console.log(`${args.includes('--check') ? 'Validated' : 'Prepared'} ${result.count} browser-only native assets; hosted server/.openai output excluded.`);
}
