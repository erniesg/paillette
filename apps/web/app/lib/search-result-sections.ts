import type { ArtworkSearchResult } from '~/types';

export type SearchResultSections = {
  rankedResults: ArtworkSearchResult[];
  browseResults: ArtworkSearchResult[];
  combinedResults: ArtworkSearchResult[];
  hasBrowseDivider: boolean;
};

const resultKey = (result: ArtworkSearchResult) =>
  String(
    result.id ||
      result.metadata?.accessionNumber ||
      result.metadata?.accession_number ||
      ''
  )
    .trim()
    .toLowerCase();

export function buildSearchResultSections({
  isBrowsingCollection,
  rankedResults,
  browseResults,
}: {
  isBrowsingCollection: boolean;
  rankedResults: ArtworkSearchResult[];
  browseResults: ArtworkSearchResult[];
}): SearchResultSections {
  if (!isBrowsingCollection) {
    return {
      rankedResults: [],
      browseResults: rankedResults,
      combinedResults: rankedResults,
      hasBrowseDivider: false,
    };
  }

  const rankedKeys = new Set(rankedResults.map(resultKey).filter(Boolean));
  const browseOnlyResults = browseResults.filter((result) => {
    const key = resultKey(result);
    return !key || !rankedKeys.has(key);
  });

  return {
    rankedResults,
    browseResults: browseOnlyResults,
    combinedResults: [...rankedResults, ...browseOnlyResults],
    hasBrowseDivider: rankedResults.length > 0 && browseOnlyResults.length > 0,
  };
}

export function getSafeSearchReturnPath(
  rawPath: string | null | undefined,
  preferredRouteId: string
) {
  if (!rawPath || rawPath.startsWith('//')) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawPath, 'https://paillette.local');
  } catch {
    return null;
  }

  if (parsed.origin !== 'https://paillette.local') return null;

  const expectedPrefix = `/${encodeURIComponent(preferredRouteId)}/search`;
  if (parsed.pathname !== expectedPrefix) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
