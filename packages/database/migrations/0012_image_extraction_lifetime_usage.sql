-- Migration: Add server-side lifetime image extraction free-use tracking
-- Created: 2026-05-28

CREATE TABLE IF NOT EXISTS image_extraction_usage_lifetime (
  user_id TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  quota INTEGER NOT NULL DEFAULT 10,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
