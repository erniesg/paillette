import { afterEach, describe, expect, it, vi } from 'vitest';

import { loader } from '../api.public-usage.$orgId';

const BUDGETS = {
  labels: { limit: 60, used: 60, remaining: 0, nextAt: 1_790_000_000_000 },
  agentCalls: { limit: 600, used: 12, remaining: 588, nextAt: null },
  search: { limit: 1000, used: 40, remaining: 960, nextAt: null },
  dailySite: { limit: 5000, used: 310, remaining: 4690, nextAt: null },
};

describe('GET /api/public-usage/:orgId — the four budgets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('proxies the caller’s budgets, keyed on their connecting address, never cached', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ success: true, data: BUDGETS })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await loader({
      context: {},
      params: { orgId: 'nga' },
      request: new Request('https://paillette.test/api/public-usage/nga', {
        headers: { 'CF-Connecting-IP': '203.0.113.9' },
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: BUDGETS });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://paillette-api-stg.berlayar.ai/api/v1/orgs/nga/search/budgets');
    expect(new Headers(init?.headers).get('CF-Connecting-IP')).toBe('203.0.113.9');
  });

  it('answers only for a public collection', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await loader({
      context: {},
      params: { orgId: 'somebody-elses-org' },
      request: new Request('https://paillette.test/api/public-usage/somebody-elses-org'),
    } as any);
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('says the budgets are unavailable rather than inventing them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      })
    );
    const response = await loader({
      context: {},
      params: { orgId: 'nga' },
      request: new Request('https://paillette.test/api/public-usage/nga'),
    } as any);
    expect(response.status).toBe(502);
    expect(((await response.json()) as any).error.code).toBe('BUDGETS_UNAVAILABLE');
  });
});
