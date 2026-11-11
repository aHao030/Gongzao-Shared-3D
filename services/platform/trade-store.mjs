import { ensure, sha256, scaledModelGeometry } from './geometry.mjs';
import { materials } from './catalog.mjs';
import { estimateBudget } from './budget-estimate.mjs';

const PAGE = 24;
const MESSAGES_PER_PAGE = 50;
const THREAD_LIMIT = 300;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const initialized = new WeakSet();
const shopTable = 'platform_trade_shops';
const threadTable = 'platform_trade_threads';
const schema = `
  CREATE TABLE IF NOT EXISTS platform_trade_shops (
    id TEXT PRIMARY KEY NOT NULL, merchant_id TEXT NOT NULL, owner TEXT NOT NULL,
    name TEXT NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, receipts TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS platform_trade_shops_merchant_id_unique ON platform_trade_shops(merchant_id);
  CREATE INDEX IF NOT EXISTS trade_visible_shops ON platform_trade_shops(enabled,id);
  CREATE TABLE IF NOT EXISTS platform_trade_threads (
    id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL, buyer_owner TEXT NOT NULL, create_key TEXT NOT NULL,
    create_digest TEXT NOT NULL, revision INTEGER NOT NULL, last_seq INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    buyer_read INTEGER NOT NULL, merchant_read INTEGER NOT NULL, buyer_unread INTEGER NOT NULL,
    merchant_unread INTEGER NOT NULL, summary TEXT NOT NULL, data TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS trade_create_retry ON platform_trade_threads(buyer_id,create_key);
  CREATE INDEX IF NOT EXISTS trade_buyer_inbox ON platform_trade_threads(buyer_id,updated_at,id);
  CREATE INDEX IF NOT EXISTS trade_merchant_inbox ON platform_trade_threads(merchant_id,updated_at,id);`;

function database(store) {
  const local = store.kind === 'sqlite';
  const db = !local && store.db.withSession ? store.db.withSession('first-primary') : store.db;
  function query(sql, args) {
    if (local && !initialized.has(db)) {
      db.exec(schema);
      initialized.add(db);
    }
    const statement = db.prepare(sql);
    return local ? statement : statement.bind(...args);
  }
  return {
    async one(sql,...args) { const q=query(sql,args); return local ? q.get(...args) : q.first(); },
    async all(sql,...args) { const q=query(sql,args); return local ? q.all(...args) : (await q.all()).results; },
    async write(sql,...args) { const q=query(sql,args); return local ? q.run(...args).changes : (await q.run()).meta.changes; }
  };
}

