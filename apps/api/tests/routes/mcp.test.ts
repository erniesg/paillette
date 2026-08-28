import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import mcpRoutes from '../../src/routes/mcp';
import type { Env } from '../../src/index';
import {
  canMutateOrg,
  requireAuthOrApiKey,
  type AuthPrincipal,
} from '../../src/middleware/auth';

const makeEnv = (): Env =>
  ({
    DB: {
      prepare: () => {
        const statement = {
          bind: () => statement,
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
        return statement;
      },
    } as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    VECTORIZE: {} as Vectorize,
    CACHE: {} as KVNamespace,
    AI: {} as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    FRAME_REMOVAL_QUEUE: {} as Queue,
    BUCKET: {} as R2Bucket,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    API_KEY_PEPPER: 'test-only-mcp-capability-secret',
    MCP_INTERNAL_CAPABILITY_SECRET: 'test-only-mcp-capability-secret',
  }) as Env;

const quota = { limit: 1000, used: 1000, remaining: 0 };
const ORG_ID = '11111111-1111-4111-8111-111111111111';

const principal = (
  userId: string,
  scopes: string[],
  kind: AuthPrincipal['kind'] = 'user'
): AuthPrincipal => ({ kind, userId, scopes });

const makeAuthorizedApp = (auth: AuthPrincipal, db: D1Database) => {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('auth', auth);
    await next();
  });
  app.route('/api/v1/mcp', mcpRoutes);
  return { app, env: { ...makeEnv(), DB: db } };
};

const authorizationDb = (allowed: {
  global?: boolean;
  orgs?: string[];
}) =>
  ({
    prepare: (sql: string) => {
      const statement = {
        bind: (...params: unknown[]) => {
          (statement as any).params = params;
          return statement;
        },
        first: async () => {
          const params = (statement as any).params as unknown[] | undefined;
          if (sql.includes('lower(slug)')) {
            return params?.[0] === 'test-org' ? { id: ORG_ID } : null;
          }
          if (sql.includes('FROM users') && sql.includes("role = 'admin'")) {
            if (allowed.global) return { allowed: 1 };
            if (allowed.orgs?.includes(params?.[1] as string)) return { allowed: 1 };
          }
          return null;
        },
      };
      return statement;
    },
  }) as unknown as D1Database;

const mcpRequest = (method: 'tools/list' | 'tools/call', params?: unknown) =>
  new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const callTool = (
  name: 'search_artworks' | 'colour_search' | 'lookup_artwork',
  collection = 'ngs'
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/mcp', mcpRoutes);
  return app.request(
    '/api/v1/mcp',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'mcp-user',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name,
          arguments:
            name === 'search_artworks'
              ? { query: 'mangrove shore', collection }
              : name === 'colour_search'
                ? { colors: ['#112233'], collection }
                : { artworkId: 'nga-1', collection },
        },
      }),
    },
    makeEnv()
  );
};

describe('MCP downstream REST errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails closed with a stable 503 when its internal capability secret is missing', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api/v1/mcp', mcpRoutes);

    const response = await app.request(
      '/api/v1/mcp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'mcp-user',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: {
            name: 'search_artworks',
            arguments: { query: 'mangrove shore', collection: 'nga' },
          },
        }),
      },
      {
        ...makeEnv(),
        MCP_INTERNAL_CAPABILITY_SECRET: undefined,
      }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        data: {
          httpStatus: 503,
          code: 'MCP_INTERNAL_CAPABILITY_UNAVAILABLE',
        },
      },
    });
  });

  it.each(['search_artworks', 'colour_search'] as const)(
    'preserves valid NGA quota and retry metadata from a non-JSON %s failure without exposing the upstream body',
    async (name) => {
      const downstream = vi.fn(
        async () =>
          new Response('gateway diagnostic that must remain private', {
            status: 503,
            headers: {
              'Content-Type': 'text/plain',
              'X-NGA-Search-Limit': '1000',
              'X-NGA-Search-Used': '17',
              'X-NGA-Search-Remaining': '983',
              'Retry-After': '30',
              'X-Upstream-Secret': 'must-not-be-forwarded',
            },
          })
      );
      vi.stubGlobal('fetch', downstream);

      const response = await callTool(name, 'open');
      const payload = (await response.json()) as any;

      expect(response.status).toBe(503);
      expect(downstream).toHaveBeenCalledOnce();
      expect(response.headers.get('X-NGA-Search-Limit')).toBe('1000');
      expect(response.headers.get('X-NGA-Search-Used')).toBe('17');
      expect(response.headers.get('X-NGA-Search-Remaining')).toBe('983');
      expect(response.headers.get('Retry-After')).toBe('30');
      expect(response.headers.get('X-Upstream-Secret')).toBeNull();
      expect(payload).toMatchObject({
        error: {
          code: -32000,
          message: 'API call failed: 503',
          data: {
            httpStatus: 503,
            code: 'API_CALL_FAILED',
            quota: { limit: 1000, used: 17, remaining: 983 },
            retryAfterSeconds: 30,
          },
        },
      });
      expect(JSON.stringify(payload)).not.toContain('gateway diagnostic');
      expect(JSON.stringify(payload)).not.toContain('must-not-be-forwarded');
    }
  );

  it.each([
    {
      label: 'malformed',
      headers: {
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': 'invalid',
        'X-NGA-Search-Remaining': '983',
        'Retry-After': '-1',
      },
    },
    {
      label: 'incomplete',
      headers: {
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '17',
        'Retry-After': 'not-a-delay',
      },
    },
  ])(
    'drops $label quota and retry metadata from a non-JSON failure',
    async ({ headers }) => {
      const downstream = vi.fn(
        async () =>
          new Response('bad gateway', {
            status: 502,
            headers: {
              'Content-Type': 'text/plain',
              ...headers,
            },
          })
      );
      vi.stubGlobal('fetch', downstream);

      const response = await callTool('search_artworks', 'open');
      const payload = (await response.json()) as any;

      expect(response.status).toBe(502);
      expect(downstream).toHaveBeenCalledOnce();
      expect(response.headers.get('X-NGA-Search-Limit')).toBeNull();
      expect(response.headers.get('X-NGA-Search-Used')).toBeNull();
      expect(response.headers.get('X-NGA-Search-Remaining')).toBeNull();
      expect(response.headers.get('Retry-After')).toBeNull();
      expect(payload.error).toMatchObject({
        code: -32000,
        data: { httpStatus: 502, code: 'API_CALL_FAILED' },
      });
      expect(payload.error.data).not.toHaveProperty('quota');
      expect(payload.error.data).not.toHaveProperty('retryAfterSeconds');
    }
  );

  it.each(['search_artworks', 'colour_search'] as const)(
    'preserves an exhausted NGA quota from %s without repeating the request',
    async (name) => {
      let debits = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        debits += 1;
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBeNull();
        expect(headers.get('X-API-Key')).toBeNull();
        expect(headers.get('X-Paillette-MCP-Internal-Capability')).toMatch(
          /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
              message: 'NGA public search quota has been exhausted',
              details: { quota },
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-NGA-Search-Limit': '1000',
              'X-NGA-Search-Used': '1000',
              'X-NGA-Search-Remaining': '0',
            },
          }
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const response = await callTool(name);
      const payload = (await response.json()) as any;

      expect(response.status).toBe(429);
      expect(debits).toBe(1);
      expect(response.headers.get('X-NGA-Search-Limit')).toBe('1000');
      expect(response.headers.get('X-NGA-Search-Remaining')).toBe('0');
      expect(payload.error).toMatchObject({
        code: -32000,
        data: {
          httpStatus: 429,
          code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
          details: { quota },
          quota,
        },
      });
    }
  );
});

