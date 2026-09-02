-- Migration: WebMCP agent-driven indexing jobs
-- Created: 2026-09-03
--
-- Backs `index_zip` / `index_folder` / `get_index_status`. A browser agent
-- cannot block inside a WebMCP `execute`, so ingestion is modelled as a job:
-- the client creates one, streams image batches into it, and polls progress.
--
-- Anonymous visitors (ChatGPT's in-app browser) drive this, so every write is
-- confined to one hard-coded sandbox organisation that holds nothing else.

-- ---------------------------------------------------------------------------
-- Sandbox principal + organisation
-- ---------------------------------------------------------------------------
-- `collections.created_by` and `orgs.owner_id` are NOT NULL foreign keys, so
-- the sandbox needs a durable owner row. It is not a login: the password hash
-- is a literal marker and no auth path ever selects this user by credentials.
INSERT OR IGNORE INTO users (id, email, name, role, password_hash)
VALUES (
  '1f5d3b90-6c42-4a17-9e08-3d7b5c214e6a',
  'webmcp-index@paillette.local',
  'WebMCP Indexing Sandbox',
  'curator',
  'disabled:no-password-login'
);

INSERT OR IGNORE INTO orgs (
  id, name, slug, description, settings, api_key, api_key_hash, owner_id
)
VALUES (
  'f2b7c1a4-9d3e-4b8c-a1f6-2e5d7c9b4a30',
  'WebMCP Indexing Sandbox',
  'webmcp-index',
  'Ephemeral collections created by browser agents through the WebMCP indexing tools.',
  '{}',
  'retired-org-key:f2b7c1a4-9d3e-4b8c-a1f6-2e5d7c9b4a30',
  'disabled:no-org-key-auth',
  '1f5d3b90-6c42-4a17-9e08-3d7b5c214e6a'
);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS index_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'zip' CHECK (source IN ('zip', 'files')),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'complete', 'failed')),
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  -- Server-derived fingerprint (hashed edge address). Never a client header.
  client_hash TEXT,
  -- Honest, user-facing explanation of anything the caps changed.
  notice TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_index_jobs_state
  ON index_jobs (state, created_at);

CREATE INDEX IF NOT EXISTS idx_index_jobs_client
  ON index_jobs (client_hash, created_at);

-- ---------------------------------------------------------------------------
-- Per-file outcomes: partial failure is normal and must be reported per file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS index_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  artwork_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'complete', 'failed', 'skipped')),
  message TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (job_id) REFERENCES index_jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_index_job_items_job
  ON index_job_items (job_id, state);

DROP TRIGGER IF EXISTS update_index_jobs_timestamp;
CREATE TRIGGER update_index_jobs_timestamp
AFTER UPDATE ON index_jobs
FOR EACH ROW
BEGIN
  UPDATE index_jobs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS update_index_job_items_timestamp;
CREATE TRIGGER update_index_job_items_timestamp
AFTER UPDATE ON index_job_items
FOR EACH ROW
BEGIN
  UPDATE index_job_items SET updated_at = datetime('now') WHERE id = NEW.id;
END;
