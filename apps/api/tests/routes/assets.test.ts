import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../src/index';
import type { AuthPrincipal } from '../../src/middleware/auth';
import assets from '../../src/routes/assets';
import { OPEN_ACCESS_ORG_ID } from '../../src/utils/orgs';

const makeApp = (principal?: AuthPrincipal) => {
  const app = new Hono<any>();
  if (principal) {
    app.use('*', async (c, next) => {
      c.set('auth', principal);
      await next();
    });
  }
  app.route('/api/v1/assets', assets as any);
  return app;
};

const makeDb = (asset: Record<string, unknown>, member = false) => ({
  prepare(sql: string) {
    const statement = {
      bind: () => statement,
      run: async () => ({ success: true, meta: { changes: 1 } }),
      first: async () => {
        if (sql.includes('FROM assets a')) return asset;
        if (sql.includes('FROM users')) return member ? { allowed: 1 } : null;
        return null;
      },
    };
    return statement;
  },
});

const asset = (
  orgId: string,
  orgSlug: string | null,
  artworkProvider: string | null = 'nga'
) => ({
  id: 'asset-1',
  storage_provider: 'external',
  object_key: 'source',
  url: 'https://images.example.test/artwork.jpg',
  mime_type: 'image/jpeg',
  org_id: orgId,
  org_slug: orgSlug,
  artwork_provider: artworkProvider,
});

const viewer: AuthPrincipal = {
  kind: 'user',
  userId: 'viewer-1',
  scopes: [],
  searchAccess: {
    granted: true,
    internalUserId: 'viewer-1',
    reason: 'authenticated',
  },
};
const storedAsset = (orgSlug = 'national-gallery-singapore') => ({
  ...asset('org-1', orgSlug),
  storage_provider: 'r2',
  object_key: 'ngs/thumb.jpg',
  url: null,
});
const storedObject = (etag = '"image-v1"') => ({
  body: new Uint8Array([1, 2, 3]),
  httpEtag: etag,
  writeHttpMetadata(headers: Headers) {
    headers.set('Content-Type', 'image/jpeg');
  },
});

describe('private NGS image byte reuse', () => {
  it('stores bytes privately but requires revalidation on every reuse', async () => {
    const get = vi.fn().mockResolvedValue(storedObject());
    const response = await makeApp(viewer).request(
      '/api/v1/assets/asset-1/content',
      {
        headers: { Authorization: 'Bearer approved' },
      },
      { DB: makeDb(storedAsset()), IMAGES: { get } } as unknown as Env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-cache, must-revalidate'
    );
    expect(response.headers.get('Vary')).toBe('Authorization');
    expect(response.headers.get('ETag')).toBe('"image-v1"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it('authorizes before returning 304 without downloading stored bytes again', async () => {
    const head = vi.fn().mockResolvedValue(storedObject());
    const get = vi.fn();
    const response = await makeApp(viewer).request(
      '/api/v1/assets/asset-1/content',
      {
        headers: {
          Authorization: 'Bearer approved',
          'If-None-Match': 'W/"image-v1", "other"',
        },
      },
      { DB: makeDb(storedAsset()), IMAGES: { head, get } } as unknown as Env
    );
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-cache, must-revalidate'
    );
    expect(head).toHaveBeenCalledWith('ngs/thumb.jpg');
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['anonymous', 'revoked', 'another-org'] as const)(
    'never serves bytes or 304 to %s even with a matching ETag',
    async (scenario) => {
      const principal =
        scenario === 'anonymous'
          ? undefined
          : scenario === 'revoked'
            ? { kind: 'user' as const, userId: 'viewer-1', scopes: [] }
            : viewer;
      const head = vi.fn().mockResolvedValue(storedObject());
      const get = vi.fn();
      const response = await makeApp(principal).request(
        '/api/v1/assets/asset-1/content',
        {
          headers: {
            ...(scenario === 'anonymous'
              ? {}
              : { Authorization: 'Bearer test' }),
            'If-None-Match': '"image-v1"',
          },
        },
        {
          DB: makeDb(
            storedAsset(
              scenario === 'another-org' ? 'other-private-org' : undefined
            )
          ),
          IMAGES: { head, get },
        } as unknown as Env
      );
      expect(response.status).toBe(404);
      expect(head).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    }
  );

  it('downloads a changed stored thumbnail instead of falsely validating old bytes', async () => {
    const head = vi.fn().mockResolvedValue(storedObject('"image-v2"'));
    const get = vi.fn().mockResolvedValue(storedObject('"image-v2"'));
    const response = await makeApp(viewer).request(
      '/api/v1/assets/asset-1/content',
      {
        headers: {
          Authorization: 'Bearer approved',
          'If-None-Match': '"image-v1"',
        },
      },
      { DB: makeDb(storedAsset()), IMAGES: { head, get } } as unknown as Env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"image-v2"');
    expect(get).toHaveBeenCalledOnce();
  });
});

describe('asset authorization', () => {
  it('keeps canonical NGA assets public after the canonical row is renamed', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      undefined,
      {
        DB: makeDb(asset(OPEN_ACCESS_ORG_ID, 'renamed-national-gallery')),
      } as unknown as Env
    );

    expect(response.status).toBe(302);
  });

  it('does not expose an attacker asset that takes the NGA slug', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      undefined,
      {
        DB: makeDb(asset('attacker-org', 'open-access-art')),
      } as unknown as Env
    );

    expect(response.status).toBe(404);
  });

  it('does not expose a non-NGA provider asset in the canonical NGA organisation', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      undefined,
      {
        DB: makeDb(asset(OPEN_ACCESS_ORG_ID, 'open-access-art', 'artic')),
      } as unknown as Env
    );

    expect(response.status).toBe(404);
  });

  it('hides a private asset from an anonymous request', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      undefined,
      {
        DB: makeDb(asset('org-1', 'national-gallery-singapore')),
      } as unknown as Env
    );

    expect(response.status).toBe(404);
  });

  it('returns private no-store headers to an org member', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      { headers: { 'X-User-Id': 'member-1' } },
      {
        DB: makeDb(asset('org-1', 'national-gallery-singapore'), true),
        ENVIRONMENT: 'test',
      } as unknown as Env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('allows a WorkOS search viewer to read a gated NGS asset', async () => {
    const response = await makeApp({
      kind: 'user',
      userId: 'viewer-1',
      scopes: [],
      searchAccess: {
        granted: true,
        internalUserId: 'viewer-1',
        reason: 'authenticated',
      },
    }).request(
      '/api/v1/assets/asset-1/content',
      { headers: { Authorization: 'Bearer test-token' } },
      {
        DB: makeDb(asset('org-1', 'national-gallery-singapore')),
      } as unknown as Env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not grant a search viewer access to another private org asset', async () => {
    const response = await makeApp({
      kind: 'user',
      userId: 'viewer-1',
      scopes: [],
      searchAccess: {
        granted: true,
        internalUserId: 'viewer-1',
        reason: 'authenticated',
      },
    }).request(
      '/api/v1/assets/asset-1/content',
      { headers: { Authorization: 'Bearer test-token' } },
      { DB: makeDb(asset('org-1', 'another-private-org')) } as unknown as Env
    );

    expect(response.status).toBe(404);
  });
});
