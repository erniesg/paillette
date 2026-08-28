import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../../src/index';
import artworkRoutes from '../../src/routes/artworks';
import collectionRoutes from '../../src/routes/collections';
import galleryRoutes from '../../src/routes/galleries';
import type { AuthPrincipal } from '../../src/middleware/auth';

const NGA_ORG_ID = 'open-access-art';
const NGA_CANONICAL_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';
const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';

class Statement {
  private parameters: unknown[] = [];

  constructor(
    private readonly db: Db,
    private readonly sql: string
  ) {}

  bind(...parameters: unknown[]) {
    this.parameters = parameters;
    return this;
  }

  async first<T>() {
    if (this.sql.includes('FROM users') || this.sql.includes('FROM org_users')) {
      return null as T | null;
    }
    if (this.sql.includes('FROM orgs')) {
      return { id: this.parameters[0] } as T;
    }
    if (this.sql.includes('FROM artworks')) {
      return { id: this.parameters[0], org_id: this.parameters[1] } as T;
    }
    if (this.sql.includes('FROM collections')) {
      return { id: this.parameters[0], org_id: this.parameters[1] } as T;
    }
    return null as T | null;
  }

  async run() {
    this.db.writeCount += 1;
    return { success: true, meta: { changes: 1 } };
  }

  async all<T>() {
    return { success: true, results: [] as T[] };
  }
}

class Db {
  writeCount = 0;

  prepare(sql: string) {
    return new Statement(this, sql);
  }
}

const viewer: AuthPrincipal = { kind: 'user', userId: 'viewer', scopes: [] };
const publicSearch: AuthPrincipal = {
  kind: 'api_key',
  userId: 'public-search',
  scopes: ['public_search'],
};
const internalMcp: AuthPrincipal = {
  kind: 'user',
  userId: 'mcp-user',
  scopes: ['mcp:write'],
  internalMcp: true,
};

const route = (
  principal: AuthPrincipal,
  path: '/orgs/:orgId' | '/galleries/:galleryId'
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('auth', principal);
    await next();
  });
  app.route(`/api/v1${path}/artworks`, artworkRoutes);
  app.route(`/api/v1${path}/collections`, collectionRoutes);
  app.route('/api/v1/orgs', galleryRoutes);
  app.route('/api/v1/galleries', galleryRoutes);
  return app;
};

const request = async (
  principal: AuthPrincipal,
  path: string,
  init: RequestInit = {}
) => {
  const db = new Db();
  const app = route(principal, '/orgs/:orgId');
  const response = await app.request(path, init, { DB: db } as Env);
  return { db, response };
};

describe.each([
  ['viewer', viewer],
  ['public search key', publicSearch],
  ['internal MCP', internalMcp],
] as const)('%s mutation access', (_name, principal) => {
  it('rejects artwork upload before object storage writes', async () => {
    const db = new Db();
    const app = route(principal, '/orgs/:orgId');
    const form = new FormData();
    form.set('metadata', JSON.stringify({ org_id: NGA_CANONICAL_ORG_ID }));
    form.set('image', new Blob(['not an image'], { type: 'image/png' }), 'art.png');

    const response = await app.request(
      `/api/v1/orgs/${NGA_ORG_ID}/artworks/upload`,
      { method: 'POST', body: form },
      { DB: db } as Env
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(db.writeCount).toBe(0);
  });

  it.each([
    ['POST', `/api/v1/orgs/${NGA_ORG_ID}/artworks/upsert`, { title: 'Nope' }],
    ['PATCH', `/api/v1/orgs/${NGA_ORG_ID}/artworks/artwork-1`, { title: 'Nope' }],
    ['DELETE', `/api/v1/orgs/${NGA_ORG_ID}/artworks/artwork-1`, undefined],
    ['POST', `/api/v1/orgs/${NGS_ORG_ID}/collections`, { name: 'Nope' }],
    ['POST', `/api/v1/orgs/${NGS_ORG_ID}/collections/upsert`, { name: 'Nope' }],
    ['PATCH', `/api/v1/orgs/${NGS_ORG_ID}/collections/collection-1`, { name: 'Nope' }],
    ['DELETE', `/api/v1/orgs/${NGS_ORG_ID}/collections/collection-1`, undefined],
    ['POST', `/api/v1/orgs/${NGS_ORG_ID}/collections/collection-1/artworks`, { artwork_id: 'artwork-1' }],
    ['DELETE', `/api/v1/orgs/${NGS_ORG_ID}/collections/collection-1/artworks/artwork-1`, undefined],
    ['POST', '/api/v1/orgs', { name: 'Nope' }],
    ['PATCH', `/api/v1/galleries/${NGA_ORG_ID}`, { name: 'Nope' }],
    ['DELETE', `/api/v1/galleries/${NGS_ORG_ID}`, undefined],
  ] as const)('rejects %s %s before writes', async (method, path, body) => {
    const { db, response } = await request(principal, path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(db.writeCount).toBe(0);
  });
});

it('applies the same collection write boundary to the galleries alias', async () => {
  const db = new Db();
  const app = route(viewer, '/galleries/:galleryId');
  const response = await app.request(
    `/api/v1/galleries/${NGA_ORG_ID}/collections`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    },
    { DB: db } as Env
  );

  expect(response.status).toBe(403);
  expect(db.writeCount).toBe(0);
});
