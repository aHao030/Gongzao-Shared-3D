import { backup, DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openExistingAccountDatabase } from './admin-access.mjs';

const DATABASE = 'platform.sqlite';
const MANIFEST = 'gongzao-backup.private.json';
const FORMAT = 'gongzao-sqlite-snapshot-v1';
const defaultDatabase = fileURLToPath(new URL('../data/platform.sqlite', import.meta.url));
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const help = `共造 · SQLite 备份与恢复演练

  npm run admin:backup -- create --out <新备份目录> [--db <当前数据库文件>]
  npm run admin:backup -- verify --from <备份目录> [--sha256 <另存的校验值>]
  npm run admin:backup -- restore --from <备份目录> --out <新恢复目录> [--sha256 <另存的校验值>]

create 使用服务的 DATA_PATH 或项目 data/platform.sqlite，支持运行中备份。
输出目录须为新目录，父目录须已存在。请另存创建时输出的 SHA-256。
restore 仅写入指定新目录。恢复上线前请在隔离环境复核首管、委派、会话与节点凭据。
生产环境变量、外部供应商凭据和配置文件请单独备份与核对。`;

async function privateDirectory(destination) {
  const resolved = path.resolve(destination);
  try { await mkdir(resolved, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('输出目录已存在，请选择一个全新的目录。');
    throw error;
  }
  // Restrict the directory before writing any SQLite pages. On Windows POSIX
  // mode bits are insufficient, so grant the current SID and drop inherited ACLs.
  if (process.platform === 'win32') {
    try {
      const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      const who = spawnSync(path.join(system,'whoami.exe'), ['/user','/fo','csv','/nh'], { encoding: 'utf8', windowsHide:true });
      const sid = who.status === 0 && who.stdout?.match(/\bS-1-[0-9-]+\b/i)?.[0];
      if (!sid) throw new Error();
      for (const args of [['/grant:r', '*'+sid+':(OI)(CI)F'], ['/inheritance:r']]) {
        const acl=spawnSync(path.join(system,'icacls.exe'),[resolved,...args],{windowsHide:true});
        if (acl.status !== 0) throw new Error();
      }
    } catch {
      await rm(resolved,{recursive:true,force:true});
      throw new Error('无法设置仅当前操作者可读写的备份目录。请选择支持 Windows 访问控制的本地目录。');
    }
  }
  return resolved;
}

async function digestFile(filename) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const part of createReadStream(filename)) {
    hash.update(part);
    bytes += part.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

function verifySQLite(filename) {
  const url = pathToFileURL(filename);
  url.searchParams.set('mode','ro');
  url.searchParams.set('immutable','1'); // Verify exactly the hashed snapshot, without journals.
  const db = new DatabaseSync(url.href, { readOnly:true });
  try {
    const checks = db.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok') throw new Error('SQLite 完整性校验失败。');
    db.prepare('SELECT owner, revision, data FROM platform_workspaces LIMIT 0');
    db.prepare('SELECT id, provider FROM auth_users LIMIT 0');
  } finally { db.close(); }
}

export async function createSnapshot({ database = process.env.DATA_PATH || defaultDatabase, out }) {
  const { db } = openExistingAccountDatabase(database,true);
  let directory;
  try {
    directory = await privateDirectory(out);
    const file = path.join(directory, DATABASE);
    await writeFile(file, Buffer.alloc(0), { mode:0o600, flag:'wx' });
    // SQLite's online backup API reads a consistent database snapshot, including
    // committed WAL pages, while existing clients can keep using the source.
    await backup(db, file);
    const copy = new DatabaseSync(file);
    try {
      const mode = copy.prepare('PRAGMA journal_mode=DELETE').get().journal_mode;
      if (mode !== 'delete') throw new Error('无法生成独立的 SQLite 快照。');
    } finally { copy.close(); }
    verifySQLite(file);
    const summary = { format:FORMAT, createdAt:new Date().toISOString(), ...(await digestFile(file)) };
    await writeFile(path.join(directory,MANIFEST),JSON.stringify(summary,null,2)+'\n',{ mode:0o600, flag:'wx' });
    return { directory, ...summary };
  } catch (error) {
    if (directory) await rm(directory,{recursive:true,force:true});
    throw error;
  } finally { db.close(); }
}

async function ordinaryFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('备份必须由普通文件组成。');
  return info;
}

