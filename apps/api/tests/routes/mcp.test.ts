import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import mcpRoutes from '../../src/routes/mcp';
import type { Env } from '../../src/index';

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
  }) as Env;

const quota = { limit: 1000, used: 1000, remaining: 0 };

const callTool = (name: 'search_artworks' | 'colour_search') => {
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
              ? { query: 'mangrove shore', collection: 'ngs' }
              : { colors: ['#112233'], collection: 'ngs' },
        },
      }),
    },
    makeEnv()
  );
};

describe('MCP downstream REST errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['search_artworks', 'colour_search'] as const)(
    'preserves an exhausted NGS quota from %s without repeating the request',
    async (name) => {
      let debits = 0;
      const fetchMock = vi.fn(async () => {
        debits += 1;
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
              message: 'NGS public search quota has been exhausted',
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
