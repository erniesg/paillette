#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildOpenAccessApplyPlan } from './lib/open-access-art-apply.mjs';
import {
  OPEN_ACCESS_ASSET_LEDGER_TABLE,
  buildOpenAccessAssetLedgerInitSql,
  buildOpenAccessAssetLedgerRows,
  buildOpenAccessAssetLedgerSchemaSql,
  sqlString,
} from './lib/open-access-art-assets.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help') || args.flags.has('h')) {
  printHelp();
  process.exit(0);
}

const dbPath = resolve(args.values.get('db') || 'tmp/open-access-art-assets.sqlite');

const options = {
  manifest: args.values.get('manifest')
    ? resolve(args.values.get('manifest'))
    : null,
  db: dbPath,
  outDir: resolve(args.values.get('out-dir') || dirname(dbPath)),
  assetMode: args.values.get('asset-mode') || 'r2',
  externalProviders: providerList(args.values.get('external-providers')),
  providers: providerList(args.values.get('providers')),
  limit: Number(args.values.get('limit') || '0'),
  downloadLimit: Number(args.values.get('download-limit') || '0'),
  batchSize: Number(args.values.get('batch-size') || '500'),
  concurrency: Number(args.values.get('concurrency') || '8'),
  maxAttempts: Number(args.values.get('max-attempts') || '5'),
  init: args.flags.has('init'),
  status: args.flags.has('status'),
  download: args.flags.has('download'),
  refreshAssets: args.flags.has('refresh-assets'),
};

if (!options.init && !options.status && !options.download) {
  printHelp();
  process.exit(1);
}
if (options.init && !options.manifest) {
  throw new Error('--manifest is required with --init');
}

mkdirSync(dirname(options.db), { recursive: true });
mkdirSync(options.outDir, { recursive: true });
sqliteExec(options.db, buildOpenAccessAssetLedgerSchemaSql());

let initialized = null;
if (options.init) {
  initialized = initLedger();
  console.error(`initialized ${initialized.assets} asset rows`);
}

let downloaded = null;
if (options.download) {
  downloaded = await downloadPendingAssets();
  console.error(
    `download complete: ${downloaded.completed} completed, ${downloaded.fetched} fetched, ${downloaded.failed} failed, ${downloaded.skipped} skipped`
  );
}

const payload = {
  db: options.db,
  outDir: options.outDir,
  initialized,
  downloaded,
  status: getLedgerStatus(),
};
console.log(JSON.stringify(payload, null, 2));

function initLedger() {
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  const plan = buildOpenAccessApplyPlan({
    manifest,
    assetMode: options.assetMode,
    externalProviders: options.externalProviders,
    limit: options.limit,
  });
  const rows = buildOpenAccessAssetLedgerRows(plan.records, {
    outDir: options.outDir,
  });
  sqliteExec(options.db, buildOpenAccessAssetLedgerSchemaSql());
  for (let index = 0; index < rows.length; index += options.batchSize) {
    const batch = rows.slice(index, index + options.batchSize);
    sqliteExec(options.db, buildOpenAccessAssetLedgerInitSql(batch));
  }

  return {
    records: plan.records.length,
    cachedRecords: plan.records.filter((row) => row.assetMode === 'r2').length,
    externalRecords: plan.records.filter((row) => row.assetMode === 'external')
      .length,
    assets: rows.length,
  };
}

async function downloadPendingAssets() {
  const rows = selectDownloadRows();
  let completed = 0;
  let fetched = 0;
  let failed = 0;
  let skipped = 0;

  await mapLimit(rows, options.concurrency, async (row, index) => {
    markDownloading(row.assetId);
    try {
      const result = await downloadAsset(row);
      if (result.skipped) skipped += 1;
      else fetched += 1;
      completed += 1;
      markDownloaded(row.assetId, result);
    } catch (error) {
      failed += 1;
      markFailed(row.assetId, error);
    }
    if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
      console.error(`processed downloads ${index + 1}/${rows.length}`);
    }
  });

  return {
    selected: rows.length,
    completed,
    fetched,
    failed,
    skipped,
  };
}

function selectDownloadRows() {
  const providerWhere = options.providers.length
    ? `AND provider IN (${options.providers
        .map((provider) => `'${sqlString(provider)}'`)
        .join(', ')})`
    : '';
  const statusWhere = options.refreshAssets
    ? 'status IN (\'pending\', \'failed\', \'downloaded\', \'downloading\')'
    : 'status IN (\'pending\', \'failed\', \'downloading\')';
  const limitSql =
    options.downloadLimit > 0 ? `LIMIT ${Number(options.downloadLimit)}` : '';
  return sqliteJson(
    options.db,
    `SELECT
  asset_id AS assetId,
  artwork_id AS artworkId,
  provider,
  role,
  source_url AS sourceUrl,
  object_key AS objectKey,
  local_path AS localPath,
  content_type AS contentType,
  attempts
FROM ${OPEN_ACCESS_ASSET_LEDGER_TABLE}
WHERE ${statusWhere}
  AND attempts < ${Number(options.maxAttempts)}
  ${providerWhere}
ORDER BY provider, artwork_id, role
${limitSql};`
  );
}

