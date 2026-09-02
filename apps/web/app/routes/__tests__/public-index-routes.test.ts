import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { action as createJob } from '../api.public-index.jobs';
import { action as postItems } from '../api.public-index.$jobId.items';
import { action as completeJob } from '../api.public-index.$jobId.complete';
import { loader as jobStatus } from '../api.public-index.$jobId.status';
import { action as searchJob } from '../api.public-index.$jobId.search';
import { loader as assetContent } from '../api.public-index.assets.$assetId';

const API = 'https://paillette-api-stg.berlayar.ai/api/v1/public-index';
const JOB_ID = '2f1c9b7a-0d64-4b21-9c8e-5a3b7d612f40';

const stubFetch = (responder: () => Response | Promise<Response>) => {
  const fetcher = vi.fn(async () => responder());
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};

const okJson = (data: unknown, init?: ResponseInit) =>
  Response.json({ success: true, data }, init);

/**
 * jsdom's Blob/File/FormData are not interoperable with the fetch
 * implementation that backs Request/Response here, so multipart handling is
 * exercised with the platform's own web globals. Workers ship one consistent
 * set, so this substitution is a test-environment concern only.
 */
const useNativeWebGlobals = async () => {
  const boundary = 'probe';
  const parsed = await new Response(
    `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${boundary}--\r\n`,
    { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }
  ).formData();

  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('FormData', parsed.constructor);
};

