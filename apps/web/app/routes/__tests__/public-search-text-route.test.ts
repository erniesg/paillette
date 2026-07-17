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

const makeRequest = (body: Record<string, unknown>, orgId = 'ngs') =>
  new Request(`https://paillette.test/api/public-search/${orgId}/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const countUpstreamSearchCalls = (mockFetch: ReturnType<typeof vi.fn>) =>
  mockFetch.mock.calls.filter(([input]) =>
    String(input).includes('/search/text')
  ).length;

describe('public text search route caching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it('caches one broad result set per query and serves requested slices from it', async () => {
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
      params: { orgId: 'ngs' },
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
    expect(firstResponse.headers.get('X-Paillette-Search-Cache')).toBe('MISS');

    const secondResponse = await action({
      context: {},
      params: { orgId: 'ngs' },
      request: makeRequest({
        query: 'serene, still and contemplative',
        topK: 2,
        minScore: 0.9,
        usageContext: { auto: true, source: 'try_query_prefetch' },
      }),
    } as any);
    const secondPayload =
      (await secondResponse.json()) as ApiResponse<SearchResponse>;

    expect(countUpstreamSearchCalls(mockFetch)).toBe(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(secondPayload.data?.results.map((artwork) => artwork.id)).toEqual([
      'strong',
    ]);
    expect(secondPayload.data?.count).toBe(1);
    expect(secondResponse.headers.get('X-Paillette-Search-Cache')).toBe('HIT');
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
      params: { orgId: 'ngs' },
      request: makeRequest(requestBody),
    } as any);
    const second = await action({
      context: {},
      params: { orgId: 'ngs' },
      request: makeRequest(requestBody),
    } as any);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBe('BYPASS');
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

  it('schedules cache persistence without delaying the search response', async () => {
    let finishPut!: () => void;
    const slowPut = new Promise<void>((resolve) => {
      finishPut = resolve;
    });
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(() => slowPut),
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

    const pendingResponse = action({
      context: { cloudflare: { context: { waitUntil } } },
      params: { orgId: 'ngs' },
      request: makeRequest({
        query: 'quiet shore',
        usageContext: { auto: true },
      }),
    } as any);
    const raced = await Promise.race([
      pendingResponse,
      new Promise<'blocked'>((resolve) =>
        setTimeout(() => resolve('blocked'), 50)
      ),
    ]);
    finishPut();
    const response = await pendingResponse;

    expect(raced).toBe(response);
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });

  it('does not let caller-controlled auto metadata suppress usage logging', async () => {
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
    ).toBe(true);
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
      params: { orgId: 'ngs' },
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
      params: { orgId: 'ngs' },
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
