import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES,
} from '@paillette/types/public-search-core';
import type { PublicSearchSpotlightBundle } from '@paillette/types/public-search';
import type { ArtworkSearchResult } from '~/types';
import { NGA_SEARCH_SPOTLIGHT_ASSET_PATH } from './generated-search-spotlight-assets';
import { NGA_SPOTLIGHT_DEFINITIONS } from './nga-spotlight-definitions';

type SearchSpotlightProvider = 'nga';
type SpotlightFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type LoadSearchSpotlightOptions = {
  fetcher?: SpotlightFetch;
  signal?: AbortSignal;
};

class SearchSpotlightValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchSpotlightValidationError';
  }
}

const hasExpectedNgaSuggestions = (bundle: PublicSearchSpotlightBundle) => {
  if (bundle.suggestions.length !== NGA_SPOTLIGHT_DEFINITIONS.length) {
    return false;
  }

  const byId = new Map(
    bundle.suggestions.map((suggestion) => [suggestion.id, suggestion])
  );
  return NGA_SPOTLIGHT_DEFINITIONS.every((definition) => {
    const suggestion = byId.get(definition.id);
    return (
      suggestion?.type === definition.type &&
      suggestion.label === definition.label &&
      suggestion.query === definition.query &&
      suggestion.dot.toLowerCase() === definition.dot.toLowerCase() &&
      (suggestion.facet || null) ===
        ('facet' in definition ? definition.facet : null) &&
      (suggestion.colourId || null) ===
        ('colourId' in definition ? definition.colourId : null)
    );
  });
};

export const getSearchSpotlightPath = (provider: SearchSpotlightProvider) => {
  switch (provider) {
    case 'nga': {
      const expectedPath = new RegExp(
        `^/search-spotlights/nga/v${PUBLIC_SEARCH_CONTRACT_VERSION}-[a-f0-9]{64}\\.json$`
      );
      if (!expectedPath.test(NGA_SEARCH_SPOTLIGHT_ASSET_PATH)) {
        throw new SearchSpotlightValidationError(
          'NGA spotlight asset does not match the active search contract'
        );
      }
      return NGA_SEARCH_SPOTLIGHT_ASSET_PATH;
    }
  }
};

export const loadSearchSpotlightBundle = async (
  provider: SearchSpotlightProvider,
  { fetcher = fetch, signal }: LoadSearchSpotlightOptions = {}
): Promise<PublicSearchSpotlightBundle | null> => {
  const response = await fetcher(getSearchSpotlightPath(provider), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`NGA spotlight asset returned ${response.status}`);
  }

  const text = await response.text();
  if (
    new TextEncoder().encode(text).byteLength >
    PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES
  ) {
    throw new SearchSpotlightValidationError(
      'NGA spotlight asset exceeds its size limit'
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new SearchSpotlightValidationError(
      'NGA spotlight asset is not valid JSON'
    );
  }

  const { PublicSearchSpotlightBundleSchema } = await import(
    '@paillette/types/public-search'
  );
  const parsed = PublicSearchSpotlightBundleSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.provider !== provider ||
    !hasExpectedNgaSuggestions(parsed.data)
  ) {
    throw new SearchSpotlightValidationError(
      'NGA spotlight asset does not match the active suggestion contract'
    );
  }

  return parsed.data;
};

export const getSpotlightArtworks = (
  bundle: PublicSearchSpotlightBundle | null | undefined,
  suggestionId: string
): ArtworkSearchResult[] => {
  const suggestion = bundle?.suggestions.find(
    (candidate) => candidate.id === suggestionId
  );
  if (!suggestion) return [];

  return suggestion.artworks.map((artwork) => ({
    id: artwork.id,
    orgId: artwork.orgId,
    galleryId: artwork.orgId,
    title: artwork.title,
    artist: artwork.artist,
    year: artwork.year,
    imageUrl: artwork.imageUrl ?? null,
    thumbnailUrl: artwork.thumbnailUrl ?? null,
    similarity: artwork.similarity,
    metadata: {
      provider: artwork.source.provider,
      sourceInstitution: artwork.source.institution,
      sourceUrl: artwork.source.url,
      sourceRecordId: artwork.source.recordId,
      accessionNumber: artwork.source.accessionNumber,
      rights: artwork.source.rights,
      dominantColors: artwork.palette,
    },
  }));
};
