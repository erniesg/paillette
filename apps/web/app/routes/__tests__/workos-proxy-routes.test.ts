import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { withWorkOSSessionMock } = vi.hoisted(() => ({
  withWorkOSSessionMock: vi.fn(),
}));

vi.mock('~/lib/workos-auth.server', () => ({
  withWorkOSSession: withWorkOSSessionMock,
}));

import { loader as backendLoader } from '../api.backend.$';
import { loader as assetLoader } from '../api.public-assets.$assetId.content';

const session = {
  accessToken: 'workos-access-token',
  user: { id: 'user_approved', email: 'hello@example.test' },
};

const backendArgs = (path = 'orgs/ngs/search/quota') =>
  ({
    context: {
      cloudflare: {
        env: { PAILLETTE_API_URL: 'https://paillette-api-stg.berlayar.ai' },
      },
    },
    params: { '*': path },
    request: new Request(
      `https://paillette-stg.berlayar.ai/api/backend/${path}`
    ),
  }) as any;

const assetArgs = (assetId = 'asset-123') =>
  ({
    context: {
      cloudflare: {
        env: { PAILLETTE_API_URL: 'https://paillette-api-stg.berlayar.ai' },
      },
    },
    params: { assetId },
    request: new Request(
      `https://paillette-stg.berlayar.ai/api/public-assets/${assetId}/content`,
      { headers: { 'If-None-Match': '"asset-etag"' } }
    ),
  }) as any;

describe('WorkOS authenticated resource proxies', () => {
  beforeEach(() => {
    withWorkOSSessionMock.mockImplementation(
      async (_args: unknown, handler: (value: unknown) => unknown) =>
        handler(session)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('forwards quota exhaustion intact without exposing the bearer to the browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'NGS_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
            details: { quota: { limit: 1000, used: 1000, remaining: 0 } },
          },
        }),
        {
          status: 429,
          headers: {
            'Cache-Control': 'private, no-store',
            'Retry-After': '60',
            'X-NGS-Search-Limit': '1000',
            'X-NGS-Search-Used': '1000',
            'X-NGS-Search-Remaining': '0',
            'X-NGA-Search-Limit': '1000',
            'X-NGA-Search-Used': '1000',
            'X-NGA-Search-Remaining': '0',
            'Set-Cookie': 'upstream-refresh=1; HttpOnly; Secure',
          },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await backendLoader(backendArgs());
    const upstream = fetchMock.mock.calls[0]?.[0] as URL;
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(upstream.toString()).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/orgs/ngs/search/quota'
    );
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer workos-access-token'
    );
    expect((init.headers as Headers).get('X-User-Id')).toBeNull();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('X-NGS-Search-Remaining')).toBe('0');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('0');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'NGS_PUBLIC_SEARCH_QUOTA_EXHAUSTED' },
    });
  });

  it('does not contact the API without a WorkOS session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    withWorkOSSessionMock.mockImplementationOnce(
      async (_args: unknown, handler: (value: unknown) => unknown) =>
        handler({ accessToken: null, user: null })
    );

    const response = await backendLoader(backendArgs());

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed instead of following a backend redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://example.test' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await backendLoader(backendArgs());

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BACKEND_REDIRECT_REJECTED' },
    });
  });

  it('streams an approved protected asset and strips upstream-only headers', async () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(image, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(image.byteLength),
          ETag: '"asset-etag"',
          'Cache-Control': 'public, max-age=86400',
          'Set-Cookie': 'upstream-refresh=1; HttpOnly; Secure',
          'X-Internal-Debug': 'never-forward',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await assetLoader(assetArgs());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/assets/asset-123/content'
    );
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer workos-access-token'
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('X-Internal-Debug')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image);
  });
});
