import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  NGA_PUBLIC_SEARCH_QUOTA_LIMIT,
  NGA_PUBLIC_SEARCH_QUOTA_SCOPE,
  getNgaPublicSearchQuota,
  reserveNgaPublicSearchQuota,
  reserveNgaPublicSearchQuotaWithUsageEvent,
} from './nga-search-quota';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const readMigration = (name: string) =>
  readFileSync(
    new URL(`../../../../packages/database/migrations/${name}`, import.meta.url),
    'utf8'
  );

const createD1 = () => {
  const sqlite = new DatabaseSync(':memory:');
  let batchTail: Promise<void> = Promise.resolve();
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readMigration('0001_initial_schema.sql'));
  sqlite.exec(readMigration('0005_api_keys_usage.sql'));
  sqlite.exec(readMigration('0018_nga_public_search_quota.sql'));

  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        async first<T>() {
          return (statement.get(...(params as never[])) as T | undefined) ?? null;
        },
        async run<T>() {
          const results = statement.all(...(params as never[])) as T[];
          return {
            success: true,
            meta: {
              changes: (
                sqlite.prepare('SELECT changes() AS count').get() as {
                  count: number;
                }
              ).count,
            },
            results,
          };
        },
        all<T>() {
          return Promise.resolve({
            success: true,
            results: statement.all(...(params as never[])) as T[],
          });
        },
      };
    },
    batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const runBatch = async () => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      };
      const result = batchTail.then(runBatch, runBatch);
      batchTail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  } as unknown as D1Database;

  return { db, sqlite };
};

