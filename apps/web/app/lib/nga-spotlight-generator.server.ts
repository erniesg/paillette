import {
  getPublicImageUrl,
  getPublicThumbnailUrl,
} from './public-artwork-metadata';
import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES,
  PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION,
  PublicSearchSpotlightBundleSchema,
  type PublicSearchSpotlightArtwork,
  type PublicSearchSpotlightBundle,
} from '@paillette/types/public-search';
import type { ArtworkSearchResult, SearchResponse } from '~/types';
import { rankByPaletteColour } from './local-colour-refinement';
import {
  NGA_SPOTLIGHT_DEFINITIONS,
  type NgaSpotlightDefinition,
} from './nga-spotlight-definitions';
import {
  NGS_SPOTLIGHT_DEFINITIONS,
  type NgsSpotlightDefinition,
} from './ngs-spotlight-definitions';

const NGA_PROVIDER = 'nga' as const;
const NGS_PROVIDER = 'ngs' as const;
const REQUEST_TOP_K = 30 as const;
const REQUEST_MIN_SCORE = 0.2 as const;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

type NgaSpotlightDefinitionId = NgaSpotlightDefinition['id'];
type NgsSpotlightDefinitionId = NgsSpotlightDefinition['id'];
type SpotlightProvider = typeof NGA_PROVIDER | typeof NGS_PROVIDER;
type SpotlightDefinition = NgaSpotlightDefinition | NgsSpotlightDefinition;

type SpotlightSearchRequest = {
  provider: SpotlightProvider;
  definitionId: string;
  query: string;
  topK: typeof REQUEST_TOP_K;
  minScore: typeof REQUEST_MIN_SCORE;
  facet?: 'artist' | 'classification';
};

export type NgaSpotlightSearchRequest = {
  provider: typeof NGA_PROVIDER;
  definitionId: NgaSpotlightDefinitionId;
  query: string;
  topK: typeof REQUEST_TOP_K;
  minScore: typeof REQUEST_MIN_SCORE;
  facet?: 'artist' | 'classification';
};

export type NgsSpotlightSearchRequest = {
  provider: typeof NGS_PROVIDER;
  definitionId: NgsSpotlightDefinitionId;
  query: string;
  topK: typeof REQUEST_TOP_K;
  minScore: typeof REQUEST_MIN_SCORE;
  facet?: 'artist' | 'classification';
};

export type GenerateNgaSpotlightBundleOptions = {
  corpusVersion: string;
  search: (request: NgaSpotlightSearchRequest) => Promise<SearchResponse>;
  now?: () => Date;
};

export type GenerateNgaSpotlightBundleResult = {
  bundle: PublicSearchSpotlightBundle;
  searchRequestCount: number;
};

export type GenerateNgsSpotlightBundleOptions = {
  corpusVersion: string;
  search: (request: NgsSpotlightSearchRequest) => Promise<SearchResponse>;
  now?: () => Date;
};

export type GenerateNgsSpotlightBundleResult = GenerateNgaSpotlightBundleResult;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asUrl = (value: unknown) => asText(value);

const getNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const hasPositiveWeight = (value: Record<string, unknown>) => {
  const weight = getNumber(
    value.percentage ?? value.percent ?? value.weight ?? value.ratio
  );
  return weight === undefined || weight > 0;
};

const getStoredPalette = (artwork: ArtworkSearchResult): string[] => {
  const metadata = asRecord(artwork.metadata);
  const colours: string[] = [];
  const seen = new Set<string>();

  const addColour = (value: unknown) => {
    if (typeof value !== 'string' || !HEX_COLOUR.test(value)) return;

    const normalized = value.toLowerCase();
    if (seen.has(normalized) || colours.length >= 32) return;

    seen.add(normalized);
    colours.push(normalized);
  };

  const readPalette = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          addColour(entry);
          continue;
        }

        const record = asRecord(entry);
        if (hasPositiveWeight(record)) {
          addColour(record.color ?? record.colour ?? record.hex);
        }
      }
      return;
    }

    const record = asRecord(value);
    const paletteColours = record.colors ?? record.colours;
    const percentages = Array.isArray(record.percentages)
      ? record.percentages
      : [];
    if (!Array.isArray(paletteColours)) return;

    for (const [index, colour] of paletteColours.entries()) {
      const weight = getNumber(percentages[index]);
      if (weight !== undefined && weight <= 0) continue;
      addColour(colour);
    }
  };

  for (const candidate of [
    metadata.dominantColors,
    metadata.dominant_colors,
    metadata.colorPalette,
    metadata.color_palette,
    metadata.colourPalette,
    metadata.colour_palette,
  ]) {
    readPalette(candidate);
  }

  return colours;
};

