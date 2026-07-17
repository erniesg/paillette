import { afterEach, describe, expect, it, vi } from 'vitest';

const { withWorkOSResourceSessionMock } = vi.hoisted(() => ({
  withWorkOSResourceSessionMock: vi.fn(
    async (_args: unknown, handler: (session: unknown) => unknown) =>
      handler({ accessToken: null, user: null })
  ),
}));

vi.mock('~/lib/workos-auth.server', () => ({
  withWorkOSResourceSession: withWorkOSResourceSessionMock,
}));

import { loader as browseLoader } from '../api.public-search.$orgId.browse';
import { action as imageAction } from '../api.public-search.$orgId.image';
import { loader as backendLoader } from '../api.backend.$';

describe('anonymous data boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns synthetic browse tiles without contacting the API', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await browseLoader({
      context: {},
      params: { orgId: 'ngs' },
      request: new Request(
        'https://paillette.test/api/public-search/ngs/browse?limit=6'
      ),
    } as any);
    const payload = (await response.json()) as any;

    expect(response.headers.get('X-Paillette-Search-Access')).toBe('locked');
    expect(payload.data.results).toHaveLength(6);
    expect(payload.data.results[0].id).toBe('locked-preview-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns synthetic image-search tiles without reading or forwarding the image', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await imageAction({
      context: {},
      params: { orgId: 'ngs' },
      request: new Request(
        'https://paillette.test/api/public-search/ngs/image',
        { method: 'POST' }
      ),
    } as any);
    const payload = (await response.json()) as any;

    expect(response.headers.get('X-Paillette-Search-Access')).toBe('locked');
    expect(payload.data.results[0].metadata.lockedPreview).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects the generic API proxy without a server session', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await backendLoader({
      context: {},
      params: { '*': 'me/api-keys' },
      request: new Request('https://paillette.test/api/backend/me/api-keys'),
    } as any);
    const payload = (await response.json()) as any;

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams authenticated image responses through the generic API proxy', async () => {
    withWorkOSResourceSessionMock.mockImplementationOnce(
      async (_args: unknown, handler: (session: unknown) => unknown) =>
        handler({ accessToken: 'workos-access-token', user: { id: 'user-1' } })
    );
    const imageBytes = new Uint8Array([255, 216, 255, 217]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(imageBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await backendLoader({
      context: {},
      params: { '*': 'assets/artwork-1/content' },
      request: new Request(
        'https://paillette.test/api/backend/assets/artwork-1/content'
      ),
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://paillette-api-stg.berlayar.ai/api/v1/assets/artwork-1/content'
    );
    const upstreamInit = fetchMock.mock.calls[0]?.[1];
    expect(upstreamInit?.method).toBe('GET');
    expect(new Headers(upstreamInit?.headers).get('Authorization')).toBe(
      'Bearer workos-access-token'
    );
  });
});