describe('NGA public search quota', () => {
  it('reports the seeded global lifetime pool before any reservation', async () => {
    const { db, sqlite } = createD1();

    await expect(getNgaPublicSearchQuota(db)).resolves.toEqual({
      limit: 1000,
      used: 0,
      remaining: 1000,
    });
    expect(
      sqlite
        .prepare('SELECT scope, used, hard_limit FROM nga_public_search_quota')
        .all()
    ).toEqual([
      { scope: 'nga-public-search', used: 0, hard_limit: 1000 },
    ]);
    expect(
      sqlite
        .prepare('SELECT id, email, role FROM users WHERE id = ?')
        .get('public-search-web')
    ).toEqual({
      id: 'public-search-web',
      email: 'public-search-web@invalid.paillette.local',
      role: 'viewer',
    });
    sqlite.close();
  });

  it('can be reapplied without changing the service principal or resetting the quota', async () => {
    const { sqlite } = createD1();
    sqlite
      .prepare(
        'UPDATE nga_public_search_quota SET used = 17 WHERE scope = ?'
      )
      .run(NGA_PUBLIC_SEARCH_QUOTA_SCOPE);
    sqlite
      .prepare('UPDATE users SET name = ? WHERE id = ?')
      .run('Existing Service Principal', 'public-search-web');

    sqlite.exec(readMigration('0018_nga_public_search_quota.sql'));

    expect(
      sqlite
        .prepare('SELECT id, email, name, role FROM users WHERE id = ?')
        .get('public-search-web')
    ).toEqual({
      id: 'public-search-web',
      email: 'public-search-web@invalid.paillette.local',
      name: 'Existing Service Principal',
      role: 'viewer',
    });
    expect(
      sqlite
        .prepare('SELECT used, hard_limit FROM nga_public_search_quota WHERE scope = ?')
        .get(NGA_PUBLIC_SEARCH_QUOTA_SCOPE)
    ).toEqual({ used: 17, hard_limit: 1000 });
    sqlite.close();
  });

  it('admits exactly the global lifetime limit and rejects the next reservation', async () => {
    const { db, sqlite } = createD1();

    for (let index = 0; index < NGA_PUBLIC_SEARCH_QUOTA_LIMIT; index += 1) {
      await expect(reserveNgaPublicSearchQuota(db)).resolves.toMatchObject({
        admitted: true,
      });
    }

    await expect(reserveNgaPublicSearchQuota(db)).resolves.toEqual({
      admitted: false,
      quota: { limit: 1000, used: 1000, remaining: 0 },
    });
    sqlite.close();
  });

  it('admits one of two concurrent requests for the final slot', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare(
        'UPDATE nga_public_search_quota SET used = hard_limit - 1 WHERE scope = ?'
      )
      .run(NGA_PUBLIC_SEARCH_QUOTA_SCOPE);

    const reservations = await Promise.all([
      reserveNgaPublicSearchQuota(db),
      reserveNgaPublicSearchQuota(db),
    ]);

    expect(reservations.filter(({ admitted }) => admitted)).toHaveLength(1);
    expect(reservations.map(({ quota }) => quota.used)).toEqual([1000, 1000]);
    sqlite.close();
  });

  it('fails closed when the singleton quota row is missing', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare('DELETE FROM nga_public_search_quota WHERE scope = ?')
      .run(NGA_PUBLIC_SEARCH_QUOTA_SCOPE);

    await expect(getNgaPublicSearchQuota(db)).rejects.toThrow(
      'NGA public search quota row is missing'
    );
    await expect(reserveNgaPublicSearchQuota(db)).rejects.toThrow(
      'NGA public search quota row is missing'
    );
    sqlite.close();
  });

  it('commits the quota debit and accepted-search event together', async () => {
    const { db, sqlite } = createD1();
    let marked = false;
    const usageEvent = {
      id: 'accepted-search',
      metadata: {},
      statement: db
        .prepare(
          `
          INSERT INTO api_usage_events (
            id, user_id, usage_date, method, path, auth_kind, query_type
          )
          SELECT ?, 'public-search-web', '2026-08-28', 'POST',
            '/api/v1/orgs/nga/search/text', 'api_key', 'text'
          WHERE changes() = 1
          `
        )
        .bind('accepted-search'),
      markRecorded: () => {
        marked = true;
      },
    };

    await expect(
      reserveNgaPublicSearchQuotaWithUsageEvent(db, usageEvent)
    ).resolves.toMatchObject({
      admitted: true,
      quota: { used: 1, remaining: 999 },
    });
    expect(marked).toBe(true);
    expect(
      sqlite.prepare('SELECT id, user_id, query_type FROM api_usage_events').all()
    ).toEqual([
      {
        id: 'accepted-search',
        user_id: 'public-search-web',
        query_type: 'text',
      },
    ]);
    sqlite.close();
  });

  it.each([
    ['text', '/api/v1/orgs/nga/search/text'],
    ['image', '/api/v1/orgs/nga/search/image'],
    ['color', '/api/v1/orgs/nga/search/color'],
  ])(
    'atomically debits and logs a valid public %s search with foreign keys enabled',
    async (queryType, path) => {
      const { db, sqlite } = createD1();
      const usageEvent = {
        id: `accepted-${queryType}`,
        metadata: {},
        statement: db
          .prepare(
            `
            INSERT INTO api_usage_events (
              id, user_id, usage_date, method, path, auth_kind, query_type
            )
            SELECT ?, 'public-search-web', '2026-08-28', 'POST', ?, 'api_key', ?
            WHERE changes() = 1
            `
          )
          .bind(`accepted-${queryType}`, path, queryType),
        markRecorded: () => undefined,
      };

      await expect(
        reserveNgaPublicSearchQuotaWithUsageEvent(db, usageEvent)
      ).resolves.toMatchObject({ admitted: true });
      expect(
        sqlite
          .prepare('SELECT user_id, query_type FROM api_usage_events WHERE id = ?')
          .get(`accepted-${queryType}`)
      ).toEqual({ user_id: 'public-search-web', query_type: queryType });
      sqlite.close();
    }
  );

  it('rolls back the debit when the public search service user is missing', async () => {
    const { db, sqlite } = createD1();
    sqlite.prepare('DELETE FROM users WHERE id = ?').run('public-search-web');
    const usageEvent = {
      id: 'accepted-search',
      metadata: {},
      statement: db
        .prepare(
          `
          INSERT INTO api_usage_events (
            id, user_id, usage_date, method, path, auth_kind, query_type
          )
          SELECT ?, 'public-search-web', '2026-08-28', 'POST',
            '/api/v1/orgs/nga/search/text', 'api_key', 'text'
          WHERE changes() = 1
          `
        )
        .bind('accepted-search'),
      markRecorded: () => undefined,
    };

    await expect(
      reserveNgaPublicSearchQuotaWithUsageEvent(db, usageEvent)
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await expect(getNgaPublicSearchQuota(db)).resolves.toMatchObject({ used: 0 });
    expect(sqlite.prepare('SELECT id FROM api_usage_events').all()).toEqual([]);
    sqlite.close();
  });

  it('rolls back the quota debit when accepted-search logging fails', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare(
        `
        INSERT INTO api_usage_events (
          id, user_id, usage_date, method, path, auth_kind
        ) VALUES (?, 'public-search-web', '2026-08-28', 'POST', '/test', 'api_key')
        `
      )
      .run('taken');
    const usageEvent = {
      id: 'accepted-search',
      metadata: {},
      statement: db
        .prepare(
          `
          INSERT INTO api_usage_events (
            id, user_id, usage_date, method, path, auth_kind
          ) VALUES (?, 'public-search-web', '2026-08-28', 'POST', '/test', 'api_key')
          `
        )
        .bind('taken'),
      markRecorded: () => undefined,
    };

    await expect(
      reserveNgaPublicSearchQuotaWithUsageEvent(db, usageEvent)
    ).rejects.toThrow();
    await expect(getNgaPublicSearchQuota(db)).resolves.toMatchObject({ used: 0 });
    expect(sqlite.prepare('SELECT id FROM api_usage_events').all()).toEqual([
      { id: 'taken' },
    ]);
    sqlite.close();
  });

  it('admits one concurrent final-slot request and creates one event', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare(
        'UPDATE nga_public_search_quota SET used = hard_limit - 1 WHERE scope = ?'
      )
      .run(NGA_PUBLIC_SEARCH_QUOTA_SCOPE);
    const event = (id: string) => ({
      id,
      metadata: {},
      statement: db
        .prepare(
          `
          INSERT INTO api_usage_events (
            id, user_id, usage_date, method, path, auth_kind
          )
          SELECT ?, 'public-search-web', '2026-08-28', 'POST', '/test', 'api_key'
          WHERE changes() = 1
          `
        )
        .bind(id),
      markRecorded: () => undefined,
    });

    const reservations = await Promise.all([
      reserveNgaPublicSearchQuotaWithUsageEvent(db, event('first')),
      reserveNgaPublicSearchQuotaWithUsageEvent(db, event('second')),
    ]);

    expect(reservations.filter(({ admitted }) => admitted)).toHaveLength(1);
    expect(sqlite.prepare('SELECT id FROM api_usage_events').all()).toHaveLength(1);
    sqlite.close();
  });
});
