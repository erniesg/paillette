import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  NGS_PUBLIC_SEARCH_QUOTA_LIMIT,
  NGS_PUBLIC_SEARCH_QUOTA_SCOPE,
  getNgsPublicSearchQuota,
  reserveNgsPublicSearchQuota,
} from './ngs-search-quota';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const createD1 = () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL(
        '../../../../packages/database/migrations/0016_ngs_public_search_quota.sql',
        import.meta.url
      ),
      'utf8'
    )
  );

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
      };
    },
  } as unknown as D1Database;

  return { db, sqlite };
};

describe('NGS public search quota', () => {
  it('reports the seeded global lifetime pool before any reservation', async () => {
    const { db, sqlite } = createD1();

    await expect(getNgsPublicSearchQuota(db)).resolves.toEqual({
      limit: 1000,
      used: 0,
      remaining: 1000,
    });
    expect(
      sqlite
        .prepare(
          'SELECT scope, used, hard_limit FROM ngs_public_search_quota'
        )
        .all()
    ).toEqual([
      {
        scope: 'ngs-public-search',
        used: 0,
        hard_limit: 1000,
      },
    ]);
    sqlite.close();
  });

  it('admits exactly the global lifetime limit and rejects the next reservation', async () => {
    const { db, sqlite } = createD1();

    for (let index = 0; index < NGS_PUBLIC_SEARCH_QUOTA_LIMIT; index += 1) {
      await expect(reserveNgsPublicSearchQuota(db)).resolves.toMatchObject({
        admitted: true,
      });
    }

    await expect(reserveNgsPublicSearchQuota(db)).resolves.toEqual({
      admitted: false,
      quota: { limit: 1000, used: 1000, remaining: 0 },
    });
    sqlite.close();
  });

  it('admits one of two concurrent requests for the final slot', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare(
        'UPDATE ngs_public_search_quota SET used = hard_limit - 1 WHERE scope = ?'
      )
      .run(NGS_PUBLIC_SEARCH_QUOTA_SCOPE);

    const reservations = await Promise.all([
      reserveNgsPublicSearchQuota(db),
      reserveNgsPublicSearchQuota(db),
    ]);

    expect(reservations.filter(({ admitted }) => admitted)).toHaveLength(1);
    expect(reservations.map(({ quota }) => quota.used)).toEqual([1000, 1000]);
    sqlite.close();
  });

  it('persists lifetime usage across a later read without a date reset', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare(
        "UPDATE ngs_public_search_quota SET used = 7, updated_at = '2001-01-01 00:00:00' WHERE scope = ?"
      )
      .run(NGS_PUBLIC_SEARCH_QUOTA_SCOPE);

    await expect(getNgsPublicSearchQuota(db)).resolves.toEqual({
      limit: 1000,
      used: 7,
      remaining: 993,
    });
    sqlite.close();
  });

  it('fails closed when the singleton quota row is missing', async () => {
    const { db, sqlite } = createD1();
    sqlite
      .prepare('DELETE FROM ngs_public_search_quota WHERE scope = ?')
      .run(NGS_PUBLIC_SEARCH_QUOTA_SCOPE);

    await expect(getNgsPublicSearchQuota(db)).rejects.toThrow(
      'NGS public search quota row is missing'
    );
    await expect(reserveNgsPublicSearchQuota(db)).rejects.toThrow(
      'NGS public search quota row is missing'
    );
    sqlite.close();
  });

  it('propagates D1 failures instead of admitting a search', async () => {
    const db = {
      prepare: () => {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;

    await expect(getNgsPublicSearchQuota(db)).rejects.toThrow('D1 unavailable');
    await expect(reserveNgsPublicSearchQuota(db)).rejects.toThrow(
      'D1 unavailable'
    );
  });
});
