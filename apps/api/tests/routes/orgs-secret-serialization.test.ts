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

  run() {
    return this.db.run(this.sql, this.params);
  }
}

class FakeOrgDb {
  readonly preparedSql: string[] = [];
  createdOrg: Record<string, unknown> | null = null;
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
    if (sql.includes("WHERE id = ? AND role = 'admin'")) {
      return { allowed: 1 } as T;
    }
    return this.org as T;
  }

  async all<T>(_sql: string, _params: unknown[]) {
    return { success: true, results: [this.org] as T[] };
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO orgs')) {
      this.createdOrg = {
        id: params[0],
        name: params[1],
        slug: params[2],
        description: params[3],
        location_country: params[4],
        location_city: params[5],
        location_address: params[6],
        website: params[7],
        settings: params[8],
        api_key: params[9],
        api_key_hash: params[10],
        owner_id: params[11],
      };
    }
    return { success: true, meta: { changes: 1 } };
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/orgs', orgRoutes);
  app.route('/galleries', orgRoutes);
  return app;
};

const makeAdminApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('auth' as never, {
      kind: 'user',
      userId: 'admin-1',
      scopes: [],
    } as never);
    await next();
  });
  app.route('/orgs', orgRoutes);
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

  it('returns only the one-time API key when an admin creates an organization', async () => {
    const db = new FakeOrgDb();
    const response = await makeAdminApp().request(
      '/orgs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Safe Org',
          slug: 'new-safe-org',
          settings: {
            allowPublicAccess: false,
            enableEmbeddingProjector: true,
            defaultLanguage: 'en',
            supportedLanguages: ['en'],
          },
        }),
      },
      { DB: db as unknown as D1Database } as Env
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    const persistedHash = db.createdOrg?.api_key_hash;
    expect(persistedHash).toEqual(expect.any(String));
    expect(body.data.api_key).toEqual(db.createdOrg?.api_key);
    expect(JSON.stringify(body)).not.toContain(String(persistedHash));
    expect(body.data).not.toHaveProperty('api_key_hash');
    expect(body.data).toMatchObject({
      name: 'New Safe Org',
      slug: 'new-safe-org',
      owner_id: 'admin-1',
    });
  });
});
