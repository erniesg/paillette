-- Migration: Add translation_jobs table for document translation tracking
-- Created: 2025-11-11
-- Sprint: 4 - Translation Service

-- Create translation_jobs table
CREATE TABLE IF NOT EXISTS translation_jobs (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  source_lang TEXT NOT NULL CHECK (source_lang IN ('en', 'zh', 'ms', 'ta')),
  target_lang TEXT NOT NULL CHECK (target_lang IN ('en', 'zh', 'ms', 'ta')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),

  -- File URLs in R2
  original_file_url TEXT NOT NULL,
  translated_file_url TEXT,

  -- Processing metadata
  word_count INTEGER,
  character_count INTEGER,
  chunk_count INTEGER,
  provider TEXT,
  cost REAL,

  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,

  -- Soft delete
  deleted_at TEXT
);

-- Index for job status queries
CREATE INDEX IF NOT EXISTS idx_translation_jobs_status
ON translation_jobs(status, created_at)
WHERE deleted_at IS NULL;

-- Index for user job lookups (when user system is added)
CREATE INDEX IF NOT EXISTS idx_translation_jobs_created
ON translation_jobs(created_at DESC)
WHERE deleted_at IS NULL;

-- Index for cleanup of old completed jobs
CREATE INDEX IF NOT EXISTS idx_translation_jobs_completed
ON translation_jobs(status, completed_at)
WHERE status = 'completed' AND deleted_at IS NULL;

-- Add comments for documentation
COMMENT ON TABLE translation_jobs IS 'Tracks document translation jobs and their processing status';
COMMENT ON COLUMN translation_jobs.file_type IS 'MIME type of uploaded document';
COMMENT ON COLUMN translation_jobs.cost IS 'Estimated or actual cost in USD';
COMMENT ON COLUMN translation_jobs.retry_count IS 'Number of times job has been retried after failure';
