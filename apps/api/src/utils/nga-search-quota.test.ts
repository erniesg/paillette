import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  NGA_PUBLIC_SEARCH_QUOTA_LIMIT,
  NGA_PUBLIC_SEARCH_QUOTA_SCOPE,
  getNgaPublicSearchQuota,
  reserveNgaPublicSearchQuota,
} from './nga-search-quota';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

const createD1 = () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL(
        '../../../../packages/database/migrations/0018_nga_public_search_quota.sql',
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
});
