-- Paillette Database Schema (D1 - SQLite)
-- Version: 1.0.0

-- ============================================================================
-- Users Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin', 'curator', 'viewer')) NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  UNIQUE(email)
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================================================
-- Orgs Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  location_country TEXT,
  location_city TEXT,
  location_address TEXT,
  website TEXT,

  -- Settings (stored as JSON)
  settings TEXT NOT NULL DEFAULT '{}',

  -- API access
  api_key TEXT UNIQUE NOT NULL,
  api_key_hash TEXT NOT NULL,

  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(slug)
);

CREATE INDEX idx_orgs_slug ON orgs(slug);
CREATE INDEX idx_orgs_owner_id ON orgs(owner_id);

-- ============================================================================
-- Org Users (M:M relationship)
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_users (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin', 'curator', 'viewer')) NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_org_users_user_id ON org_users(user_id);

-- ============================================================================
-- Collections Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  artwork_count INTEGER NOT NULL DEFAULT 0,
  thumbnail_artwork_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,

  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_collections_org_id ON collections(org_id);

-- ============================================================================
-- Artworks Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  collection_id TEXT,

  -- Image data. Nullable because some institutional records are metadata-only.
  image_url TEXT,
  thumbnail_url TEXT,
  original_filename TEXT,
  image_hash TEXT,

  -- Processed image (frame removed)
  image_url_processed TEXT,
  processing_status TEXT CHECK(processing_status IN ('pending', 'processing', 'completed', 'failed')),
  frame_removal_confidence REAL CHECK(frame_removal_confidence >= 0.0 AND frame_removal_confidence <= 1.0),
  processed_at TEXT,
  processing_error TEXT,

  -- Embedding reference (stored in Vectorize)
  embedding_id TEXT,

  -- Core metadata
  title TEXT NOT NULL,
  artist TEXT,
  year INTEGER,
  date_text TEXT,
  medium TEXT,
  classification TEXT,
  culture TEXT,
  origin TEXT,
  dimensions_height REAL,
  dimensions_width REAL,
  dimensions_depth REAL,
  dimensions_unit TEXT CHECK(dimensions_unit IN ('cm', 'in', 'm')),
  description TEXT,
  provenance TEXT,
  credit_line TEXT,
  rights TEXT,
  accession_number TEXT,
  source_url TEXT,
  source_institution TEXT,
  source_collection TEXT,
  source_record_id TEXT,

  -- Per-field source attribution for harvested institutional metadata.
  field_sources TEXT NOT NULL DEFAULT '{}',

  -- Multi-language (stored as JSON)
  translations TEXT DEFAULT '{}',

  -- Color analysis (stored as JSON arrays)
  dominant_colors TEXT,
  color_palette TEXT,
  color_extracted_at TEXT,
  color_extraction_version TEXT DEFAULT 'v1',

  -- Custom metadata (stored as JSON)
  custom_metadata TEXT DEFAULT '{}',

  -- Citation (stored as JSON)
  citation TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT NOT NULL,
  deleted_at TEXT,

  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_artworks_org_id ON artworks(org_id);
CREATE INDEX idx_artworks_collection_id ON artworks(collection_id);
CREATE INDEX idx_artworks_artist ON artworks(artist);
CREATE INDEX idx_artworks_year ON artworks(year);
CREATE INDEX idx_artworks_accession_number ON artworks(accession_number);
CREATE INDEX idx_artworks_image_hash ON artworks(image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX idx_artworks_created_at ON artworks(created_at DESC);
CREATE INDEX idx_artworks_processing_status ON artworks(org_id, processing_status) WHERE processing_status IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_artworks_processed ON artworks(org_id, image_url_processed) WHERE image_url_processed IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_artworks_org_colors ON artworks(org_id, dominant_colors) WHERE dominant_colors IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_artworks_color_extracted ON artworks(org_id, color_extracted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- Assets Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  role TEXT CHECK(role IN ('original', 'thumb', 'web', 'processed', 'mask', 'metadata', 'other')) NOT NULL,
  storage_provider TEXT CHECK(storage_provider IN ('r2', 'external')) NOT NULL DEFAULT 'r2',
  bucket TEXT,
  object_key TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  checksum TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  UNIQUE(artwork_id, role, object_key)
);

CREATE INDEX idx_assets_artwork_id ON assets(artwork_id);
CREATE INDEX idx_assets_org_id ON assets(org_id);
CREATE INDEX idx_assets_role ON assets(artwork_id, role);
CREATE INDEX idx_assets_object_key ON assets(object_key);

-- ============================================================================
-- Collection Artworks (M:M relationship)
-- ============================================================================

CREATE TABLE IF NOT EXISTS collection_artworks (
  collection_id TEXT NOT NULL,
  artwork_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (collection_id, artwork_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
);

CREATE INDEX idx_collection_artworks_artwork_id ON collection_artworks(artwork_id);

-- ============================================================================
-- Upload Jobs (track batch uploads)
-- ============================================================================

CREATE TABLE IF NOT EXISTS upload_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')) NOT NULL DEFAULT 'pending',
  total_items INTEGER NOT NULL,
  processed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  error_log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_upload_jobs_org_id ON upload_jobs(org_id);
CREATE INDEX idx_upload_jobs_status ON upload_jobs(status);

-- ============================================================================
-- Audit Logs (track all changes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT CHECK(action IN ('create', 'update', 'delete')) NOT NULL,
  user_id TEXT,
  changes TEXT, -- JSON with before/after values
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
-- API Keys and Usage Tracking
-- ============================================================================

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

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(status);

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

CREATE INDEX idx_api_usage_events_user_id ON api_usage_events(user_id, created_at DESC);
CREATE INDEX idx_api_usage_events_api_key_id ON api_usage_events(api_key_id, created_at DESC);
CREATE INDEX idx_api_usage_events_org ON api_usage_events(org_id, created_at DESC);
CREATE INDEX idx_api_usage_events_query_type ON api_usage_events(query_type, created_at DESC);
CREATE INDEX idx_api_usage_events_country ON api_usage_events(country, created_at DESC);
CREATE INDEX idx_api_usage_events_browser ON api_usage_events(browser_name, created_at DESC);

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

CREATE INDEX idx_artwork_usage_artwork ON artwork_usage_events(artwork_id, created_at DESC);
CREATE INDEX idx_artwork_usage_org ON artwork_usage_events(org_id, created_at DESC);
CREATE INDEX idx_artwork_usage_interaction ON artwork_usage_events(interaction, created_at DESC);

-- ============================================================================
-- Translation Lifetime Usage
-- ============================================================================

CREATE TABLE IF NOT EXISTS translation_usage_lifetime (
  user_id TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  quota INTEGER NOT NULL DEFAULT 10,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS extract_usage_lifetime (
  user_id TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  quota INTEGER NOT NULL DEFAULT 10,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- Translation Jobs
-- ============================================================================

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

CREATE INDEX idx_translation_jobs_status ON translation_jobs(status, created_at)
WHERE deleted_at IS NULL;
CREATE INDEX idx_translation_jobs_created ON translation_jobs(created_at DESC)
WHERE deleted_at IS NULL;
CREATE INDEX idx_translation_jobs_completed ON translation_jobs(status, completed_at)
WHERE status = 'completed' AND deleted_at IS NULL;

-- ============================================================================
-- Extract Jobs
-- ============================================================================

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

CREATE INDEX idx_extract_jobs_owner
ON extract_jobs(principal_type, principal_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_extract_jobs_status
ON extract_jobs(status, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_extract_items_job
ON extract_items(job_id, created_at);

-- ============================================================================
-- Triggers (auto-update timestamps)
-- ============================================================================

CREATE TRIGGER update_artworks_timestamp
AFTER UPDATE ON artworks
FOR EACH ROW
BEGIN
  UPDATE artworks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_upload_jobs_timestamp
AFTER UPDATE ON upload_jobs
FOR EACH ROW
BEGIN
  UPDATE upload_jobs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_assets_timestamp
AFTER UPDATE ON assets
FOR EACH ROW
BEGIN
  UPDATE assets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_extract_jobs_timestamp
AFTER UPDATE ON extract_jobs
FOR EACH ROW
BEGIN
  UPDATE extract_jobs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_extract_items_timestamp
AFTER UPDATE ON extract_items
FOR EACH ROW
BEGIN
  UPDATE extract_items SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ============================================================================
-- Trigger: Update collection artwork count
-- ============================================================================

CREATE TRIGGER increment_collection_count
AFTER INSERT ON collection_artworks
FOR EACH ROW
BEGIN
  UPDATE collections
  SET artwork_count = artwork_count + 1
  WHERE id = NEW.collection_id;
END;

CREATE TRIGGER decrement_collection_count
AFTER DELETE ON collection_artworks
FOR EACH ROW
BEGIN
  UPDATE collections
  SET artwork_count = artwork_count - 1
  WHERE id = OLD.collection_id;
END;
