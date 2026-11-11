import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyUpdate } from '../tools/update-local.mjs';
import { createIntegrationHub } from '../services/integrations/index.mjs';

const project = 'gongzao-shared-fabrication';
const json = value => JSON.stringify(value);
async function writeTree(root, files) {
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  }
}
function manifest(files, version) {
  return json({ schema: 1, project, version, files: Object.entries(files).map(([path, content]) => ({
    path, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex')
  })) });
}

test('updating preserves registered app identities and a configured backend while upgrading a stock WeChat adapter', async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'gz-client-config-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const target = path.join(tmp, 'old'), source = path.join(tmp, 'new');
  const wechat = 'apps/weapp/project.config.json', mobile = 'apps/mobile/capacitor.config.json';
  const desktop = 'apps/desktop/src-tauri/tauri.conf.json', service = 'apps/weapp/config/service.js', auth = 'apps/weapp/utils/auth.js';
  const previous = {
    'package.json': json({ name: project, version: '0.9.2' }),
    'services/platform/local.mjs': '// local', 'dist/index.html': '<html></html>',
    [wechat]: json({ appid: 'touristappid' }), [mobile]: json({ appId: 'com.example.sharedfabrication' }),
    [desktop]: json({ identifier: 'com.example.sharedfabrication' }), [service]: '// previous default', [auth]: '// stock auth'
  };
  const local = { [wechat]: json({ appid: 'wx1234567890abcdef' }), [mobile]: json({ appId: 'com.studio.mobile' }),
    [desktop]: json({ identifier: 'com.studio.desktop' }), [service]: "module.exports = { API_BASE: 'https://studio.example' };" };
  const next = { ...previous, 'package.json': json({ name: project, version: '0.9.3' }),
    [wechat]: json({ appid: 'touristappid', upgraded: true }), [mobile]: json({ appId: 'com.example.sharedfabrication', upgraded: true }),
    [desktop]: json({ identifier: 'com.example.sharedfabrication', upgraded: true }), [service]: '// next default', [auth]: '// improved auth' };
  await writeTree(target, { ...previous, ...local, 'UPDATE-MANIFEST.json': manifest(previous, '0.9.2') });
  await writeTree(source, { ...next, 'UPDATE-MANIFEST.json': manifest(next, '0.9.3') });
  const result = await applyUpdate({ source, target });
  assert.deepEqual([...result.preserved].sort(), Object.keys(local).sort());
  for (const name of [wechat, mobile, desktop]) {
    assert.deepEqual(JSON.parse(await readFile(path.join(target, name), 'utf8')), { ...JSON.parse(local[name]), upgraded: true });
  }
  assert.equal(await readFile(path.join(target, service), 'utf8'), local[service]);
  assert.equal(await readFile(path.join(target, auth), 'utf8'), next[auth]);
  assert.equal(await readFile(path.join(target, 'UPDATE-MANIFEST.json'), 'utf8'), manifest(next, '0.9.3'));
  assert.equal(await readFile(path.join(result.backup, 'code', 'UPDATE-MANIFEST.json'), 'utf8'), manifest(previous, '0.9.2'));
  const later = { ...next, 'package.json': json({ name: project, version: '0.9.4' }), [auth]: '// second adapter fix' };
  await writeTree(source, { ...later, 'UPDATE-MANIFEST.json': manifest(later, '0.9.4') });
  await applyUpdate({ source, target });
  assert.equal(await readFile(path.join(target, auth), 'utf8'), later[auth]);
  assert.equal(await readFile(path.join(target, service), 'utf8'), local[service]);
});

const context = { ownerId: 'test-workspace' };
function shippingHub(response) {
  return createIntegrationHub({
    config: { ...context, services: { karrio: { baseUrl: 'https://shipping.example' } } },
    fetchImpl: async () => Response.json(response)
  });
}
test('a tracking result belongs to its requested parcel before delivery may be displayed', async () => {
  const request = { carrier: 'ups', trackingNumber: 'Track-001' };
  await assert.rejects(shippingHub({ status: 'delivered', tracking_number: 'Track-002' }).tracking(request, context), { code: 'TRACKING_MISMATCH' });
  const matched = await shippingHub({ status: 'in_transit', tracking_number: 'track-001' }).tracking(request, context);
  assert.equal(matched.trackingNumber, request.trackingNumber);
  assert.equal(matched.status, 'IN_TRANSIT');
});

test('missing provider freight amounts remain unavailable and a genuine zero charge stays zero', async () => {
  const base = { id: 'rate', carrier_name: 'ups', service: 'ground', currency: 'USD' };
  const request = { shipper: { country_code: 'CN' }, recipient: { country_code: 'JP' }, parcels: [{ weight: 1, weight_unit: 'KG', length: 1, width: 1, height: 1, dimension_unit: 'CM' }] };
  const values = ['', ' ', null, '0', 0, '12.30'];
  const { rates } = await shippingHub({ rates: values.map(total_charge => ({ ...base, total_charge })) }).rates(request, context);
  assert.deepEqual(rates.map(r => r.totalCharge), [null, null, null, 0, 0, 12.3]);
  await assert.rejects(shippingHub({ rates: [null] }).rates(request, context), { code: 'UPSTREAM_INVALID_RESPONSE' });
});

test('an HTTP 200 containing an error is not a successful logistics or payment health probe', async () => {
  for (const service of ['karrio', 'hyperswitch']) {
    const hub = createIntegrationHub({
      config: { ...context, services: { [service]: { baseUrl: 'https://upstream.example' } } },
      fetchImpl: async () => Response.json({ error: 'service unavailable' })
    });
    await assert.rejects(hub.probe(service, context), { code: 'UPSTREAM_INVALID_RESPONSE' });
    assert.equal(hub.status(context).services.find(item => item.id === service).state, 'UNAVAILABLE');
  }
});

test('device protocol connection probe reports the number sampled, and keeps it visible on refresh', async () => {
  const hub = createIntegrationHub({
    config: { ...context, devices: ['a','b'].map(id => ({ id, protocol: 'octoprint', baseUrl: 'https://printer-' + id + '.example' })) },
    fetchImpl: async () => Response.json({ state: 'Operational' })
  });
  const probe = await hub.probe('octoprint', context);
  assert.equal(probe.itemCount, 1);
  assert.match(probe.message, /共配置 2 台/);
  assert.equal(hub.status(context).services.find(item => item.id === 'octoprint').message, probe.message);
});