const jsonRequest = (url: string, body: unknown, headers: HeadersInit = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('public indexing proxy routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a job upstream and forwards the edge address, not a client header', async () => {
    const fetcher = stubFetch(() =>
      okJson({ jobId: JOB_ID, collectionId: 'c1', accepted: ['a.jpg'] }, { status: 201 })
    );

    const response = await createJob({
      context: {},
      params: {},
      request: jsonRequest(
        'https://paillette.test/api/public-index/jobs',
        { collectionName: 'Studio scans', files: [{ name: 'a.jpg', size: 10 }] },
        { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '198.51.100.9' }
      ),
    } as any);

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      success: true,
      data: { jobId: JOB_ID },
    });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/jobs`);
    const headers = new Headers(init.headers);
    expect(headers.get('CF-Connecting-IP')).toBe('203.0.113.7');
    expect(headers.get('X-Forwarded-For')).toBeNull();
  });

  it('rejects a malformed create body before calling upstream', async () => {
    const fetcher = stubFetch(() => okJson({}));

    const response = await createJob({
      context: {},
      params: {},
      request: new Request('https://paillette.test/api/public-index/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('relays an upstream rate limit with its code and Retry-After', async () => {
    stubFetch(() =>
      Response.json(
        {
          success: false,
          error: { code: 'INDEXING_RATE_LIMITED', message: 'Slow down.' },
        },
        { status: 429, headers: { 'Retry-After': '600' } }
      )
    );

    const response = await createJob({
      context: {},
      params: {},
      request: jsonRequest('https://paillette.test/api/public-index/jobs', {
        collectionName: 'x',
        files: [{ name: 'a.jpg', size: 1 }],
      }),
    } as any);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('600');
    expect(await response.json()).toMatchObject({
      error: { code: 'INDEXING_RATE_LIMITED' },
    });
  });

  it('returns 502 when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection reset');
      })
    );

    const response = await createJob({
      context: {},
      params: {},
      request: jsonRequest('https://paillette.test/api/public-index/jobs', {
        collectionName: 'x',
        files: [{ name: 'a.jpg', size: 1 }],
      }),
    } as any);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'PUBLIC_INDEX_UPSTREAM_UNAVAILABLE' },
    });
  });

  it('forwards an image batch and drops unexpected form parts', async () => {
    await useNativeWebGlobals();
    const fetcher = stubFetch(() => okJson({ jobId: JOB_ID, processed: 1 }));

    const boundary = 'paillettetestboundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="a.jpg"',
      'Content-Type: image/jpeg',
      '',
      'abc',
      `--${boundary}`,
      'Content-Disposition: form-data; name="metadata"',
      '',
      JSON.stringify({ 'a.jpg': { title: 'A' } }),
      `--${boundary}`,
      'Content-Disposition: form-data; name="sneaky"',
      '',
      'should not be relayed',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await postItems({
      context: {},
      params: { jobId: JOB_ID },
      request: new Request(
        `https://paillette.test/api/public-index/${JOB_ID}/items`,
        {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        }
      ),
    } as any);

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/jobs/${JOB_ID}/items`);

    const relayed = init.body as FormData;
    expect(relayed.getAll('files')).toHaveLength(1);
    expect(relayed.get('metadata')).toBe(JSON.stringify({ 'a.jpg': { title: 'A' } }));
    expect(relayed.get('sneaky')).toBeNull();
  });

  it('refuses an oversized batch by declared length without reading it', async () => {
    const fetcher = stubFetch(() => okJson({}));

    const response = await postItems({
      context: {},
      params: { jobId: JOB_ID },
      request: new Request(
        `https://paillette.test/api/public-index/${JOB_ID}/items`,
        {
          method: 'POST',
          headers: { 'Content-Length': String(200 * 1024 * 1024) },
          body: new FormData(),
        }
      ),
    } as any);

    expect(response.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['items', (request: Request) => postItems({ context: {}, params: { jobId: '../etc' }, request } as any)],
    ['status', (request: Request) => jobStatus({ context: {}, params: { jobId: 'bad id' }, request } as any)],
    ['search', (request: Request) => searchJob({ context: {}, params: { jobId: 'a/b' }, request } as any)],
    ['complete', (request: Request) => completeJob({ context: {}, params: { jobId: '' }, request } as any)],
  ])('rejects an unsafe job id on the %s route', async (_name, invoke) => {
    const fetcher = stubFetch(() => okJson({}));

    const response = await invoke(
      new Request('https://paillette.test/api/public-index/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    );

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('polls job status without caching it', async () => {
    const fetcher = stubFetch(() =>
      okJson({
        jobId: JOB_ID,
        state: 'running',
        processed: 2,
        total: 5,
        collectionId: 'c1',
        errors: [],
      })
    );

    const response = await jobStatus({
      context: {},
      params: { jobId: JOB_ID },
      request: new Request(
        `https://paillette.test/api/public-index/${JOB_ID}/status`
      ),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [statusUrl] = fetcher.mock.calls[0] as unknown as [string];
    expect(statusUrl).toBe(`${API}/jobs/${JOB_ID}`);
  });

  it('completes a job even with no request body', async () => {
    const fetcher = stubFetch(() => okJson({ state: 'complete' }));

    const response = await completeJob({
      context: {},
      params: { jobId: JOB_ID },
      request: new Request(
        `https://paillette.test/api/public-index/${JOB_ID}/complete`,
        { method: 'POST' }
      ),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{}');
  });

  it('proxies a search over the indexed collection', async () => {
    const fetcher = stubFetch(() =>
      okJson({ collectionId: 'c1', results: [{ id: 'a', title: 'Red Barn' }] })
    );

    const response = await searchJob({
      context: {},
      params: { jobId: JOB_ID },
      request: jsonRequest(
        `https://paillette.test/api/public-index/${JOB_ID}/search`,
        { query: 'a red barn', topK: 5 }
      ),
    } as any);

    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/jobs/${JOB_ID}/search`);
    expect(JSON.parse(String(init.body))).toEqual({ query: 'a red barn', topK: 5 });
  });

  it('streams an indexed image back same-origin', async () => {
    const fetcher = stubFetch(
      () =>
        new Response('binary', {
          headers: { 'Content-Type': 'image/jpeg', ETag: '"abc"' },
        })
    );

    const response = await assetContent({
      context: {},
      params: { assetId: 'abc123' },
      request: new Request('https://paillette.test/api/public-index/assets/abc123'),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('ETag')).toBe('"abc"');
    const [assetUrl] = fetcher.mock.calls[0] as unknown as [string];
    expect(assetUrl).toBe(`${API}/assets/abc123`);
  });

  it('rejects an unsafe asset id and an upstream redirect', async () => {
    const fetcher = stubFetch(() => okJson({}));
    const bad = await assetContent({
      context: {},
      params: { assetId: '../../secret' },
      request: new Request('https://paillette.test/api/public-index/assets/x'),
    } as any);
    expect(bad.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();

    stubFetch(
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } })
    );
    const redirected = await assetContent({
      context: {},
      params: { assetId: 'abc123' },
      request: new Request('https://paillette.test/api/public-index/assets/abc123'),
    } as any);
    expect(redirected.status).toBe(502);
  });
});
