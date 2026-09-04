-- Migration: exhibitions that outlive the tab
-- Created: 2026-09-04
--
-- "Assemble works into shortlists and shareable exhibitions" was half true:
-- the board rendered, and then died with the tab. The first shareable link
-- carried the whole show in the URL, which works but caps the hang at what a
-- messaging client will carry and produces a wall of base64 nobody reads as a
-- link. This table is the other half: the show lives on the server and the
-- link is seven characters.
--
-- Deliberately not tied to a user. The curator is anonymous — the whole NGA
-- surface is — so there is no owner column to join against and no account to
-- lose the show behind. The code IS the capability.
--
-- `works` is JSON rather than a child table on purpose. A hang is read whole,
-- written once and never queried across: nobody asks "which exhibitions
-- contain this artwork". A row per work would buy an index nothing uses and
-- cost a join on the one read path that matters.

CREATE TABLE IF NOT EXISTS exhibitions (
  -- The short code, stored exactly as it is generated. Lookups normalise
  -- (trim, case-fold) before they get here, so the column never needs to.
  code TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  title TEXT,
  statement TEXT,
  -- Provenance travels with the prose: which hand wrote the title and the
  -- statement, so the page can credit honestly rather than guess.
  title_by_agent INTEGER NOT NULL DEFAULT 0 CHECK (title_by_agent IN (0, 1)),
  statement_by_agent INTEGER NOT NULL DEFAULT 0 CHECK (statement_by_agent IN (0, 1)),
  -- [{ artworkId, label, labelByAgent }], in hanging order. Order is the array
  -- order; there is no sequence column because the array already is one.
  works TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0)
);

-- Newest-first is the only listing anyone will ever want, and it is what a
-- retention sweep would walk.
CREATE INDEX IF NOT EXISTS idx_exhibitions_created_at
  ON exhibitions (created_at);
