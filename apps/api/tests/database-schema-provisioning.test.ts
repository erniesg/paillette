import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const readDatabaseFile = (path: string) =>
  readFileSync(
    new URL(`../../../packages/database/${path}`, import.meta.url),
    'utf8'
  );

const requiredObjects = [
  'uq_users_email_casefold',
  'nga_public_search_request_rate_limits',
  'idx_nga_public_search_rate_limits_window',
] as const;

const schemaObjects = (sqlite: NodeDatabaseSync) =>
  sqlite
    .prepare(
      `SELECT name, type, sql
       FROM sqlite_schema
       WHERE name IN (${requiredObjects.map(() => '?').join(', ')})
       ORDER BY name`
    )
    .all(...requiredObjects) as Array<{
    name: string;
    type: string;
    sql: string | null;
  }>;

describe('database fresh-schema provisioning', () => {
  it('keeps WorkOS email and NGA request-rate-limit objects aligned with migrations', () => {
    const baseline = new DatabaseSync(':memory:');
    const freshSchema = new DatabaseSync(':memory:');

    baseline.exec(readDatabaseFile('migrations/0001_initial_schema.sql'));
    baseline.exec(
      readDatabaseFile('migrations/0017_workos_auth_identities_search_access.sql')
    );
    baseline.exec(
      readDatabaseFile('migrations/0020_nga_public_search_request_rate_limit.sql')
    );
    freshSchema.exec(readDatabaseFile('src/schema.sql'));

    expect(schemaObjects(freshSchema)).toEqual(schemaObjects(baseline));

    baseline.close();
    freshSchema.close();
  });
});
