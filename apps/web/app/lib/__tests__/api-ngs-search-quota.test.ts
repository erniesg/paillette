import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';

const getAccessToken = vi.fn(async () => 'access-token');

describe('NGS search quota API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getAccessToken.mockClear();
  });

  it('loads quota through the same-origin session proxy without exposing a bearer', async () => {
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
      apiClient.getNgsSearchQuota('ngs', getAccessToken, controller.signal)
    ).resolves.toEqual({
      limit: 1000,
      used: 9,
      remaining: 991,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/backend/orgs/ngs/search/quota',
      expect.objectContaining({
        headers: {},
        signal: controller.signal,
      })
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('preserves exhausted search code and quota details for the UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'NGS_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
              message: 'No free searches remain.',
              details: { quota: { limit: 1000, used: 1000, remaining: 0 } },
            },
          }),
          { status: 429 }
        )
      )
    );

    await expect(
      apiClient.searchText('ngs', { query: 'river' }, getAccessToken)
    ).rejects.toMatchObject({
      code: 'NGS_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
      details: { quota: { limit: 1000, used: 1000, remaining: 0 } },
    });
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