export async function verifySnapshot({ from, expectedHash }) {
  const directory = path.resolve(from);
  if (!(await lstat(directory)).isDirectory()) throw new Error('备份目录无效。');
  const manifestFile = path.join(directory,MANIFEST);
  if ((await ordinaryFile(manifestFile)).size > 4096) throw new Error('备份清单格式不正确。');
  const summary = JSON.parse(await readFile(manifestFile,'utf8'));
  if (!summary || summary.format !== FORMAT || !validDigest(summary.sha256) || !Number.isSafeInteger(summary.bytes) || summary.bytes <= 0) throw new Error('备份清单格式不正确。');
  if (expectedHash !== undefined && (!validDigest(expectedHash) || expectedHash.toLowerCase() !== summary.sha256)) throw new Error('备份与另存的 SHA-256 不匹配。');
  const file = path.join(directory,DATABASE);
  if ((await ordinaryFile(file)).size !== summary.bytes) throw new Error('备份字节数不一致。');
  for (const suffix of ['-wal','-shm','-journal']) {
    try { await lstat(file+suffix); }
    catch (error) { if (error.code==='ENOENT') continue; throw error; }
    throw new Error('备份目录含有额外的 SQLite 日志文件，请使用原始快照。');
  }
  const actual = await digestFile(file);
  if (actual.bytes !== summary.bytes || actual.sha256 !== summary.sha256) throw new Error('备份 SHA-256 校验失败。');
  verifySQLite(file);
  return { directory, bytes:actual.bytes, sha256:actual.sha256 };
}

export async function restoreSnapshot({ from, out, expectedHash }) {
  const verified = await verifySnapshot({from,expectedHash});
  const directory = await privateDirectory(out);
  try {
    const file = path.join(directory,DATABASE);
    // A new inode inherits this private directory's ACL, including on Windows.
    // Only database bytes are copied from the untrusted backup medium.
    await pipeline(createReadStream(path.join(verified.directory,DATABASE)),
      createWriteStream(file, { flags:'wx', mode:0o600 }));
    const actual = await digestFile(file);
    if (actual.bytes !== verified.bytes || actual.sha256 !== verified.sha256) throw new Error('恢复副本与已验证的快照不一致。');
    verifySQLite(file);
    return {directory, database:file, ...actual};
  } catch (error) {
    await rm(directory,{recursive:true,force:true});
    throw error;
  }
}

function readArguments(argv) {
  const [action,...rest] = argv;
  const fields = {create:['--db','--out'],verify:['--from','--sha256'],restore:['--from','--out','--sha256']};
  if (!Object.hasOwn(fields,action)) throw new Error('请选择 create、verify 或 restore。');
  const result = {};
  for (let i=0;i<rest.length;i+=2) {
    const name=rest[i], value=rest[i+1];
    if (!fields[action].includes(name) || !value || value.startsWith('--') || Object.hasOwn(result,name)) throw new Error('参数无效，请查看 --help。');
    result[name]=value;
  }
  if (action!=='verify' && !result['--out']) throw new Error('请提供 --out 指定新目录。');
  if (action!=='create' && !result['--from']) throw new Error('请提供 --from 指定备份目录。');
  return {action,options:{database:result['--db'],from:result['--from'],out:result['--out'],expectedHash:result['--sha256']}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) console.log(help);
  else {
    try {
      const {action,options}=readArguments(args);
      const result = action==='create' ? await createSnapshot(options) : action==='restore' ? await restoreSnapshot(options) : await verifySnapshot(options);
      console.log('已完成：'+(result.database || result.directory));
      console.log('数据库字节数：'+result.bytes+'\nSHA-256：'+result.sha256);
      if (action==='restore') console.log('副本未启用。上线前请复核回卷的账号会话、管理授权与服务节点凭据。');
    } catch (error) { console.error(error.message); process.exitCode=1; }
  }
}
