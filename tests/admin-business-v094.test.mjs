import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStore } from '../services/platform/store-sqlite.mjs';
import { D1Store } from '../services/platform/store-d1.mjs';
import { createWorkspace, applyCommand } from '../services/platform/core.mjs';
import { customerProfileFixture } from './helpers/customer-fixture.mjs';
import { encodeWorkspace, WORKSPACE_QUOTE_PREFIX } from '../services/platform/workspace-storage.mjs';
import { readAdminBusiness } from '../services/platform/admin-business.mjs';

const ready = { status:'ready_to_ship', productionState:'QC_PASSED', paymentState:'SIMULATED_FROZEN', logisticsState:'NONE', refundState:'NONE', disputeState:'NONE' };
const privateMarker = 'PRIVATE_TEST_MARKER';
const now = 1_800_000_000_000;

function setup(t) {
  const local = new SQLiteStore(':memory:');
  t.after(() => local.close());
  const cloud = new D1Store({
    prepare(sql) {
      const statement = local.db.prepare(sql);
      return { bind: (...args) => ({ first: async () => statement.get(...args) }) };
    }
  }, null);
  const save = (owner, data) => local.db.prepare('INSERT INTO platform_workspaces VALUES (?, 1, ?, ?)').run(owner, data, now);
  return { local, cloud, save };
}

test('admin metrics report empty, legacy and compact records without exposing private fields', async t => {
  const { local, cloud, save } = setup(t);
  assert.equal((await readAdminBusiness(local, now)).summary.workspaces, 0);
  save('owner-' + privateMarker, JSON.stringify({orders:[
    { ...ready, shippingAddress:{recipient:privateMarker}, tracking:privateMarker },
    { ...ready, disputeState:'OPEN', refundState:'REQUESTED' },
    { ...ready, logisticsState:'SHIPPED' },
    { ...ready, paymentState:'SIMULATED_REFUNDED', refundState:'SIMULATED_REFUNDED' },
    {status:'ready'}, {status:'refund_pending', dispute:true}
  ]}));
  const workspace = createWorkspace();
  workspace.orders.push({...ready, refundState:'REJECTED'});
  workspace.quotes = [{ terms:'工艺'.repeat(200000) }];
  const packed = await encodeWorkspace(workspace);
  assert.ok(packed.startsWith(WORKSPACE_QUOTE_PREFIX));
  save('owner-two', packed);
  const expected = {summary:{workspaces:2,orders:7,pendingRefunds:2,openDisputes:2,awaitingShipment:3},coverage:{scanned:2,limit:32,partial:false},asOf:now};
  for (const store of [local, cloud]) {
    const result = await readAdminBusiness(store, now);
    assert.deepEqual(result, expected);
    assert.ok(!JSON.stringify(result).includes(privateMarker));
  }
});

test('metrics label partial coverage and apply the limit to whole workspaces', async t => {
  const { local, save } = setup(t);
  save('oldest', JSON.stringify({orders:[ready]}));
  for (let index=0; index<32; index++) save('newer-'+index, JSON.stringify({orders:[]}));
  const result = await readAdminBusiness(local, now);
  assert.deepEqual(result.coverage, {scanned:32,limit:32,partial:true});
  assert.equal(result.summary.workspaces, 32);
  assert.equal(result.summary.orders, 0);
});

test('unreadable workspaces and storage errors return an unavailable signal instead of misleading zeros', async t => {
  const { local, save } = setup(t);
  for (const malformed of ['not-json-'+privateMarker, JSON.stringify({orders:null}), JSON.stringify({orders:[{}]}), JSON.stringify({orders:[{status:'unknown-to-this-version'}]})]) {
    save('broken', malformed);
    await assert.rejects(readAdminBusiness(local, now), error => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'ADMIN_BUSINESS_UNAVAILABLE');
      return !error.message.includes(privateMarker);
    });
    local.db.exec('DELETE FROM platform_workspaces');
  }
  await assert.rejects(readAdminBusiness({kind:'d1',db:null}), { code:'ADMIN_BUSINESS_UNAVAILABLE' });
});


test('the operating view follows a persisted order through QC, dispute, refund request and shipment', async t => {
  const { local } = setup(t);
  const write = (type, payload) => local.transact('sandbox-account', state =>
    applyCommand(state, { type, payload, idempotencyKey:crypto.randomUUID() }));
  const counts = async () => {
    const { summary } = await readAdminBusiness(local);
    return [summary.orders,summary.pendingRefunds,summary.openDisputes,summary.awaitingShipment];
  };
  await write('customer-profile', customerProfileFixture());
  const { result:{quotes} } = await write('quote', { material:'PLA' });
  const { result:{order} } = await write('order', { quoteId:quotes[0].quoteId, demoAcknowledged:true });
  const act = (action, extra={}) => write('action', {id:order.id, action, demoAcknowledged:true, ...extra});
  assert.deepEqual(await counts(), [1,0,0,0]);
  await act('complete-print', {id:order.deviceId});
  await act('collect-and-qc', { partRemoved:true, bedClear:true, materialReady:true, loadedMaterial:'PLA', qcPassed:true });
  assert.deepEqual(await counts(), [1,0,0,1]);
  await act('dispute', {open:true, reason:'核对图纸尺寸'});
  assert.deepEqual(await counts(), [1,0,1,0]);
  await act('dispute', {open:false});
  const { result:{order:pending} } = await act('request-refund', {reason:'核对订单'});
  assert.deepEqual(await counts(), [1,1,0,0]);
  await act('resolve-refund', {requestId:pending.refundRequest.id, approved:false, reason:'客户确认继续发货'});
  assert.deepEqual(await counts(), [1,0,0,1]);
  await act('ship', {carrier:'测试承运商', trackingNumber:'DEMO-OPS123'});
  assert.deepEqual(await counts(), [1,0,0,0]);
});
