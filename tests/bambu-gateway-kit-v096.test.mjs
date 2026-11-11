import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPlatformServer } from '../services/platform/local.mjs';
import { buildBambuGatewayKit } from '../tools/build-bambu-gateway-kit.mjs';
import { gatewayKitPath } from '../services/platform/gateway-kit-download.mjs';

const run=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const expected=['BAMBU-GATEWAY-WINDOWS.cmd','README.txt','package.json','tools/bambu-gateway.mjs',
  ...['bambu-discovery.mjs','bambu-printer-ca.cer','bambu-status.mjs','cli.mjs','client.mjs',
    'config.mjs','coverage.mjs','discovery.mjs','mdns.mjs'].map(n=>'services/device-gateway/'+n)].sort();

async function unpack(zip,dir) {
  if (process.platform==='win32') {
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      'Expand-Archive -LiteralPath $env:GONGZAO_KIT_TEST_ARCHIVE -DestinationPath $env:GONGZAO_KIT_TEST_DIR'],
      {env:{...process.env,GONGZAO_KIT_TEST_ARCHIVE:zip,GONGZAO_KIT_TEST_DIR:dir}});
  } else {
    try { await run('unzip',['-q',zip,'-d',dir]); }
    catch (error) {
      if (error.code!=='ENOENT') throw error;
      await run('python3',['-m','zipfile','-e',zip,dir]);
    }
  }
}

test('Windows gateway ZIP downloads, extracts the precise release files and runs outside the project',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gongzao-standalone-kit-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const locked=path.join(dir,'installed'),zip=path.join(dir,'kit.zip');
  const {server,store}=createPlatformServer({dbPath:':memory:',integrationConfig:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const url='http://127.0.0.1:'+server.address().port+gatewayKitPath;
  const [get,head]=await Promise.all([fetch(url),fetch(url,{method:'HEAD'})]);
  const bytes=Buffer.from(await get.arrayBuffer());
  assert.deepEqual(bytes,await buildBambuGatewayKit());
  for(const response of [get,head]){
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'application/zip');
    assert.equal(response.headers.get('content-length'),String(bytes.length));
    assert.equal(response.headers.get('content-disposition'),'attachment; filename="gongzao-bambu-gateway.zip"');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.ok(response.headers.get('content-security-policy'));
  }
  assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  assert.equal((await fetch(url.replace('gongzao-bambu-gateway.zip','gateway.private.json'))).status,404);
  await fs.writeFile(zip,bytes);
  await unpack(zip,locked);
  const paths=(await fs.readdir(locked,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile())
    .map(entry=>path.relative(locked,path.join(entry.parentPath,entry.name)).split(path.sep).join('/')).sort();
  assert.deepEqual(paths,expected);
  const manifest=JSON.parse(await fs.readFile(path.join(locked,'package.json'),'utf8'));
  assert.equal(manifest.type,'module');
  assert.equal(manifest.engines.node,'>=24');
  assert.equal(manifest.version,JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
  assert.match(await fs.readFile(path.join(locked,'README.txt'),'utf8'),/Node\.js 24/);
  for(const file of paths.filter(n=>n!=='README.txt'&&n!=='package.json')){
    assert.deepEqual(await fs.readFile(path.join(locked,file)),await fs.readFile(path.join(root,file)),file);
  }
  const result=await run(process.execPath,['tools/bambu-gateway.mjs','--help'],{cwd:locked,timeout:8000});
  assert.match(result.stdout,/拓竹农场网关/);
  assert.equal(result.stderr,'');
});
