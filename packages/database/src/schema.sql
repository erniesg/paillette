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
-- Galleries Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS galleries (
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

CREATE INDEX idx_galleries_slug ON galleries(slug);
CREATE INDEX idx_galleries_owner_id ON galleries(owner_id);

-- ============================================================================
-- Gallery Users (M:M relationship)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gallery_users (
  gallery_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin', 'curator', 'viewer')) NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (gallery_id, user_id),
  FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_gallery_users_user_id ON gallery_users(user_id);

-- ============================================================================
-- Collections Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  gallery_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  artwork_count INTEGER NOT NULL DEFAULT 0,
  thumbnail_artwork_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,

  FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_collections_gallery_id ON collections(gallery_id);

-- ============================================================================
-- Artworks Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  gallery_id TEXT NOT NULL,
  collection_id TEXT,

  -- Image data
  image_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  image_hash TEXT NOT NULL,

  -- Embedding reference (stored in Vectorize)
  embedding_id TEXT,

  -- Core metadata
  title TEXT NOT NULL,
  artist TEXT,
  year INTEGER,
  medium TEXT,
  dimensions_height REAL,
  dimensions_width REAL,
  dimensions_depth REAL,
  dimensions_unit TEXT CHECK(dimensions_unit IN ('cm', 'in', 'm')),
  description TEXT,
  provenance TEXT,

  -- Multi-language (stored as JSON)
  translations TEXT DEFAULT '{}',

  -- Color analysis (stored as JSON arrays)
  dominant_colors TEXT,
  color_palette TEXT,

  -- Custom metadata (stored as JSON)
  custom_metadata TEXT DEFAULT '{}',

  -- Citation (stored as JSON)
  citation TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT NOT NULL,

  FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_artworks_gallery_id ON artworks(gallery_id);
CREATE INDEX idx_artworks_collection_id ON artworks(collection_id);
CREATE INDEX idx_artworks_artist ON artworks(artist);
CREATE INDEX idx_artworks_year ON artworks(year);
CREATE INDEX idx_artworks_image_hash ON artworks(image_hash);
CREATE INDEX idx_artworks_created_at ON artworks(created_at DESC);

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
  gallery_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')) NOT NULL DEFAULT 'pending',
  total_items INTEGER NOT NULL,
  processed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  error_log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_upload_jobs_gallery_id ON upload_jobs(gallery_id);
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
