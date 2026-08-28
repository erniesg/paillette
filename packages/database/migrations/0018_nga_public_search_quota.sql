-- Global, non-resetting quota for public National Gallery of Art searches.
CREATE TABLE IF NOT EXISTS nga_public_search_quota (
  scope TEXT PRIMARY KEY CHECK (scope = 'nga-public-search'),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  hard_limit INTEGER NOT NULL DEFAULT 1000 CHECK (hard_limit > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO nga_public_search_quota (scope, used, hard_limit)
VALUES ('nga-public-search', 0, 1000);
