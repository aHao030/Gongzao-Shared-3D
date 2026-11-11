import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { buildBambuGatewayKit } from './build-bambu-gateway-kit.mjs';
import { gatewayKitPath } from '../services/platform/gateway-kit-download.mjs';
const root=path.resolve(import.meta.dirname,'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const assets={};
for(const name of await fs.readdir(path.join(root,'dist'))){if(!MIME[path.extname(name)])continue;assets['/'+name]={type:MIME[path.extname(name)],body:await fs.readFile(path.join(root,'dist',name),'utf8')};}
const gatewayKit=await buildBambuGatewayKit();
assets[gatewayKitPath]={type:'application/zip',body:gatewayKit.toString('base64'),size:gatewayKit.length};
await fs.mkdir(path.join(root,'generated'),{recursive:true});
await fs.writeFile(path.join(root,'generated/assets.mjs'),'export const ASSETS = '+JSON.stringify(assets)+';\n');
await fs.mkdir(path.join(root,'dist/server'),{recursive:true});
await build({entryPoints:[path.join(root,'services/platform/worker.mjs')],outfile:path.join(root,'dist/server/index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false,legalComments:'inline'});
await fs.mkdir(path.join(root,'dist/.openai'),{recursive:true});
await fs.copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log('Built Worker with '+Object.keys(assets).length+' web assets; D1 and R2 bindings required.');
