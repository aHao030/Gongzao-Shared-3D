import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents, belowShopBudget, canAccept, estimateSummary, inquiryReference, mergeMessages, messageItem, sharingAction
} from '../dist/trade-ui.js';

const offer={version:4,amountCents:12345,shippingIncluded:false,terms:'PLA <室外>',leadDays:5,expiresAt:10000,accepted:false};
const buyer={role:'buyer',shopName:'定制 <店铺>',offer};
const estimated={status:'ESTIMATED',source:'SHOP_CONFIG',basis:'SLICER',lowCents:12000,highCents:14000,unitLowCents:6000,unitHighCents:7000,
  explanation:'已记录 <2> 件',includes:['制造','平台服务费'],excludes:['运费','税费']};

test('merchant prices use integer cents without binary rounding or exponent parsing',()=>{
  for(const [value,expected] of [['0.01',1],['0.29',29],['1.1',110],['1000000.00',100000000],[' 20 ',2000]]){
    assert.equal(amountToCents(value),expected);
  }
  for(const value of ['','0','1,000','1e4','-2','1.001','0xff','1000000.01','NaN']){
    assert.equal(amountToCents(value),null);
  }
});

test('thread budget uses measured scope, separates unit price and manual review, and escapes producer text',()=>{
  const html=estimateSummary(estimated);
  for(const text of ['整单参考预算 ¥120.00–¥140.00','每件约 ¥60.00–¥70.00','切片记录','店铺配置','已计入：制造、平台服务费','未计入：运费、税费','&lt;2&gt;']){
    assert.ok(html.includes(text),text);
  }
  const fixed=estimateSummary({...estimated,source:'PLATFORM_REFERENCE',highCents:12000,unitHighCents:6000});
  assert.match(fixed,/平台参考配置/);
  assert.doesNotMatch(fixed,/–/);
  const manual=estimateSummary({...estimated,status:'REVIEW_REQUIRED'});
  assert.match(manual,/需商家评估/);
  assert.doesNotMatch(manual,/¥/);
});

test('low amount hint only compares usable shop-specific budget and never blocks submission',()=>{
  assert.equal(belowShopBudget(estimated,11999),true);
  assert.equal(belowShopBudget(estimated,12000),false);
  assert.equal(belowShopBudget(estimated,null),false);
  assert.equal(belowShopBudget({...estimated,status:'REVIEW_REQUIRED'},1),false);
  assert.equal(belowShopBudget({...estimated,source:'PLATFORM_REFERENCE'},1),false);
});

test('only buyer sees file controls for an uploaded model',()=>{
  const model={shared:false,isSample:false};
  assert.equal(sharingAction({role:'buyer',model}),'授权下载原件');
  assert.equal(sharingAction({role:'buyer',model:{...model,shared:true}}),'停止共享原件');
  assert.equal(sharingAction({role:'merchant',model}),'');
  assert.equal(sharingAction({role:'buyer',model:{...model,isSample:true}}),'');
  assert.equal(sharingAction(null),'');
  const item={seq:3,kind:'sharing',sender:'buyer',at:5050,body:'撤销 <授权>'};
  assert.match(messageItem(item,buyer),/class="system-note">撤销 &lt;授权&gt;/);
});

test('only buyer may confirm an unexpired current offer, old ones remain visibly replaced',()=>{
  assert.equal(canAccept(null,1),false);
  assert.equal(canAccept(buyer,9999),true);
  assert.equal(canAccept(buyer,10000),false);
  assert.equal(canAccept({...buyer,role:'merchant'},100),false);
  assert.equal(canAccept({...buyer,offer:{...offer,accepted:true}},50),false);
  const item={seq:1,kind:'offer',sender:'merchant',at:100,offer};
  assert.match(messageItem(item,buyer,50),/有效至/);
  assert.match(messageItem(item,buyer,10000),/已过期/);
  assert.match(messageItem({...item,offer:{...offer,version:3}},buyer,50),/已被新版替代/);
  assert.match(messageItem(item,{...buyer,offer:{...offer,accepted:true}},50),/客户已确认/);
  const html=messageItem(item,buyer,50);
  for(const s of ['运费另计','¥123.45','预计 5 天发货','PLA &lt;室外&gt;','定制 &lt;店铺&gt;'])assert.ok(html.includes(s));
  assert.match(messageItem({...item,kind:'accepted'},buyer),/尚未下单付款/);
});

test('overlapping earlier and newer pages merge once and in order; user text never becomes markup',()=>{
  const a={seq:1,kind:'text',sender:'buyer',at:0,body:'<img src=x>\n下一行'};
  const old={seq:2,body:'A'},fresh={seq:2,body:'B'},third={seq:3,body:'C'};
  assert.deepEqual(mergeMessages([third,old],[fresh,a,{seq:0},{seq:'4'}]),[a,fresh,third]);
  assert.match(messageItem(a,buyer),/&lt;img src=x&gt;\n下一行/);
  assert.doesNotMatch(messageItem(a,buyer),/<img/);
});

test('merchant can distinguish two consultations about the same filename without seeing buyer account details',()=>{
  assert.equal(inquiryReference('thread_5052f954-9792-4e6b-805b-a73996a3ab50'),'A73996A3AB50');
  assert.notEqual(inquiryReference('thread_5052f954-9792-4e6b-805b-a73996a3ab51'),inquiryReference('thread_5052f954-9792-4e6b-805b-a73996a3ab50'));
});
