import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlatformServer} from '../../services/platform/local.mjs';
import {tradeInboxHref, tradeInboxRole} from '../../dist/trade-return.js';
import {prepareWebAssets} from '../tools/prepare-web-assets.mjs';

const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
async function listen(server, t) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
async function checkTradePage(address, routed) {
  const page = await fetch(address);
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-type'),/text\/html/);
  const html = await page.text();
  const marker = html.includes('<meta name="platform-routes" content="enabled">');
  assert.equal(marker,routed);
  const base = new URL(address);
  assert.equal(new URL(html.match(/class="skip" href="([^"]+)"/)[1],base).pathname,base.pathname);
  const references = [...html.matchAll(/<(?:link|script|img)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map(match=>match[1]);
  const prefix = routed ? '/' : './';
  assert.ok(references.includes(prefix+'trade.css') && references.includes(prefix+'trade-ui.js'));
  for (const ref of references) {
    const url = new URL(ref,base);
    const response = await fetch(url);
    assert.equal(response.status,200,url.href);
    assert.equal(response.headers.get('content-type')?.split(';')[0],types[path.extname(url.pathname)],url.href);
    await response.arrayBuffer();
  }
  return {base,html};
}

test('all hosted inbox routes serve the stylesheet, script and images with the correct MIME types', async t => {
  const {server,store}=createPlatformServer({dbPath:':memory:'});
  t.after(()=>store.close());
  const origin=await listen(server,t);
  for (const route of ['/messages','/messages/','/merchant/messages','/merchant/messages/']) {
    const url = new URL(route,origin);
    await checkTradePage(url,true);
    const expected = route.startsWith('/merchant/') ? 'merchant' : 'buyer';
    assert.equal(tradeInboxRole(url.pathname,'?role=merchant'),expected);
    assert.equal(tradeInboxHref(expected, {thread:'abc'},true),route.replace(/\/$/,'')+'?thread=abc');
  }
});

test('both static inbox choices and their assets work on an ordinary nested static host', async t => {
  const targetDir=await mkdtemp(path.join(tmpdir(),'gongzao-static-navigation-'));
  t.after(()=>rm(targetDir,{recursive:true,force:true}));
  const {files}=await prepareWebAssets({targetDir});
  const server=http.createServer(async (request,response)=>{
    const file=new URL(request.url,'http://static.test').pathname.slice('/native/'.length);
    if (!request.url.startsWith('/native/') || !files.includes(file)) return response.writeHead(404).end();
    response.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});
    response.end(await readFile(path.join(targetDir,file)));
  });
  const origin=await listen(server,t);
  const entry=new URL('/native/trade.html',origin);
  const {html,base}=await checkTradePage(entry,false);
  for(const role of ['buyer','merchant']){
    const href=html.match(new RegExp('id="'+role+'-tab" href="([^"]+)"'))[1];
    assert.equal(href,tradeInboxHref(role,undefined,false));
    const url=new URL(href,base);
    assert.equal(tradeInboxRole(url.pathname,url.search),role);
    await checkTradePage(url,false);
    const detail=new URL(tradeInboxHref(role,{thread:'demo'},false),base);
    assert.equal(detail.pathname,'/native/trade.html');
    assert.equal(detail.searchParams.get('thread'),'demo');
    assert.equal(tradeInboxRole(detail.pathname,detail.search),role);
  }
});
