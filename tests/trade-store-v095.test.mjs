import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../services/platform/core.mjs';
import { createTradeStore, readTradeReadiness } from '../services/platform/trade-store.mjs';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { sha256 } from '../services/platform/geometry.mjs';

const buyer={id:'account-consulting',ownerId:'workspace-customer'}, merchant={id:'account-shop',ownerId:'workspace-manufacturing'}, third={id:'account-other',ownerId:'workspace-other'};
const args=(shopId,overrides={})=>({shopId,modelId:'sample-bracket',quantity:3,unit:'mm',shareFile:false,body:'希望做三个支架，请核对材料。',...overrides});
const quote=(expectedVersion=0)=>({expectedVersion,amountCents:4500,leadDays:3,terms:'三件 PLA，含表面清理',shippingIncluded:false});

function d1Shape(db) {
  const adapter={
    withSession(policy){assert.equal(policy,'first-primary');return adapter;},
    prepare(sql){return {bind(...args){return {async all(){return {results:db.prepare(sql).all(...args)};},
      async first(){return db.prepare(sql).get(...args)??null;},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}};}};}};}
  };
  return adapter;
}
async function harness(t,{d1=false,file=':memory:'}={}) {
  const db=new DatabaseSync(file);
  t.after(()=>db.close());
  if(d1)db.exec(fs.readFileSync(new URL('../drizzle/0002_trade_conversations.sql',import.meta.url),'utf8'));
  const modelBytes=new TextEncoder().encode('synthetic step bytes');
  const upload={id:'drawing-1',name:'支架.step',format:'step',dimensions:[],sha256:await sha256(modelBytes),review:true,version:1};
  const cw=createWorkspace(),mw=createWorkspace();
  cw.models.push(upload);cw.customerProfile={shippingAddress:{recipient:'private-test-recipient'}};
  mw.merchant={profile:{name:'登记测试工坊',id:'private-profile'}};
  mw.internalSecret='private-cost-setting';
  const store={kind:d1?'d1':'sqlite',db:d1?d1Shape(db):db,load:async owner=>owner===buyer.ownerId?cw:owner===merchant.ownerId?mw:createWorkspace(),
    getFile:async(owner,id)=>owner===buyer.ownerId && id===upload.id ? modelBytes : null};
  let now=Date.now();const trade=createTradeStore({store,clock:()=>now});
  return {trade,store,db,cw,mw,modelBytes,clock:value=>{now=value;},now:()=>now,upload};
}

for(const d1 of [false,true]){
  test('independent accounts exchange model inquiries, revise offers and confirm once ('+(d1?'D1 adapter':'SQLite')+')',async t=>{
    const {trade,store}=await harness(t,{d1});
    await readTradeReadiness(store);
    assert.deepEqual((await trade.shops(null)).shops,[]);
    const {shop}=await trade.publish(merchant,{enabled:true},'publish-001');
    const directory=await trade.shops(buyer);
    assert.deepEqual(directory.shops,[{id:shop.id,name:'登记测试工坊',mine:false}]);
    assert.equal((await trade.myShop(buyer)).enrolled,false);
    assert.equal((await trade.myShop(merchant)).shop.enabled,true);
    await assert.rejects(trade.open(merchant,args(shop.id),'opening-self'),{code:'TRADE_SELF'});
    const [a,b]=await Promise.all([1,2].map(()=>trade.open(buyer,args(shop.id),'opening-001')));
    assert.equal(a.threadId,b.threadId);
    await assert.rejects(trade.open(buyer,args(shop.id,{quantity:12}),'opening-001'),{code:'IDEMPOTENCY_CONFLICT'});
    const id=a.threadId;
    assert.equal((await trade.inbox(merchant,{role:'merchant'})).threads[0].unread,1);
    assert.equal((await trade.inbox(buyer,{role:'buyer'})).threads[0].unread,0);
    await assert.rejects(trade.send(third,id,{body:'hello'},'message-333'),{code:'TRADE_THREAD_NOT_FOUND'});
    await assert.rejects(trade.offer(buyer,id,quote(),'offering-01'),{code:'TRADE_ROLE'});
    assert.equal((await trade.offer(merchant,id,quote(),'offering-02')).seq,2);
    assert.equal((await trade.offer(merchant,id,quote(),'offering-02')).replayed,true);
    const edits=await Promise.allSettled([5000,5200].map((amountCents,i)=>trade.offer(merchant,id,{...quote(1),amountCents},'offering-revise'+i)));
    assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(edits.find(x=>x.status==='rejected').reason.code,'TRADE_OFFER_CHANGED');
    await assert.rejects(trade.accept(buyer,id,{version:1},'accepted-001'),{code:'TRADE_OFFER_CHANGED'});
    await assert.rejects(trade.accept(merchant,id,{version:2},'accepted-002'),{code:'TRADE_ROLE'});
    const ack=await trade.accept(buyer,id,{version:2},'accepted-003');assert.equal(ack.seq,4);
    assert.equal((await trade.accept(buyer,id,{version:2},'accepted-003')).replayed,true);
    const detail=await trade.detail(buyer,id);
    assert.equal(detail.thread.offer.accepted,true);assert.equal(detail.thread.offer.shippingIncluded,false);
    assert.equal(detail.messages[1].offer.amountCents,4500);assert.equal(detail.messages[1].offer.version,1);
    assert.deepEqual(detail.messages.map(m=>m.seq),[1,2,3,4]);
    assert.equal(detail.thread.unread,2);
    assert.equal((await trade.read(buyer,id,{through:2})).unread,1);
    assert.equal((await trade.read(buyer,id,{through:1})).unread,1);
    assert.equal((await trade.read(buyer,id,{through:4})).unread,0);
    assert.equal(JSON.stringify(detail).includes('workspace-manufacturing'),false);
    assert.doesNotMatch(JSON.stringify(detail),/private-test-recipient|private-cost-setting|private-profile|account-consulting|opening-001/);
  });
}

