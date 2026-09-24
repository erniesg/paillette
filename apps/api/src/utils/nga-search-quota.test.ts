import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NGA_SEARCHES_PER_DAY,
  DEFAULT_NGA_SITE_SEARCHES_PER_DAY,
  getNgaPublicSearchQuota,
  ngaSearchQuotaScope,
  reserveNgaPublicSearchQuota,
  reserveNgaPublicSearchQuotaWithUsageEvent,
  type NgaSearchQuotaScope,
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
  sqlite.exec(readMigration('0023_nga_public_search_client_debits.sql'));

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

const NOON = Date.parse('2026-09-24T12:00:00Z');
const HOUR = 3_600_000;

const scope = (
  clientIdentity: string | undefined,
  overrides: Partial<NgaSearchQuotaScope> = {}
): NgaSearchQuotaScope => ({
  clientIdentity,
  limit: 3,
  siteLimit: 100,
  now: NOON,
  ...overrides,
});

const acceptedSearchEvent = (
  db: D1Database,
  id: string,
  onMarked: () => void = () => undefined
) => ({
  id,
  metadata: {},
  statement: db
    .prepare(
      `
      INSERT INTO api_usage_events (
        id, user_id, usage_date, method, path, auth_kind, query_type
      )
      SELECT ?, 'public-search-web', '2026-09-24', 'POST',
        '/api/v1/orgs/nga/search/text', 'api_key', 'text'
      WHERE changes() = 1
      `
    )
    .bind(id),
  markRecorded: onMarked,
});

