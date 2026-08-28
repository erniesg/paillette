import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import apiKeyRoutes from '../../src/routes/api-keys';
import impactRoutes from '../../src/routes/impact';
import metadataRoutes from '../../src/routes/metadata';
import ngsReviewRoutes from '../../src/routes/ngs-review';
import usageEventRoutes from '../../src/routes/usage-events';
import type { Env } from '../../src/index';
import { type AuthPrincipal } from '../../src/middleware/auth';

class Statement {
  private params: unknown[] = [];

  constructor(private readonly db: AdminDb, private readonly sql: string) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>() {
    return this.db.all<T>(this.sql, this.params);
  }

  async run() {
    return this.db.run(this.sql, this.params);
  }
}

class AdminDb {
  endpointWrites: string[] = [];

  constructor(private readonly isAdmin: boolean) {}

  prepare(sql: string) {
    return new Statement(this, sql);
  }

  async batch(statements: Statement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async first<T>(sql: string, _params: unknown[]) {
    if (sql.includes("WHERE id = ? AND role = 'admin'")) {
      return (this.isAdmin ? { allowed: 1 } : null) as T | null;
    }
    return null as T | null;
  }

  async all<T>(_sql: string, _params: unknown[]) {
    return { success: true, results: [] as T[] };
  }

  async run(sql: string, _params: unknown[]) {
    if (
      /INSERT INTO (api_keys|api_usage_events|artwork_usage_events|upload_jobs)/.test(
        sql
      )
    ) {
      this.endpointWrites.push(sql);
    }
    return { success: true, meta: { changes: 1 } };
  }
}

const envFor = (db: AdminDb): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    VECTORIZE: {} as Vectorize,
    CACHE: {} as KVNamespace,
    AI: {} as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    FRAME_REMOVAL_QUEUE: {} as Queue,
    BUCKET: {} as R2Bucket,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
  }) as Env;

const appFor = (route: Hono<any>, prefix: string) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route(prefix, route);
  return app;
};

const viewerHeaders = { 'X-User-Id': 'viewer' };
const adminHeaders = { 'X-User-Id': 'admin' };

describe('administrative route authorization', () => {
  it('rejects an internal MCP principal at the global API-key gate', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', async (c, next) => {
      c.set(
        'auth' as never,
        {
          kind: 'user',
          userId: 'mcp-user',
          scopes: ['mcp:read'],
          internalMcp: true,
        } satisfies AuthPrincipal as never
      );
      await next();
    });
    app.route('/me', apiKeyRoutes);

    const res = await app.request('/me/api-keys', {}, envFor(new AdminDb(false)));

    expect(res.status).toBe(403);
  });

  it.each([
    ['API-key list', apiKeyRoutes, '/me', '/api-keys'],
    ['impact analytics', impactRoutes, '/impact', '/artworks'],
    ['NGS review', ngsReviewRoutes, '/ngs-review', '/summary'],
  ])('%s rejects a viewer before its handler', async (_name, route, prefix, path) => {
    const db = new AdminDb(false);
    const res = await appFor(route as Hono<any>, prefix).request(`${prefix}${path}`, {
      headers: viewerHeaders,
    }, envFor(db));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(db.endpointWrites).toEqual([]);
  });

  it.each([
    ['lists', 'GET', '/api-keys', undefined],
    ['mints', 'POST', '/api-keys', JSON.stringify({})],
    ['revokes', 'DELETE', '/api-keys/key-id', undefined],
  ])('rejects a viewer before it %s an API key', async (_name, method, path, body) => {
    const db = new AdminDb(false);
    const res = await appFor(apiKeyRoutes, '/me').request(`/me${path}`, {
      method,
      headers: {
        ...viewerHeaders,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    }, envFor(db));

    expect(res.status).toBe(403);
    expect(db.endpointWrites).toEqual([]);
  });

  it('rejects the public-search principal at the global API-key gate', async () => {
    const res = await appFor(apiKeyRoutes, '/me').request('/me/api-keys', {
      headers: { 'X-User-Id': 'public-search-web' },
    }, envFor(new AdminDb(false)));

    expect(res.status).toBe(403);
  });

  it('rejects metadata validation before reading an upload', async () => {
    const db = new AdminDb(false);
    const form = new FormData();
    form.set('csv', new File(['title\nwork'], 'artworks.csv', { type: 'text/csv' }));

    const res = await appFor(metadataRoutes, '/metadata').request('/metadata/validate', {
      method: 'POST',
      headers: viewerHeaders,
      body: form,
    }, envFor(db));

    expect(res.status).toBe(403);
    expect(db.endpointWrites).toEqual([]);
  });

  it('rejects direct usage-event writes before recording telemetry', async () => {
    const db = new AdminDb(false);
    const res = await appFor(usageEventRoutes, '/usage-events').request('/usage-events', {
      method: 'POST',
      headers: { ...viewerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'browse' }),
    }, envFor(db));

    expect(res.status).toBe(403);
    expect(db.endpointWrites).toEqual([]);
  });

  it.each([
    ['API-key list', apiKeyRoutes, '/me', '/api-keys'],
    ['impact analytics', impactRoutes, '/impact', '/artworks'],
    ['NGS review', ngsReviewRoutes, '/ngs-review', '/summary'],
  ])('%s permits a global admin', async (_name, route, prefix, path) => {
    const res = await appFor(route as Hono<any>, prefix).request(`${prefix}${path}`, {
      headers: adminHeaders,
    }, envFor(new AdminDb(true)));

    expect(res.status).toBe(200);
  });
});
