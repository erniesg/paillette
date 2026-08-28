import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requireAuthOrApiKey,
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
    const response = await request(principal('approved-user'), 'allowlist', [
      'approved-user',
    ]);
    expect(response.status).toBe(200);
  });

  it('allows every authenticated principal in authenticated mode', async () => {
    const response = await request(principal('any-user'), 'authenticated');
    expect(response.status).toBe(200);
  });
});

describe('API key and test-principal boundaries', () => {
  const request = (
    path: string,
    headers: HeadersInit,
    env: Record<string, string>
  ) => {
    const app = new Hono<any>();
    app.use('*', requireAuthOrApiKey as any);
    app.get('*', (c) => c.json({ success: true }));
    return app.request(path, { headers }, env as any);
  };

  it('does not trust X-User headers outside the literal test runtime', async () => {
    const response = await request(
      '/api/v1/orgs/ngs/search/text',
      { 'X-User-Id': 'forged-user' },
      { ENVIRONMENT: 'staging' }
    );
    expect(response.status).toBe(401);
  });

  it('confines the public search key to public search endpoints', async () => {
    const env = {
      ENVIRONMENT: 'staging',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-key',
    };
    const publicHeaders = { 'X-API-Key': 'public-key' };

    await expect(
      request('/api/v1/assets/asset-1/content', publicHeaders, env)
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      request('/api/v1/orgs/ngs/search/text', publicHeaders, env)
    ).resolves.toMatchObject({ status: 200 });
  });
});

describe('MCP OAuth verifier dispatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts an exact MCP OAuth token only on the MCP route', async () => {
    const issuer = 'https://oauth.example.test';
    const audience = 'https://api.example.test';
    const jwksUri = `${issuer}/jwks`;
    const pair = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = (await exportJWK(pair.publicKey)) as JWK;
    publicJwk.kid = 'mcp-test-key';
    publicJwk.alg = 'RS256';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(jwksUri);
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    const token = await new SignJWT({ scope: 'mcp:read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'mcp-test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('oauth-user')
      .setExpirationTime('5m')
      .sign(pair.privateKey);
    const app = new Hono<any>();
    app.use('*', requireAuthOrApiKey as any);
    app.get('*', (c) => c.json({ scopes: c.get('auth').scopes }));
    const env = {
      ENVIRONMENT: 'staging',
      SEARCH_ACCESS_MODE: 'authenticated',
      LOGTO_ISSUER: issuer,
      LOGTO_JWKS_URI: jwksUri,
      LOGTO_API_RESOURCE: audience,
      DB: {
        prepare: () => {
          const statement = {
            bind: () => statement,
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
          return statement;
        },
      },
    };
    const headers = { Authorization: `Bearer ${token}` };

    const mcp = await app.request('/api/v1/mcp', { headers }, env as any);
    expect(mcp.status).toBe(200);
    await expect(mcp.json()).resolves.toEqual({ scopes: ['mcp:read'] });

    const search = await app.request(
      '/api/v1/orgs/ngs/search/text',
      { headers },
      env as any
    );
    expect(search.status).toBe(401);
  });
});
