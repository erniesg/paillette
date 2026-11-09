import { useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PublicTextSearchPlan } from './public-text-search-plan';

export const getIdleSearchPreviewKey = (plan: PublicTextSearchPlan) =>
  ['idle-search-preview', ...plan.queryKey] as const;

export function useIdleSearchPreview({
  plan,
  enabled,
  getAccessToken,
}: {
  plan: PublicTextSearchPlan | null;
  enabled: boolean;
  getAccessToken: () => Promise<string | undefined>;
}) {
  return useQuery({
    queryKey: plan
      ? getIdleSearchPreviewKey(plan)
      : ['idle-search-preview', 'disabled'],
    // Do not consume the observer's abort signal: rotation must not cancel an
    // active preview. Its result remains available on the next rotation.
    queryFn: () =>
      plan
        ? apiClient.searchText(plan.queryKey[3], plan.request, getAccessToken)
        : null,
    // A failed automatic preview also stays quiet until cache expiry. Explicit
    // submissions use a separate query and can always retry through the API.
    enabled: (query) =>
      enabled && Boolean(plan) && query.state.status !== 'error',
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
