-- Stable WorkOS identities and explicit search/API access approvals.
--
-- This migration is intentionally additive. The objects may already exist in
-- staging and production from the historical 0015 migration, so every DDL
-- statement is idempotent and the bootstrap rows are never updated or rebound.

CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (issuer, subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_provider
  ON auth_identities(user_id, provider);

-- Keep each internal user bound to at most one external subject/provider.
-- Use a distinct name so reapplying after the historical non-unique index is
-- safe and does not require dropping or rebuilding existing indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identities_user_provider
  ON auth_identities(user_id, provider);

-- The historical users.email constraint is case-sensitive in SQLite. WorkOS
-- identities normalize verified emails, so prevent a later case-only account
-- variant from making bootstrap identity binding ambiguous. Preflight confirmed
-- staging and production have no such existing variants before this migration.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_casefold
  ON users(lower(email));

CREATE TABLE IF NOT EXISTS search_access_approvals (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO users (id, email, password_hash, name, role)
SELECT
  'user-bootstrap-hello-ernie-sg',
  'hello@ernie.sg',
  'external-identity',
  'Ernie',
  'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE lower(email) = 'hello@ernie.sg'
);

-- Keep the designated bootstrap account recoverable when an older install
-- already has this email but was provisioned as a viewer. This exact-email
-- repair deliberately cannot affect other accounts.
UPDATE users
SET role = 'admin'
WHERE lower(email) = 'hello@ernie.sg';

INSERT INTO search_access_approvals (user_id, status, approved_by)
SELECT id, 'active', 'bootstrap:hello@ernie.sg'
FROM users
WHERE lower(email) = 'hello@ernie.sg'
ON CONFLICT(user_id) DO UPDATE SET
  status = 'active',
  revoked_at = NULL,
  updated_at = datetime('now');
