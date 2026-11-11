import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { permittedUpdatePath } from './update-local.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
// Call after staging intended source additions. Untracked personal files are never included.
const names = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(name => name && name !== 'UPDATE-MANIFEST.json' && permittedUpdatePath(name));
const files = [];
for (const name of [...new Set(names)].sort()) {
  const file = path.join(root, name), info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Manifest source must be an ordinary file: ' + name);
  const bytes = await fs.readFile(file);
  files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if (!files.some(item => item.path === 'tools/update-local.mjs') || !files.some(item => item.path === 'package.json')) throw new Error('Stage new source files before generating the update manifest.');
await fs.writeFile(path.join(root, 'UPDATE-MANIFEST.json'), JSON.stringify({ schema: 1, project: pkg.name, version: pkg.version, files }, null, 2) + '\n');
console.log('Created UPDATE-MANIFEST.json with ' + files.length + ' tracked source files.');