describe('NGA public search quota — per caller, per 24 hours', () => {
  it('starts every caller with a full day', async () => {
    const { db, sqlite } = createD1();
    await expect(getNgaPublicSearchQuota(db, scope('public-edge:203.0.113.9'))).resolves.toEqual({
      limit: 3,
      used: 0,
      remaining: 3,
    });
    sqlite.close();
  });

  it('admits the caller\'s limit, refuses the next, and leaves other callers alone', async () => {
    const { db, sqlite } = createD1();
    const mine = scope('public-edge:203.0.113.9');
    for (let i = 0; i < 3; i += 1) {
      await expect(reserveNgaPublicSearchQuota(db, mine)).resolves.toMatchObject({
        admitted: true,
      });
    }
    await expect(reserveNgaPublicSearchQuota(db, mine)).resolves.toMatchObject({
      admitted: false,
      quota: { limit: 3, used: 3, remaining: 0 },
      debitId: null,
    });
    // One visitor spending theirs no longer spends everybody's.
    await expect(
      reserveNgaPublicSearchQuota(db, scope('public-edge:198.51.100.4'))
    ).resolves.toMatchObject({ admitted: true, quota: { used: 1, remaining: 2 } });
    sqlite.close();
  });

  it('gives a search back 24 hours after it was made, not at a reset', async () => {
    const { db, sqlite } = createD1();
    for (const hoursAgo of [30, 20, 10]) {
      await reserveNgaPublicSearchQuota(
        db,
        scope('public-edge:203.0.113.9', { now: NOON - hoursAgo * HOUR })
      );
    }
    // The 30-hour-old search has left the window; the other two have not.
    await expect(
      getNgaPublicSearchQuota(db, scope('public-edge:203.0.113.9'))
    ).resolves.toEqual({ limit: 3, used: 2, remaining: 1 });
    await expect(
      reserveNgaPublicSearchQuota(db, scope('public-edge:203.0.113.9'))
    ).resolves.toMatchObject({ admitted: true });
    await expect(
      reserveNgaPublicSearchQuota(db, scope('public-edge:203.0.113.9'))
    ).resolves.toMatchObject({ admitted: false });
    sqlite.close();
  });

  it('keeps a site-wide ceiling, so the number of callers cannot unbound it', async () => {
    const { db, sqlite } = createD1();
    const site = { limit: 3, siteLimit: 4 };
    for (const caller of ['a', 'a', 'b', 'c']) {
      await expect(
        reserveNgaPublicSearchQuota(db, scope(caller, site))
      ).resolves.toMatchObject({ admitted: true });
    }
    await expect(reserveNgaPublicSearchQuota(db, scope('d', site))).resolves.toMatchObject({
      admitted: false,
      // Never promise a search the site would refuse.
      quota: { used: 0, remaining: 0 },
    });
    sqlite.close();
  });

  it('never stores the caller identity itself', async () => {
    const { db, sqlite } = createD1();
    await reserveNgaPublicSearchQuota(db, scope('public-edge:203.0.113.9'));
    const rows = sqlite.prepare('SELECT client_hash FROM nga_public_search_debits').all() as Array<{
      client_hash: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.9');
    sqlite.close();
  });

  it('admits one of two concurrent requests for the final slot', async () => {
    const { db, sqlite } = createD1();
    const mine = scope('x', { limit: 1 });
    const reservations = await Promise.all([
      reserveNgaPublicSearchQuota(db, mine),
      reserveNgaPublicSearchQuota(db, mine),
    ]);
    expect(reservations.filter(({ admitted }) => admitted)).toHaveLength(1);
    sqlite.close();
  });

  it('reads its limits from the environment, with defaults', () => {
    expect(ngaSearchQuotaScope({}, 'x')).toMatchObject({
      limit: DEFAULT_NGA_SEARCHES_PER_DAY,
      siteLimit: DEFAULT_NGA_SITE_SEARCHES_PER_DAY,
    });
    expect(
      ngaSearchQuotaScope(
        { NGA_SEARCH_CALLS_PER_DAY: '1000', NGA_SEARCH_SITE_CALLS_PER_DAY: '10000' },
        'x'
      )
    ).toMatchObject({ limit: 1000, siteLimit: 10000 });
  });

  it('can reapply 0018 without changing the service principal', () => {
    const { sqlite } = createD1();
    sqlite
      .prepare('UPDATE users SET name = ? WHERE id = ?')
      .run('Existing Service Principal', 'public-search-web');
    sqlite.exec(readMigration('0018_nga_public_search_quota.sql'));
    sqlite.exec(readMigration('0023_nga_public_search_client_debits.sql'));
    expect(
      sqlite.prepare('SELECT name, role FROM users WHERE id = ?').get('public-search-web')
    ).toEqual({ name: 'Existing Service Principal', role: 'viewer' });
    sqlite.close();
  });
});

describe('NGA public search quota — with the accepted-search event', () => {
  it('commits the debit and the event together', async () => {
    const { db, sqlite } = createD1();
    let marked = false;
    await expect(
      reserveNgaPublicSearchQuotaWithUsageEvent(
        db,
        acceptedSearchEvent(db, 'accepted-search', () => {
          marked = true;
        }),
        scope('x')
      )
    ).resolves.toMatchObject({ admitted: true, quota: { used: 1, remaining: 2 } });
    expect(marked).toBe(true);
    expect(sqlite.prepare('SELECT id FROM api_usage_events').all()).toEqual([
      { id: 'accepted-search' },
    ]);
    sqlite.close();
  });

  it('writes no event for a refused search', async () => {
    const { db, sqlite } = createD1();
    const one = scope('x', { limit: 1 });
    await reserveNgaPublicSearchQuotaWithUsageEvent(db, acceptedSearchEvent(db, 'first'), one);
    let marked = false;
    await expect(
      reserveNgaPublicSearchQuotaWithUsageEvent(
        db,
        acceptedSearchEvent(db, 'second', () => {
          marked = true;
        }),
        one
      )
    ).resolves.toMatchObject({ admitted: false });
    expect(marked).toBe(false);
    expect(sqlite.prepare('SELECT id FROM api_usage_events').all()).toEqual([{ id: 'first' }]);
    sqlite.close();
  });

  it('rolls back the debit when the event cannot be written', async () => {
    const { db, sqlite } = createD1();
    sqlite.prepare('DELETE FROM users WHERE id = ?').run('public-search-web');
    await expect(
      reserveNgaPublicSearchQuotaWithUsageEvent(db, acceptedSearchEvent(db, 'e'), scope('x'))
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await expect(getNgaPublicSearchQuota(db, scope('x'))).resolves.toMatchObject({ used: 0 });
    sqlite.close();
  });

  it('admits one concurrent final-slot request and creates one event', async () => {
    const { db, sqlite } = createD1();
    const one = scope('x', { limit: 1 });
    const reservations = await Promise.all([
      reserveNgaPublicSearchQuotaWithUsageEvent(db, acceptedSearchEvent(db, 'first'), one),
      reserveNgaPublicSearchQuotaWithUsageEvent(db, acceptedSearchEvent(db, 'second'), one),
    ]);
    expect(reservations.filter(({ admitted }) => admitted)).toHaveLength(1);
    expect(sqlite.prepare('SELECT id FROM api_usage_events').all()).toHaveLength(1);
    sqlite.close();
  });
});
