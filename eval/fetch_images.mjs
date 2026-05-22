// Fetch NGS thumbnail blobs from R2 -> eval/images/{id}.webp
// Idempotent: skips files already present, so re-runs only fetch deltas.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WR = join(HERE, '..', 'apps', 'api', 'node_modules', '.bin', 'wrangler');
const IMG = join(HERE, 'images');
const BUCKET = 'paillette-assets-stg';
const CONCURRENCY = 16;
const ENV = { ...process.env, CI: '1', NO_UPDATE_NOTIFIER: '1' };

mkdirSync(IMG, { recursive: true });
const rows = readFileSync(join(HERE, 'corpus.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
const jobs = rows.map(r => ({ id: r.id, key: r.thumb_key, file: join(IMG, r.id + '.webp') }));

let done = 0, skipped = 0, failed = 0;
const failures = [];

function fetchOne(job) {
  return new Promise(resolve => {
    if (existsSync(job.file) && statSync(job.file).size > 0) { skipped++; return resolve(); }
    execFile(WR, ['r2', 'object', 'get', `${BUCKET}/${job.key}`, '--file', job.file],
      { timeout: 90000, env: ENV }, (err) => {
        if (err || !existsSync(job.file) || statSync(job.file).size === 0) {
          failed++; failures.push(job.id);
        } else done++;
        const n = done + skipped + failed;
        if (n % 250 === 0 || n === jobs.length)
          process.stderr.write(`  ${n}/${jobs.length}  (ok ${done}, skip ${skipped}, fail ${failed})\n`);
        resolve();
      });
  });
}

let idx = 0;
async function worker() { while (idx < jobs.length) await fetchOne(jobs[idx++]); }
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

process.stderr.write(`\nDONE: ${done} fetched, ${skipped} already present, ${failed} failed\n`);
if (failures.length) {
  writeFileSync(join(HERE, 'fetch_failures.txt'), failures.join('\n') + '\n');
  process.stderr.write('failures -> eval/fetch_failures.txt\n');
}
