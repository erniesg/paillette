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

const NGA_PROVIDER = 'nga' as const;
const REQUEST_TOP_K = 30 as const;
const REQUEST_MIN_SCORE = 0.2 as const;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

type NgaSpotlightDefinitionId = NgaSpotlightDefinition['id'];

export type NgaSpotlightSearchRequest = {
  provider: typeof NGA_PROVIDER;
  definitionId: NgaSpotlightDefinitionId;
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

const assertNgaResults = (
  definition: NgaSpotlightDefinition,
  results: readonly ArtworkSearchResult[]
) => {
  for (const result of results) {
    const metadata = asRecord(result.metadata);
    if (metadata.provider !== NGA_PROVIDER) {
      throw new Error(
        `NGA spotlight ${definition.id} returned non-NGA artwork ${result.id}`
      );
    }
    if (metadata.isPublic === false || metadata.is_public === false) {
      throw new Error(
        `NGA spotlight ${definition.id} returned non-public artwork ${result.id}`
      );
    }
  }
};

const getRenderableUniqueResults = (
  definition: NgaSpotlightDefinition,
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
  artwork: ArtworkSearchResult
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
    ...(asUrl(artwork.imageUrl) ? { imageUrl: asUrl(artwork.imageUrl) } : {}),
    ...(asUrl(artwork.thumbnailUrl)
      ? { thumbnailUrl: asUrl(artwork.thumbnailUrl) }
      : {}),
    similarity: artwork.similarity,
    source: {
      provider: NGA_PROVIDER,
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
  definition: NgaSpotlightDefinition
): NgaSpotlightSearchRequest => ({
  provider: NGA_PROVIDER,
  definitionId: definition.id,
  query: definition.query,
  topK: REQUEST_TOP_K,
  minScore: REQUEST_MIN_SCORE,
  ...('facet' in definition ? { facet: definition.facet } : {}),
});

const getSuggestion = async (
  definition: NgaSpotlightDefinition,
  search: GenerateNgaSpotlightBundleOptions['search']
) => {
  const response = await search(getSearchRequest(definition));
  assertNgaResults(definition, response.results);
  const results = getRenderableUniqueResults(definition, response.results);

  return {
    ...definition,
    artworks: results.slice(0, REQUEST_TOP_K).map(toSpotlightArtwork),
  };
};

const getUtf8Size = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const generateNgaSpotlightBundle = async ({
  corpusVersion,
  search,
  now = () => new Date(),
}: GenerateNgaSpotlightBundleOptions): Promise<GenerateNgaSpotlightBundleResult> => {
  const suggestions = [];

  for (const definition of NGA_SPOTLIGHT_DEFINITIONS) {
    suggestions.push(await getSuggestion(definition, search));
  }

  const bundle = PublicSearchSpotlightBundleSchema.parse({
    schemaVersion: PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION,
    contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
    corpusVersion,
    provider: NGA_PROVIDER,
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
      `NGA spotlight bundle is ${byteLength} bytes; maximum is ${PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES}`
    );
  }

  return {
    bundle,
    searchRequestCount: NGA_SPOTLIGHT_DEFINITIONS.length,
  };
};
