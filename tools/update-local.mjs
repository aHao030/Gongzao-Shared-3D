import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectName = 'gongzao-shared-fabrication';
export const defaultTarget = 'D:\\Gongzao-Shared-3D-v0.6-Download\\Gongzao-Shared-3D-v0.7';
const defaultSource = fileURLToPath(new URL('../', import.meta.url));
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function permittedUpdatePath(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\\:\u0000-\u001f<>"|?*]/.test(name) || name.startsWith('/') || name.endsWith('/')) return false;
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return false;
  if (parts.some(part => ['data', 'node_modules', '.git', '.openai', '.sites-runtime', '.wrangler', 'generated', 'artifacts', 'secrets', '.secrets', 'private', 'credentials'].includes(part.toLowerCase()))) return false;
  if (parts.some(part => /^\.env(?:\.|$)|^\.dev\.vars|\.private\.|\.secret(?:\.|$)|\.gateway\.local\.|^gateway(?:[.-].*)?\.json$|^native-api\.config\.json$|^credentials(?:\.|$)|\.(?:pem|key|p12|pfx)$|\.sqlite(?:-|$)|\.log$|\.backup-/i.test(part))) return false;
  if (parts.some(part => /^(?:auth|worker|worker-access|integrations)\.config(?:\.local)?\.json$|\.local\.json$|^\.venv(?:$|[-_.])|^__pycache__$|\.pyc$/i.test(part))) return false;
  return !name.toLowerCase().startsWith('dist/server/') && !['update-manifest.json', 'sha256sums.txt'].includes(name.toLowerCase());
}

async function ordinaryRoot(directory) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Project folder has a symlink/reparse or non-directory ancestor: ' + current);
  }
}

async function ordinaryPath(root, relative, allowMissing = false) {
  let current = root;
  const parts = relative ? relative.split('/') : [];
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    let info;
    try { info = await fs.lstat(current); } catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error('Symlink/reparse paths are not updated: ' + current);
    if (i < parts.length - 1 && !info.isDirectory()) throw new Error('Expected a directory: ' + current);
    if (i === parts.length - 1 && parts.length && !info.isFile()) throw new Error('Expected an ordinary file: ' + current);
  }
}
async function projectAt(directory) {
  await ordinaryPath(directory, 'package.json');
  const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  if (pkg.name !== projectName || !versionPattern.test(pkg.version)) throw new Error('Not a supported Gongzao project: ' + directory);
  return pkg;
}
function compareVersion(a, b) { const aa = a.split('-')[0].split('.').map(Number), bb = b.split('-')[0].split('.').map(Number); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]; return 0; }

// These files contain installation-specific settings that operators are asked to edit.
const localWechatFiles = new Set(['apps/weapp/config/service.js', 'apps/weapp/utils/auth.js']);
const applicationIdentifiers = new Map([
  ['apps/weapp/project.config.json', ['appid', 'touristappid']],
  ['apps/mobile/capacitor.config.json', ['appId', 'com.example.sharedfabrication']],
  ['apps/desktop/src-tauri/tauri.conf.json', ['identifier', 'com.example.sharedfabrication']],
]);

async function previousWechatTemplates(target) {
  const manifestName = 'UPDATE-MANIFEST.json';
  const manifestPath = path.join(target, manifestName);
  try {
    await ordinaryPath(target, manifestName);
    if ((await fs.stat(manifestPath)).size > 2 * 1024 * 1024) return new Map();
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest?.project !== projectName || manifest.schema !== 1 || !Array.isArray(manifest.files)) return new Map();
    return new Map(manifest.files.filter(entry => localWechatFiles.has(entry?.path)).map(entry => [entry.path, entry.sha256]));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return new Map();
    throw error;
  }
}

async function retainDeploymentSettings(targetFile, name, packageBytes, templates) {
  if (!localWechatFiles.has(name) && !applicationIdentifiers.has(name)) return { bytes: packageBytes };
  const existing = await fs.readFile(targetFile);
  if (existing.equals(packageBytes)) return { bytes: packageBytes };
  if (localWechatFiles.has(name)) {
    // An unchanged template can receive vendor fixes. Keep a local adapter when its provenance is unknown.
    if (templates.get(name) === digest(existing)) return { bytes: packageBytes };
    return { skip: true, preserved: name };
  }

  let current, next;
  try {
    current = JSON.parse(existing.toString('utf8').replace(/^\uFEFF/, ''));
    next = JSON.parse(packageBytes.toString('utf8'));
  } catch {
    throw new Error('Cannot preserve the registered app identifier. Check the JSON in ' + name);
  }
  const [key, placeholder] = applicationIdentifiers.get(name);
  if (typeof current?.[key] !== 'string' || !current[key].trim() || current[key] === placeholder || current[key] === next[key]) {
    return { bytes: packageBytes };
  }
  next[key] = current[key];
  return { bytes: Buffer.from(JSON.stringify(next, null, 2) + '\n'), preserved: name };
}