test('file sharing checks participant, actual bytes, consent and immutable hash; closing shop preserves prior threads',async t=>{
  const {trade,modelBytes,upload}=await harness(t);
  const {shop}=await trade.publish(merchant,{enabled:true},'publish-001');
  const {threadId:id}=await trade.open(buyer,args(shop.id,{modelId:upload.id,shareFile:true}),'opening-001');
  await assert.rejects(trade.download(third,id),{code:'TRADE_THREAD_NOT_FOUND'});
  assert.deepEqual((await trade.download(merchant,id)).bytes,modelBytes);
  const privateThread=await trade.open(buyer,args(shop.id,{modelId:upload.id}),'opening-002');
  await assert.rejects(trade.download(merchant,privateThread.threadId),{code:'TRADE_FILE_PRIVATE'});
  await assert.rejects(trade.open(buyer,args(shop.id,{shareFile:true}),'opening-003'),{code:'TRADE_SAMPLE_FILE'});
  await trade.publish(merchant,{enabled:false,expectedRevision:1},'publish-002');
  assert.deepEqual((await trade.shops(null)).shops,[]);
  await assert.rejects(trade.open(buyer,args(shop.id),'opening-004'),{code:'TRADE_SHOP_CLOSED'});
  assert.equal((await trade.open(buyer,args(shop.id,{modelId:upload.id,shareFile:true}),'opening-001')).threadId,id);
  assert.equal((await trade.send(merchant,id,{body:'旧会话仍可沟通'},'message-001')).seq,2);
  modelBytes[0]++;await assert.rejects(trade.download(merchant,id),{code:'MODEL_CHANGED'});
});

test('pagination isolates same-timestamp threads, message history and read state survive restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'trade-qa-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const file=path.join(root,'qa.sqlite');const {trade,store,clock,now}=await harness(t,{file});
  const {shop}=await trade.publish(merchant,{enabled:true},'publish-001');
  let threadId;for(let i=0;i<27;i++){threadId=(await trade.open(buyer,args(shop.id),'create-room-'+i)).threadId;}
  const page=await trade.inbox(buyer,{role:'buyer'}), next=await trade.inbox(buyer,{role:'buyer',before:page.nextBefore});
  assert.equal(new Set([...page.threads,...next.threads].map(t=>t.id)).size,27);
  for(let i=0;i<54;i++)await trade.send(merchant,threadId,{body:'说明 '+i},'message-'+i);
  const first=await trade.detail(buyer,threadId);assert.equal(first.messages.length,50);assert.equal(first.messages.at(-1).seq,55);
  const prior=await trade.detail(buyer,threadId,{before:first.olderBefore});assert.deepEqual(prior.messages.map(m=>m.seq),[1,2,3,4,5]);
  const all=await trade.detail(buyer,threadId,{after:0});assert.equal(all.nextAfter,50);
  await trade.offer(merchant,threadId,quote(),'offering-abc');
  const acceptedAfterExpiry=(await trade.detail(buyer,threadId)).thread.offer.expiresAt;
  clock(acceptedAfterExpiry);await assert.rejects(trade.accept(buyer,threadId,{version:1},'accept-expired'),{code:'TRADE_OFFER_EXPIRED'});
  const reopened=new SQLiteStore(file);t.after(()=>reopened.close());
  const reopenedTrade=createTradeStore({store:{...store,db:reopened.db},clock:now});
  assert.equal((await reopenedTrade.detail(buyer,threadId)).thread.unread,55);
});

test('revoked file grants survive retries, reject stale consent, and block an unfinished file read',async t=>{
  const {trade,store,upload,modelBytes}=await harness(t);
  const {shop}=await trade.publish(merchant,{enabled:true},'publish-file');
  const {threadId:id}=await trade.open(buyer,args(shop.id,{modelId:upload.id}),'open-file-thread');
  await assert.rejects(trade.download(merchant,id),{code:'TRADE_FILE_PRIVATE'});
  await assert.rejects(trade.sharing(merchant,id,{shared:true,expectedRevision:0},'wrong-role-request'),{code:'TRADE_ROLE'});
  await trade.sharing(buyer,id,{shared:true,expectedRevision:0},'allow-download');
  let resumed, fileRequested;
  const gate=new Promise(resolve=>{resumed=resolve;}), requested=new Promise(resolve=>{fileRequested=resolve;});
  store.getFile=async()=>{fileRequested();await gate;return modelBytes;};
  const downloading=trade.download(merchant,id);
  await requested;
  await trade.sharing(buyer,id,{shared:false,expectedRevision:1},'withdraw-file');
  resumed();await assert.rejects(downloading,{code:'TRADE_FILE_PRIVATE'});
  assert.equal((await trade.sharing(buyer,id,{shared:true,expectedRevision:0},'allow-download')).replayed,true);
  await assert.rejects(trade.sharing(buyer,id,{shared:true,expectedRevision:0},'stale-reopen'),{code:'TRADE_SHARING_CHANGED'});
  assert.equal((await trade.detail(merchant,id)).thread.model.shared,false);
  await trade.sharing(buyer,id,{shared:true,expectedRevision:2},'renew-download');
  assert.deepEqual((await trade.download(merchant,id)).bytes,modelBytes);
  assert.deepEqual((await trade.detail(merchant,id)).messages.map(m=>m.kind),['text','sharing','sharing','sharing']);
});
