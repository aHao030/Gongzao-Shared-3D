import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { hasPlatformRoutes, tradeInboxHref } from '../dist/trade-return.js';

const source=(await readFile(new URL('../dist/merchant-ui.js',import.meta.url),'utf8'))
  .replace(/^import .*\n/gm,'').replace('export function createMerchantUI','function createMerchantUI');
const escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const future=()=>Date.now()+60000;
const gateway=id=>({id,name:'网关 '+id,status:'online',freshUntil:future()});
const scanResult=(extra={})=>({id:'current-scan',scope:'real',expiresAt:future(),status:'complete',gatewayId:'gw1',importable:true,candidates:[],...extra});
const device=(extra={})=>({id:'dev-a',name:'打印机 A',protocol:'bambu',model:'P1S',source:'real',connectionState:'online',connectionReason:'PROTOCOL_OBSERVED',freshUntil:future(),lastSeenAt:Date.now(),gatewayId:'gw1',endpoint:'mqtts://192.168.1.7:8883',verification:{level:'BAMBU_READONLY_REPORTED'},probeEvidence:{method:'MQTT_TLS',printState:'RUNNING',progressPercent:28},...extra});

function merchantPage(gateways=[gateway('gw1')]) {
  const listeners={},requests=[],reads=[],dialogs=[],inputs={},timers=new Map();let nextTimer=0;
  const inventory={devices:[],gateways,counts:{real:0},serverNow:Date.now()};
  const scan=scanResult({status:'pending'});
  const context=vm.createContext({
    tradeInboxHref,hasPlatformRoutes,Date,Intl,Set,Number,Object,Math,
    location:{pathname:'/merchant',hash:'#devices'},history:{replaceState(){}},
    setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},window:{addEventListener(){},scrollTo(){}},
    document:{
      querySelector(selector){return inputs[selector]??null;},
      addEventListener(name,listener){(listeners[name]??=[]).push(listener);}
    },
    get:async path=>{
      reads.push(path);
      if(path.startsWith('/merchant/scan-result'))return {scan};
      if(path==='/merchant/devices')return inventory;
      throw new Error('Unexpected UI request '+path);
    },
    prepareMutation:async(path,data)=>({execute:async()=>{
      requests.push({path,data:JSON.parse(JSON.stringify(data))});
      if(path==='/merchant/pairing')return {gateway:gateway('fixture-new'),token:'fixture-private-token',platformOrigin:'https://example.invalid'};
      return {scan:{...scan,autoRegister:data.autoRegister??null}};
    }}),
    dependencies:{
      icon:()=>'',escape,render(){},modal(...args){dialogs.push(args);},closeModal(){},toast(){},
      connection:()=>'online',session:()=>({}),legacyOrders:()=>''
    }
  });
  vm.runInContext(source+'\nglobalThis.ui=createMerchantUI(dependencies);',context);
  const ui=context.ui;
  Object.assign(ui.state,{loaded:true,profile:{name:'测试店'},gateways});
  const click=(action,data={})=>listeners.click[0]({target:{closest:()=>({dataset:{merchantAction:action,...data}})},preventDefault(){}});
  return {ui,click,requests,reads,dialogs,inputs,scan,inventory,timers,html:()=>ui.renderContent()};
}

test('one online gateway starts one durable Bambu registration without a second selection prompt', async()=>{
  const view=merchantPage();
  assert.match(view.html(),/一键接入拓竹/);
  await view.click('bambu-connect');
  assert.deepEqual(view.requests,[{path:'/merchant/scan',data:{scope:'real',gatewayId:'gw1',autoRegister:'bambu'}}]);
  assert.equal(view.dialogs.length,0);
  assert.match(view.html(),/网关将在检测完成后批量登记/);
});

test('the merchant chooses the exact gateway when several are online, and gets setup instructions when none are online', async()=>{
  const none=merchantPage([]);
  await none.click('bambu-connect');
  assert.match(none.dialogs[0].join(''),/在线的本地网关/);
  assert.equal(none.requests.length,0);
  const stale=merchantPage([{...gateway('old'),freshUntil:Date.now()-1}]);
  await stale.click('bambu-connect');
  assert.match(stale.dialogs[0].join(''),/恢复本地网关连接/);assert.equal(stale.requests.length,0);
  const view=merchantPage([gateway('east'),gateway('west')]);
  await view.click('bambu-connect');
  assert.match(view.dialogs[0].join(''),/start-bambu-scan/);
  assert.equal(view.requests.length,0);
  view.inputs['#discovery-gateway']={value:'west'};
  await view.click('start-bambu-scan');
  assert.deepEqual(view.requests[0].data,{scope:'real',gatewayId:'west',autoRegister:'bambu'});
});

