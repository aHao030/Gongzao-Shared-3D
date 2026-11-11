import test from 'node:test';
import assert from 'node:assert/strict';
import {createInternationalUI} from '../dist/international-ui.js';
import {getMarketCatalog} from '../services/platform/market.mjs';
import {normalizeShippingAddress} from '../services/platform/customer.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mainland={countryCode:'CN',recipient:'测试收件人',phone:'+86 12345',province:'浙江省',city:'杭州市',district:'西湖区',addressLine:'测试街道 1 号',postalCode:''};
async function setup(){const ui=createInternationalUI({get:async()=>getMarketCatalog(),escape});await ui.load();return ui;}
const control=(html,id)=>html.match(new RegExp('<(?:input|select)[^>]*id="'+id+'"[^>]*>'))?.[0];
const selectBody=(html,id)=>html.match(new RegExp('<select[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</select>'))?.[1];

test('empty mainland address reports every required field together, then accepts corrections',async()=>{
  const ui=await setup();
  const errors=ui.validateAddressFields({countryCode:'CN',recipient:'  ',phone:'',province:'',city:'',district:'',addressLine:''});
  assert.deepEqual(Object.keys(errors),['customer-recipient','customer-phone','customer-province','customer-city','customer-district','customer-address-line']);
  assert.match(errors['customer-recipient'],/收件人/);
  assert.match(errors['customer-province'],/省 \/ 直辖市 \/ 自治区/);
  assert.equal(ui.validateAddress({countryCode:'CN'}),errors['customer-recipient']);
  assert.deepEqual(ui.validateAddressFields(mainland),{});
  assert.equal(ui.validateAddress(mainland),'');
});

test('mainland province dropdown has exactly the supported choices and retains legacy values',async()=>{
  const ui=await setup(),body=selectBody(ui.fieldsHTML(mainland),'customer-province');
  assert.match(control(ui.fieldsHTML(mainland),'customer-province'),/^<select.*required/);
  const choices=[...body.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(choices).size,31);
  for(const province of choices){
    assert.equal(normalizeShippingAddress({...mainland,province}).province,province);
    const short=province.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/,'');
    assert.deepEqual(ui.validateAddressFields({...mainland,province:short}),{});
    assert.match(selectBody(ui.fieldsHTML({...mainland,province:short}),'customer-province'),new RegExp('<option value="'+province+'" selected>'));
  }
  const stale=ui.fieldsHTML({...mainland,province:'旧省份<img>'});
  assert.match(selectBody(stale,'customer-province'),/<option value="旧省份&lt;img&gt;" selected>旧省份&lt;img&gt;（请重新选择）/);
  assert.doesNotMatch(stale,/<img>/);
  assert.match(ui.validateAddressFields({...mainland,province:'旧省份'})['customer-province'],/从列表选择/);
  assert.match(selectBody(ui.fieldsHTML({countryCode:'CN'}),'customer-province'),/<option value="" selected>/);
});

test('US and Singapore errors follow visible required fields without imposing postal regexes',async()=>{
  const ui=await setup();
  const us=ui.validateAddressFields({countryCode:'US',recipient:'Test',phone:'12345',addressLine:'Test street',province:'',city:'',postalCode:'',district:'ignored'});
  assert.deepEqual(Object.keys(us).sort(),['customer-city','customer-postal-code','customer-province']);
  assert.match(us['customer-postal-code'],/ZIP code/);
  const sg={countryCode:'SG',recipient:'Test',phone:'+65 12345',addressLine:'Test street',postalCode:''};
  assert.deepEqual(ui.validateAddressFields(sg),{'customer-postal-code':'请填写Postal code。'});
  assert.deepEqual(ui.validateAddressFields({...sg,postalCode:'018956',province:'x'.repeat(200),city:'ignored',district:'ignored'}),{});
  // Postal syntax is intentionally delegated to the local delivery process.
  assert.deepEqual(ui.validateAddressFields({...mainland,countryCode:'CA',province:'Ontario',postalCode:'K1A 0B1'}),{});
});

test('OTHER country code is attributed to its own control and all remaining errors remain visible',async()=>{
  const ui=await setup();
  const errors=ui.validateAddressFields({countryCode:'',recipient:'',phone:'',addressLine:''});
  assert.match(errors['customer-country-code'],/两位字母/);
  assert.ok(errors['customer-recipient']);assert.ok(errors['customer-phone']);assert.ok(errors['customer-address-line']);
  assert.equal('customer-country' in errors,false);
  assert.match(control(ui.fieldsHTML({countryCode:'IT'}),'customer-country-code'),/value="IT"/);
  assert.deepEqual(ui.validateAddressFields({countryCode:'IT',recipient:'Test',phone:'+39 12345',addressLine:'Test street'}),{});
});

test('phone validation rejects misplaced plus, non-numeric text and digit count limits',async()=>{
  const ui=await setup();
  for(const phone of ['12+345','++12345','1234','1'.repeat(21),'12345abc']){
    assert.match(ui.validateAddressFields({...mainland,phone})['customer-phone'],/5–20 位数字/);
    assert.throws(()=>normalizeShippingAddress({...mainland,phone}));
  }
  for(const phone of ['12345','+86 (123) 456-789','1'.repeat(20)]){
    assert.deepEqual(ui.validateAddressFields({...mainland,phone}),{});
    assert.equal(normalizeShippingAddress({...mainland,phone}).phone,phone);
  }
});

test('length and control-character errors identify the affected fields without discarding valid input',async()=>{
  const ui=await setup();
  const errors=ui.validateAddressFields({...mainland,recipient:'测'.repeat(81),addressLine:'楼栋\n房间',postalCode:'0'.repeat(21)});
  assert.match(errors['customer-recipient'],/80 个字符/);
  assert.match(errors['customer-address-line'],/换行或控制字符/);
  assert.match(errors['customer-postal-code'],/20 个字符/);
  assert.equal(errors['customer-phone'],undefined);
  assert.equal(mainland.addressLine,'测试街道 1 号');
});

test('switching away from mainland replaces the select and clears incompatible regional fields',async()=>{
  const ui=await setup();let html='',focused=false;
  const values={'customer-country':'US','customer-recipient':'Test','customer-phone':'12345','customer-province':'浙江省','customer-city':'杭州市','customer-district':'西湖区','customer-address-line':'Test street','customer-postal-code':'310000'};
  const root={querySelector:id=>id==='#customer-address-fields'?{set innerHTML(v){html=v;}}:id==='#customer-country'?{value:'US',focus(){focused=true;}}:values[id.slice(1)]!==undefined?{value:values[id.slice(1)]}:null};
  ui.changeCountry('US',root);
  assert.ok(focused);assert.match(control(html,'customer-province'),/^<input/);
  assert.doesNotMatch(html,/浙江省|杭州市|西湖区|310000/);
  assert.match(html,/Test street/);
});
