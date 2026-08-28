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
