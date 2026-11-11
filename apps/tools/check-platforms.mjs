#!/usr/bin/env node
/** Static source checks only. This does not compile, sign, install or launch any native app. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareWebAssets } from './prepare-web-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node apps/tools/check-platforms.mjs [--target all|mobile|desktop|weapp]');
  process.exit(0);
}
let target = 'all';
if (args.length) {
  if (args.length !== 2 || args[0] !== '--target' || !['all', 'mobile', 'desktop', 'weapp'].includes(args[1])) {
    console.error('Invalid arguments. Use --target all|mobile|desktop|weapp.');
    process.exit(2);
  }
  target = args[1];
}
const failures = [], notices = new Set(), parsed = new Map(), syntaxChecked = new Set();
if (target !== 'weapp') {
  try { await prepareWebAssets({ checkOnly: true }); }
  catch (error) { failures.push(error.message); }
}
let checks = 0;
const relative = file => path.relative(repo, file).split(path.sep).join('/');
function check(condition, message) { checks++; if (!condition) failures.push(message); return Boolean(condition); }
function note(message) { notices.add(message); }
function exists(file) { return fs.existsSync(file) && fs.statSync(file).isFile(); }
function read(file) {
  if (!check(exists(file), `${relative(file)}: missing file`)) return '';
  return fs.readFileSync(file, 'utf8');
}
function json(file) {
  if (parsed.has(file)) return parsed.get(file);
  const content = read(file);
  if (!content) return null;
  try { const value = JSON.parse(content); parsed.set(file, value); return value; }
  catch (error) { failures.push(`${relative(file)}: invalid JSON (${error.message})`); return null; }
}
function syntax(file) {
  if (syntaxChecked.has(file)) return;
  syntaxChecked.add(file);
  const browserAsset = within(path.join(repo, 'apps/shared/web'), file);
  const result = spawnSync(process.execPath, browserAsset ? ['--check', '--input-type=module'] : ['--check', file], { encoding: 'utf8', ...(browserAsset ? { input: fs.readFileSync(file, 'utf8') } : {}) });
  check(result.status === 0, `${relative(file)}: JavaScript syntax failed\n${(result.stderr || result.error?.message || '').trim()}`);
}
const ignored = new Set(['node_modules', 'target', 'gen', '.git', '.gradle', 'android', 'ios', 'build']);
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory() && !ignored.has(item.name)) walk(file);
    else if (item.isFile() && /\.(?:json|webmanifest)$/.test(item.name)) json(file);
    else if (item.isFile() && /\.(?:js|mjs|cjs)$/.test(item.name)) syntax(file);
  }
}
function within(root, file) {
  const delta = path.relative(root, file);
  return delta === '' || (!delta.startsWith('..' + path.sep) && delta !== '..' && !path.isAbsolute(delta));
}
function appIdentifier(id, file) {
  check(typeof id === 'string' && /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(id), `${relative(file)}: use a reverse-domain app identifier with alphanumeric segments`);
  if (typeof id === 'string' && id.startsWith('com.example.')) note(`${relative(file)}: com.example is a placeholder; replace before release.`);
}
function distAt(directory, configured, file) {
  if (!check(typeof configured === 'string' && configured.length > 0, `${relative(file)}: missing local dist path`)) return;
  const resolved = path.resolve(directory, configured);
  check(resolved === path.join(repo, 'apps/shared/web'), `${relative(file)}: web resources must resolve to browser-only apps/shared/web/`);
  const index = path.join(resolved, 'index.html');
  const html = read(index);
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) {
    const link = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) continue;
    const clean = link.split(/[?#]/)[0];
    if (!clean) continue;
    const asset = path.resolve(resolved, clean.replace(/^\//, ''));
    check(within(resolved, asset) && exists(asset), `${relative(index)}: missing or out-of-dist asset ${clean}`);
  }
}

function mobile() {
  const dir = path.join(repo, 'apps/mobile'); walk(dir);
  const packageFile = path.join(dir, 'package.json'); const pkg = json(packageFile);
  const configFile = path.join(dir, 'capacitor.config.json'); const config = json(configFile);
  if (!pkg || !config) return;
  appIdentifier(config.appId, configFile); distAt(dir, config.webDir, configFile);
  for (const name of ['@capacitor/core', '@capacitor/android', '@capacitor/ios']) check(/^\^?8(?:\.|$)/.test(pkg.dependencies?.[name] || ''), `${relative(packageFile)}: ${name} must stay on the selected major 8`);
  check(/^\^?8(?:\.|$)/.test(pkg.devDependencies?.['@capacitor/cli'] || ''), `${relative(packageFile)}: Capacitor CLI must stay on major 8`);
  for (const name of ['sync', 'add:android', 'add:ios', 'open:android', 'open:ios']) check(typeof pkg.scripts?.[name] === 'string', `${relative(packageFile)}: missing ${name} script`);
  if (config.server?.url) note(`${relative(configFile)}: remote server.url is configured; verify that this is not a development URL in a release build.`);
  if (!exists(path.join(dir, 'package-lock.json'))) note('apps/mobile: no npm lockfile yet; npm ci is unavailable until a reviewed lockfile is committed.');
}
function desktop() {
  const dir = path.join(repo, 'apps/desktop'); walk(dir);
  const packageFile = path.join(dir, 'package.json'); const pkg = json(packageFile);
  const configFile = path.join(dir, 'src-tauri/tauri.conf.json'); const config = json(configFile);
  if (!pkg || !config) return;
  appIdentifier(config.identifier, configFile); distAt(path.dirname(configFile), config.build?.frontendDist, configFile);
  check(/^\^?2(?:\.|$)/.test(pkg.devDependencies?.['@tauri-apps/cli'] || ''), `${relative(packageFile)}: Tauri CLI must stay on the selected major 2`);
  for (const name of ['src-tauri/Cargo.toml', 'src-tauri/build.rs', 'src-tauri/src/lib.rs', 'src-tauri/src/main.rs', 'app-icon.svg']) read(path.join(dir, name));
  const icon = read(path.join(dir, 'app-icon.svg'));
  check(/<svg\b/.test(icon), 'apps/desktop/app-icon.svg: expected SVG icon source');
  check(/(?:^|\s)tauri\s+icon\b/.test(pkg.scripts?.icons || ''), `${relative(packageFile)}: missing Tauri icon generation script`);
  for (const hook of ['predev', 'prebuild']) check(/(?:npm|pnpm|yarn)(?:\s+run)?\s+icons\b/.test(pkg.scripts?.[hook] || ''), `${relative(packageFile)}: ${hook} must generate platform icons`);
  const labels = new Set((config.app?.windows || []).map(window => window.label));
  check(labels.size > 0 && !labels.has(undefined), `${relative(configFile)}: define named app windows`);
  const capabilityDir = path.join(dir, 'src-tauri/capabilities');
  check(fs.existsSync(capabilityDir), `${relative(capabilityDir)}: missing capabilities directory`);
  for (const entry of fs.existsSync(capabilityDir) ? fs.readdirSync(capabilityDir) : []) {
    if (!entry.endsWith('.json')) continue;
    const capFile = path.join(capabilityDir, entry); const cap = json(capFile); if (!cap) continue;
    for (const window of cap.windows || []) {
      const pattern = '^' + String(window).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
      check([...labels].some(label => new RegExp(pattern).test(label)), `${relative(capFile)}: window ${window} does not match an app window`);
    }
  }
  check(Array.isArray(config.bundle?.icon) && config.bundle.icon.length > 0, `${relative(configFile)}: missing bundle icon paths`);
  for (const entry of config.bundle?.icon || []) check(typeof entry === 'string' && within(path.join(dir, 'src-tauri/icons'), path.resolve(path.dirname(configFile), entry)), `${relative(configFile)}: icon must be generated under src-tauri/icons/`);
  if (!exists(path.join(dir, 'package-lock.json')) || !exists(path.join(dir, 'src-tauri/Cargo.lock'))) note('apps/desktop: npm/Cargo lockfiles are not both present; reproducible native CI still needs reviewed lockfiles.');
}

const nativeTags = new Set(('view text button input textarea picker picker-view picker-view-column switch slider checkbox checkbox-group radio radio-group label form navigator image scroll-view swiper swiper-item movable-area movable-view cover-view cover-image icon rich-text progress video audio camera live-player live-pusher canvas map web-view ad ad-custom official-account open-data editor page-container page-meta navigation-bar root-portal match-media keyboard-accessory channel-live channel-video voip-room functional-page-navigator block template import include slot wxs component').split(' '));
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function weapp() {
  const dir = path.join(repo, 'apps/weapp'); walk(dir);
  const projectFile = path.join(dir, 'project.config.json'); const project = json(projectFile);
  const appFile = path.join(dir, 'app.json'); const app = json(appFile); if (!app || !project) return;
  check(path.resolve(dir, project.miniprogramRoot || '.') === dir, `${relative(projectFile)}: miniprogramRoot must resolve to apps/weapp/`);
  if (project.appid === 'touristappid') note('apps/weapp: touristappid is a local preview placeholder; real preview/publishing requires a registered AppID and current tool permissions.');
  else check(/^wx[0-9a-f]{16}$/i.test(project.appid || ''), `${relative(projectFile)}: expected touristappid or a real wx AppID`);
  const pages = [...(app.pages || [])];
  for (const sub of app.subPackages || app.subpackages || []) for (const page of sub.pages || []) pages.push(`${sub.root}/${page}`);
  check(pages.length > 0 && new Set(pages).size === pages.length, `${relative(appFile)}: pages must be present and unique`);
  for (const tab of app.tabBar?.list || []) check(pages.includes(tab.pagePath), `${relative(appFile)}: tabBar route ${tab.pagePath} is not declared`);
  const seen = new Set();
  function componentBase(sourceDirectory, value) {
    if (typeof value !== 'string') return null;
    if (/^(?:plugin|dynamicLib):\/\//.test(value)) { note(`apps/weapp: external component ${value} needs runtime/plugin validation.`); return null; }
    const resolved = value.startsWith('/') ? path.resolve(dir, value.slice(1)) : path.resolve(sourceDirectory, value);
    if (!check(within(dir, resolved), `apps/weapp: component path escapes project: ${value}`)) return null;
    return resolved;
  }
  function inspect(base, isPage = false) {
    if (seen.has(base)) return; seen.add(base);
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) check(exists(base + extension), `${relative(base + extension)}: missing ${isPage ? 'page' : 'component'} file`);
    const conf = json(base + '.json'); const js = read(base + '.js'); const wxml = read(base + '.wxml');
    if (!conf) return;
    const declarations = { ...(app.usingComponents || {}), ...(conf.usingComponents || {}) };
    for (const match of wxml.matchAll(/<\s*([A-Za-z][\w:-]*)\b/g)) check(nativeTags.has(match[1]) || Object.hasOwn(declarations, match[1]), `${relative(base + '.wxml')}: undeclared component <${match[1]}>`);
    for (const match of wxml.matchAll(/\b(?:capture-)?(?:bind|catch)(?::[\w-]+|[a-z][\w-]*)\s*=\s*['"]([^'"]+)['"]/g)) {
      const handler = match[1];
      if (handler.includes('{{')) { note(`${relative(base + '.wxml')}: dynamic event handler requires runtime validation.`); continue; }
      const name = escapeRegex(handler);
      check(new RegExp(`(?:^|[\\s,{])(?:async\\s+)?${name}\\s*(?:\\([^)]*\\)\\s*\\{|:\\s*(?:(?:async\\s+)?function\\b|(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>))`, 'm').test(js), `${relative(base + '.wxml')}: handler ${handler} is not declared in the corresponding JS`);
    }
    for (const [name, value] of Object.entries(declarations)) {
      const sourceDir = Object.hasOwn(conf.usingComponents || {}, name) ? path.dirname(base) : dir;
      const resolved = componentBase(sourceDir, value); if (resolved) inspect(resolved);
    }
    for (const match of wxml.matchAll(/<(?:import|include|wxs)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g)) {
      const resolved = componentBase(path.dirname(base), match[1]);
      if (resolved) check(exists(resolved), `${relative(base + '.wxml')}: missing template/script ${match[1]}`);
    }
  }
  for (const page of pages) {
    const base = path.resolve(dir, page);
    if (check(within(dir, base), `${relative(appFile)}: page path escapes project`)) inspect(base, true);
  }
}

if (target === 'all' || target === 'mobile') mobile();
if (target === 'all' || target === 'desktop') desktop();
if (target === 'all' || target === 'weapp') weapp();
walk(path.join(repo, 'apps/shared'));
const sharedClient = path.join(repo, 'apps/shared/api-client.js');
const miniClient = path.join(repo, 'apps/weapp/utils/api-client.js');
if ((target === 'all' || target === 'weapp') && exists(sharedClient) && exists(miniClient)) {
  const source = fs.readFileSync(sharedClient, 'utf8');
  let bundled = fs.readFileSync(miniClient, 'utf8');
  const generatedHeader = '// Generated from apps/shared/api-client.js; run node apps/tools/sync-client.mjs.\n';
  if (bundled.startsWith(generatedHeader)) bundled = bundled.slice(generatedHeader.length);
  check(source === bundled, 'apps/weapp/utils/api-client.js differs from the shared client; run node apps/tools/sync-client.mjs.');
}
const serviceConfig = path.join(repo, 'apps/weapp/config/service.js');
if (exists(serviceConfig)) {
  const source = read(serviceConfig);
  const match = source.match(/\bAPI_BASE\s*(?::|=)\s*(['"`])([^'"`\r\n]*)\1/);
  if (!match) note('apps/weapp/config/service.js: API_BASE is not a static literal; validate the resolved HTTPS URL before enabling server mode.');
  else if (!match[2]) note('apps/weapp: API_BASE is empty; server mode remains unconfigured.');
  else {
    try {
      const url = new URL(match[2]);
      check(url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.hash, 'apps/weapp/config/service.js: API_BASE must be an HTTPS URL without embedded credentials or fragments');
      if (target === 'all' || target === 'desktop') {
        const config = json(path.join(repo, 'apps/desktop/src-tauri/tauri.conf.json'));
        const csp = config?.app?.security?.csp;
        const connects = typeof csp === 'string' ? (csp.match(/(?:^|;)\s*connect-src\s+([^;]+)/)?.[1] || '').split(/\s+/) : csp?.['connect-src'];
        if (!(Array.isArray(connects) ? connects : String(connects || '').split(/\s+/)).includes(url.origin)) note(`apps/desktop: add the exact HTTPS backend origin ${url.origin} to a reviewed Tauri CSP override before enabling server mode; do not use a wildcard.`);
      }
    } catch { failures.push('apps/weapp/config/service.js: API_BASE is not a valid URL'); }
  }
  if (/\bAUTH_ADAPTER_READY\s*(?::|=)\s*false\b/.test(source)) note('apps/weapp: authentication adapter is disabled; protected server operations must remain blocked.');
}
for (const message of notices) console.log(`NOTE ${message}`);
if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  console.error(`Static checks failed: ${failures.length} issue(s), ${checks} checks.`);
  process.exitCode = 1;
} else console.log(`PASS ${target}: ${checks} static checks, ${parsed.size} JSON files, ${syntaxChecked.size} JavaScript syntax checks. Native build, signing, simulator and device validation were not performed.`);
