import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  requireApprovedDataAccess,
  type AuthPrincipal,
} from '../../src/middleware/auth';

const makeDb = (approvedUserIds: string[]) => ({
  prepare: vi.fn((sql: string) => ({
    bind: vi.fn((userId: string) => ({
      first: vi.fn(async () =>
        sql.includes('search_access_approvals') &&
        approvedUserIds.includes(userId)
          ? { user_id: userId }
          : null
      ),
    })),
  })),
});

const request = async (
  principal: AuthPrincipal | undefined,
  mode: string | undefined,
  approvedUserIds: string[] = []
) => {
  const app = new Hono<any>();
  if (principal) {
    app.use('*', async (c, next) => {
      c.set('auth', principal);
      await next();
    });
  }
  app.use('*', requireApprovedDataAccess as any);
  app.get('/', (c) => c.json({ success: true }));

  return app.request('/', undefined, {
    DB: makeDb(approvedUserIds),
    SEARCH_ACCESS_MODE: mode,
  });
};

const principal = (userId: string): AuthPrincipal => ({
  kind: 'user',
  userId,
  scopes: [],
});

describe('requireApprovedDataAccess', () => {
  it('returns a typed 401 when authentication is missing', async () => {
    const response = await request(undefined, 'allowlist');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('fails closed to allowlist when mode is missing', async () => {
    const response = await request(principal('pending-user'), undefined);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'ACCESS_PENDING' },
    });
  });

  it('allows an actively approved user in allowlist mode', async () => {
    const response = await request(
      principal('approved-user'),
      'allowlist',
      ['approved-user']
    );
    expect(response.status).toBe(200);
  });

  it('allows every authenticated principal in authenticated mode', async () => {
    const response = await request(principal('any-user'), 'authenticated');
    expect(response.status).toBe(200);
  });
});
