import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

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
