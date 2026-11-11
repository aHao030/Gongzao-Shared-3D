import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../shared/api-client.js', import.meta.url);
const target = new URL('../weapp/utils/api-client.js', import.meta.url);
const generated = '// Generated from apps/shared/api-client.js; run node apps/tools/sync-client.mjs.\n' + await readFile(source, 'utf8');
if (process.argv.includes('--check')) {
  const actual = await readFile(target, 'utf8').catch(() => '');
  if (actual !== generated) throw new Error('WeChat client copy is stale; run node apps/tools/sync-client.mjs');
  console.log('Shared API client copy is synchronized.');
} else {
  await writeFile(target, generated);
  console.log('Updated WeChat shared API client copy.');
}
