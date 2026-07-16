import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadArtworkDetailPage } from '../public-route-loaders.server';

describe('loadArtworkDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not request protected artwork data without a session token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loadArtworkDetailPage({
        request: new Request('https://paillette.berlayar.ai/ngs/artworks/a1'),
        requestedOrgId: 'ngs',
        artworkId: 'a1',
        routeScope: 'org',
        accessToken: null,
        apiBaseUrl: 'https://paillette-api.berlayar.ai/api/v1',
      })
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the WorkOS token only from the server-side detail loader', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: { id: 'org-1', slug: 'national-gallery-singapore' },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: { id: 'a1', galleryId: 'org-1', title: 'Blue' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadArtworkDetailPage({
      request: new Request('https://paillette.berlayar.ai/ngs/artworks/a1'),
      requestedOrgId: 'ngs',
      artworkId: 'a1',
      routeScope: 'org',
      accessToken: 'workos-token',
      apiBaseUrl: 'https://paillette-api.berlayar.ai/api/v1',
    });

    expect(result.artwork.title).toBe('Blue');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        headers: { Authorization: 'Bearer workos-token' },
      });
    }
  });
});
