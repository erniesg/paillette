-- Atomic fixed-window abuse guard for every accepted NGA public search.
-- client_hash is SHA-256 derived in the API; raw IPs and user/key ids never
-- reach this table.
CREATE TABLE IF NOT EXISTS nga_public_search_request_rate_limits (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_nga_public_search_rate_limits_window
  ON nga_public_search_request_rate_limits (window_start);
