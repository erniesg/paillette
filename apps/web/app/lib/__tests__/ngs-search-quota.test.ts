import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  formatNgsSearchQuota,
  canRetryNgsSearch,
  getNgsSearchQuota,
  getNgsSearchQuotaFromError,
  isNgsSearchQuotaExhausted,
  NGS_SEARCH_QUERY_OPTIONS,
  NGS_SEARCH_QUOTA_QUERY_OPTIONS,
  reconcileNgsSearchQuota,
} from '../ngs-search-quota';

describe('NGS search quota presentation', () => {
  it('formats the remaining allowance for the visible counter', () => {
    expect(
      formatNgsSearchQuota({ limit: 1000, used: 0, remaining: 1000 })
    ).toBe('1,000 free searches left');
  });

  it('uses quota returned by a successful search response to decrement the counter', () => {
    expect(
      formatNgsSearchQuota(
        getNgsSearchQuota({ limit: 1000, used: 1, remaining: 999 })!
      )
    ).toBe('999 free searches left');
  });

  it('recognises an exhausted quota error and uses its quota details', () => {
    const error = {
      code: 'NGS_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
      message: 'No free searches remain.',
      details: {
        quota: { limit: 1000, used: 1000, remaining: 0 },
      },
    };

    expect(isNgsSearchQuotaExhausted(error)).toBe(true);
    expect(getNgsSearchQuotaFromError(error)).toEqual({
      limit: 1000,
      used: 1000,
      remaining: 0,
    });
  });

  it('does not mistake unrelated API errors for quota exhaustion', () => {
    expect(
      isNgsSearchQuotaExhausted({
        code: 'PUBLIC_SEARCH_UNAVAILABLE',
        message: 'Search is temporarily unavailable.',
      })
    ).toBe(false);
  });

  it('keeps a cached spotlight visible while scheduling one counted NGS search', async () => {
    const queryClient = new QueryClient();
    const cached = { results: [], count: 0, queryTime: 0 };
    const queryFn = vi.fn().mockResolvedValue({
      results: [{ id: 'fresh-result' }],
      count: 1,
      queryTime: 12,
    });
    expect(NGS_SEARCH_QUERY_OPTIONS).toEqual({ staleTime: 0 });
    const observer = new QueryObserver(queryClient, {
      queryKey: ['ngs', 'spotlight', 'river'],
      queryFn,
      initialData: cached,
      ...NGS_SEARCH_QUERY_OPTIONS,
    });

    expect(observer.getCurrentResult().data).toEqual(cached);
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    unsubscribe();
    queryClient.clear();
  });

  it('refreshes the shared NGS quota without aggressive polling', () => {
    expect(NGS_SEARCH_QUOTA_QUERY_OPTIONS).toEqual({
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
      queryKey: ['ngs-search-quota', 'ngs'],
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
    await reconcileNgsSearchQuota(queryClient, 'ngs', {
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    resolveStaleQuota?.({ limit: 1000, used: 0, remaining: 1000 });

    expect(queryClient.getQueryData(['ngs-search-quota', 'ngs'])).toEqual({
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    unsubscribe();
    queryClient.clear();
  });

  it('suppresses retry when the quota is exhausted even for a non-quota error', () => {
    expect(canRetryNgsSearch(true)).toBe(false);
    expect(canRetryNgsSearch(false)).toBe(true);
  });
});
