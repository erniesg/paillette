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

const createD1 = () => {
  const sqlite = new DatabaseSync(':memory:');
  let batchTail: Promise<void> = Promise.resolve();
  sqlite.exec(
    readFileSync(
      new URL(
        '../../../../packages/database/migrations/0018_nga_public_search_quota.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  sqlite.exec('CREATE TABLE api_usage_events (id TEXT PRIMARY KEY)');

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
        .prepare('INSERT INTO api_usage_events (id) SELECT ? WHERE changes() = 1')
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
      sqlite.prepare('SELECT id FROM api_usage_events').all()
    ).toEqual([{ id: 'accepted-search' }]);
    sqlite.close();
  });

  it('rolls back the quota debit when accepted-search logging fails', async () => {
    const { db, sqlite } = createD1();
    sqlite.prepare('INSERT INTO api_usage_events (id) VALUES (?)').run('taken');
    const usageEvent = {
      id: 'accepted-search',
      metadata: {},
      statement: db.prepare('INSERT INTO api_usage_events (id) VALUES (?)').bind('taken'),
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
        .prepare('INSERT INTO api_usage_events (id) SELECT ? WHERE changes() = 1')
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
