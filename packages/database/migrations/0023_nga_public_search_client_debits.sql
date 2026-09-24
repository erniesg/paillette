-- NGA public search: per caller over any 24 hours, instead of one lifetime
-- counter for the whole deployment.
--
-- 0018's `nga_public_search_quota` was a single row that only ever went up.
-- It reached 1000/1000 mid-run on staging and had to be reset by hand, and
-- one visitor could spend it for everyone. This table replaces it as the thing
-- that admits a search: one row per debited search, keyed by a SHA-256 of the
-- caller identity (the same identity 0020's rate limit uses; raw addresses are
-- never stored), timestamped in epoch milliseconds.
--
-- A search is admitted when the caller has fewer than their daily limit of
-- rows in the last 24 hours AND the whole site has fewer than the site limit.
-- The site limit is what keeps this a spend guard: per-caller alone would be
-- unbounded in the number of callers.
--
-- Replaced rather than extended because the old row has no caller and no time
-- in it; there is nothing in it to extend. It is deliberately NOT dropped
-- here: code still deployed elsewhere reads it until it is redeployed, and a
-- rollback needs it. Drop it in a later migration once nothing reads it.
CREATE TABLE IF NOT EXISTS nga_public_search_debits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_hash TEXT NOT NULL,
  debited_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nga_public_search_debits_client
  ON nga_public_search_debits (client_hash, debited_at);

CREATE INDEX IF NOT EXISTS idx_nga_public_search_debits_time
  ON nga_public_search_debits (debited_at);