const isImageable = (artwork: ArtworkSearchResult) =>
  Boolean(asUrl(artwork.thumbnailUrl) || asUrl(artwork.imageUrl));

const hasRequiredCardMetadata = (artwork: ArtworkSearchResult) => {
  const metadata = asRecord(artwork.metadata);
  return Boolean(
    asText(artwork.id) &&
      asText(artwork.orgId || artwork.galleryId) &&
      asText(artwork.title) &&
      asText(metadata.sourceInstitution ?? metadata.source_institution)
  );
};

const assertProviderResults = (
  provider: SpotlightProvider,
  definition: SpotlightDefinition,
  results: readonly ArtworkSearchResult[]
) => {
  for (const result of results) {
    const metadata = asRecord(result.metadata);
    const sourceInstitution = asText(
      metadata.sourceInstitution ?? metadata.source_institution
    );
    const matchesProvider =
      provider === NGA_PROVIDER
        ? metadata.provider === NGA_PROVIDER
        : (metadata.provider === undefined ||
            metadata.provider === NGS_PROVIDER) &&
          sourceInstitution?.toLowerCase() === 'national gallery singapore';
    if (!matchesProvider) {
      throw new Error(
        `${provider.toUpperCase()} spotlight ${definition.id} returned non-${provider.toUpperCase()} artwork ${result.id}`
      );
    }
    if (
      provider === NGA_PROVIDER &&
      (metadata.isPublic === false || metadata.is_public === false)
    ) {
      throw new Error(
        `NGA spotlight ${definition.id} returned non-public artwork ${result.id}`
      );
    }
  }
};

const getRenderableUniqueResults = (
  definition: SpotlightDefinition,
  results: readonly ArtworkSearchResult[]
) => {
  const unique: ArtworkSearchResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (!isImageable(result) || !hasRequiredCardMetadata(result)) continue;
    if (seen.has(result.id)) continue;

    seen.add(result.id);
    unique.push(result);
  }

  if (unique.length === 0) {
    throw new Error(
      `NGA spotlight ${definition.id} requires at least one renderable unique artwork`
    );
  }

  if (definition.type !== 'colour') return unique;

  const selectedColour = definition.colourId.startsWith('custom:')
    ? definition.colourId.slice('custom:'.length)
    : definition.dot;
  return rankByPaletteColour(unique, [selectedColour], getStoredPalette);
};

const toSpotlightArtwork = (
  artwork: ArtworkSearchResult,
  provider: SpotlightProvider
): PublicSearchSpotlightArtwork => {
  const metadata = asRecord(artwork.metadata);
  const sourceInstitution = asText(
    metadata.sourceInstitution ?? metadata.source_institution
  );

  return {
    id: artwork.id,
    orgId: artwork.orgId || artwork.galleryId,
    title: asText(artwork.title)!,
    ...(asText(artwork.artist) ? { artist: asText(artwork.artist) } : {}),
    ...(Number.isInteger(artwork.year) ? { year: artwork.year } : {}),
    // The bundle is served to anonymous visitors straight off the CDN, so the
    // URLs baked into it have to be publicly fetchable. `artwork.imageUrl` is
    // Paillette's own asset URL, which requires a session and answers 401 —
    // every cached spotlight image failed to load. `getPublicImageUrl` prefers
    // the holding institution's CORS-open IIIF URL out of the record's
    // provenance, which is exactly what a cached, no-auth bundle needs.
    ...(asUrl(getPublicImageUrl(artwork))
      ? { imageUrl: asUrl(getPublicImageUrl(artwork)) }
      : {}),
    ...(asUrl(getPublicThumbnailUrl(artwork))
      ? { thumbnailUrl: asUrl(getPublicThumbnailUrl(artwork)) }
      : {}),
    similarity: artwork.similarity,
    source: {
      provider,
      institution: sourceInstitution!,
      ...(asText(metadata.sourceRecordId ?? metadata.source_record_id)
        ? {
            recordId: asText(
              metadata.sourceRecordId ?? metadata.source_record_id
            ),
          }
        : {}),
      ...(asUrl(metadata.sourceUrl ?? metadata.source_url)
        ? { url: asUrl(metadata.sourceUrl ?? metadata.source_url) }
        : {}),
      ...(asText(metadata.accessionNumber ?? metadata.accession_number)
        ? {
            accessionNumber: asText(
              metadata.accessionNumber ?? metadata.accession_number
            ),
          }
        : {}),
      ...(asText(metadata.rights) ? { rights: asText(metadata.rights) } : {}),
    },
    palette: getStoredPalette(artwork),
  };
};

