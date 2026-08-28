import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const loadMigration = () =>
  readFileSync(
    new URL(
      '../../../packages/database/migrations/0019_retire_org_plaintext_api_keys.sql',
      import.meta.url
    ),
    'utf8'
  );

describe('organization API-key storage migration', () => {
  it('replaces legacy plaintext with a stable non-secret identifier without changing hashes or personal API keys', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE orgs (
        id TEXT PRIMARY KEY,
        api_key TEXT UNIQUE NOT NULL,
        api_key_hash TEXT NOT NULL,
        owner_id TEXT NOT NULL
      );
      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        user_id TEXT NOT NULL
      );
      INSERT INTO orgs (id, api_key, api_key_hash, owner_id)
      VALUES ('org-1', 'legacy-key-value', 'legacy-key-hash', 'owner-1');
      INSERT INTO api_keys (id, key_hash, user_id)
      VALUES ('personal-key-1', 'personal-key-hash', 'owner-1');
    `);

    const migration = loadMigration();
    db.exec(migration);
    db.exec(migration);

    expect(
      db
        .prepare('SELECT api_key, api_key_hash, owner_id FROM orgs WHERE id = ?')
        .get('org-1')
    ).toEqual({
      api_key: 'retired-org-key:org-1',
      api_key_hash: 'legacy-key-hash',
      owner_id: 'owner-1',
    });
    expect(
      db
        .prepare('SELECT id, key_hash, user_id FROM api_keys WHERE id = ?')
        .get('personal-key-1')
    ).toEqual({
      id: 'personal-key-1',
      key_hash: 'personal-key-hash',
      user_id: 'owner-1',
    });

    db.close();
  });
});
