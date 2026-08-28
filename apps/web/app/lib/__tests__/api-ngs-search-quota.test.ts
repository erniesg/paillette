import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';

const getAccessToken = vi.fn(async () => 'access-token');

describe('NGS search quota API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getAccessToken.mockClear();
  });

  it('loads the authenticated quota without consuming a search', async () => {
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

    await expect(
      apiClient.getNgsSearchQuota('ngs', getAccessToken)
    ).resolves.toEqual({
      limit: 1000,
      used: 9,
      remaining: 991,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/orgs\/ngs\/search\/quota$/),
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token' },
      })
    );
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
});
