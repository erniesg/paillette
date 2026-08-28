import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { orgQueries } from '@paillette/database';
import orgRoutes from '../../src/routes/galleries';
import type { Env } from '../../src/index';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIALS = {
  api_key: 'pk_live_must_not_escape',
  api_key_hash: 'hash_must_not_escape',
  upstream_credential: 'also_must_not_escape',
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeOrgDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  first<T>() {
    return this.db.first<T>(this.sql, this.params);
  }

  all<T>() {
    return this.db.all<T>(this.sql, this.params);
  }
}

class FakeOrgDb {
  readonly preparedSql: string[] = [];
  readonly org = {
    id: ORG_ID,
    name: 'Safe Org',
    slug: 'safe-org',
    description: 'A test organization',
    location_country: 'SG',
    location_city: 'Singapore',
    location_address: null,
    website: 'https://example.test',
    settings: '{"allowPublicAccess":true}',
    owner_id: 'owner-1',
    created_at: '2026-08-28T00:00:00.000Z',
    ...CREDENTIALS,
  };

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  async first<T>(sql: string, _params: unknown[]) {
    if (sql.includes('COUNT(*)')) return { total: 1 } as T;
    if (sql.includes('SELECT id FROM orgs')) return { id: ORG_ID } as T;
    return this.org as T;
  }

  async all<T>(_sql: string, _params: unknown[]) {
    return { success: true, results: [this.org] as T[] };
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/orgs', orgRoutes);
  app.route('/galleries', orgRoutes);
  return app;
};

const assertNoCredentials = (body: unknown) => {
  const serialized = JSON.stringify(body);
  for (const value of Object.values(CREDENTIALS)) {
    expect(serialized).not.toContain(value);
  }
  expect(serialized).not.toContain('api_key');
  expect(serialized).not.toContain('upstream_credential');
};

describe('organization read credential serialization', () => {
  it('uses explicit read projections that omit API credentials', () => {
    for (const query of [
      orgQueries.list(),
      orgQueries.findById(ORG_ID),
      orgQueries.findBySlug('safe-org'),
      orgQueries.findByOwner('owner-1'),
    ]) {
      expect(query.sql).not.toMatch(/select\s+\*/i);
      expect(query.sql).not.toContain('api_key');
      expect(query.sql).not.toContain('api_key_hash');
    }
  });

  it.each([
    ['/orgs', 'list'],
    [`/orgs/${ORG_ID}`, 'id'],
    ['/orgs/slug/safe-org', 'slug'],
    ['/galleries', 'legacy list'],
    [`/galleries/${ORG_ID}`, 'legacy id'],
    ['/galleries/slug/safe-org', 'legacy slug'],
  ])('does not serialize credentials for %s (%s)', async (path) => {
    const app = makeApp();
    const db = new FakeOrgDb();
    const response = await app.request(path, undefined, {
      DB: db as unknown as D1Database,
    } as Env);

    expect(response.status).toBe(200);
    const body = await response.json();
    assertNoCredentials(body);
    expect(body.success).toBe(true);
    expect(path === '/orgs' || path === '/galleries').toBe(
      Array.isArray(body.data)
    );
  });
});
