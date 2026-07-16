-- Stable external identities and explicit search/API access approvals.

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

INSERT INTO search_access_approvals (user_id, status, approved_by)
SELECT id, 'active', 'bootstrap:hello@ernie.sg'
FROM users
WHERE lower(email) = 'hello@ernie.sg'
ON CONFLICT(user_id) DO NOTHING;
