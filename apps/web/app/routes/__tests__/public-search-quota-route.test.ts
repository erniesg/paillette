import { afterEach, describe, expect, it, vi } from 'vitest';

import { loader } from '../api.public-search.$orgId.quota';

describe('public NGA search quota proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('proxies the authoritative NGA quota with no-store and quota headers', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { success: true, data: { limit: 1000, used: 1, remaining: 999 } },
        {
          headers: {
            'X-NGA-Search-Limit': '1000',
            'X-NGA-Search-Used': '1',
            'X-NGA-Search-Remaining': '999',
          },
        }
      )
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await loader({
      context: {},
      params: { orgId: 'nga' },
      request: new Request('https://paillette.test/api/public-search/nga/quota'),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    expect(fetcher).toHaveBeenCalledWith(
      'https://paillette-api-stg.berlayar.ai/api/v1/orgs/nga/search/quota',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it.each([
    [
      'a fractional quota body',
      { success: true, data: { limit: 1000, used: 0.5, remaining: 999.5 } },
      {
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '1',
        'X-NGA-Search-Remaining': '999',
      },
    ],
    [
      'an inconsistent quota body',
      { success: true, data: { limit: 1000, used: 1, remaining: 1000 } },
      {
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '1',
        'X-NGA-Search-Remaining': '999',
      },
    ],
    [
      'a header/body mismatch',
      { success: true, data: { limit: 1000, used: 1, remaining: 999 } },
      {
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '2',
        'X-NGA-Search-Remaining': '998',
      },
    ],
    [
      'an incomplete quota header set',
      { success: true, data: { limit: 1000, used: 1, remaining: 999 } },
      {
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '1',
      },
    ],
  ])(
    'returns a safe 502 instead of relaying %s',
    async (_kind, payload, headers) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(async () =>
          Response.json(payload, { status: 200, headers })
        )
      );

      const response = await loader({
        context: {},
        params: { orgId: 'nga' },
        request: new Request('https://paillette.test/api/public-search/nga/quota'),
      } as any);

      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-NGA-Search-Limit')).toBeNull();
      expect(response.headers.get('X-NGA-Search-Used')).toBeNull();
      expect(response.headers.get('X-NGA-Search-Remaining')).toBeNull();
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: {
          code: 'PUBLIC_SEARCH_QUOTA_UPSTREAM_ERROR',
          message: 'Search quota is temporarily unavailable.',
        },
      });
    }
  );

  it('returns a safe 502 without quota headers for a non-JSON success response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        new Response('INTERNAL_UPSTREAM_SENTINEL', {
          status: 200,
          headers: {
            'X-NGA-Search-Limit': '1000',
            'X-NGA-Search-Used': '1',
          },
        })
      )
    );

    const response = await loader({
      context: {},
      params: { orgId: 'nga' },
      request: new Request('https://paillette.test/api/public-search/nga/quota'),
    } as any);

    expect(response.status).toBe(502);
    expect(response.headers.get('X-NGA-Search-Limit')).toBeNull();
    await expect(response.text()).resolves.not.toContain(
      'INTERNAL_UPSTREAM_SENTINEL'
    );
  });

  it('only retains coherent quota headers and Retry-After on upstream errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        Response.json(
          { success: false, error: { code: 'RATE_LIMITED', message: 'Wait.' } },
          {
            status: 429,
            headers: {
              'Retry-After': '17',
              'Set-Cookie': 'internal=sentinel',
              'X-NGA-Search-Limit': '1000',
              'X-NGA-Search-Used': '1',
              'X-NGA-Search-Remaining': '999',
            },
          }
        )
      )
    );

    const response = await loader({
      context: {},
      params: { orgId: 'nga' },
      request: new Request('https://paillette.test/api/public-search/nga/quota'),
    } as any);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('rejects non-NGA scopes before using the public service key', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await loader({
      context: {},
      params: { orgId: 'ngs' },
      request: new Request('https://paillette.test/api/public-search/ngs/quota'),
    } as any);

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