function auth(actor) {
  ensure(typeof actor?.id === 'string' && actor.id && typeof actor.ownerId === 'string' && actor.ownerId,
    401,'TRADE_LOGIN_REQUIRED','请用注册账号登录后继续');
}
function inputs(input, allowed) {
  ensure(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k=>allowed.includes(k)),
    400,'TRADE_INPUT','提交的字段不正确，请刷新后重试');
}
function count(n, min, max, message) {
  ensure(Number.isSafeInteger(n) && n>=min && n<=max,400,'TRADE_INPUT',message); return n;
}
function message(value, max, name) {
  ensure(typeof value === 'string',400,'TRADE_INPUT','请填写'+name);
  const s=value.trim();
  ensure(s && [...s].length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s),
    400,'TRADE_INPUT',name+'须为1–'+max+'字的文本'); return s;
}
function requestKey(key) {
  ensure(typeof key==='string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(key),400,'IDEMPOTENCY_REQUIRED','操作需要有效的唯一请求标识');
}
const hash = normalized => sha256(encoder.encode(JSON.stringify(normalized)));
const roleOf = (row,actor) => row.buyer_id===actor.id ? 'buyer' : 'merchant';
const memberClause = '(buyer_id=? OR merchant_id=?)';
function shopView(row) {
  return row ? {id:row.id,name:row.name,enabled:!!row.enabled,revision:row.revision} : null;
}
function threadView(row,actor) {
  const role=roleOf(row,actor);
  return {id:row.id, ...JSON.parse(row.summary), role, lastSeq:row.last_seq, updatedAt:row.updated_at,
    unread:role==='buyer' ? row.buyer_unread : row.merchant_unread};
}
function visibleMessage(entry) {
  const {seq,kind,sender,body,at,offer}=entry;
  return {seq,kind,sender,body,at,...(offer ? {offer} : {})};
}
function requestMatch(prior, digest) {
  ensure(prior===digest,409,'IDEMPOTENCY_CONFLICT','这个请求标识已用于其他操作');
}
function offerInput(input) {
  inputs(input,['amountCents','leadDays','terms','expectedVersion','shippingIncluded']);
  ensure(typeof input.shippingIncluded==='boolean',400,'TRADE_INPUT','请明确报价是否包含运费');
  return {
    amountCents:count(input.amountCents,1,100000000,'金额须为1分至100万元'),
    leadDays:count(input.leadDays,1,365,'预计发货天数须为1–365天'),
    shippingIncluded:input.shippingIncluded, terms:message(input.terms,500,'报价范围'),
    expectedVersion:count(input.expectedVersion,0,1000000,'报价版本不正确')
  };
}

// Shops use the verified account ID for authorization; a separate workspace ID
// is only used to read that account's own data and is never sent to the peer.
export function createTradeStore({store,clock=Date.now}) {
  const db=database(store);
  const ownShop=actor=>db.one('SELECT * FROM '+shopTable+' WHERE merchant_id=?',actor.id);
  async function visibleThread(actor,id) {
    auth(actor);
    const row=await db.one('SELECT * FROM '+threadTable+' WHERE id=? AND '+memberClause,id,actor.id,actor.id);
    ensure(row,404,'TRADE_THREAD_NOT_FOUND','找不到该会话'); return row;
  }
  async function shops(actor,{before}={}) {
    ensure(!before||/^shop_[a-f0-9-]{36}$/.test(before),400,'TRADE_CURSOR','店铺分页标识无效');
    const rows=await db.all('SELECT id,name,merchant_id FROM '+shopTable+' WHERE enabled=1'+(before?' AND id<?':'')+' ORDER BY id DESC LIMIT ?',...(before?[before]:[]),PAGE+1);
    const items=rows.slice(0,PAGE).map(r=>({id:r.id,name:r.name,mine:actor?.id===r.merchant_id}));
    return {shops:items,nextBefore:rows.length>PAGE?items.at(-1).id:null};
  }
  async function myShop(actor) {
    auth(actor);
    const workspace=await store.load(actor.ownerId);
    return {enrolled:!!workspace.merchant?.profile,shop:shopView(await ownShop(actor))};
  }
  async function publish(actor,input,key) {
    auth(actor); inputs(input,['enabled','expectedRevision']); requestKey(key);
    ensure(typeof input.enabled==='boolean',400,'TRADE_INPUT','请选择咨询入口状态');
    const expected=count(input.expectedRevision??0,0,Number.MAX_SAFE_INTEGER,'店铺版本无效');
    const wk=await store.load(actor.ownerId), name=wk.merchant?.profile?.name;
    ensure(name,403,'TRADE_MERCHANT_REQUIRED','请先开通商家资料');
    const digest=await hash([input.enabled,expected]);
    for(let attempt=0;attempt<12;attempt++){
      const row=await ownShop(actor);
      const history=row?JSON.parse(row.receipts):[];
      const done=history.find(x=>x.key===key);
      if(done){requestMatch(done.digest,digest);return {shop:done.shop,replayed:true};}
      ensure((row?.revision??0)===expected,409,'TRADE_SHOP_CHANGED','店铺已变更，请刷新后重试');
      const shop={id:row?.id??'shop_'+crypto.randomUUID(),name,enabled:input.enabled,revision:expected+1};
      const receipts=JSON.stringify([...history.slice(-63),{key,digest,shop}]);
      const changed=row ? await db.write('UPDATE '+shopTable+' SET name=?,enabled=?,revision=?,receipts=? WHERE id=? AND revision=?',name,+shop.enabled,shop.revision,receipts,shop.id,expected)
        : await db.write('INSERT OR IGNORE INTO '+shopTable+'(id,merchant_id,owner,name,enabled,revision,receipts) VALUES(?,?,?,?,?,?,?)',shop.id,actor.id,actor.ownerId,name,+shop.enabled,shop.revision,receipts);
      if(changed) return {shop};
    }
    ensure(false,409,'CONCURRENT_UPDATE','店铺正在更新，请用原请求重试');
  }
  async function shopWorkspaces(actor,shopId) {
    ensure(typeof shopId === 'string' && /^shop_[a-f0-9-]{36}$/.test(shopId),400,'TRADE_INPUT','请选择有效的店铺');
    const shop=await db.one('SELECT id,merchant_id,owner,name,revision FROM '+shopTable+' WHERE id=? AND enabled=1',shopId);
    ensure(shop,404,'TRADE_SHOP_CLOSED','该店铺当前未开放新咨询');
    ensure(shop.merchant_id!==actor.id && shop.owner!==actor.ownerId,409,'TRADE_SELF','请选择其他商家');
    const [customer,merchant]=await Promise.all([store.load(actor.ownerId),store.load(shop.owner)]);
    return {shop,customer,merchant};
  }
  async function preview(actor,input) {
    auth(actor);
    inputs(input,['shopId','modelId','material','quality','qty','unit','capabilityId']);
    const {shopId,...options}=input;
    const {shop,customer,merchant}=await shopWorkspaces(actor,shopId);
    const estimate=estimateBudget(customer,options,{merchantWorkspace:merchant,now:clock()});
    const stillOpen=await db.one('SELECT id FROM '+shopTable+' WHERE id=? AND enabled=1 AND revision=?',shopId,shop.revision);
    ensure(stillOpen,409,'TRADE_SHOP_CHANGED','店铺入口已变更，请刷新');
    return {estimate};
  }
  async function open(actor,input,key) {
    auth(actor); requestKey(key); inputs(input,['shopId','modelId','quantity','unit','shareFile','body','material','quality']);
    const {shopId,modelId,unit,shareFile,material='AUTO',quality='standard'}=input;
    const quantity=count(input.quantity,1,50,'数量须为1–50件的整数');
    ensure(typeof shopId==='string' && typeof modelId==='string' && ['mm','inch'].includes(unit) && typeof shareFile==='boolean',
      400,'TRADE_INPUT','请选择店铺、模型并确认文件单位和共享方式');
    ensure((material==='AUTO'||Object.hasOwn(materials,material)) && ['standard','fine'].includes(quality),400,'TRADE_INPUT','材料或质量选项无效');
    const body=message(input.body,1000,'咨询内容'),digest=await hash([shopId,modelId,quantity,unit,shareFile,material,quality,body]);
    const findReplay=async()=>{
      const previous=await db.one('SELECT id,create_digest FROM '+threadTable+' WHERE buyer_id=? AND create_key=?',actor.id,key);
      if(!previous)return null;
      requestMatch(previous.create_digest,digest);return {threadId:previous.id,replayed:true};
    };
    const prior=await findReplay(); if(prior)return prior;
    const {shop,customer,merchant}=await shopWorkspaces(actor,shopId);
    const model=customer.models?.find(m=>m.id===modelId);
    ensure(model,404,'MODEL_NOT_FOUND','请重新选择自己的模型');
    if(shareFile) {
      ensure(!model.isSample,409,'TRADE_SAMPLE_FILE','演示模型无法共享原文件');
      const bytes=await store.getFile(actor.ownerId,model.id);
      ensure(bytes && await sha256(bytes)===model.sha256,409,'TRADE_FILE_UNAVAILABLE','原文件无法核对，请重新上传或关闭原件共享');
    }
    const at=clock(), id='thread_'+crypto.randomUUID();
    const estimate=await estimateBudget(customer,{modelId,material,quality,qty:quantity,unit},{merchantWorkspace:merchant,now:at});
    const summary={shopName:shop.name,model:{name:model.name,format:model.format,dimensions:scaledModelGeometry(model,unit).dimensions,shared:shareFile,shareRevision:0,isSample:!!model.isSample},
      quantity,unit,material,quality,estimate,offer:null,lastMessage:body.slice(0,120)};
    const data={modelId:model.id,modelHash:model.sha256,messages:[{seq:1,kind:'text',sender:'buyer',body,at}]};
    const sql='INSERT OR IGNORE INTO '+threadTable+' (id,shop_id,buyer_id,merchant_id,buyer_owner,create_key,create_digest,revision,last_seq,updated_at,buyer_read,merchant_read,buyer_unread,merchant_unread,summary,data) '+
      'SELECT ?,?,?,?,?,?,?,1,1,?,1,0,0,1,?,? WHERE EXISTS (SELECT 1 FROM '+shopTable+' WHERE id=? AND merchant_id=? AND enabled=1 AND revision=?) '+
      'AND (SELECT COUNT(*) FROM '+threadTable+' WHERE buyer_id=?)<300 AND (SELECT COUNT(*) FROM '+threadTable+' WHERE merchant_id=?)<1500';
    const created=await db.write(sql,id,shopId,actor.id,shop.merchant_id,actor.ownerId,key,digest,at,JSON.stringify(summary),JSON.stringify(data),shopId,shop.merchant_id,shop.revision,actor.id,shop.merchant_id);
    if(created)return {threadId:id};
    const raced=await findReplay(); if(raced)return raced;
    const fresh=await db.one('SELECT revision,enabled FROM '+shopTable+' WHERE id=?',shopId);
    ensure(fresh?.enabled && fresh.revision===shop.revision,409,'TRADE_SHOP_CHANGED','店铺入口已变更，请刷新');
    ensure(false,409,'TRADE_INBOX_CAPACITY','咨询会话数量已达到当前容量');
  }
  async function inbox(actor,{before,role}={}) {
    auth(actor);
    ensure(!role||['buyer','merchant'].includes(role),400,'TRADE_INPUT','收件箱身份无效');
    const parts=before?/^(\d{1,16}):(thread_[a-f0-9-]{36})$/.exec(before):null;
    ensure(!before||parts,400,'TRADE_CURSOR','收件箱分页标识无效');
    const args=role?[actor.id]:[actor.id,actor.id];
    const where=role ? (role==='buyer'?'buyer_id=?':'merchant_id=?') : memberClause;
    if(parts)args.push(Number(parts[1]),parts[2]);
    const rows=await db.all('SELECT id,buyer_id,summary,last_seq,updated_at,buyer_unread,merchant_unread FROM '+threadTable+' WHERE '+where+
      (parts?' AND (updated_at,id)<(?,?)':'')+' ORDER BY updated_at DESC,id DESC LIMIT ?',...args,PAGE+1);
    const threads=rows.slice(0,PAGE).map(r=>threadView(r,actor)),last=threads.at(-1);
    return {threads,nextBefore:rows.length>PAGE?last.updatedAt+':'+last.id:null};
  }
  async function detail(actor,id,{after,before}={}) {
    const row=await visibleThread(actor,id), msgs=JSON.parse(row.data).messages;
    ensure(after==null||before==null,400,'TRADE_CURSOR','一次只可指定一个翻页方向');
    if(after!=null)count(after,0,Number.MAX_SAFE_INTEGER,'消息游标无效');
    if(before!=null)count(before,1,Number.MAX_SAFE_INTEGER,'消息游标无效');
    const selected=after!=null ? msgs.filter(m=>m.seq>after).slice(0,MESSAGES_PER_PAGE)
      : msgs.filter(m=>before==null||m.seq<before).slice(-MESSAGES_PER_PAGE);
    const messages=selected.map(visibleMessage);
    return {thread:threadView(row,actor),messages,nextAfter:messages.length&&messages.at(-1).seq<row.last_seq?messages.at(-1).seq:null,
      olderBefore:messages.length&&messages[0].seq>1?messages[0].seq:null};
  }
  async function append(actor,id,kind,normalized,key) {
    auth(actor);requestKey(key);
    const digest=await hash([kind,normalized]);
    for(let attempt=0;attempt<16;attempt++){
      const row=await visibleThread(actor,id), role=roleOf(row,actor), summary=JSON.parse(row.summary), data=JSON.parse(row.data);
      const previous=data.messages.find(m=>m.sender===role && m.key===key);
      if(previous){requestMatch(previous.digest,digest);return {threadId:id,seq:previous.seq,replayed:true};}
      const at=clock(), seq=row.last_seq+1, entry={seq,kind,sender:role,at,key,digest};
      const withdrawing = kind === 'sharing' && !normalized.shared;
      ensure(seq<=THREAD_LIMIT || withdrawing,409,'TRADE_THREAD_CAPACITY','当前会话已满，请新开咨询');
      if(kind==='text'){entry.body=normalized.body;}
      else if(kind==='offer'){
        ensure(role==='merchant',403,'TRADE_ROLE','仅会话中的商家可以报价');
        ensure(!summary.offer?.accepted,409,'TRADE_OFFER_ACCEPTED','此方案已经确认，请新开咨询讨论新方案');
        ensure((summary.offer?.version??0)===normalized.expectedVersion,409,'TRADE_OFFER_CHANGED','报价版本已变更，请刷新核对');
        const {amountCents,leadDays,terms,shippingIncluded}=normalized;
        entry.offer={version:normalized.expectedVersion+1,amountCents,currency:'CNY',leadDays,terms,shippingIncluded,createdAt:at,expiresAt:at+WEEK,accepted:false};
        summary.offer=entry.offer;entry.body='商家已发出第'+entry.offer.version+'版报价';
      } else if (kind === 'sharing') {
        ensure(role === 'buyer',403,'TRADE_ROLE','仅发起咨询的客户可变更原件共享');
        ensure(!summary.model.isSample,409,'TRADE_SAMPLE_FILE','演示模型无法共享原文件');
        const currentRevision = summary.model.shareRevision ?? 0;
        ensure(currentRevision === normalized.expectedRevision,409,'TRADE_SHARING_CHANGED','原件共享已变更，请刷新后核对');
        ensure(normalized.shared !== summary.model.shared,409,'TRADE_SHARING_UNCHANGED','原件共享状态未变化');
        if (normalized.shared) {
          const file = await store.getFile(row.buyer_owner,data.modelId);
          ensure(file && await sha256(file) === data.modelHash,409,'TRADE_FILE_UNAVAILABLE','原文件无法核对，请重新上传后发起新会话');
        }
        summary.model.shared = normalized.shared;
        summary.model.shareRevision = currentRevision + 1;
        entry.body = normalized.shared ? '客户已授权本店下载会话中的模型原件' : '客户已停止向本店共享模型原件';
      } else {
        ensure(role==='buyer',403,'TRADE_ROLE','仅咨询客户可以确认报价');
        ensure(summary.offer?.version===normalized.version,409,'TRADE_OFFER_CHANGED','报价已更新，请核对最新版本');
        ensure(!summary.offer.accepted,409,'TRADE_OFFER_ACCEPTED','该报价已经确认');
        ensure(at<summary.offer.expiresAt,409,'TRADE_OFFER_EXPIRED','报价已过期，请商家重新报价');
        entry.offer={...summary.offer,accepted:true,acceptedAt:at};summary.offer=entry.offer;entry.body='客户已确认第'+normalized.version+'版沟通报价';
      }
      summary.lastMessage=entry.body.slice(0,120); data.messages.push(entry);
      const payload=JSON.stringify(data);ensure(withdrawing || encoder.encode(payload).length<=768*1024,409,'TRADE_THREAD_CAPACITY','当前会话已满，请新开咨询');
      const changed=await db.write('UPDATE '+threadTable+' SET data=?,summary=?,last_seq=?,updated_at=?,revision=revision+1,'+
        'buyer_unread=buyer_unread+?,merchant_unread=merchant_unread+? WHERE id=? AND revision=?',payload,JSON.stringify(summary),seq,Math.max(at,row.updated_at),+(role==='merchant'),+(role==='buyer'),id,row.revision);
      if(changed)return {threadId:id,seq};
    }
    ensure(false,409,'CONCURRENT_UPDATE','消息正在更新，请用原请求标识重试');
  }
  async function read(actor,id,input) {
    inputs(input,['through']);const through=count(input.through,0,Number.MAX_SAFE_INTEGER,'已读消息序号无效');
    for(let attempt=0;attempt<12;attempt++){
      const row=await visibleThread(actor,id),role=roleOf(row,actor);
      ensure(through<=row.last_seq,400,'TRADE_READ_RANGE','只能标记已存在的消息');
      if(through<=row[role+'_read'])return {unread:row[role+'_unread']};
      const unread=JSON.parse(row.data).messages.filter(m=>m.sender!==role&&m.seq>through).length;
      const changed=await db.write('UPDATE '+threadTable+' SET '+role+'_read=?,'+role+'_unread=? WHERE id=? AND revision=? AND '+role+'_read<?',through,unread,id,row.revision,through);
      if(changed)return {unread};
    }
    ensure(false,409,'CONCURRENT_UPDATE','会话已更新，请重新标记已读');
  }
  async function download(actor,id) {
    const row=await visibleThread(actor,id), summary=JSON.parse(row.summary), data=JSON.parse(row.data);
    ensure(summary.model.shared,403,'TRADE_FILE_PRIVATE','客户未共享模型原件');
    const bytes=await store.getFile(row.buyer_owner,data.modelId);
    ensure(bytes,404,'FILE_NOT_FOUND','共享原件已不可用');
    ensure(await sha256(bytes)===data.modelHash,409,'MODEL_CHANGED','共享模型与当时的版本不一致');
    // Revocation may commit while R2 is reading a large file. Check the grant
    // again immediately before returning bytes. Already delivered copies remain.
    const checked = await db.one('SELECT summary FROM '+threadTable+' WHERE id=? AND '+memberClause,id,actor.id,actor.id);
    const currentModel = checked ? JSON.parse(checked.summary).model : null;
    ensure(currentModel?.shared && (currentModel.shareRevision ?? 0) === (summary.model.shareRevision ?? 0),
      403,'TRADE_FILE_PRIVATE','原件共享已变更，请刷新会话');
    return {name:summary.model.name,bytes};
  }
  return {shops,myShop,publish,preview,open,inbox,detail,read,download,
    sharing:(actor,id,input,key)=>{
      inputs(input,['shared','expectedRevision']);
      ensure(typeof input.shared==='boolean',400,'TRADE_INPUT','请明确选择是否授权共享原件');
      const expectedRevision=count(input.expectedRevision,0,Number.MAX_SAFE_INTEGER,'原件授权版本无效');
      return append(actor,id,'sharing',{shared:input.shared,expectedRevision},key);
    },
    send:(actor,id,input,key)=>{inputs(input,['body']);return append(actor,id,'text',{body:message(input.body,1000,'消息')},key);},
    offer:(actor,id,input,key)=>append(actor,id,'offer',offerInput(input),key),
    accept:(actor,id,input,key)=>{inputs(input,['version']);return append(actor,id,'accepted',{version:count(input.version,1,1000000,'报价版本无效')},key);}
  };
}

export async function readTradeReadiness(store) {
  const db=database(store);
  await db.one('SELECT id,enabled,revision FROM '+shopTable+' LIMIT 1');
  await db.one('SELECT id,last_seq,buyer_unread,merchant_unread FROM '+threadTable+' LIMIT 1');
}
