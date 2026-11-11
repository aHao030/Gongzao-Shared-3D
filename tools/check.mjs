import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const roots = ['dist','packages','services','apps/weapp','tests'];
let checked = 0;
async function walk(dir) {
  for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
      if (result.status) throw new Error(`${file}: ${result.stderr}`);
      checked++;
    } else if (/\.(json|webmanifest)$/.test(file)) {JSON.parse(await fs.readFile(file,'utf8'));checked++;}
  }
}
for (const dir of roots) { try {await fs.access(dir);} catch {continue;} await walk(dir); }
console.log(`语法及 JSON 检查通过：${checked} 个文件`);
