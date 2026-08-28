import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';

const getAccessToken = vi.fn(async () => 'access-token');

describe('NGA public search quota API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getAccessToken.mockClear();
  });

  it('loads public NGA quota through the same-origin proxy without a bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { limit: 1000, used: 9, remaining: 991 },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(
      apiClient.getNgaPublicSearchQuota(controller.signal)
    ).resolves.toEqual({
      limit: 1000,
      used: 9,
      remaining: 991,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public-search/nga/quota',
      expect.objectContaining({
        signal: controller.signal,
      })
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('uses the same-origin session proxy for authenticated NGS browsing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [],
          pagination: { total: 0 },
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiClient.listArtworks('ngs', {
        limit: 60,
        offset: 0,
        sortBy: 'title',
        sortOrder: 'asc',
      })
    ).resolves.toEqual({ artworks: [], total: 0 });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/backend/orgs/ngs/artworks?limit=60&sort_by=title&sort_order=asc&org_id=ngs'
    );
  });
});
