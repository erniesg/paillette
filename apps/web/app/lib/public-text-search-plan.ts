import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  normalizePublicSearchText,
} from '@paillette/types/public-search-core';

type PublicSearchFacet = 'artist' | 'classification';

type PublicTextSearchPlanInput = {
  orgId: string;
  facet: PublicSearchFacet | null;
  committedTextQuery: string;
  colourQuery: string | null;
  topK: number;
  minScore: number;
};

export const buildPublicTextSearchPlan = ({
  orgId,
  facet,
  committedTextQuery,
  colourQuery,
  topK,
  minScore,
}: PublicTextSearchPlanInput) => {
  const textQuery = normalizePublicSearchText(committedTextQuery);
  const fallbackColourQuery = colourQuery
    ? normalizePublicSearchText(colourQuery)
    : '';
  const query = textQuery || fallbackColourQuery;
  if (!query) return null;

  const request = {
    query,
    topK,
    minScore,
    ...(facet ? { facet } : {}),
  };

  return {
    request,
    queryKey: [
      'search',
      'text',
      PUBLIC_SEARCH_CONTRACT_VERSION,
      orgId,
      facet || 'semantic',
      query,
      topK,
      minScore,
    ] as const,
  };
};

export type PublicTextSearchPlan = NonNullable<
  ReturnType<typeof buildPublicTextSearchPlan>
>;