describe('MCP NGA aliases', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['search_artworks', 'colour_search'] as const)(
    'forwards the open alias for %s exactly once to the NGA REST boundary',
    async (name) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain(
          `/orgs/open/search/${name === 'search_artworks' ? 'text' : 'color'}`
        );
        return new Response(JSON.stringify({ success: true, data: {} }), {
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const response = await callTool(name, 'open');

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );
});

describe('MCP role and key authorization', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('only exposes read tools to a fresh viewer and their personal API key', async () => {
    for (const auth of [
      principal('viewer', ['mcp:read']),
      principal('viewer', [], 'api_key'),
    ]) {
      const { app, env } = makeAuthorizedApp(auth, authorizationDb({}));
      const listed = await app.fetch(mcpRequest('tools/list'), env);
      const names = ((await listed.json()) as any).result.tools.map(
        (tool: { name: string }) => tool.name
      );
      expect(names).toContain('search_artworks');
      expect(names).toContain('lookup_artwork');
      expect(names).not.toContain('upsert_artwork_record');
      expect(names).not.toContain('translate_text');

      const downstream = vi.fn();
      vi.stubGlobal('fetch', downstream);
      const write = await app.fetch(
        mcpRequest('tools/call', {
          name: 'upsert_artwork_record',
          arguments: { collection: 'test-org', title: 'Denied' },
        }),
        env
      );
      expect(write.status).toBe(403);
      expect((await write.json()) as any).toMatchObject({
        error: { code: -32001 },
      });
      expect(downstream).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('permits a scoped curator only for an owned or member org', async () => {
    const db = authorizationDb({ orgs: [ORG_ID] });
    await expect(
      canMutateOrg(db, principal('curator', ['mcp:write']), ORG_ID)
    ).resolves.toBe(true);
    const { app, env } = makeAuthorizedApp(
      principal('curator', ['mcp:write']),
      db
    );
    const downstream = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { written: true } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', downstream);

    const denied = await app.fetch(
      mcpRequest('tools/call', {
        name: 'upsert_collection',
        arguments: { collection: 'other-org', name: 'Denied' },
      }),
      env
    );
    expect(denied.status).toBe(403);
    expect(downstream).not.toHaveBeenCalled();

    const allowed = await app.fetch(
      mcpRequest('tools/call', {
        name: 'upsert_collection',
        arguments: { collection: 'test-org', name: 'Allowed' },
      }),
      env
    );
    expect(allowed.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('permits globally scoped MCP writes only to an administrator', async () => {
    const { app, env } = makeAuthorizedApp(
      principal('admin', ['mcp:write']),
      authorizationDb({ global: true })
    );
    const downstream = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { translated: true } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', downstream);

    const response = await app.fetch(
      mcpRequest('tools/call', {
        name: 'translate_text',
        arguments: { text: 'Hello', targetLang: 'zh' },
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });
});

describe('MCP internal REST handoff', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['search_artworks', 'colour_search', 'lookup_artwork'] as const)(
    'executes %s through exactly one authenticated internal REST request',
    async (name) => {
      const downstream = new Hono<{ Bindings: Env }>();
      let debits = 0;
      downstream.use('*', requireAuthOrApiKey as any);
      downstream.all('/api/v1/*', async (c) => {
        debits += 1;
        return c.json({
          success: true,
          data: { source: 'internal-rest', userId: c.get('auth').userId },
        });
      });
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
          downstream.request(input, init, makeEnv())
        )
      );

      const response = await callTool(name);
      expect(response.status).toBe(200);
      expect(debits).toBe(1);
      await expect(response.json()).resolves.toMatchObject({
        result: {
          structuredContent: { source: 'internal-rest', userId: 'mcp-user' },
        },
      });
    }
  );
});
