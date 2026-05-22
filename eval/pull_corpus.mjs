// Pull the NGS eval corpus from D1 -> eval/corpus.jsonl
// Pulls artworks + assets as flat, un-joined scans (the assets.artwork_id
// JOIN blows D1's CPU limit — no index), then joins in memory.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DB = 'paillette-stg';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'corpus.jsonl');

function d1(sql) {
  let out;
  try {
    out = execSync(
      `npx --no-install wrangler d1 execute ${DB} --remote --json --command ${JSON.stringify(sql)}`,
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
    );
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  let j;
  try { j = JSON.parse(out); }
  catch { throw new Error('non-JSON output: ' + String(out).slice(0, 300)); }
  if (j && j.error) throw new Error(j.error.text + ' :: ' + JSON.stringify(j.error.notes || []));
  if (!Array.isArray(j) || !j[0] || !j[0].results) throw new Error('unexpected shape: ' + String(out).slice(0, 200));
  return j[0].results;
}

function pageAll(cols, table, chunk) {
  const rows = [];
  for (let off = 0; ; off += chunk) {
    const r = d1(`SELECT ${cols} FROM ${table} ORDER BY rowid LIMIT ${chunk} OFFSET ${off}`);
    rows.push(...r);
    process.stderr.write(`  ${table} +${r.length} (${rows.length})\n`);
    if (r.length < chunk) break;
  }
  return rows;
}

process.stderr.write('pulling artworks...\n');
const arts = pageAll('id,title,artist,date_text,classification,description', 'artworks', 1500);
process.stderr.write('pulling assets...\n');
const assets = pageAll('artwork_id,role,key', 'assets', 4000);

const byArt = new Map();
for (const a of assets) {
  if (!byArt.has(a.artwork_id)) byArt.set(a.artwork_id, {});
  byArt.get(a.artwork_id)[a.role] = a.key;
}

let imaged = 0, withDesc = 0;
const lines = [];
for (const a of arts) {
  const ks = byArt.get(a.id);
  if (!ks || !ks.thumb) continue; // imaged artworks only
  imaged++;
  const hasDesc = a.description && String(a.description).trim();
  if (hasDesc) withDesc++;
  lines.push(JSON.stringify({
    id: a.id, title: a.title, artist: a.artist, date_text: a.date_text,
    classification: a.classification, description: hasDesc ? a.description : null,
    thumb_key: ks.thumb, original_key: ks.original || null,
  }));
}
writeFileSync(OUT, lines.join('\n') + '\n');
process.stderr.write(`\nDONE: ${arts.length} artworks, ${assets.length} assets pulled\n`);
process.stderr.write(`corpus.jsonl: ${imaged} imaged artworks | ${withDesc} with description\n`);
