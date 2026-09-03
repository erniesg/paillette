/**
 * The same-origin proxy the redeal loop goes through.
 *
 * It exists so the browser never holds a key and so there is no agent-only
 * endpoint: the human's Enter and the agent's `redeal` tool both arrive here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { action } from '../api.public-search.$orgId.exemplars';
import type { ApiResponse, SearchResponse } from '~/types';

const result = (id: string) => ({
  id,
  galleryId: 'eabbf000-708e-4d4c-8ac8-966b59d4fcac',
  imageUrl: null,
  similarity: 0.8,
  title: `Artwork ${id}`,
});

const upstreamOk = (ids: string[]): ApiResponse<SearchResponse> => ({
  success: true,
  data: { results: ids.map(result), count: ids.length, queryTime: 4 },
});

const makeRequest = (body: unknown, orgId = 'nga') =>
  new Request(`https://paillette.test/api/public-search/${orgId}/exemplars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const run = (body: unknown, orgId = 'nga') =>
  action({
    context: {},
    params: { orgId },
    request: makeRequest(body, orgId),
  } as any);

const stubUpstream = (payload: unknown, status = 200) => {
  const mockFetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
};

const upstreamBody = (mockFetch: ReturnType<typeof stubUpstream>) => {
  const init = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
};

describe('public exemplar search route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards the exemplars to the upstream search route', async () => {
    const mockFetch = stubUpstream(upstreamOk(['n1']));

    const response = await run({
      positiveIds: ['a'],
      negativeIds: ['b'],
      excludeIds: ['c'],
      topK: 12,
    });

    expect(response.status).toBe(200);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/search/exemplars'
    );
    expect(upstreamBody(mockFetch)).toMatchObject({
      positiveIds: ['a'],
      negativeIds: ['b'],
      excludeIds: ['c'],
      topK: 12,
      negativeWeight: 0.5,
    });
  });

  it('defaults to a board of twelve and the documented negative weight', async () => {
    const mockFetch = stubUpstream(upstreamOk([]));

    await run({ positiveIds: ['a'] });

    expect(upstreamBody(mockFetch)).toMatchObject({
      topK: 12,
      negativeWeight: 0.5,
    });
  });

  it('drops blanks and duplicates rather than forwarding them', async () => {
    const mockFetch = stubUpstream(upstreamOk([]));

    await run({ positiveIds: ['a', '  a  ', '', 'b', 42] });

    expect(upstreamBody(mockFetch)?.positiveIds).toEqual(['a', 'b']);
  });

  it('clamps a wild topK instead of passing it through', async () => {
    const mockFetch = stubUpstream(upstreamOk([]));

    await run({ positiveIds: ['a'], topK: 9999 });

    expect(upstreamBody(mockFetch)?.topK).toBe(100);
  });

  it('refuses a request with no positives, without calling upstream', async () => {
    const mockFetch = stubUpstream(upstreamOk([]));

    const response = await run({ positiveIds: [] });

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    stubUpstream(upstreamOk([]));

    expect((await run('not json')).status).toBe(400);
  });

  it('refuses an organisation that is not open to public search', async () => {
    const mockFetch = stubUpstream(upstreamOk([]));

    const response = await run({ positiveIds: ['a'] }, 'someone-elses-org');

    expect(response.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('filters works hidden from the public catalogue out of the board', async () => {
    // The board is dealt from the index, so the same visibility rule the text
    // route applies has to apply here or a hidden work reappears on a redeal.
    stubUpstream({
      success: true,
      data: {
        results: [
          result('visible'),
          {
            ...result('hidden'),
            galleryId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
            metadata: { accessionNumber: 'P-0001-00-0' },
          },
        ],
        count: 2,
        queryTime: 4,
      },
    });

    const response = await run({ positiveIds: ['a'] });
    const payload = (await response.json()) as ApiResponse<SearchResponse>;

    expect(payload.success).toBe(true);
    expect(payload.data?.count).toBe(payload.data?.results.length);
  });

  it('reports an unreachable upstream as a 502 rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      })
    );

    const response = await run({ positiveIds: ['a'] });
    const payload = (await response.json()) as ApiResponse;

    expect(response.status).toBe(502);
    expect(payload.error?.code).toBe(
      'PUBLIC_EXEMPLAR_SEARCH_UPSTREAM_UNAVAILABLE'
    );
  });

  it('passes an upstream failure through with its own code', async () => {
    stubUpstream(
      {
        success: false,
        error: { code: 'EXEMPLARS_NOT_INDEXED', message: 'No embeddings.' },
      },
      422
    );

    const response = await run({ positiveIds: ['a'] });
    const payload = (await response.json()) as ApiResponse;

    expect(response.status).toBe(422);
    expect(payload.error?.code).toBe('EXEMPLARS_NOT_INDEXED');
  });

  it('never caches a board', async () => {
    stubUpstream(upstreamOk(['n1']));

    const response = await run({ positiveIds: ['a'] });

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
