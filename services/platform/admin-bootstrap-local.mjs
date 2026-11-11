// A local account's id is stable even when the owner of a sandbox workspace
// changes during registration. Only the installation operator can write this table.
const accountIdPattern = /^account_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const isLocalAccountId = value => typeof value === 'string' && accountIdPattern.test(value);

function storedSubject(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_admin_bootstrap'").get();
  return exists ? db.prepare('SELECT subject FROM local_admin_bootstrap WHERE singleton = 1').get()?.subject ?? null : null;
}

function accountExists(db, subject) {
  return isLocalAccountId(subject) && Boolean(db.prepare('SELECT 1 FROM auth_users WHERE id = ?').get(subject));
}

export function localBootstrapStatus(db, env = process.env) {
  const stored = storedSubject(db);
  const overridden = Object.hasOwn(env, 'GONGZAO_ADMIN_OWNER');
  const configured = overridden ? env.GONGZAO_ADMIN_OWNER : stored;
  const effective = accountExists(db, configured) ? configured : null;
  return { stored, effective, source: overridden ? 'environment' : stored ? 'database' : 'none' };
}

export function localBootstrapOwner(store, env = process.env) {
  return localBootstrapStatus(store.db, env).effective;
}

// With an immediate transaction, a second operator cannot overwrite a handover
// based on an owner they read before the first operator made their change.
export function setLocalBootstrap(db, { action, subject, previous, env = process.env, now = Date.now() }) {
  if (!['set', 'replace', 'clear'].includes(action)) throw new Error('未知的首管操作。');
  if (Object.hasOwn(env, 'GONGZAO_ADMIN_OWNER')) {
    throw new Error('服务由 GONGZAO_ADMIN_OWNER 指定首管。请在服务的启动环境中交接并重启，或先移除此设置再使用本机向导。');
  }
  if (action !== 'set' && !isLocalAccountId(previous)) throw new Error('交接或解除需要填写原首管的完整账号 ID。');
  if (action !== 'clear' && !isLocalAccountId(subject)) throw new Error('请使用已注册账号的完整账号 ID。');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = storedSubject(db);
    if (action === 'set' && current && current !== subject) throw new Error('此数据库已有首管。请使用交接，并核对原首管 ID。');
    if (action !== 'set' && previous !== current) throw new Error('原首管与当前记录不一致，请重新查询当前数据库。');
    const next = action === 'clear' ? null : subject;
    if (next && !accountExists(db, next)) throw new Error('在选定数据库中没有找到这个已注册账号。');
    if (current !== next) {
      db.exec(`CREATE TABLE IF NOT EXISTS local_admin_bootstrap (
        singleton INTEGER PRIMARY KEY CHECK (singleton=1), subject TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_admin_bootstrap_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, changed_at INTEGER NOT NULL,
        action TEXT NOT NULL, old_subject TEXT, new_subject TEXT
      )`);
      if (next) db.prepare('INSERT INTO local_admin_bootstrap(singleton,subject) VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET subject=excluded.subject').run(next);
      else db.prepare('DELETE FROM local_admin_bootstrap WHERE singleton=1').run();
      db.prepare('INSERT INTO local_admin_bootstrap_log(changed_at,action,old_subject,new_subject) VALUES(?,?,?,?)').run(now,action,current,next);
      db.exec('DELETE FROM local_admin_bootstrap_log WHERE sequence <= (SELECT MAX(sequence)-200 FROM local_admin_bootstrap_log)');
    }
    db.exec('COMMIT');
    return { changed: current !== next, subject: next };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function localBootstrapHistory(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_admin_bootstrap_log'").get();
  return exists ? db.prepare('SELECT sequence, changed_at, action, old_subject, new_subject FROM local_admin_bootstrap_log ORDER BY sequence DESC LIMIT 200').all() : [];
}
