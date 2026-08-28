import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMcpInternalCapability,
  MCP_INTERNAL_CAPABILITY_HEADER,
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
      request('/api/v1/orgs/nga/search/text', publicHeaders, env)
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

describe('MCP internal REST capability', () => {
  const env = {
    ENVIRONMENT: 'staging',
    SEARCH_ACCESS_MODE: 'authenticated',
    API_KEY_PEPPER: 'test-only-mcp-capability-secret',
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

  const restApp = () => {
    const app = new Hono<any>();
    app.use('*', requireAuthOrApiKey as any);
    app.post('/api/v1/orgs/nga/search/text', (c) =>
      c.json({ userId: c.get('auth').userId, scopes: c.get('auth').scopes })
    );
    return app;
  };

  const mcpPrincipal: AuthPrincipal = {
    kind: 'user',
    userId: 'legacy-mcp-user',
    email: 'legacy@example.test',
    scopes: ['mcp:read'],
  };

  it('accepts only a signed, unexpired capability for its exact REST call', async () => {
    const capability = await createMcpInternalCapability(
      env as any,
      mcpPrincipal,
      'POST',
      '/api/v1/orgs/nga/search/text'
    );

    const response = await restApp().request(
      '/api/v1/orgs/nga/search/text',
      {
        method: 'POST',
        headers: { [MCP_INTERNAL_CAPABILITY_HEADER]: capability },
      },
      env as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: 'legacy-mcp-user',
      scopes: ['mcp:read'],
    });
  });

  it('rejects forged, expired, or wrong-method MCP capabilities', async () => {
    const valid = await createMcpInternalCapability(
      env as any,
      mcpPrincipal,
      'POST',
      '/api/v1/orgs/nga/search/text'
    );
    const expired = await createMcpInternalCapability(
      env as any,
      mcpPrincipal,
      'POST',
      '/api/v1/orgs/nga/search/text',
      Date.now() - 1
    );
    const [version, payload, signature] = valid.split('.');
    const forgedSignature = `${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1) ?? ''}`;
    const forged = `${version}.${payload}.${forgedSignature}`;

    for (const [method, capability] of [
      ['POST', forged],
      ['POST', expired],
      ['GET', valid],
    ] as const) {
      const response = await restApp().request(
        '/api/v1/orgs/nga/search/text',
        { method, headers: { [MCP_INTERNAL_CAPABILITY_HEADER]: capability } },
        env as any
      );
      expect(response.status).toBe(401);
    }
  });
});
