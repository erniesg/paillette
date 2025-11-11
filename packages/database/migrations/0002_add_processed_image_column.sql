-- Paillette Database Schema (D1 - SQLite)
-- Migration: 0002_add_processed_image_column
-- Created: 2025-11-11
-- Description: Add image_url_processed column for frame-removed artwork images

-- ============================================================================
-- Add Processed Image Column
-- ============================================================================

-- Add column to store processed (frame-removed) image URL
-- NULL indicates image has not been processed yet
ALTER TABLE artworks ADD COLUMN image_url_processed TEXT;

-- Add column to track processing status
-- Values: 'pending', 'processing', 'completed', 'failed', NULL (not queued)
ALTER TABLE artworks ADD COLUMN processing_status TEXT CHECK(
  processing_status IN ('pending', 'processing', 'completed', 'failed')
);

-- Add column to store confidence score from frame detection (0.0 to 1.0)
-- Higher score means more confident the frame removal was successful
ALTER TABLE artworks ADD COLUMN frame_removal_confidence REAL CHECK(
  frame_removal_confidence >= 0.0 AND frame_removal_confidence <= 1.0
);

-- Add column to track when processing was completed
ALTER TABLE artworks ADD COLUMN processed_at TEXT;

-- Add column to store processing error message if failed
ALTER TABLE artworks ADD COLUMN processing_error TEXT;

-- ============================================================================
-- Create Index for Processing Queries
-- ============================================================================

-- Index for finding artworks that need processing
CREATE INDEX idx_artworks_processing_status
ON artworks(gallery_id, processing_status)
WHERE processing_status IS NOT NULL;

-- Index for finding processed artworks
CREATE INDEX idx_artworks_processed
ON artworks(gallery_id, image_url_processed)
WHERE image_url_processed IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================

-- image_url_processed: Stores the URL of the frame-removed image
--   - NULL means not processed yet
--   - If processing fails, this remains NULL and processing_error is set
--
-- processing_status: Tracks the current state of frame removal
--   - NULL: Not queued for processing
--   - 'pending': Queued but not started
--   - 'processing': Currently being processed
--   - 'completed': Successfully processed (image_url_processed is set)
--   - 'failed': Processing failed (processing_error is set)
--
-- frame_removal_confidence: Score from 0.0 to 1.0
--   - Higher score = more confident the frame was correctly identified
--   - Low scores (<0.5) may require manual review
--   - NULL if processing hasn't been attempted
--
-- processed_at: Timestamp when processing completed (success or failure)
-- processing_error: Error message if processing failed
