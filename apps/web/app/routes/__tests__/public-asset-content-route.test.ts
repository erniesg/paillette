import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { withWorkOSResourceSessionMock } = vi.hoisted(() => ({
  withWorkOSResourceSessionMock: vi.fn(),
}));

vi.mock('~/lib/workos-auth.server', () => ({
  withWorkOSResourceSession: withWorkOSResourceSessionMock,
}));

import { loader } from '../api.public-assets.$assetId.content';

const makeArgs = (assetId = 'asset-123') =>
  ({
    context: {
      cloudflare: {
        env: {
          PAILLETTE_API_URL: 'https://paillette-api-stg.berlayar.ai',
        },
      },
    },
    params: { assetId },
    request: new Request(
      `https://paillette-stg.berlayar.ai/api/public-assets/${assetId}/content`,
      {
        headers: {
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          'If-None-Match': '"asset-etag"',
        },
      }
    ),
  }) as any;

describe('public asset content route', () => {
  beforeEach(() => {
    withWorkOSResourceSessionMock.mockImplementation(
      async (_args: unknown, handler: (session: unknown) => unknown) =>
        handler({
          accessToken: 'workos-access-token',
          user: { id: 'user_approved', email: 'hello@ernie.sg' },
        })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams an authenticated upstream image through the same origin', async () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const mockFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(image, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(image.byteLength),
            ETag: '"asset-etag"',
            'X-Internal-Debug': 'do-not-forward',
          },
        })
    );
    vi.stubGlobal('fetch', mockFetch);

    const response = await loader(makeArgs());
    const upstreamRequest = mockFetch.mock.calls[0]?.[0] as Request;

    expect(upstreamRequest.url).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/assets/asset-123/content'
    );
    expect(upstreamRequest.headers.get('Authorization')).toBe(
      'Bearer workos-access-token'
    );
    expect(upstreamRequest.headers.get('If-None-Match')).toBe('"asset-etag"');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(response.headers.get('X-Internal-Debug')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image);
  });

  it('does not contact the asset API without a WorkOS access token', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', mockFetch);
    withWorkOSResourceSessionMock.mockImplementationOnce(
      async (_args: unknown, handler: (session: unknown) => unknown) =>
        handler({ accessToken: null, user: null })
    );

    const response = await loader(makeArgs());

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects malformed asset ids before making an upstream request', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', mockFetch);

    const response = await loader(makeArgs('../private'));

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
