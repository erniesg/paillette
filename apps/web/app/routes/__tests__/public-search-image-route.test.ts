import { afterEach, describe, expect, it, vi } from 'vitest';

import { action } from '../api.public-search.$orgId.image';
import type { ApiResponse, SearchResponse } from '~/types';

const successPayload: ApiResponse<SearchResponse> = {
  success: true,
  data: { results: [], count: 0, queryTime: 12 },
};

const makeForm = (
  image: File = new File([new Uint8Array([1, 2, 3, 4])], 'query.png', {
    type: 'image/png',
  })
) => {
  const form = new FormData();
  form.append('image', image);
  return form;
};

const makeRequest = (
  form: FormData,
  orgId = 'nga',
  signal?: AbortSignal
) => {
  const request = new Request(
    `https://paillette.test/api/public-search/${orgId}/image`,
    {
      method: 'POST',
    }
  );
  if (signal) {
    Object.defineProperty(request, 'signal', { value: signal });
  }
  Object.defineProperty(request, 'formData', {
    value: async () => form,
  });
  return request;
};

describe('public image search proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards canonical constraints, numeric minScore zero, and the abort signal', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(successPayload)
    );
    vi.stubGlobal('fetch', fetcher);
    const form = makeForm();
    form.set('topK', '30');
    form.set('minScore', '0');
    form.set(
      'constraints',
      JSON.stringify({
        artistIds: ['artist-1', 'artist-1'],
        mediumFamilies: ['oil', 'oil'],
        classifications: ['Painting', 'Painting'],
        dateRange: { startYear: 1700, endYear: 1799 },
      })
    );
    const request = makeRequest(form);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request,
    } as any);
    const upstream = fetcher.mock.calls[0]?.[1] as RequestInit;
    const outbound = upstream.body as FormData;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream.signal).toBe(request.signal);
    expect(outbound.get('minScore')).toBe('0');
    expect(outbound.get('constraints')).toBe(
      JSON.stringify({
        dateRange: { startYear: 1700, endYear: 1799 },
        classifications: ['Painting'],
        mediumFamilies: ['oil'],
        artistIds: ['artist-1'],
      })
    );
  });

  it.each([
    ['missing image', () => new FormData()],
    [
      'multiple images',
      () => {
        const form = makeForm();
        form.append(
          'image',
          new File([new Uint8Array([5])], 'second.webp', {
            type: 'image/webp',
          })
        );
        return form;
      },
    ],
    ['zero bytes', () => makeForm(new File([], 'empty.png', { type: 'image/png' }))],
    [
      'wrong MIME',
      () => makeForm(new File([new Uint8Array([1])], 'query.gif', { type: 'image/gif' })),
    ],
    [
      'oversize',
      () =>
        makeForm(
          new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.webp', {
            type: 'image/webp',
          })
        ),
    ],
    [
      'malformed constraints JSON',
      () => {
        const form = makeForm();
        form.set('constraints', '{');
        return form;
      },
    ],
    [
      'array constraints',
      () => {
        const form = makeForm();
        form.set('constraints', '[]');
        return form;
      },
    ],
    [
      'null constraints',
      () => {
        const form = makeForm();
        form.set('constraints', 'null');
        return form;
      },
    ],
    [
      'unknown field',
      () => {
        const form = makeForm();
        form.set('constraints', JSON.stringify({ subject: 'flowers' }));
        return form;
      },
    ],
    [
      'invalid known value',
      () => {
        const form = makeForm();
        form.set('constraints', JSON.stringify({ mediumFamilies: ['silk'] }));
        return form;
      },
    ],
    [
      'out-of-order date range',
      () => {
        const form = makeForm();
        form.set(
          'constraints',
          JSON.stringify({ dateRange: { startYear: 1900, endYear: 1800 } })
        );
        return form;
      },
    ],
    [
      'non-integer date range',
      () => {
        const form = makeForm();
        form.set(
          'constraints',
          JSON.stringify({ dateRange: { startYear: 1700.5, endYear: 1800 } })
        );
        return form;
      },
    ],
    [
      'unknown nested date field',
      () => {
        const form = makeForm();
        form.set(
          'constraints',
          JSON.stringify({
            dateRange: { startYear: 1700, endYear: 1800, era: 'CE' },
          })
        );
        return form;
      },
    ],
    [
      'duplicate topK controls',
      () => {
        const form = makeForm();
        form.append('topK', '10');
        form.append('topK', '20');
        return form;
      },
    ],
    [
      'duplicate minScore controls',
      () => {
        const form = makeForm();
        form.append('minScore', '0');
        form.append('minScore', '0.5');
        return form;
      },
    ],
  ])('rejects %s locally with no-store before upstream spend', async (_label, makeInvalidForm) => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest(makeInvalidForm()),
    } as any);

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed multipart locally before upstream spend', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);
    const request = new Request(
      'https://paillette.test/api/public-search/nga/image',
      { method: 'POST' }
    );
    Object.defineProperty(request, 'formData', {
      value: async () => {
        throw new TypeError('Failed to parse body as FormData.');
      },
    });

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request,
    } as any);

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['ngs', 'private-org'])(
    'denies noncanonical public scope %s before upstream spend',
    async (orgId) => {
      const fetcher = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal('fetch', fetcher);

      const response = await action({
        context: {},
        params: { orgId },
        request: makeRequest(makeForm(), orgId),
      } as any);

      expect(response.status).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each([
    [429, '17'],
    [501, null],
  ])('preserves upstream %i with no-store and Retry-After', async (status, retryAfter) => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          success: false,
          error: { code: 'UPSTREAM_ERROR', message: 'Unavailable' },
        },
        {
          status,
          headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
        }
      )
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest(makeForm()),
    } as any);

    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe(retryAfter);
  });

  it.each([
    [
      429,
      '23',
      'text/html',
      '<html><script>INTERNAL_HTML_SENTINEL</script></html>',
    ],
    [501, '41', 'text/plain', 'INTERNAL_TEXT_SENTINEL: provider stack'],
  ])(
    'synthesizes safe JSON for non-JSON upstream %i without disclosing its body',
    async (status, retryAfter, contentType, upstreamBody) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(async () =>
          new Response(upstreamBody, {
            status,
            headers: {
              'Content-Type': contentType,
              'Retry-After': retryAfter,
            },
          })
        )
      );

      const response = await action({
        context: {},
        params: { orgId: 'nga' },
        request: makeRequest(makeForm()),
      } as any);

      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Retry-After')).toBe(retryAfter);
      expect(response.headers.get('Content-Type')).toContain(
        'application/json'
      );
      const body = await response.text();
      expect(body).not.toContain(upstreamBody);
      expect(JSON.parse(body)).toEqual({
        success: false,
        error: {
          code: 'PUBLIC_IMAGE_SEARCH_UPSTREAM_ERROR',
          message: 'Public image search request failed.',
        },
      });
    }
  );

  it('rethrows a caller abort instead of converting it to upstream unavailability', async () => {
    const abortError = new DOMException('caller cancelled', 'AbortError');
    const controller = new AbortController();
    controller.abort(abortError);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(abortError)
    );

    const pending = action({
      context: {},
      params: { orgId: 'nga' },
      request: makeRequest(makeForm(), 'nga', controller.signal),
    } as any);

    await expect(pending).rejects.toBe(abortError);
  });
});
