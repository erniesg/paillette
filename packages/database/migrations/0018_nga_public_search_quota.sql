-- Global, non-resetting quota for public National Gallery of Art searches.
-- The public-search API credential is a service principal. It must have a
-- durable, non-privileged users row because accepted-search telemetry has a
-- foreign key to users. INSERT OR IGNORE preserves an existing deployment's
-- identity and never resets or changes its permissions.
INSERT OR IGNORE INTO users (id, email, password_hash, name, role)
VALUES (
  'public-search-web',
  'public-search-web@invalid.paillette.local',
  'service-account-no-login',
  'NGA Public Search',
  'viewer'
);

CREATE TABLE IF NOT EXISTS nga_public_search_quota (
  scope TEXT PRIMARY KEY CHECK (scope = 'nga-public-search'),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  hard_limit INTEGER NOT NULL DEFAULT 1000 CHECK (hard_limit > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO nga_public_search_quota (scope, used, hard_limit)
VALUES ('nga-public-search', 0, 1000);
