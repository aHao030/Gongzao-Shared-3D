import { DatabaseSync } from 'node:sqlite';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { isLocalAccountId, localBootstrapHistory, localBootstrapStatus, setLocalBootstrap } from '../services/platform/admin-bootstrap-local.mjs';

const defaultDatabase = fileURLToPath(new URL('../data/platform.sqlite', import.meta.url));
const help = `共造 · 首位管理员设置

先用准备担任首管的账号登录本机的 /admin/login，核对页面显示的账号 ID。
Windows 可双击 ADMIN-WINDOWS.cmd。终端运行 npm run admin:setup 可进入向导。

  npm run admin:setup -- status
  npm run admin:setup -- lookup --email <已注册邮箱>
  npm run admin:setup -- set --id <账号ID>
  npm run admin:setup -- replace --previous <原首管ID> --id <新首管ID>
  npm run admin:setup -- clear --previous <原首管ID>
  npm run admin:setup -- history

所有命令可通过 --db <数据库文件> 指定实例，也支持服务启动时的 DATA_PATH。
环境变量 GONGZAO_ADMIN_OWNER 优先于本机记录。角色变更在下一次后台请求时生效。`;

export function openExistingAccountDatabase(filename, readOnly = false) {
  let actualPath;
  try {
    actualPath = realpathSync(filename);
    if (!statSync(actualPath).isFile()) throw new Error();
  } catch {
    throw new Error('数据库不存在或不可读。请先启动平台并注册账号，再核对 DATA_PATH 或 --db。');
  }
  const url = pathToFileURL(actualPath);
  url.searchParams.set('mode', readOnly ? 'ro' : 'rw');
  const db = new DatabaseSync(url.href, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    db.prepare('SELECT id, provider, email, external_email, email_verified FROM auth_users LIMIT 0');
    db.prepare('SELECT owner FROM platform_workspaces LIMIT 0');
    return { db, actualPath };
  } catch {
    db.close();
    throw new Error('文件中缺少共造平台账号表或工作区表，请核对数据库路径。');
  }
}

export function findAccounts(db, email) {
  if (typeof email !== 'string' || !email.trim() || email.length > 254 || /[\x00-\x1f\x7f]/.test(email)) throw new Error('请提供已注册的邮箱。');
  return db.prepare(`SELECT id, provider, email_verified FROM auth_users
    WHERE (provider='email' AND email=?) OR (provider='oidc' AND external_email=? AND email_verified=1)
    ORDER BY created_at, id`).all(email.trim().toLowerCase(), email.trim().toLowerCase());
}

function describeStatus(db) {
  const status = localBootstrapStatus(db);
  if (status.source === 'environment') {
    console.log('权限来源：服务环境 GONGZAO_ADMIN_OWNER');
    console.log(status.effective ? '当前首管 ID：' + status.effective : '环境值没有匹配本库的注册账号，当前首管授权已关闭。');
    if (status.stored) console.log('环境值移除后，数据库绑定为：' + status.stored);
  } else {
    console.log(status.stored ? '本机绑定的首管 ID：' + status.stored : '本机还未绑定首管。');
    if (status.stored && !status.effective) console.log('原账号不存在，可使用交接将权限转给已注册的新账号。');
  }
  return status;
}

function parseArgs(args) {
  const options = {};
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : null;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index+1];
    if (!['--db','--email','--id','--previous'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options,key)) throw new Error('参数不正确。运行 npm run admin:setup -- --help 查看用法。');
    options[key] = value;
  }
  if (command && !['status','lookup','set','replace','clear','history'].includes(command)) throw new Error('未知操作，请查看 --help。');
  const allowed = {status:[], lookup:['--email'], set:['--id'], replace:['--id','--previous'], clear:['--previous'], history:[]};
  for (const key of Object.keys(options)) {
    if (key !== '--db' && !allowed[command]?.includes(key)) throw new Error('当前操作不支持此参数：' + key);
  }
  return {command, options};
}

function lookup(db, email) {
  const accounts = findAccounts(db, email);
  if (!accounts.length) throw new Error('此数据库中没有对应的邮箱账号。第三方登录用户也可直接使用自己页面上的账号 ID。');
  for (const account of accounts) console.log(account.id, account.provider === 'oidc' ? '第三方账号' : '本机邮箱账号');
  console.log('请与该用户登录 /admin/login 后显示的账号 ID 核对，再授权。');
}

async function guided(db) {
  const status = describeStatus(db);
  if (status.source === 'environment') return;
  const rl = createInterface({input:stdin,output:stdout});
  try {
    const action = status.stored
      ? await rl.question('输入 1 交接、2 解除、3 按邮箱查询，直接回车退出：')
      : await rl.question('输入 1 开通首管、3 按邮箱查询，直接回车退出：');
    if (!action.trim()) return;
    if (action.trim() === '3') return lookup(db, await rl.question('已注册邮箱：'));
    if (action.trim() !== '1' && !(status.stored && action.trim() === '2')) throw new Error('选项无效。');
    const clearing = action.trim() === '2';
    const previous = status.stored ? (await rl.question('原首管的完整账号 ID：')).trim() : undefined;
    const subject = clearing ? undefined : (await rl.question('新首管已登录账号的完整 ID：')).trim();
    if (subject && !isLocalAccountId(subject)) throw new Error('账号 ID 格式不正确，请复制 /admin/login 上显示的完整标识。');
    const result = setLocalBootstrap(db,{action:clearing ? 'clear' : status.stored ? 'replace' : 'set', previous, subject});
    console.log(result.changed ? '已保存。刷新平台管理页面即可查看当前权限。' : '绑定已是该账号。');
  } finally { rl.close(); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) { console.log(help); return; }
  const {command,options} = parseArgs([...args]);
  if (!command && !stdin.isTTY) { console.log(help); return; }
  const dbFile = resolve(options['--db'] ?? process.env.DATA_PATH ?? defaultDatabase);
  console.log('选择的数据库：' + dbFile);
  const {db,actualPath} = openExistingAccountDatabase(dbFile, ['status','history','lookup'].includes(command));
  try {
    if (actualPath !== dbFile) console.log('数据库实际位置：' + actualPath);
    if (!command) return await guided(db);
    if (command === 'status') { describeStatus(db); return; }
    if (command === 'lookup') return lookup(db,options['--email']);
    if (command === 'history') {
      const items=localBootstrapHistory(db);
      console.log('本机首管变更（最多保存最近 200 条）：');
      if (!items.length) console.log('暂无记录。');
      for (const item of items) console.log(new Date(item.changed_at).toISOString(),item.action,item.old_subject??'无','→',item.new_subject??'无');
      return;
    }
    const result = setLocalBootstrap(db,{action:command,previous:options['--previous'],subject:options['--id']});
    console.log(result.changed ? '已保存。刷新平台管理页面即可查看当前权限。' : '绑定已是该账号。');
  } finally {db.close();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
