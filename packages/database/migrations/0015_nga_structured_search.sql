-- Authoritative fields used by deterministic NGA structured search.
ALTER TABLE artworks ADD COLUMN year_start INTEGER;
ALTER TABLE artworks ADD COLUMN year_end INTEGER;
ALTER TABLE artworks ADD COLUMN subclassification TEXT;
ALTER TABLE artworks ADD COLUMN visual_classification TEXT;
ALTER TABLE artworks ADD COLUMN medium_family TEXT;
ALTER TABLE artworks ADD COLUMN primary_artist_id TEXT;

CREATE INDEX IF NOT EXISTS idx_artworks_org_year_range
  ON artworks(org_id, year_start, year_end) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artworks_org_visual_classification
  ON artworks(org_id, visual_classification) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artworks_org_medium_family
  ON artworks(org_id, medium_family) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artworks_org_primary_artist
  ON artworks(org_id, primary_artist_id) WHERE deleted_at IS NULL;
