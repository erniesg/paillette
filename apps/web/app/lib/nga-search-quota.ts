import type { PublicSearchQuota } from '@paillette/types/public-search';
import type { QueryClient } from '@tanstack/react-query';

export type NgaSearchQuota = PublicSearchQuota;

const isNgaSearchQuota = (value: unknown): value is NgaSearchQuota => {
  if (!value || typeof value !== 'object') return false;
  const quota = value as Record<string, unknown>;
  return (
    typeof quota.limit === 'number' &&
    typeof quota.used === 'number' &&
    typeof quota.remaining === 'number'
  );
};

export const getNgaSearchQuota = (value: unknown) =>
  isNgaSearchQuota(value) ? value : null;

export const getNgaSearchQuotaFromHeaders = (headers: Headers) => {
  const rawLimit = headers.get('X-NGA-Search-Limit');
  const rawUsed = headers.get('X-NGA-Search-Used');
  const rawRemaining = headers.get('X-NGA-Search-Remaining');
  if (
    !rawLimit?.trim() ||
    !rawUsed?.trim() ||
    !rawRemaining?.trim()
  ) {
    return null;
  }

  const limit = Number(rawLimit);
  const used = Number(rawUsed);
  const remaining = Number(rawRemaining);
  const quota = { limit, used, remaining };

  if (
    !Number.isSafeInteger(limit) ||
    !Number.isSafeInteger(used) ||
    !Number.isSafeInteger(remaining) ||
    limit < 0 ||
    used < 0 ||
    remaining < 0 ||
    used + remaining !== limit
  ) {
    return null;
  }

  return quota;
};

export const withNgaSearchQuotaFromHeaders = (
  details: Record<string, unknown> | undefined,
  headers: Headers
) => {
  const quota = getNgaSearchQuotaFromHeaders(headers);
  return quota ? { ...details, quota } : details;
};

export const formatNgaSearchQuota = (quota: NgaSearchQuota) =>
  `${quota.remaining.toLocaleString()} free searches left`;

export const NGA_SEARCH_QUOTA_QUERY_OPTIONS = {
  staleTime: 5_000,
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;

export const getNgaSearchQuotaQueryKey = () => ['nga-search-quota'] as const;

export const reconcileNgaSearchQuota = async (
  queryClient: QueryClient,
  quota: NgaSearchQuota
) => {
  const queryKey = getNgaSearchQuotaQueryKey();
  await queryClient.cancelQueries({ queryKey });
  const currentQuota = queryClient.getQueryData<NgaSearchQuota>(queryKey);
  if (currentQuota && quota.remaining > currentQuota.remaining) return;
  queryClient.setQueryData(queryKey, quota);
};

export const canRetryNgaSearch = (hasExhaustedQuota: boolean) =>
  !hasExhaustedQuota;

export const isNgaSearchQuotaExhausted = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED'
  );

export const getNgaSearchQuotaFromError = (error: unknown) => {
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const quota = (details as { quota?: unknown }).quota;
  return getNgaSearchQuota(quota);
};
