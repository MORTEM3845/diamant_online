import { readFile, writeFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Run after `npx wrangler login`. Credentials stay in Wrangler's own login store.
const configPath = resolve('wrangler.jsonc');
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const config = JSON.parse(await readFile(configPath, 'utf8'));
function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'Cloudflare command failed.\n');
    console.error('Выполните npx wrangler login и повторите npm run deploy:setup.');
    process.exit(result.status || 1);
  }
  return result.stdout;
}
let databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!databaseId) {
  const databases = JSON.parse(run(['d1', 'list', '--json']));
  const found = databases.find(d => d.name === 'diamant-online');
  if (found) databaseId = found.uuid || found.id;
  else {
    console.log('Создаётся отдельная база diamant-online…');
    const output = run(['d1', 'create', 'diamant-online', '--location', 'weur', '--update-config=false']);
    databaseId = output.match(/database_id["\s]*[:=]\s*["']([a-f\d-]{36})["']/i)?.[1];
    if (!databaseId) {
      // Re-query after successful creation; do not create a second database.
      const next = JSON.parse(run(['d1', 'list', '--json'])).find(d => d.name === 'diamant-online');
      databaseId = next?.uuid || next?.id;
    }
  }
}
if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(databaseId || '') || /^0{8}-/.test(databaseId)) {
  throw new Error('Не удалось получить ID D1. Укажите CLOUDFLARE_D1_DATABASE_ID и повторите настройку.');
}
config.d1_databases[0].database_id = databaseId;
if (process.env.CLOUDFLARE_ACCOUNT_ID) config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
await writeFile(`${configPath}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
await rename(`${configPath}.tmp`, configPath);
console.log('D1 подключена в wrangler.jsonc. Теперь npm run deploy проверит проект и опубликует игру.');
console.log('Для GitHub Actions добавьте эту D1 ID в Variables → CLOUDFLARE_D1_DATABASE_ID:');
console.log(databaseId);
