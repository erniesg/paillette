import { afterEach, describe, expect, it, vi } from 'vitest';

import { action } from '../api.public-search.$orgId.text';
import type { ApiResponse, SearchResponse } from '~/types';

const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';

const result = (
  id: string,
  similarity: number,
  sourceInstitution = 'National Gallery Singapore',
  sourceCollection = 'National Collection'
) => ({
  id,
  galleryId: NGS_ORG_ID,
  imageUrl: null,
  metadata: {
    sourceInstitution,
    sourceCollection,
    source_institution: sourceInstitution,
    source_collection: sourceCollection,
  },
  similarity,
  source_collection: sourceCollection,
  source_institution: sourceInstitution,
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

const makeRequest = (body: Record<string, unknown>) =>
  new Request('https://paillette.test/api/public-search/ngs/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('public text search route caching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(secondPayload.data?.results.map((artwork) => artwork.id)).toEqual([
      'strong',
    ]);
    expect(secondPayload.data?.count).toBe(1);
    expect(secondResponse.headers.get('X-Paillette-Search-Cache')).toBe('HIT');
  });

  it('filters non-NGS source rows before returning and caching NGS text results', async () => {
    let cachedResponse: Response | undefined;
    const mixedSourcePayload: ApiResponse<SearchResponse> = {
      success: true,
      data: {
        results: [
          result('sam', 0.98, 'Singapore Art Museum', 'SAM Collection'),
          result('ngs', 0.9),
          result(
            'nms',
            0.88,
            'National Museum of Singapore',
            'National Museum Collection'
          ),
        ],
        count: 3,
        queryTime: 88,
      },
    };
    const cache = {
      match: vi.fn(async () => cachedResponse?.clone()),
      put: vi.fn(async (_request: Request, response: Response) => {
        cachedResponse = response.clone();
      }),
    };
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(mixedSourcePayload), {
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
        query: 'portrait',
        topK: 10,
        minScore: 0.2,
        usageContext: { auto: true },
      }),
    } as any);
    const firstPayload =
      (await firstResponse.json()) as ApiResponse<SearchResponse>;

    expect(firstPayload.data?.results.map((artwork) => artwork.id)).toEqual([
      'ngs',
    ]);
    expect(firstPayload.data?.count).toBe(1);
    expect(firstResponse.headers.get('X-Paillette-Search-Cache')).toBe('MISS');

    const secondResponse = await action({
      context: {},
      params: { orgId: 'ngs' },
      request: makeRequest({
        query: 'portrait',
        topK: 10,
        minScore: 0.2,
        usageContext: { auto: true },
      }),
    } as any);
    const secondPayload =
      (await secondResponse.json()) as ApiResponse<SearchResponse>;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(secondPayload.data?.results.map((artwork) => artwork.id)).toEqual([
      'ngs',
    ]);
    expect(secondResponse.headers.get('X-Paillette-Search-Cache')).toBe('HIT');
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
});
