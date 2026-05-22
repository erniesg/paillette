// Pull NGS/roots source data from D1 -> eval/corpus_grounding.jsonl
// This is the factual grounding for caption->embed: raw_ngs + raw_roots are the
// already-collected institutional source data; the *_url fields are citations.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DB = 'paillette-stg';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'corpus_grounding.jsonl');
const CHUNK = 100;

function d1(sql) {
  let out;
  try {
    out = execSync(
      `npx --no-install wrangler d1 execute ${DB} --remote --json --command ${JSON.stringify(sql)}`,
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  let j;
  try { j = JSON.parse(out); }
  catch { throw new Error('non-JSON output: ' + String(out).slice(0, 300)); }
  if (j && j.error) throw new Error(j.error.text + ' :: ' + JSON.stringify(j.error.notes || []));
  if (!Array.isArray(j) || !j[0] || !j[0].results) throw new Error('bad shape: ' + String(out).slice(0, 200));
  return j[0].results;
}

const cols = 'id, raw_ngs, raw_roots, ngs_detail_url, roots_listing_url';
const lines = [];
for (let off = 0; ; off += CHUNK) {
  const rows = d1(`SELECT ${cols} FROM artworks ORDER BY rowid LIMIT ${CHUNK} OFFSET ${off}`);
  for (const r of rows) lines.push(JSON.stringify(r));
  process.stderr.write(`  grounding ${lines.length}\n`);
  if (rows.length < CHUNK) break;
}
writeFileSync(OUT, lines.join('\n') + '\n');
process.stderr.write(`DONE: ${lines.length} rows -> corpus_grounding.jsonl\n`);
