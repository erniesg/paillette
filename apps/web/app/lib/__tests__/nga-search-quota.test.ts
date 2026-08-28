import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  formatNgaSearchQuota,
  canRetryNgaSearch,
  getNgaSearchQuota,
  getNgaSearchQuotaFromHeaders,
  getNgaSearchQuotaFromError,
  withNgaSearchQuotaFromHeaders,
  isNgaSearchQuotaExhausted,
  NGA_SEARCH_QUOTA_QUERY_OPTIONS,
  reconcileNgaSearchQuota,
} from '../nga-search-quota';

describe('NGA public search quota presentation', () => {
  it('formats the remaining allowance for the visible counter', () => {
    expect(
      formatNgaSearchQuota({ limit: 1000, used: 0, remaining: 1000 })
    ).toBe('1,000 free searches left');
  });

  it('uses quota returned by a successful search response to decrement the counter', () => {
    expect(
      formatNgaSearchQuota(
        getNgaSearchQuota({ limit: 1000, used: 1, remaining: 999 })!
      )
    ).toBe('999 free searches left');
  });

  it('recognises an exhausted quota error and uses its quota details', () => {
    const error = {
      code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
      message: 'No free searches remain.',
      details: {
        quota: { limit: 1000, used: 1000, remaining: 0 },
      },
    };

    expect(isNgaSearchQuotaExhausted(error)).toBe(true);
    expect(getNgaSearchQuotaFromError(error)).toEqual({
      limit: 1000,
      used: 1000,
      remaining: 0,
    });
  });

  it('reads the counted quota from a post-reservation upstream error', async () => {
    const quota = getNgaSearchQuotaFromHeaders(
      new Headers({
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '1',
        'X-NGA-Search-Remaining': '999',
      })
    );
    const queryClient = new QueryClient();

    expect(quota).toEqual({ limit: 1000, used: 1, remaining: 999 });
    await reconcileNgaSearchQuota(queryClient, quota!);
    expect(queryClient.getQueryData(['nga-search-quota'])).toEqual(quota);
    queryClient.clear();
  });

  it('attaches a post-reservation limiter quota to the client error details', () => {
    const details = withNgaSearchQuotaFromHeaders(
      { retryable: true },
      new Headers({
        'X-NGA-Search-Limit': '1000',
        'X-NGA-Search-Used': '1',
        'X-NGA-Search-Remaining': '999',
      })
    );

    expect(
      getNgaSearchQuotaFromError({
        code: 'PUBLIC_SEARCH_COLD_MISS_RATE_LIMITED',
        details,
      })
    ).toEqual({ limit: 1000, used: 1, remaining: 999 });
  });

  it('does not mistake unrelated API errors for quota exhaustion', () => {
    expect(
      isNgaSearchQuotaExhausted({
        code: 'PUBLIC_SEARCH_UNAVAILABLE',
        message: 'Search is temporarily unavailable.',
      })
    ).toBe(false);
  });

  it('refreshes the shared NGA quota without aggressive polling', () => {
    expect(NGA_SEARCH_QUOTA_QUERY_OPTIONS).toEqual({
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    });
  });

  it('prevents a cancelled stale quota fetch from overwriting a newer search quota', async () => {
    const queryClient = new QueryClient();
    let resolveStaleQuota:
      | ((quota: { limit: number; used: number; remaining: number }) => void)
      | undefined;
    const observer = new QueryObserver(queryClient, {
    queryKey: ['nga-search-quota'],
      queryFn: ({ signal }) =>
        new Promise<{ limit: number; used: number; remaining: number }>(
          (resolve, reject) => {
            resolveStaleQuota = resolve;
            signal.addEventListener('abort', () => reject(signal.reason));
          }
        ),
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await vi.waitFor(() => expect(resolveStaleQuota).toBeTypeOf('function'));
    await reconcileNgaSearchQuota(queryClient, {
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    resolveStaleQuota?.({ limit: 1000, used: 0, remaining: 1000 });

    expect(queryClient.getQueryData(['nga-search-quota'])).toEqual({
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    unsubscribe();
    queryClient.clear();
  });

  it('does not let an older counted search response increase remaining quota', async () => {
    const queryClient = new QueryClient();

    await reconcileNgaSearchQuota(queryClient, {
      limit: 1000,
      used: 1000,
      remaining: 0,
    });
    await reconcileNgaSearchQuota(queryClient, {
      limit: 1000,
      used: 999,
      remaining: 1,
    });

    expect(queryClient.getQueryData(['nga-search-quota'])).toEqual({
      limit: 1000,
      used: 1000,
      remaining: 0,
    });
    queryClient.clear();
  });

  it('accepts a first, equal, or lower remaining quota from a counted search', async () => {
    const queryClient = new QueryClient();

    await reconcileNgaSearchQuota(queryClient, {
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    await reconcileNgaSearchQuota(queryClient, {
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    await reconcileNgaSearchQuota(queryClient, {
      limit: 1000,
      used: 2,
      remaining: 998,
    });

    expect(queryClient.getQueryData(['nga-search-quota'])).toEqual({
      limit: 1000,
      used: 2,
      remaining: 998,
    });
    queryClient.clear();
  });

  it('suppresses retry when the quota is exhausted even for a non-quota error', () => {
    expect(canRetryNgaSearch(true)).toBe(false);
    expect(canRetryNgaSearch(false)).toBe(true);
  });
});
