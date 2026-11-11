import { get, postQuery, prepareMutation } from './api-client.js';

import { tradeInboxHref, tradeInboxRole } from './trade-return.js';

const API = '/trade';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const materials = {AUTO:'让商家推荐', PLA:'PLA', PETG:'PETG', ABS:'ABS', RESIN:'工程树脂', ALUMINUM:'铝合金', CNC:'CNC 铝件'};
const qualities = {standard:'标准精度',fine:'高精度'};
const when = n => Number.isFinite(n) ? new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(n) : '';
const money = n => Number.isSafeInteger(n) ? '¥'+(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}) : '待确认';
const range = (a,b) => a === b ? money(a) : money(a)+'–'+money(b);
const option = (key,label,current) => '<option value="'+esc(key)+'"'+(key===current?' selected':'')+'>'+esc(label)+'</option>';
const field = (id,label,html) => '<label class="field" for="'+id+'">'+label+html+'</label>';
const button = (act,label,cls='') => '<button type="button" data-act="'+esc(act)+'" class="'+esc(cls)+'">'+esc(label)+'</button>';

export function amountToCents(value) {
  const text=String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan,fraction='']=text.split('.');
  const cents=Number(yuan)*100+Number(fraction.padEnd(2,'0'));
  return cents>0 && cents<=100000000 ? cents : null;
}

export function estimateSummary(estimate) {
  if (!estimate) return '<p class="note">暂无预算记录。</p>';
  const priced=estimate.status==='ESTIMATED' && Number.isSafeInteger(estimate.lowCents) && Number.isSafeInteger(estimate.highCents);
  const basis={GEOMETRY:'模型几何估算', SLICER:'切片记录', MIXED:'切片及几何估算', MANUAL:'工程审核'};
  return '<p><b>'+ (priced?'整单参考预算 '+esc(range(estimate.lowCents,estimate.highCents)):'需商家评估')+'</b></p>'+
    (priced?'<p>每件约 '+esc(range(estimate.unitLowCents,estimate.unitHighCents))+' · '+esc(basis[estimate.basis]||'初步预算')+' · '+(estimate.source==='SHOP_CONFIG'?'店铺配置':'平台参考配置')+'</p>':'')+
    (estimate.explanation?'<p class="note">'+esc(estimate.explanation)+'</p>':'')+
    ((estimate.includes||[]).length?'<p class="note">'+(priced?'已计入：':'待商家核算：')+esc(estimate.includes.join('、'))+'</p>':'')+
    ((estimate.excludes||[]).length?'<p class="note">未计入：'+esc(estimate.excludes.join('、'))+'</p>':'');
}

export function mergeMessages(known,incoming) {
  const messages=new Map(known.map(item=>[item.seq,item]));
  for(const item of incoming) if(Number.isSafeInteger(item.seq)&&item.seq>0)messages.set(item.seq,item);
  return Array.from(messages.values()).sort((a,b)=>a.seq-b.seq);
}

export function canAccept(thread,now=Date.now()) {
  return thread?.role==='buyer' && Boolean(thread.offer) && !thread.offer.accepted && thread.offer.expiresAt>now;
}

export function sharingAction(thread) {
  if(thread?.role!=='buyer' || !thread.model || thread.model.isSample) return '';
  return thread.model.shared?'停止共享原件':'授权下载原件';
}

export function belowShopBudget(estimate,amount) {
  return estimate?.status==='ESTIMATED' && estimate.source==='SHOP_CONFIG' &&
    Number.isSafeInteger(estimate.lowCents) && Number.isSafeInteger(amount) && amount>0 && amount<estimate.lowCents;
}

function quoteBody(offer) {
  return '<div class="quote-head"><b>商家报价 · 第 '+esc(offer.version)+' 版</b></div><strong class="amount">'+esc(money(offer.amountCents))+'</strong>'+
    '<p>整单 · '+(offer.shippingIncluded?'含运费':'运费另计')+' · 预计 '+esc(offer.leadDays)+' 天发货</p><p>'+esc(offer.terms)+'</p>';
}
export function messageItem(item,thread,now=Date.now()) {
  const mine=item.sender===thread.role;
  const head='<li class="msg'+(mine?' mine':'')+'"><span class="meta">'+(mine?'我':item.sender==='merchant'?esc(thread.shopName):'客户')+' · '+esc(when(item.at))+'</span>';
  if(item.kind==='offer'&&item.offer) {
    const o=item.offer,latest=o.version===thread.offer?.version;
    const tag=!latest?'已被新版替代':thread.offer.accepted?'客户已确认':o.expiresAt<=now?'已过期':'有效至 '+when(o.expiresAt);
    return head+'<div class="offer-card">'+quoteBody(o)+'<p class="meta">'+esc(tag)+'</p></div></li>';
  }
  if(item.kind==='sharing')return head+'<div class="system-note">'+esc(item.body)+'</div></li>';
  if(item.kind==='accepted')return head+'<div class="system-note">已确认第 '+esc(item.offer?.version??thread.offer?.version)+' 版报价方案 · 尚未下单付款</div></li>';
  return head+'<div class="bubble">'+esc(item.body)+'</div></li>';
}

