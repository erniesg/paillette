import { describe, expect, it, vi } from 'vitest';
import app, { type Env } from '../src/index';

const OPEN_ACCESS_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const env = (): Env =>
  ({
    DB: {
      prepare: vi.fn((sql: string) => {
        const statement = {
          bind: vi.fn(() => statement),
          first: vi.fn(async () => {
            if (sql.includes('FROM orgs')) return { id: OPEN_ACCESS_ORG_ID };
            if (sql.includes('COUNT(*)')) return { count: 0 };
            return null;
          }),
          all: vi.fn(async () => ({ results: [] })),
        };
        return statement;
      }),
    } as unknown as D1Database,
    ENVIRONMENT: 'test',
    API_VERSION: 'test',
  }) as Env;

describe('API cached NGA image boundary', () => {
  const imageEnv = (
    orgId = OPEN_ACCESS_ORG_ID,
    provider: string | null = 'nga',
    found = true
  ) => {
    const bindings = env();
    bindings.DB.prepare = vi.fn(() => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () =>
          found
            ? {
                id: 'cached-thumbnail',
                storage_provider: 'r2',
                object_key: 'nga/cached-thumbnail.jpg',
                mime_type: 'image/jpeg',
                org_id: orgId,
                org_slug: 'open-access-art',
                artwork_provider: provider,
              }
            : null
        ),
      };
      return statement;
    }) as unknown as D1Database['prepare'];
    bindings.IMAGES = {
      get: vi.fn(async () => ({
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        httpEtag: '"cached-image"',
        writeHttpMetadata: (headers: Headers) =>
          headers.set('Content-Type', 'image/jpeg'),
      })),
    } as unknown as R2Bucket;
    return bindings;
  };

  it('serves cached NGA image bytes anonymously through the full API stack', async () => {
    const bindings = imageEnv();
    const response = await app.fetch(
      new Request('http://localhost/api/v1/assets/cached-thumbnail/content'),
      bindings
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(response.headers.get('ETag')).toBe('"cached-image"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    );
    expect(bindings.IMAGES.get).toHaveBeenCalledWith(
      'nga/cached-thumbnail.jpg'
    );
  });

  it.each([
    ['private organisation using the public slug', 'private-org', 'nga', true],
    ['non-NGA provider', OPEN_ACCESS_ORG_ID, 'artic', true],
    ['missing provider', OPEN_ACCESS_ORG_ID, null, true],
    ['missing asset', OPEN_ACCESS_ORG_ID, 'nga', false],
  ])(
    'does not expose a %s anonymously',
    async (_name, orgId, provider, found) => {
      const bindings = imageEnv(orgId, provider, found);
      const response = await app.fetch(
        new Request('http://localhost/api/v1/assets/cached-thumbnail/content'),
        bindings
      );

      expect(response.status).toBe(404);
      expect(bindings.IMAGES.get).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['POST', '/api/v1/assets/cached-thumbnail/content'],
    ['GET', '/api/v1/assets/cached-thumbnail'],
    ['GET', '/api/v1/assets/cached-thumbnail/content/extra'],
  ])('keeps %s %s behind app authentication', async (method, path) => {
    const bindings = imageEnv();
    const response = await app.fetch(
      new Request(`http://localhost${path}`, { method }),
      bindings
    );

    expect(response.status).toBe(401);
    expect(bindings.DB.prepare).not.toHaveBeenCalled();
    expect(bindings.IMAGES.get).not.toHaveBeenCalled();
  });
});

describe('API public NGA artwork boundary', () => {
  it('permits an anonymous exact NGA artwork list', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/v1/orgs/nga/artworks?public_only=true'),
      env()
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ['NGS list', 'GET', '/api/v1/orgs/ngs/artworks'],
    ['private list', 'GET', '/api/v1/orgs/private-org/artworks'],
    ['NGA mutation', 'POST', '/api/v1/orgs/nga/artworks/upsert'],
    ['embedding read', 'GET', '/api/v1/orgs/nga/embeddings'],
  ])('does not make %s public', async (_name, method, path) => {
    const response = await app.fetch(
      new Request(`http://localhost${path}`, { method }),
      env()
    );

    expect(response.status).toBe(401);
  });
});
