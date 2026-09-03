import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader as suggestionsLoader } from '../api.public-index.$jobId.suggestions';

const API = 'https://paillette-api-stg.berlayar.ai/api/v1/public-index';
const JOB_ID = '2f1c9b7a-0d64-4b21-9c8e-5a3b7d612f40';

const okJson = (data: unknown, init?: ResponseInit) =>
  Response.json({ success: true, data }, init);

/** Routes every upstream call by URL suffix so status and search can differ. */
const stubFetch = (handlers: {
  status?: () => Response | Promise<Response>;
  search?: () => Response | Promise<Response>;
}) => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/search') && handlers.search) return handlers.search();
    if (!url.endsWith('/search') && handlers.status) return handlers.status();
    throw new Error(`Unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};

const request = (jobId = JOB_ID) =>
  new Request(`https://paillette.test/api/public-index/${jobId}/suggestions`);

describe('GET /api/public-index/:jobId/suggestions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects an unsafe job id before calling upstream', async () => {
    const fetcher = stubFetch({});
    const response = await suggestionsLoader({
      context: {},
      params: { jobId: '../etc' },
      request: request('../etc'),
    } as any);

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports not-ready without searching a still-running job', async () => {
    const fetcher = stubFetch({
      status: () => okJson({ state: 'running', collectionId: 'c1' }),
    });

    const response = await suggestionsLoader({
      context: {},
      params: { jobId: JOB_ID },
      request: request(),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const payload = (await response.json()) as { data: unknown };
    expect(payload.data).toEqual({ ready: false, state: 'running' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [statusUrl] = fetcher.mock.calls[0] as unknown as [string];
    expect(statusUrl).toBe(`${API}/jobs/${JOB_ID}`);
  });

  it('404s a job the upstream does not know about', async () => {
    stubFetch({
      status: () =>
        Response.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'x' } },
          { status: 404 }
        ),
    });

    const response = await suggestionsLoader({
      context: {},
      params: { jobId: JOB_ID },
      request: request(),
    } as any);

    expect(response.status).toBe(404);
  });

  it('computes and caches a grounded bundle for a completed job', async () => {
    const cachePut = vi.fn(async () => undefined);
    const cacheMatch = vi.fn(async () => undefined);
    vi.stubGlobal('caches', { default: { match: cacheMatch, put: cachePut } });

    const fetcher = stubFetch({
      status: () => okJson({ state: 'complete', collectionId: 'c1' }),
      search: () =>
        okJson({
          collectionId: 'c1',
          results: [
            {
              id: 'a1',
              similarity: 0.5,
              artist: 'Rembrandt van Rijn',
              medium: 'Oil on canvas',
              classification: 'Painting',
              year: 1650,
            },
          ],
        }),
    });

    const response = await suggestionsLoader({
      context: {},
      params: { jobId: JOB_ID },
      request: request(),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const payload = (await response.json()) as {
      data: {
        ready: boolean;
        grounded: boolean;
        collectionId: string;
        jobId: string;
        suggestions: unknown[];
      };
    };
    expect(payload.data.ready).toBe(true);
    expect(payload.data.grounded).toBe(true);
    expect(payload.data.collectionId).toBe('c1');
    expect(payload.data.jobId).toBe(JOB_ID);
    expect(Array.isArray(payload.data.suggestions)).toBe(true);
    expect(payload.data.suggestions.length).toBeGreaterThan(0);

    // Status + at least the six seed searches.
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(cacheMatch).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledTimes(1);
    const [cacheKeyArg] = cachePut.mock.calls[0] as unknown as [Request];
    expect(cacheKeyArg.url).toContain(JOB_ID);
  });

  it('serves a cached bundle without touching the network again', async () => {
    const cached = okJson({ ready: true, jobId: JOB_ID, suggestions: [] });
    const cacheMatch = vi.fn(async () => cached);
    const cachePut = vi.fn(async () => undefined);
    vi.stubGlobal('caches', { default: { match: cacheMatch, put: cachePut } });
    const fetcher = stubFetch({});

    const response = await suggestionsLoader({
      context: {},
      params: { jobId: JOB_ID },
      request: request(),
    } as any);

    expect(response).toBe(cached);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('returns 502 when the upstream is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection reset');
      })
    );

    const response = await suggestionsLoader({
      context: {},
      params: { jobId: JOB_ID },
      request: request(),
    } as any);

    expect(response.status).toBe(502);
  });
});
