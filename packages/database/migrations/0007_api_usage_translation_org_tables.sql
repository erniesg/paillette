-- Paillette Database Schema (D1 - SQLite)
-- Migration: 0007_api_usage_translation_org_tables
-- Created: 2026-05-22
-- Description:
--   Add the auxiliary tables required by the deployed API when a fresh app
--   database is created from the canonical schema instead of replaying all
--   legacy migrations.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT CHECK(status IN ('active', 'revoked')) NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);

CREATE TABLE IF NOT EXISTS api_usage_daily (
  principal_type TEXT CHECK(principal_type IN ('user', 'api_key')) NOT NULL,
  principal_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  quota INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (principal_type, principal_id, usage_date)
);

CREATE TABLE IF NOT EXISTS api_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_key_id TEXT,
  usage_date TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  route TEXT,
  query_type TEXT,
  org_id TEXT,
  collection_id TEXT,
  auth_kind TEXT CHECK(auth_kind IN ('user', 'api_key')),
  ip_address TEXT,
  user_agent TEXT,
  browser_name TEXT,
  browser_version TEXT,
  os_name TEXT,
  os_version TEXT,
  device_type TEXT,
  country TEXT,
  region TEXT,
  region_code TEXT,
  city TEXT,
  postal_code TEXT,
  timezone TEXT,
  continent TEXT,
  latitude REAL,
  longitude REAL,
  colo TEXT,
  asn INTEGER,
  as_organization TEXT,
  cf_ray TEXT,
  request_protocol TEXT,
  http_protocol TEXT,
  tls_version TEXT,
  tls_cipher TEXT,
  referer TEXT,
  origin TEXT,
  accept_language TEXT,
  content_type TEXT,
  sec_ch_ua TEXT,
  sec_ch_ua_platform TEXT,
  sec_ch_ua_mobile TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_usage_events_user_id ON api_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_api_key_id ON api_usage_events(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_org ON api_usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_query_type ON api_usage_events(query_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_country ON api_usage_events(country, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_browser ON api_usage_events(browser_name, created_at DESC);

CREATE TABLE IF NOT EXISTS artwork_usage_events (
  id TEXT PRIMARY KEY,
  usage_event_id TEXT NOT NULL,
  artwork_id TEXT NOT NULL,
  org_id TEXT,
  rank INTEGER,
  score REAL,
  interaction TEXT CHECK(interaction IN ('result', 'view', 'click', 'download')) NOT NULL DEFAULT 'result',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (usage_event_id) REFERENCES api_usage_events(id) ON DELETE CASCADE,
  FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artwork_usage_artwork ON artwork_usage_events(artwork_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artwork_usage_org ON artwork_usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artwork_usage_interaction ON artwork_usage_events(interaction, created_at DESC);

CREATE TABLE IF NOT EXISTS translation_jobs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  source_lang TEXT NOT NULL CHECK (source_lang IN ('en', 'zh', 'ms', 'ta')),
  target_lang TEXT NOT NULL CHECK (target_lang IN ('en', 'zh', 'ms', 'ta')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  original_file_url TEXT NOT NULL,
  translated_file_url TEXT,
  word_count INTEGER,
  character_count INTEGER,
  chunk_count INTEGER,
  provider TEXT,
  cost REAL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_status ON translation_jobs(status, created_at)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_translation_jobs_created ON translation_jobs(created_at DESC)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_translation_jobs_completed ON translation_jobs(status, completed_at)
WHERE status = 'completed' AND deleted_at IS NULL;
