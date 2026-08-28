import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
  close(): void;
};

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0017_workos_auth_identities_search_access.sql',
    import.meta.url
  ),
  'utf8'
);

describe('WorkOS auth migration', () => {
  it('repairs only the intended bootstrap user to admin and active approval', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL
      );
      INSERT INTO users (id, email, password_hash, name, role)
      VALUES
        ('bootstrap-existing', 'hello@ernie.sg', 'x', 'Existing Ernie', 'viewer'),
        ('other-user', 'other@example.test', 'x', 'Other', 'viewer');
    `);
    db.exec(`
      CREATE TABLE search_access_approvals (
        user_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO search_access_approvals (user_id, status, approved_by, revoked_at)
      VALUES ('bootstrap-existing', 'revoked', 'operator', datetime('now'));
    `);

    db.exec(migration);

    expect(db.prepare('SELECT role FROM users WHERE id = ?').get('bootstrap-existing')).toEqual({ role: 'admin' });
    expect(db.prepare('SELECT role FROM users WHERE id = ?').get('other-user')).toEqual({ role: 'viewer' });
    expect(
      db.prepare('SELECT status, revoked_at FROM search_access_approvals WHERE user_id = ?').get('bootstrap-existing')
    ).toEqual({ status: 'active', revoked_at: null });
    db.close();
  });

  it('can be reapplied without changing existing identities or approvals', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL
      );
    `);

    db.exec(migration);
    db.exec(`
      INSERT INTO users (id, email, password_hash, name, role)
      VALUES ('workos-user', 'person@example.com', 'external-identity', 'Person', 'viewer');
      INSERT INTO auth_identities
        (provider, issuer, subject, user_id, email, email_verified)
      VALUES
        ('workos', 'https://auth.example.com', 'subject-1', 'workos-user', 'person@example.com', 1);
      INSERT INTO search_access_approvals (user_id, status, approved_by)
      VALUES ('workos-user', 'revoked', 'operator');
    `);

    db.exec(migration);

    expect(
      db
        .prepare(
          'SELECT provider, issuer, subject, user_id, email, email_verified FROM auth_identities WHERE user_id = ?'
        )
        .get('workos-user')
    ).toEqual({
      provider: 'workos',
      issuer: 'https://auth.example.com',
      subject: 'subject-1',
      user_id: 'workos-user',
      email: 'person@example.com',
      email_verified: 1,
    });
    expect(
      db
        .prepare(
          'SELECT user_id, status, approved_by FROM search_access_approvals WHERE user_id = ?'
        )
        .get('workos-user')
    ).toEqual({
      user_id: 'workos-user',
      status: 'revoked',
      approved_by: 'operator',
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'uq_auth_identities_user_provider'"
        )
        .get()
    ).toEqual({ count: 1 });

    db.close();
  });
});
