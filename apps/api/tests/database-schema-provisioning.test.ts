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

const securitySeedRows = (sqlite: NodeDatabaseSync) =>
  sqlite
    .prepare(
      `SELECT
         users.id,
         users.email,
         users.name,
         users.role,
         search_access_approvals.status,
         search_access_approvals.approved_by
       FROM users
       LEFT JOIN search_access_approvals ON search_access_approvals.user_id = users.id
       WHERE users.id IN ('user-bootstrap-hello-ernie-sg', 'public-search-web')
       ORDER BY users.id`
    )
    .all() as Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    status: string | null;
    approved_by: string | null;
  }>;

describe('database fresh-schema provisioning', () => {
  it('keeps WorkOS/NGA security objects and durable seed rows aligned with migrations', () => {
    const baseline = new DatabaseSync(':memory:');
    const freshSchema = new DatabaseSync(':memory:');

    baseline.exec(readDatabaseFile('migrations/0001_initial_schema.sql'));
    baseline.exec(
      readDatabaseFile('migrations/0017_workos_auth_identities_search_access.sql')
    );
    baseline.exec(readDatabaseFile('migrations/0018_nga_public_search_quota.sql'));
    baseline.exec(
      readDatabaseFile('migrations/0020_nga_public_search_request_rate_limit.sql')
    );
    freshSchema.exec(readDatabaseFile('src/schema.sql'));

    expect(schemaObjects(freshSchema)).toEqual(schemaObjects(baseline));
    expect(securitySeedRows(freshSchema)).toEqual(securitySeedRows(baseline));
    expect(securitySeedRows(freshSchema)).toEqual([
      {
        id: 'public-search-web',
        email: 'public-search-web@invalid.paillette.local',
        name: 'NGA Public Search',
        role: 'viewer',
        status: null,
        approved_by: null,
      },
      {
        id: 'user-bootstrap-hello-ernie-sg',
        email: 'hello@ernie.sg',
        name: 'Ernie',
        role: 'admin',
        status: 'active',
        approved_by: 'bootstrap:hello@ernie.sg',
      },
    ]);

    baseline.close();
    freshSchema.close();
  });
});
