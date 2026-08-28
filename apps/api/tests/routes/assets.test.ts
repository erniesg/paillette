import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../src/index';
import assets from '../../src/routes/assets';

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
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

const asset = (orgSlug: string) => ({
  id: 'asset-1',
  storage_provider: 'external',
  object_key: 'source',
  url: 'https://images.example.test/artwork.jpg',
  mime_type: 'image/jpeg',
  org_id: 'org-1',
  org_slug: orgSlug,
});

describe('asset authorization', () => {
  it('keeps NGA open-access assets public', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      undefined,
      { DB: makeDb(asset('open-access-art')) } as unknown as Env
    );

    expect(response.status).toBe(302);
  });

  it('hides a private asset from an anonymous request', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      undefined,
      { DB: makeDb(asset('national-gallery-singapore')) } as unknown as Env
    );

    expect(response.status).toBe(404);
  });

  it('returns private no-store headers to an org member', async () => {
    const response = await makeApp().request(
      '/api/v1/assets/asset-1/content',
      { headers: { 'X-User-Id': 'member-1' } },
      {
        DB: makeDb(asset('national-gallery-singapore'), true),
        ENVIRONMENT: 'test',
      } as unknown as Env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