async function downloadAsset(row) {
  if (!row.sourceUrl) {
    throw new Error(`missing source URL for ${row.assetId}`);
  }
  if (existsSync(row.localPath) && !options.refreshAssets) {
    const stat = statSync(row.localPath);
    return {
      localPath: row.localPath,
      contentType: row.contentType,
      sizeBytes: stat.size,
      sha256: fileSha256(row.localPath),
      skipped: true,
    };
  }

  const tmpPath = `${row.localPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const response = await fetch(row.sourceUrl, {
      headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
    });
    if (!response.ok) {
      throw new Error(`image fetch failed with ${response.status}: ${row.sourceUrl}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    mkdirSync(dirname(row.localPath), { recursive: true });
    writeFileSync(tmpPath, bytes);
    renameSync(tmpPath, row.localPath);
    return {
      localPath: row.localPath,
      contentType: response.headers.get('content-type') || row.contentType,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      skipped: false,
    };
  } catch (error) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    throw error;
  }
}

function markDownloading(assetId) {
  sqliteExec(
    options.db,
    `UPDATE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}
SET status = 'downloading',
    attempts = attempts + 1,
    updated_at = ${sqlNow()}
WHERE asset_id = '${sqlString(assetId)}';`
  );
}

function markDownloaded(assetId, result) {
  sqliteExec(
    options.db,
    `UPDATE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}
SET status = 'downloaded',
    last_error = NULL,
    size_bytes = ${Number(result.sizeBytes) || 0},
    sha256 = '${sqlString(result.sha256)}',
    content_type = '${sqlString(result.contentType)}',
    downloaded_at = ${sqlNow()},
    updated_at = ${sqlNow()}
WHERE asset_id = '${sqlString(assetId)}';`
  );
}

function markFailed(assetId, error) {
  sqliteExec(
    options.db,
    `UPDATE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}
SET status = 'failed',
    last_error = '${sqlString(error?.message || error)}',
    updated_at = ${sqlNow()}
WHERE asset_id = '${sqlString(assetId)}';`
  );
}

function getLedgerStatus() {
  const byStatus = sqliteJson(
    options.db,
    `SELECT status, COUNT(*) AS assets, COALESCE(SUM(size_bytes), 0) AS bytes
FROM ${OPEN_ACCESS_ASSET_LEDGER_TABLE}
GROUP BY status
ORDER BY status;`
  );
  const byProvider = sqliteJson(
    options.db,
    `SELECT provider, status, COUNT(*) AS assets, COALESCE(SUM(size_bytes), 0) AS bytes
FROM ${OPEN_ACCESS_ASSET_LEDGER_TABLE}
GROUP BY provider, status
ORDER BY provider, status;`
  );
  const totals = sqliteJson(
    options.db,
    `SELECT
  COUNT(*) AS assets,
  COUNT(DISTINCT artwork_id) AS artworks,
  COALESCE(SUM(size_bytes), 0) AS bytes,
  SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) AS downloadedAssets,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingAssets,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedAssets
FROM ${OPEN_ACCESS_ASSET_LEDGER_TABLE};`
  )[0] || {
    assets: 0,
    artworks: 0,
    bytes: 0,
    downloadedAssets: 0,
    pendingAssets: 0,
    failedAssets: 0,
  };

  return { totals, byStatus, byProvider };
}

function sqliteExec(db, sql) {
  if (!sql.trim()) return '';
  return execFileSync('sqlite3', [db, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sqliteJson(db, sql) {
  const output = execFileSync('sqlite3', ['-json', db, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.trim() ? JSON.parse(output) : [];
}

function sqlNow() {
  return `'${new Date().toISOString()}'`;
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function providerList(value) {
  return String(value || '')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--' || !arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      values.set(key, rest.join('='));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(raw);
    } else {
      values.set(raw, next);
      index += 1;
    }
  }
  return { values, flags };
}

function printHelp() {
  console.log(`Usage:
  pnpm open:assets -- --manifest tmp/open-access-art.json --out-dir tmp/open-access-art-assets --db tmp/open-access-art-assets.sqlite --external-providers=artic --init --status
  pnpm open:assets -- --db tmp/open-access-art-assets.sqlite --download --providers=nga --download-limit=100 --concurrency=8

Options:
  --manifest PATH          Dry-run/apply manifest to seed into the asset ledger.
  --db PATH                SQLite ledger path. Default: tmp/open-access-art-assets.sqlite.
  --out-dir PATH           Local asset root. Default: tmp/open-access-art-assets.
  --asset-mode r2|external Ledger asset mode for non-external providers.
  --external-providers CSV Provider keys to keep external when seeding.
  --providers CSV          Provider filter for download workers.
  --limit N                Limit manifest records during ledger init.
  --download-limit N       Limit selected assets during this download run.
  --batch-size N           SQLite upsert batch size. Default: 500.
  --concurrency N          Parallel downloads within this process. Default: 8.
  --max-attempts N         Skip rows whose attempts reached this number.
  --refresh-assets         Re-fetch existing downloaded local files.
  --init                   Seed/update the SQLite asset ledger from --manifest.
  --download               Download pending/failed ledger rows.
  --status                 Print ledger status.
`);
}
