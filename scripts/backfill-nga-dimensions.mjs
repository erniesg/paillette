#!/usr/bin/env node
/**
 * Fill the dimension columns on NGA rows ingested before apply wrote them.
 *
 *   node scripts/backfill-nga-dimensions.mjs --env staging --dry-run
 *   node scripts/backfill-nga-dimensions.mjs --env staging --execute
 *
 * --dry-run reads D1 and prints counts; it writes nothing anywhere, D1 or
 * disk. --execute writes in id-ordered batches and records a cursor after
 * each batch D1 confirms, so an interrupted run picks up where it stopped;
 * --restart ignores the cursor.
 *
 * Options: --objects <objects.csv> (default: the pinned NGA open-data commit,
 * downloaded into tmp/ and checked against its known SHA-256),
 * --batch-size <n> (default 1000), --out-dir <dir>.
 *
 * Only staging has a database entry. There is no flag that reaches
 * production.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

import {
  EXPECTED_NGA_SOURCE_SHA256,
  NGA_SOURCE_COMMIT,
  parseNgaD1ApplyFacts,
  parseWranglerJsonOutput,
  sha256,
} from './lib/nga-artist-backfill.mjs';
import {
  BACKFILL_DATABASES,
  NGA_ARTWORK_ID_PREFIX,
  buildNgaDimensionUpdateSql,
  pendingBatches,
  planNgaDimensionBackfill,
} from './lib/nga-dimensions-backfill.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `--flag value` and `--flag=value` both work; bare flags are booleans.
const VALUED = new Set(['env', 'objects', 'batch-size', 'out-dir']);
const args = new Map();
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
  const [key, ...rest] = arg.slice(2).split('=');
  if (rest.length) args.set(key, rest.join('='));
  else if (VALUED.has(key)) args.set(key, argv[(index += 1)]);
  else args.set(key, true);
}

const env = args.get('env');
const database = BACKFILL_DATABASES[env];
if (!database) {
  throw new Error(
    `--env must be one of: ${Object.keys(BACKFILL_DATABASES).join(', ')}`
  );
}
const dryRun = args.has('dry-run');
const execute = args.has('execute');
if (dryRun === execute) {
  throw new Error('pass exactly one of --dry-run or --execute');
}
const batchSize = Number(args.get('batch-size') ?? 1000);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
  throw new Error('--batch-size must be an integer from 1 to 5000');
}
const outDir = resolve(
  repoRoot,
  String(args.get('out-dir') ?? `tmp/nga-dimensions-backfill/${env}`)
);
const cursorPath = join(outDir, 'cursor.json');

const wrangler = (wranglerArgs) => {
  const result = spawnSync(
    'pnpm',
    [
      '--dir',
      join(repoRoot, 'apps/api'),
      'exec',
      'wrangler',
      'd1',
      'execute',
      database,
      '--env',
      env,
      '--remote',
      '--json',
      ...wranglerArgs,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(
      `wrangler exited ${result.status}: ${(result.stderr || result.stdout || '').slice(-2000)}`
    );
  }
  return result.stdout;
};

const loadObjectsCsv = async () => {
  let text;
  const given = args.get('objects');
  if (typeof given === 'string') {
    text = readFileSync(resolve(given), 'utf8');
  } else {
    const cached = join(repoRoot, 'tmp/nga-opendata', NGA_SOURCE_COMMIT, 'objects.csv');
    if (!existsSync(cached)) {
      const url = `https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/${NGA_SOURCE_COMMIT}/data/objects.csv`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`objects.csv fetch failed: ${response.status}`);
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, await response.text());
    }
    text = readFileSync(cached, 'utf8');
  }
  // The same file the ingest read, or the join means nothing.
  const digest = sha256(text);
  if (digest !== EXPECTED_NGA_SOURCE_SHA256['objects.csv']) {
    throw new Error(
      `objects.csv sha256 ${digest} is not the ingest's pinned source ${NGA_SOURCE_COMMIT}`
    );
  }
  const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (errors.length) {
    throw new Error(`objects.csv parse error: ${errors[0].message} (row ${errors[0].row})`);
  }
  return new Map(data.map((row) => [String(row.objectid), row.dimensions || '']));
};

const loadStagedRows = () => {
  const rows = [];
  let after = '';
  // Keyset pages: stable under concurrent writes and cheap to re-read.
  for (;;) {
    const payload = parseWranglerJsonOutput(
      wrangler([
        '--command',
        `SELECT id, source_record_id FROM artworks WHERE id > '${after.replaceAll("'", "''")}' AND id LIKE '${NGA_ARTWORK_ID_PREFIX}%' ORDER BY id LIMIT 10000`,
      ]),
      'D1 row read'
    );
    const page = (Array.isArray(payload) ? payload[0] : payload)?.results;
    if (!Array.isArray(page)) throw new Error('D1 row read returned no results');
    rows.push(...page);
    if (page.length < 10000) return rows;
    after = page[page.length - 1].id;
  }
};

const started = Date.now();
const textByObjectId = await loadObjectsCsv();
const rows = loadStagedRows();
const plan = planNgaDimensionBackfill({ rows, textByObjectId });

const summary = {
  env,
  database,
  mode: dryRun ? 'dry-run' : 'execute',
  source: { commit: NGA_SOURCE_COMMIT, objects: textByObjectId.size },
  ...plan.counts,
  parsedShare: plan.counts.rows
    ? Number((plan.counts.parsed / plan.counts.rows).toFixed(4))
    : 0,
  topUnparsedShapes: plan.topUnparsedShapes,
};

if (dryRun) {
  const batches = pendingBatches(plan.updates, { batchSize });
  console.log(
    JSON.stringify({ ...summary, updates: plan.updates.length, batches: batches.length }, null, 2)
  );
  process.exit(0);
}

mkdirSync(join(outDir, 'sql'), { recursive: true });
const cursor =
  !args.has('restart') && existsSync(cursorPath)
    ? JSON.parse(readFileSync(cursorPath, 'utf8'))
    : { after: null, batches: 0, updated: 0, elapsedMs: 0 };
const batches = pendingBatches(plan.updates, { after: cursor.after, batchSize });
console.error(
  `${plan.updates.length} updates, ${batches.length} batches pending after ${cursor.after ?? 'the start'}`
);

for (const [index, batch] of batches.entries()) {
  const batchStarted = Date.now();
  const file = join(outDir, 'sql', `batch-${String(cursor.batches + 1).padStart(4, '0')}.sql`);
  writeFileSync(file, `${batch.map(buildNgaDimensionUpdateSql).join('\n')}\n`);
  const facts = parseNgaD1ApplyFacts(wrangler(['--file', file, '--yes']), {
    expectedQueryCount: batch.length,
    label: `D1 dimension batch ${file}`,
  });
  cursor.after = batch[batch.length - 1].id;
  cursor.batches += 1;
  cursor.updated += batch.length;
  cursor.elapsedMs += Date.now() - batchStarted;
  cursor.lastQueryCount = facts.actualQueryCount;
  writeFileSync(cursorPath, `${JSON.stringify(cursor, null, 2)}\n`);
  console.error(
    `batch ${index + 1}/${batches.length}: ${batch.length} rows through ${cursor.after} in ${Date.now() - batchStarted} ms`
  );
}

console.log(
  JSON.stringify(
    {
      ...summary,
      updated: cursor.updated,
      batchesApplied: cursor.batches,
      batchElapsedMs: cursor.elapsedMs,
      wallClockMs: Date.now() - started,
      cursor: cursorPath,
    },
    null,
    2
  )
);
