-- Migration: a meter for audio minutes, which the model-call meter does not cover
-- Created: 2026-09-04
--
-- `AGENT_MODEL_CALLS_PER_HOUR` counts requests to /api/public-agent/turn. A
-- live realtime session does not go through that route at all: it is billed by
-- audio tokens flowing in and out for as long as the connection is open. The
-- two meters measure different things, and the one already in place reads zero
-- while the new one runs.
--
-- So: a second meter, in seconds of session wall-clock. Seconds rather than
-- audio frames because seconds are what a human can reason about ("three
-- minutes each, an hour a day") and because over-counting silence is the safe
-- direction to be wrong in.
--
-- D1 rather than KV, despite KV being where the model-call counter lives. KV
-- counters are read-modify-write and lose concurrent increments; that is an
-- acceptable trade for a per-IP request count and a bad one for money. The
-- guarded UPSERT below is atomic the way `nga_public_search_quota`'s guarded
-- UPDATE is, so two tabs opening a session at the same instant cannot both
-- read the last remaining second.

-- One row per (meter, window). Scopes are strings the application composes:
--   'site:2026-09-04'                  — everybody, one UTC day
--   'caller:<sha256 of ip>:<hour>'     — one visitor, one clock hour
-- Windows are part of the key rather than a column so expiry is a delete of
-- old rows and never a comparison on the hot path.
CREATE TABLE IF NOT EXISTS live_audio_budget (
  scope TEXT PRIMARY KEY,
  seconds_spent INTEGER NOT NULL DEFAULT 0 CHECK (seconds_spent >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What a retention sweep walks, and what makes a filmed rehearsal's cost
-- visible afterwards rather than inferred from an invoice.
CREATE INDEX IF NOT EXISTS idx_live_audio_budget_updated
  ON live_audio_budget (updated_at);

-- One row per minted session. This is the ledger, not a cache: it records what
-- was granted, what was actually used, and the provider's call id.
--
-- The call id is the part that makes the ceiling enforceable rather than
-- advisory. The browser's SDP offer is proxied through the Worker precisely so
-- this column can be filled in without trusting the client to report it — and
-- with it the Worker can hang the call up at the provider when the grant runs
-- out, which is a thing the page cannot decline to do.
CREATE TABLE IF NOT EXISTS live_audio_sessions (
  id TEXT PRIMARY KEY,
  client_hash TEXT NOT NULL,
  -- The two budget rows this session was debited against, so settlement can
  -- refund the unused remainder to exactly the windows it was taken from even
  -- if the clock has since rolled into the next hour or day.
  caller_scope TEXT NOT NULL,
  site_scope TEXT NOT NULL,
  -- Debited up front, in full, at mint. A session that never reports back
  -- keeps its whole grant spent; that is what stops a silent client from
  -- being cheaper than an honest one.
  granted_seconds INTEGER NOT NULL CHECK (granted_seconds > 0),
  -- Provider call id (`rtc_...`), learned from the Location header when the
  -- offer is proxied. NULL until the browser actually connects.
  call_id TEXT,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed_at INTEGER,
  -- Wall-clock actually used, written at settlement. NULL while open.
  spent_seconds INTEGER,
  close_reason TEXT
);

-- The sweep's query: find sessions that are open and past their grant. Both
-- the mint path and the heartbeat run it, so a stale session left by a closed
-- laptop is hung up by the next visitor's arrival rather than waiting for a
-- client that is never coming back.
CREATE INDEX IF NOT EXISTS idx_live_audio_sessions_open
  ON live_audio_sessions (closed_at, expires_at);