const getSearchRequest = (
  provider: SpotlightProvider,
  definition: SpotlightDefinition
): SpotlightSearchRequest => ({
  provider,
  definitionId: definition.id,
  query: definition.query,
  topK: REQUEST_TOP_K,
  minScore: REQUEST_MIN_SCORE,
  ...('facet' in definition ? { facet: definition.facet } : {}),
});

const getSuggestion = async (
  provider: SpotlightProvider,
  definition: SpotlightDefinition,
  search: (request: SpotlightSearchRequest) => Promise<SearchResponse>
) => {
  const response = await search(getSearchRequest(provider, definition));
  assertProviderResults(provider, definition, response.results);
  const results = getRenderableUniqueResults(definition, response.results);

  return {
    ...definition,
    artworks: results
      .slice(0, REQUEST_TOP_K)
      .map((artwork) => toSpotlightArtwork(artwork, provider)),
  };
};

const getUtf8Size = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const generateSpotlightBundle = async ({
  provider,
  definitions,
  corpusVersion,
  search,
  now = () => new Date(),
}: {
  provider: SpotlightProvider;
  definitions: readonly SpotlightDefinition[];
  corpusVersion: string;
  search: (request: SpotlightSearchRequest) => Promise<SearchResponse>;
  now?: () => Date;
}): Promise<GenerateNgaSpotlightBundleResult> => {
  const suggestions = [];

  for (const definition of definitions) {
    suggestions.push(await getSuggestion(provider, definition, search));
  }

  const bundle = PublicSearchSpotlightBundleSchema.parse({
    schemaVersion: PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION,
    contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
    corpusVersion,
    provider,
    generatedAt: now().toISOString(),
    requestDefaults: {
      topK: REQUEST_TOP_K,
      minScore: REQUEST_MIN_SCORE,
    },
    suggestions,
  });

  const byteLength = getUtf8Size(bundle);
  if (byteLength > PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES) {
    throw new Error(
      `${provider.toUpperCase()} spotlight bundle is ${byteLength} bytes; maximum is ${PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES}`
    );
  }

  return {
    bundle,
    searchRequestCount: definitions.length,
  };
};

export const generateNgaSpotlightBundle = async ({
  corpusVersion,
  search,
  now,
}: GenerateNgaSpotlightBundleOptions): Promise<GenerateNgaSpotlightBundleResult> =>
  generateSpotlightBundle({
    provider: NGA_PROVIDER,
    definitions: NGA_SPOTLIGHT_DEFINITIONS,
    corpusVersion,
    search: (request) => search(request as NgaSpotlightSearchRequest),
    ...(now ? { now } : {}),
  });

export const generateNgsSpotlightBundle = async ({
  corpusVersion,
  search,
  now,
}: GenerateNgsSpotlightBundleOptions): Promise<GenerateNgsSpotlightBundleResult> =>
  generateSpotlightBundle({
    provider: NGS_PROVIDER,
    definitions: NGS_SPOTLIGHT_DEFINITIONS,
    corpusVersion,
    search: (request) => search(request as NgsSpotlightSearchRequest),
    ...(now ? { now } : {}),
  });
