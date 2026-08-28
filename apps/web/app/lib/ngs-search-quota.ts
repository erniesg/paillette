import type { PublicSearchQuota } from '@paillette/types/public-search';

export type NgsSearchQuota = PublicSearchQuota;

const isNgsSearchQuota = (value: unknown): value is NgsSearchQuota => {
  if (!value || typeof value !== 'object') return false;
  const quota = value as Record<string, unknown>;
  return (
    typeof quota.limit === 'number' &&
    typeof quota.used === 'number' &&
    typeof quota.remaining === 'number'
  );
};

export const getNgsSearchQuota = (value: unknown) =>
  isNgsSearchQuota(value) ? value : null;

export const formatNgsSearchQuota = (quota: NgsSearchQuota) =>
  `${quota.remaining.toLocaleString()} free searches left`;

export const NGS_SEARCH_QUERY_OPTIONS = { staleTime: 0 } as const;

export const NGS_SEARCH_QUOTA_QUERY_OPTIONS = {
  staleTime: 5_000,
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;

export const isNgsSearchQuotaExhausted = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'NGS_PUBLIC_SEARCH_QUOTA_EXHAUSTED'
  );

export const getNgsSearchQuotaFromError = (error: unknown) => {
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const quota = (details as { quota?: unknown }).quota;
  return getNgsSearchQuota(quota);
};