test('the automatic receipt includes only Bambu devices; a Bambu-only empty scan gives matching guidance',()=>{
  const view=merchantPage(),other={id:'o',name:'不应出现在拓竹结果的服务',protocol:'octoprint',connectionState:'online'};
  view.ui.state.scan=scanResult({autoRegister:'bambu',registrationResult:{added:1,existing:0,blocked:0},candidates:[
    device({registered:true,connectionState:'authorization_required',probeEvidence:{method:'SSDP'}}),other]});
  let html=view.html();
  assert.match(html,/新增 1 台/);assert.match(html,/已添加/);assert.match(html,/BAMBU-GATEWAY-WINDOWS/);
  assert.doesNotMatch(html,/不应出现在拓竹结果的服务|data-merchant-action="import"|data-candidate-id=/);
  view.ui.state.scan.candidates=[other];view.ui.state.scan.registrationResult={added:0,existing:0,blocked:0};
  view.ui.state.scan.partialDiagnostics=['BAMBU_DISCOVERY_LIMIT','BAMBU_LISTEN_UNAVAILABLE','fixture-secret-never-echo'];
  html=view.html();assert.match(html,/没有发现拓竹设备/);assert.match(html,/指定设备地址/);assert.match(html,/本次达到扫描上限/);assert.match(html,/UDP 1990\/2021/);assert.doesNotMatch(html,/fixture-secret-never-echo/);
});

test('fresh authenticated reports show the print state; the UI discards stale progress or an unverified state', async()=>{
  const view=merchantPage(),d=device({deviceKey:'hidden-internal-test-identifier'});
  view.ui.state.devices=[d];
  assert.match(view.html(),/打印中 · 28%/);assert.doesNotMatch(view.html(),/hidden-internal-test-identifier/);
  await view.click('device-details',{deviceId:d.id});
  assert.match(view.dialogs.at(-1).join(''),/P1S/);assert.doesNotMatch(view.dialogs.at(-1).join(''),/hidden-internal-test-identifier/);
  d.probeEvidence={method:'MQTT_TLS',printState:'IDLE'};assert.match(view.html(),/空闲/);
  d.freshUntil=Date.now()-10;assert.match(view.html(),/离线或观察已过期/);assert.doesNotMatch(view.html(),/空闲/);
  d.freshUntil=future();d.connectionState='authorization_required';d.probeEvidence={method:'SSDP',printState:'RUNNING',progressPercent:99};
  assert.match(view.html(),/待本地授权/);assert.doesNotMatch(view.html(),/99%|打印中/);
});

test('a manual scan permits server-approved advertisements, blocks conflicts, and still recognizes older HTTP gateways',()=>{
  const view=merchantPage();
  view.ui.state.scan=scanResult({candidates:[
    device({id:'pending-a',name:'手动拓竹',connectionState:'authorization_required',canRegister:true}),
    device({id:'conflict-a',canRegister:false,registrationConflict:'OTHER_GATEWAY'}),
    {id:'old-o',name:'OctoPrint',protocol:'octoprint',connectionState:'online'}]});
  let html=view.html();
  assert.match(html,/3 台已发现 · 2 台可添加/);assert.match(html,/可登记 · 待本地授权/);
  assert.match(html,/data-candidate-id="conflict-a" disabled/);assert.match(html,/已在另一网关登记/);
  view.ui.state.scan.expiresAt=Date.now()-100;html=view.html();assert.match(html,/检测已过期/);assert.doesNotMatch(html,/data-candidate-id=/);
});


test('visible inventory picks up background monitoring without starting new scans or changing machines',async()=>{
  const view=merchantPage(),original=device();
  view.ui.state.devices=[original];
  await view.click('view',{view:'devices'});
  const timer=[...view.timers.values()].find(t=>t.delay===30000);
  assert.ok(timer);
  view.inventory.devices=[device({probeEvidence:{method:'MQTT_TLS',printState:'PAUSE',progressPercent:32}})];
  await timer.callback();
  assert.match(view.html(),/已暂停 · 32%/);
  assert.deepEqual(view.reads,['/merchant/devices']);
  assert.deepEqual(view.requests,[]);
  await view.click('view',{view:'overview'});
  assert.equal([...view.timers.values()].filter(t=>t.delay===30000).length,0);
});


test('connected platform pages provide the standalone gateway and separate private configuration, while static shells omit the download route', async()=>{
  const hosted=merchantPage([]);
  hosted.inputs['meta[name="platform-routes"][content="enabled"]']={};
  await hosted.click('bambu-connect');
  let body=hosted.dialogs.at(-1).join('');
  assert.match(body,/href="\/downloads\/gongzao-bambu-gateway.zip" download/);
  assert.match(body,/Node.js 24/);
  hosted.inputs['#gateway-name']={value:'测试网关'};
  await hosted.click('create-pairing');
  body=hosted.dialogs.at(-1).join('');
  assert.match(body,/下载 Windows 网关/);
  assert.match(body,/data-merchant-action="download-config"[^>]*>下载配对配置/);
  assert.doesNotMatch(body,/fixture-private-token/);
  const local=merchantPage([]);
  await local.click('bambu-connect');
  assert.doesNotMatch(local.dialogs.at(-1).join(''),/gongzao-bambu-gateway.zip/);
});