export function inquiryReference(id) {
  return String(id??'').replace(/^thread_/,'').replaceAll('-','').slice(-12).toUpperCase();
}

function threadButton(t,selected) {
  return '<button type="button" class="list-item" data-thread="'+esc(t.id)+'"'+(t.id===selected?' aria-current="true"':'')+'><strong>'+esc(t.role==='buyer'?t.shopName:t.model?.name||'客户询价')+'</strong>'+
  '<span class="meta">'+esc(when(t.updatedAt))+'</span><span class="preview">'+esc(t.lastMessage||'模型询价')+'</span>'+
  (t.unread>0?'<span class="badge" aria-label="'+esc(t.unread)+' 条未读">'+esc(t.unread>99?'99+':t.unread)+'</span>':'<span></span>')+
  '<span class="model-name">'+esc(t.role==='buyer'?t.model?.name:'询价号 '+inquiryReference(t.id))+' · '+esc(t.quantity)+' 件</span></button>';
}

export function startTrade(doc=document,win=window) {
  const $=s=>doc.querySelector(s), app=$('#app'), access=$('#access'), dialog=$('#trade-dialog');
  const role=tradeInboxRole(win.location.pathname,win.location.search);
  const routed=!win.location.pathname.endsWith('/trade.html');
  const merchant=role==='merchant', params=new URLSearchParams(win.location.search);
  const state={session:null,models:[],threads:[],cursor:null,thread:null,messages:[],older:null,shop:null,shops:[],shopCursor:null};
  const drafts=new Map();
  let starting=false,polling=false,composing=false,modalBusy=false,readPending=false,generation=0,loadSeq=0,modalEpoch=0,budgetTimer,latestBudget=0,pollTimer,contextKey='',listKey='',activityKey='';
  const status=(msg='')=>{const n=$('#notice');n.textContent=msg;n.hidden=!msg;};
  const send=async(path,body)=> (await prepareMutation(path,body)).execute();
  const path=id=>API+'/threads/'+encodeURIComponent(id);
  const roleURL=(r,query)=>tradeInboxHref(r,query,routed);
  const accessLink=()=> (merchant?'/merchant/login':'/login')+'?returnTo='+encodeURIComponent(tradeInboxHref(role,params,true));
  for(const tab of ['buyer','merchant'])$('#'+tab+'-tab').href=roleURL(tab);
  $('#'+role+'-tab').setAttribute('aria-current','page');
  if(routed) $('#return-home').href=merchant?'/merchant':'/';
  $('#return-home').textContent=merchant&&routed?'返回商家工作台':'返回创作空间';
  function discardSession() {
    generation++;loadSeq++;latestBudget++;modalEpoch++;
    drafts.clear();state.session=null;state.thread=null;state.messages=[];state.threads=[];state.models=[];state.shop=null;state.shops=[];
    listKey=contextKey=activityKey='';$('#message-text').value='';$('#thread-list').replaceChildren();$('#context').replaceChildren();$('#messages').replaceChildren();$('#thread-title').textContent='';
    if(dialog.open)dialog.close();app.hidden=true;access.hidden=false;clearInterval(pollTimer);
  }
  function guest() {
    discardSession();
    access.innerHTML='<h2>登录后查看询价消息</h2><p>'+(merchant?'用店铺所属账号接收客户咨询和发送报价。':'用自己的账号选择店铺、发送模型咨询并查看回复。')+'</p><a class="button primary" href="'+esc(accessLink())+'">'+(merchant?'商家登录':'用户登录 / 注册')+'</a>';
  }
  function showError(e) {
    if(e?.code==='WORKSPACE_CHANGED'){discardSession();access.textContent='账号已切换，正在重新加载…';return;}
    if(e?.status===401){guest();return;}
    status(e?.message||'暂时无法连接，请刷新后重试。');
  }
  function composerError(msg=''){
    const el=$('#compose-error');el.textContent=msg;el.hidden=!msg;
  }
  function updateList() {
    const next=state.threads.map(t=>threadButton(t,state.thread?.id)).join('')||
      '<p class="small-empty">'+(merchant?'还没有客户咨询。':'暂无咨询，可选择店铺发起新会话。')+'</p>';
    const list=$('#thread-list');
    if(next!==listKey){
      const focused=doc.activeElement?.dataset?.thread;list.innerHTML=next;listKey=next;
      if(focused)Array.from(list.querySelectorAll('[data-thread]')).find(el=>el.dataset.thread===focused)?.focus({preventScroll:true});
    }
    $('#more-threads').hidden=!state.cursor;
  }
  async function refreshThreads(more=false){
    const stamp=++loadSeq, before=more?state.cursor:null;
    if(more&&!before)return;
    const r=await get(API+'/threads?role='+role+(before?'&before='+encodeURIComponent(before):''));
    if(stamp!==loadSeq||app.hidden)return;
    const received=(r.threads||[]).filter(t=>t.role===role);
    if(more) {
      const ids=new Set(state.threads.map(t=>t.id));
      state.threads.push(...received.filter(t=>!ids.has(t.id)));state.cursor=r.nextBefore;
    } else {
      const previous=state.threads, incoming=new Set(received.map(t=>t.id));
      const keepOlder=previous.length>received.length && Boolean(r.nextBefore);
      state.threads=keepOlder?[...received,...previous.filter(t=>!incoming.has(t.id))]:received;
      if(!keepOlder)state.cursor=r.nextBefore;
    }
    updateList();
  }
  function renderContext() {
    const t=state.thread;if(!t)return;
    $('#thread-title').textContent=t.role==='buyer'?t.shopName:t.model?.name||'客户询价';
    $('#thread-caption').textContent=t.role==='buyer'?'与商家沟通':'客户咨询 · 询价号 '+inquiryReference(t.id);
    const key=JSON.stringify([t.id,t.model,t.estimate,t.quantity,t.unit,t.material,t.quality]);
    if(key!==contextKey){
      const opened=$('#context details')?.open||false;
      const model=t.model||{}, dims=Array.isArray(model.dimensions)?model.dimensions.map(n=>Number(n.toFixed(2))).join(' × '):'';
      const e=t.estimate, hint=e?.status==='ESTIMATED'?range(e.lowCents,e.highCents):'需商家评估';
      $('#context').innerHTML='<details class="model-context"'+(opened?' open':'')+'><summary><strong>'+esc(model.name||'模型')+'</strong>'+esc(t.quantity)+' 件 · '+esc(hint)+'</summary>'+
        '<p>'+esc(materials[t.material]||t.material||'材料待定')+' · '+esc(qualities[t.quality]||t.quality||'标准精度')+(dims?' · '+esc(dims)+' mm':'')+'</p>'+
        estimateSummary(e)+'<p class="note">完整询价号：<code>'+esc(t.id)+'</code></p>'+(model.shared?button('download','下载已分享的模型'):'<p class="note">已分享模型概要。</p>')+(sharingAction(t)?button('sharing',sharingAction(t),'quiet'):'')+'</details>';
      contextKey=key;
    }
    const action=$('#offer-action');
    const buttons=t.role==='merchant'&&!t.offer?.accepted?button('offer',t.offer?'更新报价':'发送报价卡'):
      canAccept(t)?button('accept','查看并确认第 '+t.offer.version+' 版报价'):
      t.offer?.accepted?'<span class="note">报价已确认 · 尚未下单付款</span>':
      t.offer?.expiresAt<=Date.now()?'<span class="note">报价已过期，可请商家更新。</span>':'';
    if(buttons!==activityKey){action.innerHTML=buttons;activityKey=buttons;}
  }
  function drawMessages(mode,oldHeight=0,oldTop=0) {
    const messages=$('#messages'),stream=$('#stream'),t=state.thread;
    messages.innerHTML=state.messages.map(m=>messageItem(m,t)).join('');
    $('#older').hidden=!state.older;
    if(mode==='bottom')stream.scrollTop=stream.scrollHeight;
    else if(mode==='prepend')stream.scrollTop=oldTop+stream.scrollHeight-oldHeight;
    else stream.scrollTop=oldTop;
  }
  async function markRead() {
    if(readPending||!state.thread?.unread||doc.hidden)return;
    const t=state.thread,through=state.messages.at(-1)?.seq;
    const stream=$('#stream');
    if(!through||through!==t.lastSeq||stream.scrollHeight-stream.scrollTop-stream.clientHeight>50)return;
    readPending=true;
    try{
      await send(path(t.id)+'/read',{through});
      if(state.thread?.id===t.id && state.thread.lastSeq===through){state.thread.unread=0;const row=state.threads.find(v=>v.id===t.id);if(row){row.unread=0;updateList();}}
    }catch(error){showError(error);}finally{readPending=false;}
  }
  async function openThread(id,{scroll=false}={}) {
    if(state.thread?.id===id){await refreshDetail();return;}
    const stamp=++generation;
    if(state.thread)drafts.set(state.thread.id,$('#message-text').value);
    state.thread=null;state.messages=[];
    $('#conversation-body').hidden=true;$('#empty').hidden=false;
    $('#empty-note').textContent='正在打开会话…';
    let r;
    try{r=await get(path(id));}
    catch(error){
      if(stamp!==generation)return;
      $('#empty-note').textContent='未能打开会话，可在列表中重新选择。';throw error;
    }
    if(stamp!==generation||app.hidden)return;
    if(r.thread.role!==role){win.location.assign(roleURL(r.thread.role,{thread:id}));return;}
    state.thread=r.thread;state.messages=mergeMessages([],r.messages||[]);state.older=r.olderBefore;
    contextKey=activityKey='';composerError();$('#message-text').value=drafts.get(id)||'';
    $('#conversation-body').hidden=false;$('#empty').hidden=true;
    win.history.replaceState(null,'',roleURL(role,{thread:id}));
    renderContext();updateList();drawMessages('bottom');status();
    if(scroll && win.matchMedia?.('(max-width:730px)').matches)$('#conversation-body').scrollIntoView({block:'start'});
    await markRead();
  }
  async function refreshDetail() {
    const t=state.thread;if(!t)return;
    const stamp=generation,seq=state.messages.at(-1)?.seq||0;
    const r=await get(path(t.id)+'?after='+seq);
    if(stamp!==generation||app.hidden||!state.thread||r.thread.lastSeq<state.thread.lastSeq)return;
    const stream=$('#stream'),top=stream.scrollTop,atEnd=stream.scrollHeight-top-stream.clientHeight<50;
    const changed=JSON.stringify(state.thread.offer)!==JSON.stringify(r.thread.offer);
    if(changed||(r.messages||[]).length) {
      state.messages=mergeMessages(state.messages,r.messages||[]);
      state.thread=r.thread;drawMessages(atEnd?'bottom':'keep',0,top);
    } else state.thread=r.thread;
    renderContext();await markRead();
  }
  async function refreshAll() {
    if(polling||app.hidden||doc.hidden)return;
    polling=true;
    try{await Promise.all([refreshThreads(),refreshDetail()]);status();}
    catch(error){showError(error);}finally{polling=false;}
  }
  async function older() {
    if(!state.thread||!state.older)return;
    const t=state.thread,stamp=generation,el=$('#older');el.disabled=true;
    try{
      const r=await get(path(t.id)+'?before='+state.older);
      if(stamp!==generation)return;
      const stream=$('#stream'),h=stream.scrollHeight,top=stream.scrollTop;
      state.messages=mergeMessages(state.messages,r.messages||[]);state.older=r.olderBefore;drawMessages('prepend',h,top);
    }finally{el.disabled=false;}
  }
  function renderShop() {
    const n=$('#shop-state');
    if(!merchant){n.replaceChildren();return;}
    const s=state.shop||{};
    if(!s.enrolled){n.innerHTML='开通店铺后可接收咨询。 <a href="/merchant">进入商家工作台</a>';return;}
    n.innerHTML='<div class="line"><span>'+ (s.shop?.enabled?'正在接收新咨询':'新咨询已关闭')+'</span>'+button('shop',s.shop?.enabled?'关闭入口':'开启咨询')+'</div>';
  }
  function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(refreshAll,8000);}
  async function init() {
    if(starting)return;starting=true;
    try{
      state.session=await get('/session');
      if(!state.session.authenticated){guest();return;}
      access.hidden=true;app.hidden=false;
      $('#side-actions').innerHTML=merchant?button('refresh','刷新','quiet'):button('start','发起咨询','primary');
      const tasks=[refreshThreads()];
      if(merchant)tasks.push(get(API+'/shop').then(v=>{state.shop=v;renderShop();}));
      await Promise.all(tasks);
      const id=params.get('thread');
      if(id)await openThread(id);
      else if(!merchant && ['modelId','shopId'].some(k=>params.has(k)))await newInquiry();
      else if(state.threads.length)await openThread(state.threads[0].id);
      startPolling();
    }catch(error){
      if(error?.status===401||error?.code==='WORKSPACE_CHANGED'){showError(error);return;}
      if(app.hidden||!state.session?.authenticated){access.hidden=false;access.innerHTML='<h2>消息服务暂不可用</h2><p>'+esc(error.message)+'</p>'+(!routed?'<p>实时收发消息需要连接共造服务端。可在已部署的平台打开相应收件箱。</p>':'')+button('init','重新连接');}
      else{status(error.message);$('#side-actions').insertAdjacentHTML('beforeend',button('init','重新连接','quiet'));}
    }finally{starting=false;}
  }

  function modal(title,html) {
    modalEpoch++;latestBudget++;clearTimeout(budgetTimer);
    dialog.innerHTML='<header class="dialog-head"><h2 id="dialog-title">'+esc(title)+'</h2>'+button('close','关闭')+'</header><div class="dialog-body">'+html+'</div>';
    if(!dialog.open)dialog.showModal();return modalEpoch;
  }
  function modalError(msg) {
    const box=$('#dialog-error');if(box){box.textContent=msg;box.hidden=!msg;}
  }
  function closeModal() {if(!modalBusy && dialog.open)dialog.close();}
  const errBox='<p id="dialog-error" class="error" role="alert" hidden></p>';
  function actions(label){return '<div class="dialog-actions">'+button('close','取消','quiet')+'<button class="primary" type="submit">'+label+'</button></div>'+errBox;}
  function toggleForm(form,busy){for(const el of form.elements){if(busy){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}}}
  const selected=(id)=>$('#'+id)?.value||'';
  function paramsForBudget() {
    return {modelId:selected('new-model'),material:selected('new-material'),qty:Number(selected('new-qty')),quality:selected('new-quality'),unit:selected('new-unit'),...(selected('new-shop')?{shopId:selected('new-shop')}:{})};
  }
  async function refreshBudget() {
    const requestId=++latestBudget,epoch=modalEpoch,box=$('#new-budget'),input=paramsForBudget();
    if(!box)return;
    if(!input.modelId||!Number.isInteger(input.qty)||input.qty<1||input.qty>50){box.textContent='请选择模型并填写 1–50 件的整数数量。';return;}
    box.textContent='正在估算…';
    try{const r=await postQuery('/budget-estimate',input);if(requestId===latestBudget&&epoch===modalEpoch&&dialog.open)box.innerHTML=estimateSummary(r.estimate);}
    catch(e){if(requestId===latestBudget&&epoch===modalEpoch&&dialog.open)box.textContent='预算暂不可用。'+e.message;}
  }
  function setShareAvailability() {
    const m=state.models.find(v=>v.id===selected('new-model')),box=$('#new-share');
    if(!box)return;box.disabled=!m||Boolean(m.isSample);if(box.disabled)box.checked=false;
    $('#share-note').textContent=m?.isSample?'示例模型仅分享概要。':'勾选后，仅本会话双方可下载原文件。';
  }
  function renderNew(seed) {
    const shops=state.shops.filter(s=>!s.mine),models=state.models;
    const goodId=models.some(m=>m.id===seed.modelId),unavailable=seed.modelId&&!goodId;
    const modelId=goodId?seed.modelId:unavailable?'':models[0]?.id;
    const shopId=shops.some(s=>s.id===seed.shopId)?seed.shopId:(!seed.shopId&&shops.length===1?shops[0].id:'');
    const html='<form data-form="new">'+
      field('new-shop','联系店铺','<select id="new-shop" required>'+option('',shops.length?'选择一家店铺':'暂无已开放的店铺',shopId)+shops.map(v=>option(v.id,v.name,shopId)).join('')+'</select>')+
      (state.shopCursor?button('more-shops','显示更多店铺','quiet'):'')+
      (seed.shopId&&!shopId?'<p class="note">尚未找到此前选择的店铺，请从当前可咨询的店铺中选择。</p>':'')+
      (!shops.length?'<p class="note">商家可用自己的账号在商家收件箱开启咨询。</p>':'')+
      field('new-model','咨询的模型','<select id="new-model" required>'+option('','选择当前账号中的模型',modelId)+models.map(m=>option(m.id,m.name+(m.isSample?'（示例）':''),modelId)).join('')+'</select>')+
      (unavailable?'<p class="note">当前账号找不到之前的模型，请重新选择或返回创作空间上传。</p>':'')+
      (!models.length?'<p class="note">当前账号还没有模型。<a href="./index.html">返回创作空间上传模型</a></p>':'')+
      '<div class="row">'+field('new-qty','制作数量（件）','<input id="new-qty" type="number" step="1" min="1" max="50" required value="'+esc(seed.qty||'1')+'">')+
      field('new-unit','文件单位','<select id="new-unit">'+option('mm','毫米',seed.unit)+option('inch','英寸',seed.unit)+'</select>')+'</div>'+
      '<div class="row">'+field('new-material','材料','<select id="new-material">'+Object.entries(materials).map(([k,v])=>option(k,v,seed.material)).join('')+'</select>')+
      field('new-quality','精度','<select id="new-quality">'+Object.entries(qualities).map(([k,v])=>option(k,v,seed.quality)).join('')+'</select>')+'</div>'+
      '<div class="summary-box" id="new-budget" aria-live="polite"></div>'+
      field('new-body','给商家的留言','<textarea id="new-body" maxlength="1000" rows="3" required placeholder="例如：希望使用室外耐候材料，请核对工艺和交期。">'+esc(seed.body||'')+'</textarea>')+
      '<label class="check"><input type="checkbox" id="new-share">允许这家店铺下载模型原件</label><p class="note" id="share-note"></p>'+
      actions('发给商家')+'</form>';
    modal('发起模型咨询',html);setShareAvailability();refreshBudget();
  }
  async function newInquiry() {
    const epoch=modal('发起模型咨询','<p role="status">正在读取店铺和模型…</p>');
    try{
      const [shops,workspace]=await Promise.all([get(API+'/shops'),get('/workspace')]);
      if(epoch!==modalEpoch||!dialog.open)return;
      state.shops=shops.shops||[];state.shopCursor=shops.nextBefore;state.models=workspace.workspace?.models||[];
      renderNew(Object.fromEntries(params));
    }catch(e){if(epoch===modalEpoch&&dialog.open){if(e.status===401)return guest();modal('发起模型咨询','<p class="error" role="alert">'+esc(e.message)+'</p>'+button('start','重新加载'));}}
  }
  async function moreShops() {
    const cursor=state.shopCursor,epoch=modalEpoch;if(!cursor)return;
    const r=await get(API+'/shops?before='+encodeURIComponent(cursor));
    if(epoch!==modalEpoch||!dialog.open)return;
    const select=$('#new-shop');
    for(const v of r.shops||[])if(!v.mine&&!state.shops.some(s=>s.id===v.id)){
      state.shops.push(v);select.insertAdjacentHTML('beforeend',option(v.id,v.name,select.value));
    }
    state.shopCursor=r.nextBefore;
    if(!r.nextBefore)dialog.querySelector('[data-act="more-shops"]')?.remove();
  }
  function offerForm() {
    const t=state.thread;if(!t||t.role!=='merchant'||t.offer?.accepted)return;
    const old=t.offer;
    modal(old?'更新商家报价':'发送商家报价','<form data-form="offer" data-thread="'+esc(t.id)+'" data-version="'+esc(old?.version||0)+'">'+
      '<p class="note">'+esc(t.model?.name)+' · '+esc(t.quantity)+' 件</p><div class="row">'+
      field('offer-amount','整单报价（元）','<input id="offer-amount" required inputmode="decimal" placeholder="0.00" value="'+(old?(old.amountCents/100).toFixed(2):'')+'">')+
      field('offer-days','预计几天发货','<input id="offer-days" type="number" min="1" max="365" step="1" required value="'+esc(old?.leadDays||'')+'">')+'</div>'+
      '<p class="note" id="offer-margin" role="status" hidden>金额低于店铺参考预算，请核对制作成本、服务费与报价范围。</p>'+
      field('offer-shipping','运费','<select id="offer-shipping" required>'+option('','请选择',old?String(old.shippingIncluded):'')+option('true','报价包含运费',old?String(old.shippingIncluded):'')+option('false','运费另计',old?String(old.shippingIncluded):'')+'</select>')+
      field('offer-terms','工艺与报价范围','<textarea id="offer-terms" required maxlength="500" rows="4" placeholder="说明材料、精度、后处理及额外费用。">'+esc(old?.terms||'')+'</textarea>')+
      '<p class="note">报价有效期 7 天。新版本将替代前一版。</p>'+actions('发送报价卡')+'</form>');
  }
  function sharingForm() {
    const t=state.thread,label=sharingAction(t);
    if(!label)return;
    const enable=!t.model.shared;
    modal(label,'<form data-form="sharing" data-thread="'+esc(t.id)+'" data-enabled="'+enable+'" data-revision="'+esc(t.model.shareRevision??0)+'"><p>模型：'+esc(t.model.name)+'</p><p>店铺：'+esc(t.shopName)+'</p><p class="note">'+
      (enable?'确认后，这家店铺可以下载本会话中的模型原文件。':'确认后将停止这家店铺之后的下载，已下载的副本无法收回。')+'</p>'+actions('确认'+label)+'</form>');
  }
  function acceptForm() {
    const t=state.thread;if(!canAccept(t))return;
    modal('确认商家报价','<form data-form="accept" data-thread="'+esc(t.id)+'" data-version="'+esc(t.offer.version)+'"><div class="summary-box">'+quoteBody(t.offer)+'</div><p class="note">确认后会通知商家，仅确认这版方案，不会创建订单或扣款。</p>'+actions('确认这版方案')+'</form>');
  }
  function shopForm() {
    const s=state.shop;if(!s?.enrolled)return;
    const enable=!s.shop?.enabled;
    modal(enable?'开启店铺咨询':'关闭新咨询','<form data-form="shop" data-enabled="'+enable+'" data-revision="'+esc(s.shop?.revision||0)+'"><p>'+(enable?'开启后，客户可在店铺列表中找到你并发送模型咨询。':'关闭后停止接收新咨询，已有会话仍可沟通。')+'</p>'+actions(enable?'开启咨询':'关闭入口')+'</form>');
  }
  async function submitModal(form) {
    if(modalBusy||form.dataset.stale==='true')return;
    modalError();let task;
    const mode=form.dataset.form;
    const invalid=(selector,text)=>{modalError(text);$(selector)?.focus();};
    if(mode==='new'){
      const budget=paramsForBudget(),body=selected('new-body').trim();
      if(!selected('new-shop'))return invalid('#new-shop','请选择已开放咨询的店铺。');
      if(!budget.modelId)return invalid('#new-model','请选择当前账号的模型。');
      if(!Number.isInteger(budget.qty)||budget.qty<1||budget.qty>50)return invalid('#new-qty','数量须为 1–50 的整数。');
      if(!body)return invalid('#new-body','请填写想咨询的问题。');
      const payload={shopId:selected('new-shop'),modelId:budget.modelId,quantity:budget.qty,material:budget.material,quality:budget.quality,unit:budget.unit,shareFile:$('#new-share').checked&&!$('#new-share').disabled,body};
      task=()=>send(API+'/threads',payload);
    } else if(mode==='offer'){
      const cents=amountToCents(selected('offer-amount')),days=Number(selected('offer-days')),shipping=selected('offer-shipping'),terms=selected('offer-terms').trim();
      if(!cents)return invalid('#offer-amount','请填写 0.01–1,000,000 元，最多两位小数。');
      if(!Number.isInteger(days)||days<1||days>365)return invalid('#offer-days','预计发货天数须为 1–365 的整数。');
      if(!['true','false'].includes(shipping))return invalid('#offer-shipping','请选择报价是否包含运费。');
      if(!terms)return invalid('#offer-terms','请说明本次报价涵盖的工艺。');
      task=()=>send(path(form.dataset.thread)+'/offers',{amountCents:cents,leadDays:days,shippingIncluded:shipping==='true',terms,expectedVersion:Number(form.dataset.version)});
    } else if(mode==='accept'){
      task=()=>send(path(form.dataset.thread)+'/accept',{version:Number(form.dataset.version)});
    } else if(mode==='sharing'){
      task=()=>send(path(form.dataset.thread)+'/sharing',{shared:form.dataset.enabled==='true',expectedRevision:Number(form.dataset.revision)});
    } else if(mode==='shop'){
      task=()=>send(API+'/shop',{enabled:form.dataset.enabled==='true',expectedRevision:Number(form.dataset.revision)});
    }else return;
    modalBusy=true;toggleForm(form,true);dialog.querySelector('.dialog-head button').disabled=true;
    const success={new:'咨询已发给商家。',shop:'店铺咨询设置已更新。',offer:'报价已发送。',accept:'已确认这版方案。',sharing:'原件下载授权已更新。'}[mode];
    let confirmed=false;
    try {
      const result=await task();
      confirmed=true;dialog.close();
      if(mode==='new'){
        win.history.replaceState(null,'',roleURL(role,{thread:result.threadId}));
        await Promise.all([refreshThreads(),openThread(result.threadId,{scroll:true})]);
      } else if(mode==='shop'){state.shop={enrolled:true,shop:result.shop};renderShop();}
      else await Promise.all([refreshDetail(),refreshThreads()]);
      status(success);
    }catch(error){
      if(error.status===401||error.code==='WORKSPACE_CHANGED')showError(error);
      else if(confirmed){status(success+' 暂时无法刷新，请重新打开会话。');}
      else if(dialog.open){modalError(error.message);if(error.status===409){await refreshDetail().catch(showError);if(mode==='shop'){state.shop=await get(API+'/shop').catch(()=>state.shop);renderShop();}modalError(error.message+' 请关闭此窗口并核对最新状态。');if(mode!=='new')form.dataset.stale='true';}}
      else showError(error);
    }finally{modalBusy=false;if(form.isConnected){toggleForm(form,false);if(form.dataset.stale==='true')form.querySelector('[type="submit"]').disabled=true;dialog.querySelector('.dialog-head button').disabled=false;}}
  }
  async function sendText() {
    if(composing||!state.thread)return;
    const t=state.thread,input=$('#message-text'),form=$('#composer'),raw=input.value,body=raw.trim();
    if(!body){composerError('请填写消息内容。');input.focus();return;}
    composing=true;composerError();toggleForm(form,true);
    let confirmed=false;
    try{
      await send(path(t.id)+'/messages',{body});
      confirmed=true;
      if(drafts.get(t.id)===raw)drafts.delete(t.id);
      if(state.thread?.id===t.id){input.value='';await refreshDetail();$('#stream').scrollTop=$('#stream').scrollHeight;}
      await refreshThreads();
    }catch(e){if(e.status===401||e.code==='WORKSPACE_CHANGED')showError(e);else if(confirmed)status('消息已发送，暂时无法刷新聊天记录。');else if(state.thread?.id===t.id)composerError(e.message);else showError(e);}
    finally{composing=false;toggleForm(form,false);if(state.thread?.id===t.id && doc.activeElement===doc.body)input.focus({preventScroll:true});}
  }
  async function download() {
    const t=state.thread;if(!t?.model?.shared)return;
    const r=await win.fetch('/api/v2'+path(t.id)+'/file',{credentials:'same-origin',cache:'no-store',headers:{'X-Gongzao-Workspace':state.session.workspaceContext}});
    if(!r.ok){const data=await r.json().catch(()=>({}));if(r.status===401)return guest();if(data.error?.code==='WORKSPACE_CHANGED')await get('/session');throw new Error(data.error?.message||'文件暂不可下载。');}
    const url=URL.createObjectURL(await r.blob());
    try{const a=doc.createElement('a');a.href=url;a.download=t.model.name;doc.body.append(a);a.click();a.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
  }
  doc.addEventListener('click',async event=>{
    const row=event.target.closest('[data-thread].list-item'),target=event.target.closest('[data-act]');
    try{
      if(row){await openThread(row.dataset.thread,{scroll:true});return;}
      if(!target)return;
      switch(target.dataset.act){
        case 'init':await init();break; case 'start':await newInquiry();break; case 'close':closeModal();break;
        case 'refresh':await refreshAll();break; case 'shop':shopForm();break;case 'offer':offerForm();break;
        case 'sharing':sharingForm();break;case 'accept':acceptForm();break;case 'more-shops':await moreShops();break;case 'download':await download();break;
      }
    }catch(e){if(dialog.open)modalError(e.message);else showError(e);}
  });
  $('#more-threads').addEventListener('click',()=>refreshThreads(true).catch(showError));
  $('#older').addEventListener('click',()=>older().catch(showError));
  $('#composer').addEventListener('submit',e=>{e.preventDefault();sendText();});
  $('#message-text').addEventListener('input',()=>{if(state.thread)drafts.set(state.thread.id,$('#message-text').value);composerError();});
  $('#stream').addEventListener('scroll',()=>{if(!polling)markRead();},{passive:true});
  dialog.addEventListener('submit',e=>{e.preventDefault();submitModal(e.target).catch(showError);});
  dialog.addEventListener('cancel',e=>{if(modalBusy)e.preventDefault();});
  dialog.addEventListener('close',()=>{modalEpoch++;latestBudget++;clearTimeout(budgetTimer);dialog.replaceChildren();});
  dialog.addEventListener('input',e=>{
    if(e.target.form?.dataset.stale==='true')return;
    modalError();
    if(e.target.id==='offer-amount'){
      $('#offer-margin').hidden=!belowShopBudget(state.thread?.estimate,amountToCents(e.target.value));return;
    }
    if(!['new-model','new-shop','new-material','new-qty','new-quality','new-unit'].includes(e.target.id))return;
    if(['new-model','new-shop'].includes(e.target.id)){$('#new-share').checked=false;setShareAvailability();}latestBudget++;clearTimeout(budgetTimer);budgetTimer=setTimeout(refreshBudget,180);
  });
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)refreshAll();});
  win.addEventListener('pagehide',()=>clearInterval(pollTimer));
  win.addEventListener('pageshow',e=>{if(e.persisted && state.session?.authenticated){startPolling();refreshAll();}});
  init();
}
if(typeof document!=='undefined' && document.querySelector('#trade-dialog'))startTrade();
