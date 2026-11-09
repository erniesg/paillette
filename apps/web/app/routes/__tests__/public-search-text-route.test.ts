import { afterEach, describe, expect, it, vi } from 'vitest';

import { action } from '../api.public-search.$orgId.text';
import type { ApiResponse, SearchResponse } from '~/types';

const result = (id: string, similarity: number) => ({
  id,
  galleryId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  imageUrl: null,
  similarity,
  title: `Artwork ${id}`,
});

const searchPayload: ApiResponse<SearchResponse> = {
  success: true,
  data: {
    results: [result('strong', 0.95), result('good', 0.8), result('weak', 0.4)],
    count: 3,
    queryTime: 123,
  },
};

const makeRequest = (body: Record<string, unknown>, orgId = 'nga') =>
  new Request(`https://paillette.test/api/public-search/${orgId}/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const countUpstreamSearchCalls = (mockFetch: ReturnType<typeof vi.fn>) =>
  mockFetch.mock.calls.filter(([input]) =>
    String(input).includes('/search/text')
  ).length;

describe('public text search route quota reservation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs current requested/canonical K and wall timings once, preserving safe API diagnostics', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(searchPayload), {
            headers: {
              'Server-Timing':
                'metadata;dur=2.50, private_query;dur=8, total;dur=4.00',
              'X-Paillette-Search-Request-Id':
                '12345678-1234-1234-1234-123456789abc',
              'X-Paillette-Embedding-Count': '2',
              'X-Paillette-Embedding-Cache':
                'image:miss,caption:hit,refinement:skipped',
              'X-Paillette-Search-Path': 'hybrid',
              'X-Paillette-Search-Contract': '32',
            },
          })
      )
    );
    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'private query', topK: 3 }),
    } as any);
    expect(response.headers.get('Server-Timing')).toMatch(
      /^metadata;dur=2.50, total;dur=4.00, public_proxy;dur=\d+\.\d+$/
    );
    expect(response.headers.get('X-Paillette-Embedding-Count')).toBe('2');
    expect(response.headers.get('X-Paillette-Search-Path')).toBe('hybrid');
    const events = log.mock.calls.map(([value]) => JSON.parse(value as string));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'public_search_proxy',
      scope: 'nga',
      requestedTopK: 3,
      normalizedTopK: 3,
      canonicalTopK: 100,
      apiRequestId: '12345678-1234-1234-1234-123456789abc',
      httpStatus: 200,
    });
    expect(events[0].totalMs).toBeGreaterThanOrEqual(events[0].upstreamMs);
    expect(events[0].upstreamMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toMatch(
      /private|queryTime|galleryId|https/
    );
  });

  it('logs failures/early exits once with unknown upstream work and rejects arbitrary diagnostic headers', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await action({
      context: {},
      params: { orgId: 'private-org' },
      request: makeRequest({ query: 'private query' }),
    } as any);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
      scope: 'other',
      upstreamMs: null,
      requestedTopK: null,
      errorCategory: 'rejected',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(searchPayload), {
            headers: {
              'X-Paillette-Search-Request-Id': 'private-org',
              'X-Paillette-Search-Path': 'https://provider',
              'X-Paillette-Embedding-Count': 'secret',
              'Server-Timing': 'query;desc="private"',
            },
          })
      )
    );
    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'private query', topK: 200 }),
    } as any);
    expect(JSON.parse(log.mock.calls[1]![0] as string)).toMatchObject({ requestedTopK: 200, normalizedTopK: 100, canonicalTopK: 100 });
    expect(response.headers.get('X-Paillette-Search-Request-Id')).toBeNull();
    expect(response.headers.get('X-Paillette-Search-Path')).toBeNull();
    expect(response.headers.get('X-Paillette-Embedding-Count')).toBeNull();
    expect(response.headers.get('Server-Timing')).toMatch(/^public_proxy;dur=/);
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private|provider|secret/
    );
  });

  it('normalizes the forwarded query with the shared contract', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    const request = makeRequest({
      query: '  Cafe\u0301\n\t angels  ',
    });
    await action({
      context: {},
      params: { orgId: 'nga' },
      request,
    } as any);

    const upstreamInit = mockFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const upstreamBody =
      typeof upstreamInit?.body === 'string'
        ? JSON.parse(upstreamInit.body)
        : undefined;

    expect(upstreamBody).toMatchObject({
      query: 'Café angels',
    });
    expect(upstreamInit?.signal).toBe(request.signal);
  });

  it('reserves every intentional NGA search at the API even when the presentation cache has a match', async () => {
    let cachedResponse: Response | undefined;
    const cache = {
      match: vi.fn(async () => cachedResponse?.clone()),
      put: vi.fn(async (_request: Request, response: Response) => {
        cachedResponse = response.clone();
      }),
    };
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('caches', { default: cache });
    vi.stubGlobal('fetch', mockFetch);

    const firstResponse = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'serene, still and contemplative',
        topK: 1,
        minScore: 0.5,
        usageContext: { auto: true, source: 'idle_showcase' },
      }),
    } as any);
    const firstPayload =
      (await firstResponse.json()) as ApiResponse<SearchResponse>;
    const upstreamInit = mockFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const upstreamBody =
      typeof upstreamInit?.body === 'string'
        ? JSON.parse(upstreamInit.body)
        : undefined;

    expect(upstreamBody).toEqual({
      query: 'serene, still and contemplative',
      topK: 100,
      minScore: 0,
    });
    expect(firstPayload.data?.results.map((artwork) => artwork.id)).toEqual([
      'strong',
    ]);
    expect(firstPayload.data?.count).toBe(1);
    expect(firstResponse.headers.get('X-Paillette-Search-Cache')).toBeNull();

    const secondResponse = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'serene, still and contemplative',
        topK: 2,
        minScore: 0.9,
        usageContext: { auto: true, source: 'try_query_prefetch' },
      }),
    } as any);
    const secondPayload =
      (await secondResponse.json()) as ApiResponse<SearchResponse>;

    expect(countUpstreamSearchCalls(mockFetch)).toBe(2);
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(secondPayload.data?.results.map((artwork) => artwork.id)).toEqual([
      'strong',
    ]);
    expect(secondPayload.data?.count).toBe(1);
    expect(secondResponse.headers.get('X-Paillette-Search-Cache')).toBeNull();
  });

  it('preserves NGA quota headers and prevents caching a quota-bearing response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-NGA-Search-Limit': '1000',
            'X-NGA-Search-Used': '1',
            'X-NGA-Search-Remaining': '999',
          },
        })
      )
    );

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'quiet shore' }),
    } as any);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
  });

  it('synthesizes a safe error while preserving a valid counted quota from a non-JSON upstream response', async () => {
    const upstreamBody = '<html>INTERNAL_UPSTREAM_SENTINEL</html>';
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        new Response(upstreamBody, {
          status: 502,
          headers: {
            'Content-Type': 'text/html',
            'Retry-After': '17',
            'X-NGA-Search-Limit': '1000',
            'X-NGA-Search-Used': '1',
            'X-NGA-Search-Remaining': '999',
          },
        })
      )
    );

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'quiet shore' }),
    } as any);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('17');
    expect(response.headers.get('X-NGA-Search-Limit')).toBe('1000');
    expect(response.headers.get('X-NGA-Search-Used')).toBe('1');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'PUBLIC_TEXT_SEARCH_UPSTREAM_ERROR',
        message: 'Public text search request failed.',
      },
    });
  });

  it('returns a safe no-store 502 when the upstream fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(
        new Error('INTERNAL_NETWORK_SENTINEL')
      )
    );

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'quiet shore' }),
    } as any);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(response.headers.get('X-NGA-Search-Limit')).toBeNull();
    expect(response.headers.get('X-NGA-Search-Used')).toBeNull();
    expect(response.headers.get('X-NGA-Search-Remaining')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'PUBLIC_TEXT_SEARCH_UPSTREAM_UNAVAILABLE',
        message: 'Public text search is temporarily unavailable.',
      },
    });
  });

  it('rethrows a caller abort instead of converting it to upstream unavailability', async () => {
    const abortError = new DOMException('caller cancelled', 'AbortError');
    const controller = new AbortController();
    controller.abort(abortError);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(abortError)
    );

    const request = makeRequest({ query: 'quiet shore' });
    Object.defineProperty(request, 'signal', { value: controller.signal });
    const pending = action({
      context: {},
      params: { orgId: 'nga' },
      request,
    } as any);

    await expect(pending).rejects.toBe(abortError);
  });

  it('omits incomplete quota headers from a non-JSON upstream error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        new Response('INTERNAL_UPSTREAM_SENTINEL', {
          status: 503,
          headers: {
            'Content-Type': 'text/plain',
            'X-NGA-Search-Limit': '1000',
            'X-NGA-Search-Used': '1',
          },
        })
      )
    );

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'quiet shore' }),
    } as any);

    expect(response.status).toBe(503);
    expect(response.headers.get('X-NGA-Search-Limit')).toBeNull();
    expect(response.headers.get('X-NGA-Search-Used')).toBeNull();
    expect(response.headers.get('X-NGA-Search-Remaining')).toBeNull();
  });

  it('does not cache a successful response with a degraded search channel', async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const degradedPayload: ApiResponse<SearchResponse> = {
      ...searchPayload,
      meta: {
        timestamp: '2026-07-17T08:00:00.000Z',
        search: {
          cacheable: false,
          degradedChannels: ['caption_embedding'],
        },
      },
    };
    const mockFetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify(degradedPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('caches', { default: cache });
    vi.stubGlobal('fetch', mockFetch);

    const requestBody = {
      query: 'quiet shore',
      topK: 30,
      minScore: 0.2,
      usageContext: { auto: true },
    };
    const first = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest(requestBody),
    } as any);
    const second = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest(requestBody),
    } as any);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBeNull();
    expect(countUpstreamSearchCalls(mockFetch)).toBe(2);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('preserves an API L2 cache disposition on an edge miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Paillette-Search-Cache': 'KV-FRESH',
          },
        })
      )
    );

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({ query: 'quiet shore' }),
    } as any);

    expect(response.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
  });

  it('does not schedule a second web-side cache or usage write', async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const waitUntil = vi.fn();
    vi.stubGlobal('caches', { default: cache });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const response = await action({
      context: { cloudflare: { context: { waitUntil } } },
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'quiet shore',
        usageContext: { auto: true },
      }),
    } as any);
    expect(response.status).toBe(200);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('does not duplicate accepted-search logging in the web proxy', async () => {
    const scheduled: Promise<unknown>[] = [];
    const mockFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith('/usage-events')
            ? { success: true }
            : searchPayload
        ),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    await action({
      context: {
        cloudflare: {
          context: {
            waitUntil: (work: Promise<unknown>) => scheduled.push(work),
          },
        },
      },
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'quiet shore',
        usageContext: { auto: true },
      }),
    } as any);
    await Promise.all(scheduled);

    expect(
      mockFetch.mock.calls.some(([input]) =>
        String(input).endsWith('/usage-events')
      )
    ).toBe(false);
  });

  it('defaults public text searches to a broader 20 percent threshold', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'rabbit',
        topK: 30,
      }),
    } as any);
    const payload = (await response.json()) as ApiResponse<SearchResponse>;
    const upstreamInit = mockFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const upstreamBody =
      typeof upstreamInit?.body === 'string'
        ? JSON.parse(upstreamInit.body)
        : undefined;

    expect(upstreamBody).toEqual({
      query: 'rabbit',
      topK: 100,
      minScore: 0,
    });
    expect(payload.data?.results.map((artwork) => artwork.id)).toEqual([
      'strong',
      'good',
      'weak',
    ]);
    expect(payload.data?.count).toBe(3);
  });

  it('forwards artist-facet searches upstream with the same broad cache shape', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'Zhang Yiqian',
        topK: 30,
        minScore: 0.2,
        facet: 'artist',
        usageContext: { facet: 'artist' },
      }),
    } as any);
    const payload = (await response.json()) as ApiResponse<SearchResponse>;
    const upstreamInit = mockFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const upstreamBody =
      typeof upstreamInit?.body === 'string'
        ? JSON.parse(upstreamInit.body)
        : undefined;

    expect(upstreamBody).toEqual({
      query: 'Zhang Yiqian',
      topK: 100,
      minScore: 0,
      facet: 'artist',
    });
    expect(payload.data?.count).toBe(3);
  });

  it('proxies open-access NGA fixture search with provenance metadata intact', async () => {
    const openAccessPayload: ApiResponse<SearchResponse> = {
      success: true,
      data: {
        results: [
          {
            id: 'open-access-art:nga:17387',
            galleryId: 'open-access-art',
            imageUrl:
              'https://paillette-api-stg.berlayar.ai/api/v1/assets/471cd77ba1030ffd2d6fb65dd9bec6c4/content',
            thumbnailUrl:
              'https://paillette-api-stg.berlayar.ai/api/v1/assets/358ef75285f2fcb1ea5f8304c81949d5/content',
            similarity: 0.93,
            title: 'Gemel Bottle',
            artist: 'Yolande Delasser',
            year: 1936,
            metadata: {
              accessionNumber: '1943.8.5186',
              collectionSlug: 'open-access-art',
              provider: 'nga',
              providerRecordId: '17387',
              rightsStatus: 'Open Access / Public Domain',
              sourceCollection: 'CG-W',
              sourceInstitution: 'National Gallery of Art, Washington',
              sourceUrl:
                'https://www.nga.gov/collection/art-object-page.17387.html',
            },
          },
        ],
        count: 1,
        queryTime: 42,
      },
    };
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(openAccessPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest(
        {
          query: 'blue ceramic jugs',
          topK: 5,
          minScore: 0.5,
          usageContext: { auto: true, source: 'nga_fixture_smoke' },
        },
        'nga'
      ),
    } as any);
    const payload = (await response.json()) as ApiResponse<SearchResponse>;
    const upstreamUrl = mockFetch.mock.calls[0]?.[0]?.toString();
    const upstreamInit = mockFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const upstreamBody =
      typeof upstreamInit?.body === 'string'
        ? JSON.parse(upstreamInit.body)
        : undefined;
    const artwork = payload.data?.results[0];

    expect(upstreamUrl).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/orgs/nga/search/text'
    );
    expect(upstreamBody).toEqual({
      query: 'blue ceramic jugs',
      topK: 100,
      minScore: 0,
    });
    expect(payload.data?.count).toBe(1);
    expect(artwork).toMatchObject({
      id: 'open-access-art:nga:17387',
      imageUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/471cd77ba1030ffd2d6fb65dd9bec6c4/content',
      thumbnailUrl:
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/358ef75285f2fcb1ea5f8304c81949d5/content',
      title: 'Gemel Bottle',
      metadata: {
        accessionNumber: '1943.8.5186',
        collectionSlug: 'open-access-art',
        provider: 'nga',
        sourceCollection: 'CG-W',
        sourceInstitution: 'National Gallery of Art, Washington',
        sourceUrl:
          'https://www.nga.gov/collection/art-object-page.17387.html',
      },
    });
  });

  it('forwards classification-facet searches upstream', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'Painting',
        topK: 30,
        minScore: 0.2,
        facet: 'classification',
      }),
    } as any);
    const upstreamInit = mockFetch.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    const upstreamBody =
      typeof upstreamInit?.body === 'string'
        ? JSON.parse(upstreamInit.body)
        : undefined;

    expect(upstreamBody).toEqual({
      query: 'Painting',
      topK: 100,
      minScore: 0,
      facet: 'classification',
    });
  });

  it('rejects legacy visual refinement before it can spend another embedding call', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest({
        query: 'angels',
        visualRefinement: 'dark navy blue',
        topK: 30,
        minScore: 0.2,
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects arbitrary org IDs before forwarding the quota-exempt public key', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', mockFetch);

    const response = await action({
      context: {},
      params: { orgId: 'private-org' },
      request: makeRequest({ query: 'anything' }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
