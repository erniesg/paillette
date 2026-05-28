-- Migration: Extract job tracking
-- Created: 2026-05-28

CREATE TABLE IF NOT EXISTS extract_jobs (
  id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'api_key')),
  principal_id TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'object' CHECK (target IN ('object', 'content')),
  preserve_filenames INTEGER NOT NULL DEFAULT 1 CHECK (preserve_filenames IN (0, 1)),
  filename_prefix TEXT NOT NULL DEFAULT '',
  filename_suffix TEXT NOT NULL DEFAULT '',
  preview_requested INTEGER NOT NULL DEFAULT 0 CHECK (preview_requested IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed')),
  input_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  output_zip_key TEXT,
  warnings_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS extract_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('r2', 'url')),
  original_filename TEXT NOT NULL,
  input_key TEXT,
  source_url TEXT,
  output_key TEXT,
  preview_key TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  warning TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (job_id) REFERENCES extract_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_extract_jobs_owner
ON extract_jobs(principal_type, principal_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_extract_jobs_status
ON extract_jobs(status, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_extract_items_job
ON extract_items(job_id, created_at);

DROP TRIGGER IF EXISTS update_extract_jobs_timestamp;
CREATE TRIGGER update_extract_jobs_timestamp
AFTER UPDATE ON extract_jobs
FOR EACH ROW
BEGIN
  UPDATE extract_jobs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS update_extract_items_timestamp;
CREATE TRIGGER update_extract_items_timestamp
AFTER UPDATE ON extract_items
FOR EACH ROW
BEGIN
  UPDATE extract_items SET updated_at = datetime('now') WHERE id = NEW.id;
END;
