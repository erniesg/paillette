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
import { hashApiKey } from '../../src/utils/crypto';

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

  it('keeps personal API-key hashes bound only to API_KEY_PEPPER', async () => {
    const apiKey = 'plt_existing-personal-key';
    const apiKeyPepper = 'existing-api-key-pepper';
    const expectedHash = await hashApiKey(`${apiKeyPepper}.${apiKey}`);
    let receivedHash: string | undefined;
    const app = new Hono<any>();
    app.use('*', requireAuthOrApiKey as any);
    app.get('*', (c) => c.json({ success: true }));

    const response = await app.request(
      '/api/v1/orgs/nga/search/text',
      { headers: { 'X-API-Key': apiKey } },
      {
        ENVIRONMENT: 'staging',
        API_KEY_PEPPER: apiKeyPepper,
        MCP_INTERNAL_CAPABILITY_SECRET: 'independent-mcp-secret',
        DB: {
          prepare: (sql: string) => {
            const statement = {
              bind: (keyHash: string) => {
                if (sql.includes('FROM api_keys')) receivedHash = keyHash;
                return statement;
              },
              first: async () => ({
                id: 'key-1',
                user_id: 'user-1',
                email: 'user@example.test',
                name: 'User',
              }),
              run: async () => ({ success: true, meta: { changes: 1 } }),
            };
            return statement;
          },
        },
      } as any
    );

    expect(response.status).toBe(200);
    expect(receivedHash).toBe(expectedHash);
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
    app.get('*', (c) => c.json({
      scopes: c.get('auth').scopes,
      userId: c.get('auth').userId,
      externalIssuer: c.get('auth').externalIssuer,
    }));
    const users = new Map<string, { email: string; name: string }>([
      ['oauth-user', { email: 'admin@example.test', name: 'Admin' }],
    ]);
    const identities = new Map<string, string>();
    const directUserWrites: string[] = [];
    const env = {
      ENVIRONMENT: 'staging',
      SEARCH_ACCESS_MODE: 'authenticated',
      LOGTO_ISSUER: issuer,
      LOGTO_JWKS_URI: jwksUri,
      LOGTO_API_RESOURCE: audience,
      DB: {
        prepare: (sql: string) => {
          const statement = {
            bind: (...values: string[]) => {
              statement.values = values;
              return statement;
            },
            values: [] as string[],
            first: async () => {
              if (sql.includes('FROM auth_identities')) {
                return identities.get(`${statement.values[0]}|${statement.values[1]}`)
                  ? { user_id: identities.get(`${statement.values[0]}|${statement.values[1]}`) }
                  : null;
              }
              if (sql.includes('FROM users WHERE lower(email)')) return null;
              return null;
            },
            all: async () => ({ success: true, results: [] }),
            run: async () => {
              if (sql.includes('INSERT INTO users')) {
                directUserWrites.push(statement.values[0] ?? '');
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
          return statement;
        },
        batch: async (statements: Array<{ values: string[] }>) => {
          const [user, binding] = statements;
          const userId = user.values[0];
          const issuerValue = binding.values[1];
          const subject = binding.values[2];
          users.set(userId, { email: user.values[1], name: user.values[3] });
          identities.set(`${issuerValue}|${subject}`, userId);
          return [];
        },
      },
    };
    const headers = { Authorization: `Bearer ${token}` };

    const mcp = await app.request('/api/v1/mcp', { headers }, env as any);
    expect(mcp.status).toBe(200);
    const mcpBody = await mcp.json();
    expect(mcpBody).toMatchObject({
      scopes: ['mcp:read'],
      externalIssuer: issuer,
    });
    expect(mcpBody.userId).not.toBe('oauth-user');
    expect(users.has('oauth-user')).toBe(true);
    expect(directUserWrites).not.toContain('oauth-user');

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
    MCP_INTERNAL_CAPABILITY_SECRET: 'test-only-mcp-capability-secret',
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
      c.json({
        kind: c.get('auth').kind,
        userId: c.get('auth').userId,
        apiKeyId: c.get('auth').apiKeyId,
        scopes: c.get('auth').scopes,
      })
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
      kind: 'user',
      userId: 'legacy-mcp-user',
      apiKeyId: undefined,
      scopes: ['mcp:read'],
    });
  });

  it('preserves personal-key provenance for downstream usage attribution', async () => {
    const capability = await createMcpInternalCapability(
      env as any,
      {
        kind: 'api_key',
        userId: 'key-owner',
        apiKeyId: 'key-123',
        scopes: [],
      },
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
      kind: 'api_key',
      userId: 'key-owner',
      apiKeyId: 'key-123',
      scopes: [],
    });
  });

  it('does not provision or overwrite an identity carried by an internal MCP capability', async () => {
    const capability = await createMcpInternalCapability(
      env as any,
      {
        kind: 'user',
        userId: 'existing-mcp-user',
        email: 'existing@example.test',
        name: 'Existing profile',
        scopes: ['mcp:read'],
      },
      'POST',
      '/api/v1/orgs/nga/search/text'
    );
    const noProvisionEnv = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('INSERT INTO users')) {
            throw new Error('internal MCP must not provision users');
          }
          const statement = {
            bind: () => statement,
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
          return statement;
        },
      },
    };

    const response = await restApp().request(
      '/api/v1/orgs/nga/search/text',
      {
        method: 'POST',
        headers: { [MCP_INTERNAL_CAPABILITY_HEADER]: capability },
      },
      noProvisionEnv as any
    );

    expect(response.status).toBe(200);
  });

  it('refuses to mint malformed provenance combinations', async () => {
    await expect(
      createMcpInternalCapability(
        env as any,
        { kind: 'api_key', userId: 'key-owner', scopes: [] },
        'POST',
        '/api/v1/orgs/nga/search/text'
      )
    ).rejects.toThrow('Invalid MCP internal capability principal or target');

    await expect(
      createMcpInternalCapability(
        env as any,
        {
          kind: 'user',
          userId: 'user',
          apiKeyId: 'must-not-be-present',
          scopes: ['mcp:read'],
        },
        'POST',
        '/api/v1/orgs/nga/search/text'
      )
    ).rejects.toThrow('Invalid MCP internal capability principal or target');
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
    const legacyVersion = `v1.${payload}.${signature}`;

    for (const [method, capability] of [
      ['POST', forged],
      ['POST', legacyVersion],
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

  it('fails closed with a stable 503 when the internal capability secret is missing', async () => {
    const response = await restApp().request(
      '/api/v1/orgs/nga/search/text',
      {
        method: 'POST',
        headers: {
          [MCP_INTERNAL_CAPABILITY_HEADER]: 'v2.ZXhh.AA',
        },
      },
      { ...env, MCP_INTERNAL_CAPABILITY_SECRET: undefined } as any
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'MCP_INTERNAL_CAPABILITY_UNAVAILABLE',
        message: 'MCP internal capability is unavailable',
      },
    });
  });
});
