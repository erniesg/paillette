-- Migration: Add color extraction columns to artworks table
-- Created: 2025-11-12
-- Sprint: 2 - Color Extraction & Search

-- Add color extraction columns to artworks table
ALTER TABLE artworks ADD COLUMN dominant_colors TEXT;
ALTER TABLE artworks ADD COLUMN color_palette TEXT;
ALTER TABLE artworks ADD COLUMN color_extracted_at TEXT;
ALTER TABLE artworks ADD COLUMN color_extraction_version TEXT DEFAULT 'v1';

-- Create index for color search queries
-- This helps with filtering artworks by color presence
CREATE INDEX IF NOT EXISTS idx_artworks_gallery_colors
ON artworks(gallery_id, dominant_colors)
WHERE dominant_colors IS NOT NULL AND deleted_at IS NULL;

-- Create index for color extraction status
-- Useful for identifying artworks that need color extraction
CREATE INDEX IF NOT EXISTS idx_artworks_color_extracted
ON artworks(gallery_id, color_extracted_at)
WHERE deleted_at IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN artworks.dominant_colors IS 'JSON array of dominant colors with hex codes and percentages';
COMMENT ON COLUMN artworks.color_palette IS 'Full color palette JSON (same as dominant_colors for now)';
COMMENT ON COLUMN artworks.color_extracted_at IS 'Timestamp when colors were last extracted';
COMMENT ON COLUMN artworks.color_extraction_version IS 'Version of color extraction algorithm used';
