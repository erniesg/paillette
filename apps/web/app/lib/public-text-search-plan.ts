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
  constraints?: import('@paillette/types/public-search-core').PublicSearchConstraints;
};

export const buildPublicTextSearchPlan = ({
  orgId,
  facet,
  committedTextQuery,
  colourQuery,
  topK,
  minScore,
  constraints,
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
    ...(constraints ? { constraints } : {}),
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
      JSON.stringify(constraints || null),
    ] as const,
  };
};

export type PublicTextSearchPlan = NonNullable<
  ReturnType<typeof buildPublicTextSearchPlan>
>;
