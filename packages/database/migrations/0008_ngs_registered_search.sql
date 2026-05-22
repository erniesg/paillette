-- Paillette Database Schema (D1 - SQLite)
-- Migration: 0008_ngs_registered_search
-- Created: 2026-05-23
-- Description:
--   Make the NGS public search org match the registered-users-only API rule.

UPDATE orgs
SET settings = json_set(
  CASE
    WHEN settings IS NULL OR settings = '' THEN '{}'
    ELSE settings
  END,
  '$.allowPublicAccess',
  json('false')
)
WHERE id = '00000000-0000-4000-8000-000000000101';
