import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {canAcceptProposal,compatibleCapabilities,validateInquiryDraft} from '../dist/workflow-ui.js';
const source=(await readFile(new URL('../dist/workflow-ui.js',import.meta.url),'utf8')).replace(/^import .*\n/,'').replaceAll('export ','');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const capability={id:'cap-f1-standard',name:'标准 FDM',farmId:'f1',process:'FDM',materials:['PLA','PETG'],maxDimensions:[240,240,250],qualities:['standard','fine'],enabled:true,quoteMode:'AUTO_ESTIMATE',revision:1};
const future=Date.now()+900000;
const proposal={revision:2,status:'ACTIVE',source:'MERCHANT_REVIEW',process:'FDM',material:'PLA',quality:'standard',manufacturingCents:10000,shippingCents:1000,platformFeeCents:700,totalCents:11700,productionHours:2,dispatchDays:[1,2],transitDays:[2,3],arrivalDays:[3,5],expiresAt:future,note:'已核对用途'};
const inquiry={id:'INQ-test',revision:3,status:'AWAITING_CUSTOMER',modelSnapshot:{id:'sample-bracket',name:'<script>bad</script>.stl',dimensions:[1,2,3]},unit:'inch',qty:2,material:'AUTO',capabilitySnapshot:capability,currentProposalRevision:2,proposals:[{...proposal,revision:1,status:'SUPERSEDED',totalCents:9999},proposal],requirements:{purpose:'<img onerror=alert(1)>'}};
function harness({get=async path=>path.endsWith('/capabilities')?{capabilities:[capability]}:{inquiries:[]},execute=async()=>({}),address=true}={}){
 const events={},nodes={},sent=[],modals=[],toasts=[],pages=[];let addressCallback=null;
 const selected={model:{id:'sample-bracket',dimensions:[72,48,58]},qty:1,quantityDraft:null,unit:'mm'};
 const context=vm.createContext({Date,Intl,Number,String,Set,Object,Math,JSON,Array,encodeURIComponent,location:{pathname:'/'},document:{querySelector:id=>nodes[id]||null,querySelectorAll:()=>[],addEventListener:(name,handler)=>(events[name]??=[]).push(handler)},get,prepareMutation:async(path,payload)=>{sent.push({path,payload});return{execute};},dependencies:{icon:()=>'',escape:esc,render(){},modal:(...args)=>modals.push(args),closeModal(){},toast:text=>toasts.push(text),selection:()=>selected,applyWorkspace(){},changePage:p=>pages.push(p),connection:()=> 'online',hasAddress:()=>address,requestAddress:callback=>{addressCallback=callback;},merchantAuthenticated:()=>true}});
 vm.runInContext(source+'\nglobalThis.ui=createWorkflowUI(dependencies);',context);
 async function click(action,data={}){const target={dataset:{workflowAction:action,...data}};for(const handler of events.click||[])await handler({target:{closest:()=>target},preventDefault(){}});}
 return{ui:context.ui,context,events,nodes,sent,modals,toasts,pages,selected,click,get addressCallback(){return addressCallback;}};
}
test('inquiry validation requires model, explicit dimensions, valid uncommitted quantity and positive tolerance',()=>{
 const d={capabilityId:'c',dimensionsConfirmed:true,toleranceMm:''},s={model:{id:'m'},qty:3,quantityDraft:null};
 assert.equal(validateInquiryDraft(d,s),'');
 assert.match(validateInquiryDraft({...d,dimensionsConfirmed:false},s),/尺寸/);
 assert.match(validateInquiryDraft(d,{...s,quantityDraft:''}),/1–50/);
 assert.match(validateInquiryDraft(d,{...s,quantityDraft:'3.5'}),/1–50/);
 assert.match(validateInquiryDraft({...d,toleranceMm:'-0.1'},s),/公差/);
 assert.match(validateInquiryDraft({...d,toleranceMm:'101'},s),/公差/);
 assert.match(validateInquiryDraft(d,{...s,model:{id:'m',localOnly:true}}),/上传/);
});
test('only active current unexpired proposal is locally confirmable; disabled or incompatible capabilities excluded',()=>{
 assert.equal(canAcceptProposal(inquiry),true);
 assert.equal(canAcceptProposal({...inquiry,currentProposalRevision:1}),false);
 assert.equal(canAcceptProposal({...inquiry,status:'ORDERED'}),false);
 assert.equal(canAcceptProposal(inquiry,future),false);
 assert.equal(compatibleCapabilities([capability,{...capability,id:'off',enabled:false}],'PLA').length,1);
 assert.equal(compatibleCapabilities([capability],'ALUMINUM').length,0);
 assert.equal(compatibleCapabilities([capability],'AUTO').length,1);
});
test('model-first form defaults to merchant material recommendation and keeps engineering options collapsed',async()=>{
 const h=harness();await h.ui.load();const html=h.ui.customerForm();
 assert.match(html,/<option value="AUTO" selected>让商家推荐/);
 assert.match(html,/id="inquiry-dimensions"/);
 assert.match(html,/<details class="workflow-advanced" >/);
 assert.match(html,/尺寸公差 ± mm/);assert.doesNotMatch(html,/喷嘴温度|打印速度|支撑角度/);
 h.ui.state.draft.dimensionsConfirmed=true;h.ui.modelChanged();assert.equal(h.ui.state.draft.dimensionsConfirmed,false);
});
test('customer confirmation escapes metadata, scales inch dimensions, highlights revision and excludes private cost',()=>{
 const h=harness();h.ui.state.inquiries=[inquiry];h.ui.state.proposalEconomics=[{inquiryId:inquiry.id,estimatedCostCents:4321}];h.ui.viewInquiry(inquiry.id);
 const html=h.modals[0].join('');assert.match(html,/25.4 × 50.8 × 76.2 mm/);assert.match(html,/文件单位 inch/);
 assert.match(html,/&lt;script&gt;bad/);assert.doesNotMatch(html,/<script>|<img onerror/);
 assert.match(html,/这是新方案 v2/);assert.match(html,/data-proposal-revision="2"/);assert.doesNotMatch(html,/43\.21|预计制造成本/);
});
test('non-FDM confirmation and review never present FDM layer height as machining precision',()=>{
 const h=harness();const cnc={...inquiry,id:'INQ-cnc',material:'CNC',capabilitySnapshot:{...capability,process:'CNC',materials:['CNC']},proposals:[{...proposal,process:'CNC',material:'CNC'}]};h.ui.state.inquiries=[cnc];h.ui.viewInquiry(cnc.id);let html=h.modals.at(-1).join('');assert.match(html,/工艺档位/);assert.doesNotMatch(html,/0\.20 mm|0\.12 mm/);
 h.ui.reviewInquiry(cnc.id);html=h.modals.at(-1).join('');assert.match(html,/工艺档位/);assert.doesNotMatch(html,/0\.20 mm|0\.12 mm/);
});
test('missing address defers inquiry creation; request payload uses explicit selected model and unit',async()=>{
 const h=harness({address:false});await h.ui.load();h.ui.state.draft.dimensionsConfirmed=true;await h.click('submit-inquiry');assert.equal(h.sent.length,0);assert.equal(typeof h.addressCallback,'function');
 const ready=harness({execute:async()=>({inquiry:{...inquiry,status:'AWAITING_MERCHANT'}})});await ready.ui.load();ready.ui.state.draft.dimensionsConfirmed=true;ready.selected.unit='inch';await ready.click('submit-inquiry');assert.equal(ready.sent[0].path,'/inquiries');assert.equal(ready.sent[0].payload.material,'AUTO');assert.equal(ready.sent[0].payload.unit,'inch');assert.equal(ready.sent[0].payload.dimensionsConfirmed,true);assert.deepEqual(ready.pages,['inquiries']);
});
test('confirmation sends exact displayed revision and blocks a stale confirmation button',async()=>{
 const h=harness({execute:async()=>({inquiry:{...inquiry,status:'ORDERED'}})});h.ui.state.inquiries=[inquiry];await h.click('accept-inquiry',{inquiryId:inquiry.id,proposalRevision:'1'});assert.equal(h.sent.length,0);
 await h.click('accept-inquiry',{inquiryId:inquiry.id,proposalRevision:'2'});assert.equal(h.sent[0].path,'/inquiries/accept');assert.equal(h.sent[0].payload.proposalRevision,2);assert.equal(h.sent[0].payload.customerAccepted,true);assert.deepEqual(h.pages,['orders']);
});
test('auth reset prevents late merchant reads restoring prior account inquiries and cost evidence',async()=>{
 const resolutions=[];const h=harness({get:()=>new Promise(resolve=>resolutions.push(resolve))});const pending=h.ui.load(true);assert.equal(resolutions.length,2);h.ui.reset();resolutions[0]({capabilities:[capability]});resolutions[1]({inquiries:[inquiry],proposalEconomics:[{estimatedCostCents:9911}]});await pending;assert.equal(h.ui.state.inquiries.length,0);assert.equal(h.ui.state.proposalEconomics.length,0);assert.equal(h.ui.state.capabilities.length,0);assert.equal(h.ui.state.loaded,false);
});
test('auth reset prevents late inquiry mutations reopening a prior account order',async()=>{
 let resolve;const h=harness({execute:()=>new Promise(r=>{resolve=r;})});h.ui.state.inquiries=[inquiry];const pending=h.click('accept-inquiry',{inquiryId:inquiry.id,proposalRevision:'2'});await new Promise(setImmediate);h.ui.reset();resolve({inquiry:{...inquiry,status:'ORDERED'}});await pending;assert.equal(h.ui.state.inquiries.length,0);assert.equal(h.pages.length,0);
});
