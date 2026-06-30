import { buildOpenAccessAssetDownloads } from './open-access-art-apply.mjs';

export const OPEN_ACCESS_ASSET_LEDGER_TABLE = 'open_access_asset_ledger';

export function sqlString(value) {
  return String(value ?? '').replaceAll("'", "''");
}

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  return `'${sqlString(value)}'`;
}

export function buildOpenAccessAssetLedgerRows(records, { outDir } = {}) {
  return buildOpenAccessAssetDownloads(records, { outDir }).map((download) => ({
    ...download,
    status: 'pending',
  }));
}

export function buildOpenAccessAssetLedgerSchemaSql() {
  return `CREATE TABLE IF NOT EXISTS ${OPEN_ACCESS_ASSET_LEDGER_TABLE} (
  asset_id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  role TEXT NOT NULL,
  source_url TEXT,
  object_key TEXT NOT NULL,
  local_path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  downloaded_at TEXT,
  uploaded_at TEXT,
  embedded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_open_access_asset_ledger_status
  ON ${OPEN_ACCESS_ASSET_LEDGER_TABLE} (status, provider);

CREATE INDEX IF NOT EXISTS idx_open_access_asset_ledger_artwork
  ON ${OPEN_ACCESS_ASSET_LEDGER_TABLE} (artwork_id);
`;
}

export function buildOpenAccessAssetLedgerUpsertSql(
  rows,
  { generatedAt = new Date().toISOString() } = {}
) {
  if (!rows.length) return '';

  return rows
    .map(
      (row) => `INSERT INTO ${OPEN_ACCESS_ASSET_LEDGER_TABLE} (
  asset_id, artwork_id, provider, role, source_url, object_key, local_path,
  content_type, status, attempts, created_at, updated_at
) VALUES (
  ${sqlValue(row.assetId)},
  ${sqlValue(row.artworkId)},
  ${sqlValue(row.provider)},
  ${sqlValue(row.role)},
  ${sqlValue(row.sourceUrl)},
  ${sqlValue(row.objectKey)},
  ${sqlValue(row.localPath)},
  ${sqlValue(row.contentType)},
  'pending',
  0,
  ${sqlValue(generatedAt)},
  ${sqlValue(generatedAt)}
)
ON CONFLICT(asset_id) DO UPDATE SET
  artwork_id = excluded.artwork_id,
  provider = excluded.provider,
  role = excluded.role,
  source_url = excluded.source_url,
  object_key = excluded.object_key,
  local_path = excluded.local_path,
  content_type = excluded.content_type,
  status = CASE
    WHEN ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.source_url IS NOT excluded.source_url
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.object_key IS NOT excluded.object_key
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.local_path IS NOT excluded.local_path
    THEN 'pending'
    ELSE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.status
  END,
  attempts = CASE
    WHEN ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.source_url IS NOT excluded.source_url
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.object_key IS NOT excluded.object_key
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.local_path IS NOT excluded.local_path
    THEN 0
    ELSE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.attempts
  END,
  last_error = CASE
    WHEN ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.source_url IS NOT excluded.source_url
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.object_key IS NOT excluded.object_key
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.local_path IS NOT excluded.local_path
    THEN NULL
    ELSE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.last_error
  END,
  size_bytes = CASE
    WHEN ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.source_url IS NOT excluded.source_url
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.object_key IS NOT excluded.object_key
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.local_path IS NOT excluded.local_path
    THEN NULL
    ELSE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.size_bytes
  END,
  sha256 = CASE
    WHEN ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.source_url IS NOT excluded.source_url
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.object_key IS NOT excluded.object_key
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.local_path IS NOT excluded.local_path
    THEN NULL
    ELSE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.sha256
  END,
  downloaded_at = CASE
    WHEN ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.source_url IS NOT excluded.source_url
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.object_key IS NOT excluded.object_key
      OR ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.local_path IS NOT excluded.local_path
    THEN NULL
    ELSE ${OPEN_ACCESS_ASSET_LEDGER_TABLE}.downloaded_at
  END,
  updated_at = excluded.updated_at;`
    )
    .join('\n\n');
}

export function buildOpenAccessAssetLedgerInitSql(
  rows,
  { generatedAt = new Date().toISOString() } = {}
) {
  return [
    buildOpenAccessAssetLedgerSchemaSql(),
    buildOpenAccessAssetLedgerUpsertSql(rows, { generatedAt }),
  ]
    .filter(Boolean)
    .join('\n\n');
}
