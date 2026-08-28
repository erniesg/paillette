-- Global, non-resetting quota for public National Gallery Singapore searches.
CREATE TABLE IF NOT EXISTS ngs_public_search_quota (
  scope TEXT PRIMARY KEY CHECK (scope = 'ngs-public-search'),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= hard_limit),
  hard_limit INTEGER NOT NULL DEFAULT 1000 CHECK (hard_limit = 1000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO ngs_public_search_quota (scope, used, hard_limit)
VALUES ('ngs-public-search', 0, 1000);
