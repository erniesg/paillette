import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES,
  normalizePublicSearchText,
} from '@paillette/types/public-search-core';
import type { PublicSearchSpotlightBundle } from '@paillette/types/public-search';
import type { ArtworkSearchResult, SearchResponse } from '~/types';
import { apiClient } from './api';
import { NGA_SEARCH_SPOTLIGHT_ASSET_PATH } from './generated-search-spotlight-assets';
import { NGS_SEARCH_SPOTLIGHT_API_PATH } from './generated-ngs-search-spotlight-asset';
import { NGA_SPOTLIGHT_DEFINITIONS } from './nga-spotlight-definitions';
import { NGS_SPOTLIGHT_DEFINITIONS } from './ngs-spotlight-definitions';

type SearchSpotlightProvider = 'nga' | 'ngs';
type AccessTokenProvider = () => Promise<string | undefined>;
type SpotlightFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type LoadSearchSpotlightOptions = {
  fetcher?: SpotlightFetch;
  getAccessToken?: AccessTokenProvider;
  signal?: AbortSignal;
};

class SearchSpotlightValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchSpotlightValidationError';
  }
}

const normalizeDisplayIdentityPart = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const getDisplayIdentity = (artwork: ArtworkSearchResult) => {
  const title = artwork.title && normalizeDisplayIdentityPart(artwork.title);
  const artist = artwork.artist && normalizeDisplayIdentityPart(artwork.artist);
  const year = artwork.year;

  if (!title || !artist || !Number.isFinite(year)) return `id:${artwork.id}`;

  return `display:${title}:${artist}:${year}`;
};

const dedupeSpotlightArtworks = (artworks: ArtworkSearchResult[]) => {
  const seenIdentities = new Set<string>();

  return artworks.filter((artwork) => {
    const identity = getDisplayIdentity(artwork);
    if (seenIdentities.has(identity)) return false;

    seenIdentities.add(identity);
    return true;
  });
};

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

const hasExpectedNgsSuggestions = (bundle: PublicSearchSpotlightBundle) => {
  if (bundle.suggestions.length !== NGS_SPOTLIGHT_DEFINITIONS.length) {
    return false;
  }

  const byId = new Map(
    bundle.suggestions.map((suggestion) => [suggestion.id, suggestion])
  );
  return NGS_SPOTLIGHT_DEFINITIONS.every((definition) => {
    const suggestion = byId.get(definition.id);
    return (
      suggestion?.type === definition.type &&
      suggestion.label === definition.label &&
      suggestion.query === definition.query &&
      suggestion.dot.toLowerCase() === definition.dot.toLowerCase() &&
      (suggestion.facet || null) === null &&
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
    case 'ngs': {
      const expectedPath = new RegExp(
        `^/orgs/ngs/search-spotlights/v${PUBLIC_SEARCH_CONTRACT_VERSION}-[a-f0-9]{64}$`
      );
      if (!expectedPath.test(NGS_SEARCH_SPOTLIGHT_API_PATH)) {
        throw new SearchSpotlightValidationError(
          'NGS spotlight asset does not match the active search contract'
        );
      }
      return NGS_SEARCH_SPOTLIGHT_API_PATH;
    }
  }
};

export const loadSearchSpotlightBundle = async (
  provider: SearchSpotlightProvider,
  { fetcher = fetch, getAccessToken, signal }: LoadSearchSpotlightOptions = {}
): Promise<PublicSearchSpotlightBundle | null> => {
  const path = getSearchSpotlightPath(provider);
  const text =
    provider === 'ngs'
      ? JSON.stringify(
          await apiClient.getSearchSpotlightBundle(
            path,
            getAccessToken ||
              (() => Promise.reject(new Error('Sign in is required'))),
            signal
          )
        )
      : await (async () => {
          const response = await fetcher(path, {
            headers: { Accept: 'application/json' },
            signal,
          });
          if (!response.ok) {
            throw new Error(
              `${provider.toUpperCase()} spotlight asset returned ${response.status}`
            );
          }
          return response.text();
        })();
  if (
    new TextEncoder().encode(text).byteLength >
    PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES
  ) {
    throw new SearchSpotlightValidationError(
      `${provider.toUpperCase()} spotlight asset exceeds its size limit`
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new SearchSpotlightValidationError(
      `${provider.toUpperCase()} spotlight asset is not valid JSON`
    );
  }

  const { PublicSearchSpotlightBundleSchema } = await import(
    '@paillette/types/public-search'
  );
  const parsed = PublicSearchSpotlightBundleSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.provider !== provider ||
    !(provider === 'nga'
      ? hasExpectedNgaSuggestions(parsed.data)
      : hasExpectedNgsSuggestions(parsed.data))
  ) {
    throw new SearchSpotlightValidationError(
      `${provider.toUpperCase()} spotlight asset does not match the active suggestion contract`
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

  return dedupeSpotlightArtworks(
    suggestion.artworks.map((artwork) => ({
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
    }))
  );
};

export const getSpotlightSearchPlaceholder = (
  bundle: PublicSearchSpotlightBundle | null | undefined,
  {
    query,
    facet,
    colourId,
    topK,
    minScore,
  }: {
    query: string;
    facet?: 'artist' | 'classification' | null;
    colourId?: string | null;
    topK: number;
    minScore: number;
  }
): SearchResponse | undefined => {
  const normalizedQuery =
    normalizePublicSearchText(query).toLocaleLowerCase('en-US');
  if (!bundle || !normalizedQuery) return undefined;

  const suggestion = bundle.suggestions.find(
    (candidate) =>
      normalizePublicSearchText(candidate.query).toLocaleLowerCase('en-US') ===
        normalizedQuery &&
      (candidate.facet || null) === (facet || null) &&
      (candidate.colourId || null) === (colourId || null)
  );
  if (!suggestion) return undefined;

  const results = getSpotlightArtworks(bundle, suggestion.id)
    .filter((artwork) => artwork.similarity >= minScore)
    .slice(0, topK);

  return {
    results,
    count: results.length,
    queryTime: 0,
  };
};
