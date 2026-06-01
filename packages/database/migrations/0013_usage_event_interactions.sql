-- Usage Event Interaction Metadata
--
-- Expand artwork interaction tracking beyond result impressions/downloads so
-- public search can record artwork opens, result clicks, and citation copies
-- with compact per-action context.

DROP INDEX IF EXISTS idx_artwork_usage_artwork;
DROP INDEX IF EXISTS idx_artwork_usage_org;
DROP INDEX IF EXISTS idx_artwork_usage_interaction;

ALTER TABLE artwork_usage_events RENAME TO artwork_usage_events_old;

CREATE TABLE artwork_usage_events (
  id TEXT PRIMARY KEY,
  usage_event_id TEXT NOT NULL,
  artwork_id TEXT NOT NULL,
  org_id TEXT,
  rank INTEGER,
  score REAL,
  interaction TEXT CHECK(interaction IN ('result', 'view', 'click', 'download', 'citation_copy')) NOT NULL DEFAULT 'result',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (usage_event_id) REFERENCES api_usage_events(id) ON DELETE CASCADE,
  FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
);

INSERT INTO artwork_usage_events (
  id,
  usage_event_id,
  artwork_id,
  org_id,
  rank,
  score,
  interaction,
  metadata,
  created_at
)
SELECT
  id,
  usage_event_id,
  artwork_id,
  org_id,
  rank,
  score,
  interaction,
  '{}',
  created_at
FROM artwork_usage_events_old;

DROP TABLE artwork_usage_events_old;

CREATE INDEX IF NOT EXISTS idx_artwork_usage_artwork ON artwork_usage_events(artwork_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artwork_usage_org ON artwork_usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artwork_usage_interaction ON artwork_usage_events(interaction, created_at DESC);
