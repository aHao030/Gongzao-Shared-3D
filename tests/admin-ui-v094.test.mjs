import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardContent, formErrors, loginContent, permittedTabs } from '../dist/admin-ui.js';

const guest = {authenticated:false,configured:true,authorized:false,actorId:null};
const local = {mode:'LOCAL',emailPassword:{enabled:true},providers:[{label:'统一账号',enabled:true,authorizationPath:'/api/auth/oidc/start?provider=keycloak'}]};
const granted = permissions => ({...guest,authenticated:true,authorized:true,actorId:'test-account',role:'auditor',permissions});
const base = {
  session:granted({manageNodes:false,manageIntake:false,manageMembers:false,viewAudit:true}),
  overview:{intake:{paused:true,reason:'维护'},nodes:[{name:'工场<script>',id:'node-abc',purpose:'计算',status:'NEVER_CONNECTED',state:'ACTIVE'}],members:[],audit:[],auditLimit:200,auditDropped:0},
  business:{summary:{workspaces:30,orders:4,pendingRefunds:0,openDisputes:1,awaitingShipment:2},coverage:{partial:true,scanned:30},asOf:1}
};

test('admin sign-in distinguishes local credentials, configured OIDC, hosted identity, and setup', () => {
  const html=loginContent(guest,local);
  assert.match(html,/autocomplete="current-password"/);
  assert.match(html,/api\/auth\/oidc\/start\?provider=keycloak&amp;returnTo=%2Fadmin/);
  assert.doesNotMatch(html,/data-form="member.grant"/);
  const hosted=loginContent(guest,{platform:{enabled:true,signInUrl:'/signin-with-chatgpt'}});
  assert.match(hosted,/target="_top" href="\/signin-with-chatgpt\?return_to=%2Fadmin"/);
  assert.doesNotMatch(hosted,/type="password"/);
  const unconfigured=loginContent({...guest,authenticated:true,configured:false,actorId:'actor<&'},local);
  assert.match(unconfigured,/ADMIN-WINDOWS\.cmd/);
  assert.match(unconfigured,/actor&lt;&amp;/);
  assert.match(loginContent({...guest,authenticated:true,actorId:'me'},local),/需要管理员授权/);
});

test('read-only roles cannot open mutating controls and partial or failed totals are labelled', () => {
  assert.deepEqual(permittedTabs(base.session),['overview','nodes','audit']);
  const overview=dashboardContent({...base,tab:'members'});
  assert.match(overview,/部分统计，已覆盖 30 个工作区/);
  assert.doesNotMatch(overview,/data-op="(?:member.grant|intake.set)"/);
  const nodes=dashboardContent({...base,tab:'nodes'});
  assert.match(nodes,/等待首次心跳/);
  assert.match(nodes,/工场&lt;script&gt;/);
  assert.doesNotMatch(nodes,/data-op="node\./);
  const down=dashboardContent({...base,business:null,businessError:'业务统计暂不可用。'});
  assert.match(down,/业务统计暂不可用/);
  assert.doesNotMatch(down,/>待发货</);
});

test('operator sees rotate and intake controls without membership administration; revoked nodes stay terminal', () => {
  const state={...base,session:granted({manageNodes:true,manageIntake:true,manageMembers:false,viewAudit:true})};
  assert.match(dashboardContent({...state,tab:'overview'}),/恢复受理/);
  const nodes=dashboardContent({...state,tab:'nodes'});
  assert.match(nodes,/data-op="node.rotate"/);
  assert.match(nodes,/--server-node/);
  const revoked={...state,tab:'nodes',overview:{...state.overview,nodes:[{id:'n',name:'归档',state:'REVOKED',status:'REVOKED'}]}};
  assert.doesNotMatch(dashboardContent(revoked),/data-op="node.rotate"/);
});

test('forms require visible node labels, opaque account subjects and reasons for pausing intake', () => {
  assert.ok(formErrors('node.create',{name:' ',purpose:'计算'} )['node-name']);
  assert.ok(formErrors('member.grant',{subject:'a b',role:'operator'}).subject);
  assert.ok(formErrors('member.grant',{subject:'user',role:'owner'}).role);
  assert.ok(formErrors('intake.set',{paused:true,reason:' '}).reason);
  assert.deepEqual(formErrors('intake.set',{paused:false}),{});
});