export async function prepareUpdate({ source = defaultSource, target = defaultTarget } = {}) {
  source = path.resolve(source); target = path.resolve(target);
  if (target === path.parse(target).root || source === path.parse(source).root) throw new Error('A disk root cannot be a project folder.');
  await ordinaryRoot(source); await ordinaryRoot(target);
  const realSource = await fs.realpath(source), realTarget = await fs.realpath(target);
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const a = normalized(realSource), b = normalized(realTarget);
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw new Error('Extract the new package into a separate folder outside the old project.');
  const sourcePkg = await projectAt(realSource), targetPkg = await projectAt(realTarget);
  if (compareVersion(sourcePkg.version, targetPkg.version) < 0) throw new Error('Refusing to downgrade a newer project.');
  await ordinaryPath(realSource, 'UPDATE-MANIFEST.json');
  const manifestBytes = await fs.readFile(path.join(realSource, 'UPDATE-MANIFEST.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== 1 || manifest.project !== projectName || manifest.version !== sourcePkg.version || !Array.isArray(manifest.files) || manifest.files.length < 3 || manifest.files.length > 5000) throw new Error('Invalid or mismatched update manifest.');
  const templates = await previousWechatTemplates(realTarget);
  const seen = new Set(), files = [], preserved = []; let totalBytes = 0;
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid manifest entry.');
    const name = entry.path, lower = String(name).toLowerCase();
    if (!permittedUpdatePath(name) || seen.has(lower) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 20 * 1024 * 1024) throw new Error('Unsafe or duplicate manifest entry.');
    seen.add(lower);
    totalBytes += entry.bytes;
    if (totalBytes > 200 * 1024 * 1024) throw new Error('Update package exceeds the 200 MB source-code limit.');
    await ordinaryPath(realSource, name); await ordinaryPath(realTarget, name, true);
    const bytes = await fs.readFile(path.join(realSource, name));
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error('Package integrity check failed: ' + name);
    const targetFile = path.join(realTarget, name);
    let existed = false;
    try { existed = (await fs.lstat(targetFile)).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const settings = existed ? await retainDeploymentSettings(targetFile, name, bytes, templates) : { bytes };
    if (settings.preserved) preserved.push(settings.preserved);
    if (!settings.skip) files.push({ name, bytes: settings.bytes, existed });
  }
  for (const required of ['package.json', 'services/platform/local.mjs', 'dist/index.html']) if (!seen.has(required)) throw new Error('The package manifest is incomplete.');
  const manifestName = 'UPDATE-MANIFEST.json';
  await ordinaryPath(realTarget, manifestName, true);
  let hadManifest = true;
  try { await fs.access(path.join(realTarget, manifestName)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; hadManifest = false; }
  return { source: realSource, target: realTarget, fromVersion: targetPkg.version, toVersion: sourcePkg.version, files, preserved,
    manifestFile: { name: manifestName, bytes: manifestBytes, existed: hadManifest } };
}

export async function applyUpdate(options = {}) {
  const plan = await prepareUpdate(options);
  const suffix = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex');
  const backup = plan.target + '.backup-' + suffix;
  await fs.mkdir(backup, { recursive: false });
  const receipt = { project: projectName, target: plan.target, fromVersion: plan.fromVersion, toVersion: plan.toVersion, status: 'BACKING_UP', createdAt: new Date().toISOString(), overwritten: [], added: [], preserved: plan.preserved };
  const receiptPath = path.join(backup, 'UPDATE-RECEIPT.json');
  const saveReceipt = () => fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  const completed = [];
  const installFiles = [...plan.files, plan.manifestFile];
  try {
    for (const file of installFiles) {
      await ordinaryPath(plan.target, file.name, true);
      if (file.existed) {
        const dest = path.join(backup, 'code', file.name);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(path.join(plan.target, file.name), dest);
        receipt.overwritten.push(file.name);
      } else receipt.added.push(file.name);
    }
    receipt.status = 'APPLYING'; await saveReceipt();
    for (const file of installFiles) {
      await ordinaryPath(plan.target, file.name, true);
      const destination = path.join(plan.target, file.name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = destination + '.gongzao-' + suffix + '.tmp';
      try { await fs.writeFile(temporary, file.bytes, { flag: 'wx' }); await fs.rename(temporary, destination); completed.push(file); }
      finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    receipt.status = 'COMPLETE'; receipt.completedAt = new Date().toISOString(); await saveReceipt();
    return { target: plan.target, backup, fromVersion: plan.fromVersion, toVersion: plan.toVersion, updatedFiles: plan.files.length, preserved: plan.preserved };
  } catch (error) {
    const rollbackErrors = [];
    for (const file of completed.reverse()) {
      try {
        await ordinaryPath(plan.target, file.name, true);
        if (file.existed) await fs.copyFile(path.join(backup, 'code', file.name), path.join(plan.target, file.name));
        else await fs.unlink(path.join(plan.target, file.name));
      } catch (rollbackError) { rollbackErrors.push(file.name + ': ' + rollbackError.code); }
    }
    receipt.status = rollbackErrors.length ? 'ROLLBACK_INCOMPLETE' : 'FAILED_ROLLED_BACK';
    receipt.error = error.message; receipt.rollbackErrors = rollbackErrors; await saveReceipt().catch(() => {});
    throw new Error('Update failed: ' + error.message + '\nCode backup: ' + backup + (rollbackErrors.length ? '\nAutomatic rollback was incomplete; keep the backup and do not restart until restored.' : '\nApplied code changes were rolled back. Local data was not copied or deleted.'));
  }
}

async function main() {
  let target = defaultTarget, mode = '--check';
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--target' && process.argv[i + 1]) target = process.argv[++i];
    else if (['--check', '--apply'].includes(process.argv[i])) mode = process.argv[i];
    else throw new Error('Usage: node tools/update-local.mjs --check|--apply [--target PATH]');
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  if (mode === '--apply') {
    if (process.platform !== 'win32' || process.env.GONGZAO_UPDATE_PREFLIGHT !== 'complete') throw new Error('Run UPDATE-WINDOWS.cmd so Windows process and database checks run first.');
    console.log(JSON.stringify(await applyUpdate({ target })));
  } else { const plan = await prepareUpdate({ target }); console.log(JSON.stringify({ target: plan.target, fromVersion: plan.fromVersion, toVersion: plan.toVersion, files: plan.files.length })); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
