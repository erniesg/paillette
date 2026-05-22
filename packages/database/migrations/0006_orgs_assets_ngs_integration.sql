-- Paillette Database Schema (D1 - SQLite)
-- Migration: 0006_orgs_assets_ngs_integration
-- Created: 2026-05-22
-- Description:
--   Prepare the app database for National Gallery Singapore ingestion by:
--   - renaming galleries/gallery_id to orgs/org_id
--   - allowing metadata-only artworks with no image
--   - adding source-attribution fields without colliding with provenance
--   - adding an assets table for R2 objects

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Drop old indexes/triggers before table and column renames.
DROP TRIGGER IF EXISTS update_artworks_timestamp;

DROP INDEX IF EXISTS idx_galleries_slug;
DROP INDEX IF EXISTS idx_galleries_owner_id;
DROP INDEX IF EXISTS idx_gallery_users_user_id;
DROP INDEX IF EXISTS idx_collections_gallery_id;
DROP INDEX IF EXISTS idx_artworks_gallery_id;
DROP INDEX IF EXISTS idx_artworks_collection_id;
DROP INDEX IF EXISTS idx_artworks_artist;
DROP INDEX IF EXISTS idx_artworks_year;
DROP INDEX IF EXISTS idx_artworks_image_hash;
DROP INDEX IF EXISTS idx_artworks_created_at;
DROP INDEX IF EXISTS idx_artworks_processing_status;
DROP INDEX IF EXISTS idx_artworks_processed;
DROP INDEX IF EXISTS idx_artworks_gallery_colors;
DROP INDEX IF EXISTS idx_artworks_color_extracted;
DROP INDEX IF EXISTS idx_upload_jobs_gallery_id;
DROP INDEX IF EXISTS idx_api_usage_events_gallery;
DROP INDEX IF EXISTS idx_artwork_usage_gallery;

-- Core org rename.
ALTER TABLE galleries RENAME TO orgs;
ALTER TABLE gallery_users RENAME TO org_users;
ALTER TABLE org_users RENAME COLUMN gallery_id TO org_id;
ALTER TABLE collections RENAME COLUMN gallery_id TO org_id;
ALTER TABLE upload_jobs RENAME COLUMN gallery_id TO org_id;
ALTER TABLE api_usage_events RENAME COLUMN gallery_id TO org_id;
ALTER TABLE artwork_usage_events RENAME COLUMN gallery_id TO org_id;

-- Rebuild artworks because SQLite cannot drop NOT NULL constraints in-place.
CREATE TABLE artworks_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  collection_id TEXT,

  -- Image data. Nullable because NGS contains catalogue records without images.
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

  -- Timestamps / soft delete
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT NOT NULL,
  deleted_at TEXT,

  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO artworks_new (
  id, org_id, collection_id,
  image_url, thumbnail_url, original_filename, image_hash,
  image_url_processed, processing_status, frame_removal_confidence, processed_at, processing_error,
  embedding_id,
  title, artist, year, medium,
  dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
  description, provenance,
  translations, dominant_colors, color_palette,
  custom_metadata, citation,
  created_at, updated_at, uploaded_by
)
SELECT
  id, gallery_id, collection_id,
  image_url, thumbnail_url, original_filename, image_hash,
  image_url_processed, processing_status, frame_removal_confidence, processed_at, processing_error,
  embedding_id,
  title, artist, year, medium,
  dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
  description, provenance,
  translations, dominant_colors, color_palette,
  custom_metadata, citation,
  created_at, updated_at, uploaded_by
FROM artworks;

DROP TABLE artworks;
ALTER TABLE artworks_new RENAME TO artworks;

-- Assets model for R2 objects. This lets one artwork have original, thumb, web,
-- processed, and future derived assets without adding more artwork columns.
CREATE TABLE assets (
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

-- Backfill legacy image columns into assets where possible. object_key uses the
-- URL for legacy rows because older uploads did not persist the R2 key.
INSERT INTO assets (
  id, artwork_id, org_id, role, storage_provider, object_key, url, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))), id, org_id, 'original', 'r2', image_url, image_url, created_at, updated_at
FROM artworks
WHERE image_url IS NOT NULL;

INSERT INTO assets (
  id, artwork_id, org_id, role, storage_provider, object_key, url, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))), id, org_id, 'thumb', 'r2', thumbnail_url, thumbnail_url, created_at, updated_at
FROM artworks
WHERE thumbnail_url IS NOT NULL AND thumbnail_url != image_url;

-- Recreate canonical indexes using org terminology.
CREATE INDEX idx_orgs_slug ON orgs(slug);
CREATE INDEX idx_orgs_owner_id ON orgs(owner_id);
CREATE INDEX idx_org_users_user_id ON org_users(user_id);

CREATE INDEX idx_collections_org_id ON collections(org_id);

CREATE INDEX idx_artworks_org_id ON artworks(org_id);
CREATE INDEX idx_artworks_collection_id ON artworks(collection_id);
CREATE INDEX idx_artworks_artist ON artworks(artist);
CREATE INDEX idx_artworks_year ON artworks(year);
CREATE INDEX idx_artworks_accession_number ON artworks(accession_number);
CREATE INDEX idx_artworks_created_at ON artworks(created_at DESC);
CREATE INDEX idx_artworks_image_hash ON artworks(image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX idx_artworks_processing_status
ON artworks(org_id, processing_status)
WHERE processing_status IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_artworks_processed
ON artworks(org_id, image_url_processed)
WHERE image_url_processed IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_artworks_org_colors
ON artworks(org_id, dominant_colors)
WHERE dominant_colors IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_artworks_color_extracted
ON artworks(org_id, color_extracted_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_upload_jobs_org_id ON upload_jobs(org_id);

CREATE INDEX idx_api_usage_events_org ON api_usage_events(org_id, created_at DESC);
CREATE INDEX idx_artwork_usage_org ON artwork_usage_events(org_id, created_at DESC);

CREATE INDEX idx_assets_artwork_id ON assets(artwork_id);
CREATE INDEX idx_assets_org_id ON assets(org_id);
CREATE INDEX idx_assets_role ON assets(artwork_id, role);
CREATE INDEX idx_assets_object_key ON assets(object_key);

CREATE TRIGGER update_artworks_timestamp
AFTER UPDATE ON artworks
FOR EACH ROW
BEGIN
  UPDATE artworks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER update_assets_timestamp
AFTER UPDATE ON assets
FOR EACH ROW
BEGIN
  UPDATE assets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

COMMIT;

PRAGMA foreign_keys = ON;
