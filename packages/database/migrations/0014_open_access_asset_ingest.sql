-- Track Cloudflare Queue driven Open Access Art asset ingest into R2.

CREATE TABLE IF NOT EXISTS open_access_asset_ingest (
  asset_id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  role TEXT CHECK(role IN ('web', 'thumb', 'original', 'processed', 'mask', 'metadata', 'other')) NOT NULL,
  source_url TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT,
  status TEXT CHECK(status IN ('pending', 'queued', 'uploading', 'uploaded', 'failed')) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  queued_at TEXT,
  uploaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_open_access_asset_ingest_status
  ON open_access_asset_ingest (status, provider);

CREATE INDEX IF NOT EXISTS idx_open_access_asset_ingest_artwork
  ON open_access_asset_ingest (artwork_id);

CREATE INDEX IF NOT EXISTS idx_open_access_asset_ingest_object_key
  ON open_access_asset_ingest (object_key);

CREATE TRIGGER IF NOT EXISTS update_open_access_asset_ingest_timestamp
AFTER UPDATE ON open_access_asset_ingest
FOR EACH ROW
BEGIN
  UPDATE open_access_asset_ingest SET updated_at = datetime('now') WHERE asset_id = NEW.asset_id;
END;
