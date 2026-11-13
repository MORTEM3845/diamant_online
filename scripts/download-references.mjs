import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const sources = JSON.parse(await readFile(new URL('../references/sources.json', import.meta.url), 'utf8'));
const folder = resolve('references');
await mkdir(folder, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
for (const source of sources) {
  const target = resolve(folder, source.file);
  let exists = false;
  try { await access(target); exists = true; } catch {}
  if (exists) {
    if (sha256(await readFile(target)) !== source.sha256) throw new Error(`Existing reference differs: ${source.file}. Inspect before replacing.`);
    console.log(`Verified: ${source.file}`);
    continue;
  }
  const response = await fetch(source.source, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download ${source.file}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== source.sha256) throw new Error(`Publisher changed ${source.file}. Review the rules before updating sources.json.`);
  await writeFile(target, bytes);
  console.log(`Downloaded and verified: ${source.file}`);
}
