import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { normalizeShippingAddress, saveCustomerProfile, requireShippingAddress } from '../services/platform/customer.mjs';
import { createPlatformServer } from '../services/platform/local.mjs';
import { handleApi } from '../services/platform/http.mjs';

const address = changes => ({ recipient:'合成测试收件人', phone:'+86 13800000000', countryCode:'CN', province:'浙江省', city:'杭州市', district:'西湖区', addressLine:'合成测试路1号', postalCode:'', ...changes });
const profile = changes => ({ displayName:'测试用户', setupCompleted:true, shippingAddress:address(), ...changes });

test('address validation identifies the rejected semantic field without reflecting user input', () => {
  for (const [field,value,message] of [
    ['countryCode','China','请填写有效的国家或地区代码'],
    ['phone','+86+13800000000','请填写有效的联系电话'],
    ['province','私密错误省名','请选择有效的中国大陆省区市'],
    ['recipient','', '请填写有效的收件人'],
    ['city','', '请填写有效的城市'],
    ['district','', '请填写有效的区 / 县'],
    ['addressLine','私密地址\n注入', '请填写有效的详细地址']
  ]) {
    assert.throws(() => normalizeShippingAddress(address({[field]:value})), error => {
      assert.equal(error.status,400); assert.equal(error.code,'INVALID_ADDRESS');
      assert.equal(error.message,message); assert.deepEqual(error.fieldErrors,{[field]:message});
      assert.doesNotMatch(JSON.stringify(error.fieldErrors),/私密/);
      return true;
    });
  }
  assert.equal(normalizeShippingAddress(address({province:'浙江'})).province,'浙江省');
  assert.throws(() => saveCustomerProfile({},profile({displayName:'a'.repeat(81)}),1), error => {
    assert.equal(error.code,'INVALID_PROFILE'); assert.deepEqual(error.fieldErrors,{displayName:'账号名称格式无效'}); return true;
  });
});

test('country-specific requirements and legacy quote errors retain their exact field', () => {
  const us=address({countryCode:'US',province:'CA',city:'San Francisco',district:'',postalCode:''});
  assert.throws(() => normalizeShippingAddress(us), error => {
    assert.deepEqual(error.fieldErrors,{postalCode:'请填写有效的ZIP code'}); return true;
  });
  assert.throws(() => requireShippingAddress({customerProfile:{shippingAddress:us}}), error => {
    assert.equal(error.status,409); assert.equal(error.code,'ADDRESS_INCOMPLETE');
    assert.deepEqual(error.fieldErrors,{postalCode:'请填写有效的ZIP code'}); return true;
  });
  assert.equal(normalizeShippingAddress({...us,postalCode:'94105-1234'}).postalCode,'94105-1234');
});

test('HTTP profile response transports field errors and failed saves preserve the prior address', async t => {
  const directory=await mkdtemp(path.join(tmpdir(),'gongzao-field-errors-'));
  const instance=createPlatformServer({dbPath:path.join(directory,'test.sqlite')});
  await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>instance.server.close(resolve));instance.store.close();await rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+instance.server.address().port;
  const session=await fetch(base+'/api/v2/session');
  const cookie=session.headers.get('set-cookie').split(';')[0];
  const save=body=>fetch(base+'/api/v2/customer/profile',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
  const initial=await (await save(profile())).json();
  for(const [field,body] of [
    ['province',profile({shippingAddress:address({province:'不存在的私密省名'})})],
    ['phone',profile({shippingAddress:address({phone:'+86+13800000000'})})],
    ['displayName',profile({displayName:'私密称呼\n注入'})]
  ]) {
    const response=await save(body),result=await response.json();
    assert.equal(response.status,400); assert.deepEqual(Object.keys(result.error.fieldErrors),[field]);
    assert.equal(result.error.fieldErrors[field],result.error.message);
    assert.match(result.requestId,/^[a-f0-9-]+$/); assert.doesNotMatch(JSON.stringify(result),/私密/);
  }
  const saved=await (await fetch(base+'/api/v2/customer/profile',{headers:{Cookie:cookie}})).json();
  assert.deepEqual(saved.profile,initial.profile);
});

test('HTTP omits unexpected error metadata and rejects unrecognized field names', async () => {
  const request=()=>new Request('https://platform.example/api/v2/workspace');
  const makeStore=error=>({load:async()=>{throw error;}});
  const generic=Object.assign(new Error('private failure'),{fieldErrors:{phone:'private phone'}});
  const hidden=await (await handleApi(request(),{store:makeStore(generic),ownerId:'synthetic-owner'})).json();
  assert.equal(hidden.error.code,'INTERNAL_ERROR'); assert.equal(hidden.error.fieldErrors,undefined);
  assert.doesNotMatch(JSON.stringify(hidden),/private/);
  const expected=Object.assign(new Error('invalid'),{name:'PlatformError',code:'INVALID_ADDRESS',status:400,fieldErrors:{phone:'请填写有效的联系电话',secretToken:'do not expose',recipient:{nested:'invalid'},province:'x'.repeat(301)}});
  const safe=await (await handleApi(request(),{store:makeStore(expected),ownerId:'synthetic-owner'})).json();
  assert.deepEqual(safe.error.fieldErrors,{phone:'请填写有效的联系电话'});
});

test('web API errors preserve safe field metadata without changing original-request retry keys', async () => {
  const source=(await readFile(new URL('../dist/api-client.js',import.meta.url),'utf8')).replace(/^export /gm,'');
  const memory=new Map(),requests=[];
  let failing=true;
  const context=vm.createContext({TextEncoder,Uint8Array,AbortController,setTimeout,clearTimeout,crypto:{randomUUID},sessionStorage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)},fetch:async(url,options)=>{
    requests.push({url,options});
    return {ok:!failing,status:failing?400:200,json:async()=>failing?{requestId:'synthetic-request',error:{code:'INVALID_ADDRESS',message:'请选择有效的中国大陆省区市',fieldErrors:{province:'请选择有效的中国大陆省区市',secretToken:'discard',phone:['bad']}}}:{saved:true}};
  }});
  vm.runInContext(source+'\nglobalThis.client={prepareMutation,get};',context);
  const task=await context.client.prepareMutation('/customer/profile',profile());
  await assert.rejects(task.execute(), error => {
    assert.equal(error.status,400); assert.equal(error.code,'INVALID_ADDRESS'); assert.equal(error.requestId,'synthetic-request');
    assert.deepEqual({...error.fieldErrors},{province:'请选择有效的中国大陆省区市'}); return true;
  });
  failing=false;
  await task.execute();
  assert.equal(requests[0].options.headers['Idempotency-Key'],requests[1].options.headers['Idempotency-Key']);
  assert.equal(requests[0].options.body,requests[1].options.body);
  assert.doesNotMatch(JSON.stringify([...memory]),/收件人|测试路|fieldErrors/);
});
