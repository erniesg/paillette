import type { ArtworkSearchResult, SearchResponse } from '~/types';
import type { NgaSpotlightSearchRequest } from './nga-spotlight-generator.server';

export type NgaOfflineCorpusRecord = {
  id?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  title?: string | null;
  artist?: string | null;
  year?: number | null;
  date_text?: string | null;
  medium?: string | null;
  classification?: string | null;
  description?: string | null;
  caption?: { text?: string | null } | string | null;
  credit_line?: string | null;
  rights?: string | null;
  accession_number?: string | null;
  source_url?: string | null;
  source_institution?: string | null;
  source_collection?: string | null;
  source_record_id?: string | null;
  custom_metadata?: Record<string, unknown> | null;
};

type CreateNgaOfflineSpotlightSearchOptions = {
  orgId: string;
  records: readonly NgaOfflineCorpusRecord[];
  enrichments?: readonly ArtworkSearchResult[];
};

type SearchFields = {
  title: string;
  artist: string;
  classification: string;
  medium: string;
  description: string;
  identity: string;
};

type PreparedArtwork = {
  artwork: ArtworkSearchResult;
  fields: SearchFields;
  hasStoredPalette: boolean;
};

const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'da',
  'de',
  'in',
  'of',
  'the',
  'van',
  'with',
]);

const CONCEPTS: Partial<
  Record<NgaSpotlightSearchRequest['definitionId'], readonly string[][]>
> = {
  'stormy-seas-ships': [
    ['storm', 'stormy', 'tempest', 'rough'],
    ['sea', 'ocean', 'marine', 'wave'],
    ['ship', 'boat', 'vessel', 'sail'],
  ],
  'women-profile': [
    ['woman', 'women', 'female', 'lady', 'sitter'],
    ['profile', 'side view'],
  ],
  'mother-child': [
    ['mother', 'madonna', 'maternal'],
    ['child', 'infant', 'baby', 'christ child'],
    ['hold', 'holding', 'cradle', 'cradling', 'embrace'],
  ],
  'quiet-interiors': [
    ['quiet', 'calm', 'serene', 'still'],
    ['domestic', 'home', 'household', 'family'],
    ['interior', 'room', 'parlor', 'kitchen', 'bedroom'],
  ],
  'blue-painted-ornament': [
    ['blue', 'navy', 'cobalt', 'azure'],
    ['paint', 'painted', 'painting', 'gouache', 'watercolor'],
    ['ornament', 'ornamental', 'decorative', 'pattern', 'design', 'tile'],
  ],
};

const normalize = (value: unknown) =>
  typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ')
    : '';

const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const hasPaletteColour = (value: unknown): boolean => {
  if (typeof value === 'string') return HEX_COLOUR.test(value);
  if (Array.isArray(value)) return value.some(hasPaletteColour);
  if (!value || typeof value !== 'object') return false;

  const record = asRecord(value);
  return (
    hasPaletteColour(record.color ?? record.colour ?? record.hex) ||
    hasPaletteColour(record.colors ?? record.colours)
  );
};

const hasStoredPalette = (metadata: Record<string, unknown>) =>
  [
    metadata.dominantColors,
    metadata.dominant_colors,
    metadata.colorPalette,
    metadata.color_palette,
    metadata.colourPalette,
    metadata.colour_palette,
  ].some(hasPaletteColour);

const isNgaEnrichment = (artwork: ArtworkSearchResult) => {
  const metadata = asRecord(artwork.metadata);
  return (
    metadata.provider === 'nga' &&
    metadata.isPublic !== false &&
    metadata.is_public !== false &&
    metadata.openAccess !== false
  );
};

const getEnrichmentMap = (
  enrichments: readonly ArtworkSearchResult[] | undefined
) => {
  const byId = new Map<string, ArtworkSearchResult>();
  for (const artwork of enrichments ?? []) {
    if (isNgaEnrichment(artwork) && !byId.has(artwork.id)) {
      byId.set(artwork.id, artwork);
    }
  }
  return byId;
};

const getCaptionText = (caption: NgaOfflineCorpusRecord['caption']) => {
  if (typeof caption === 'string') return caption;
  return asText(caption?.text);
};

const prepareArtwork = (
  record: NgaOfflineCorpusRecord,
  orgId: string,
  enrichment: ArtworkSearchResult | undefined
): PreparedArtwork | null => {
  const id = asText(record.id);
  const title = asText(record.title);
  const sourceInstitution = asText(record.source_institution);
  const customMetadata = asRecord(record.custom_metadata);
  const provider = asText(customMetadata.provider);
  const imageUrl =
    asText(enrichment?.imageUrl) ?? asText(record.image_url) ?? null;
  const thumbnailUrl =
    asText(enrichment?.thumbnailUrl) ?? asText(record.thumbnail_url) ?? null;

  if (
    !id ||
    !title ||
    !sourceInstitution ||
    (!imageUrl && !thumbnailUrl) ||
    (provider && provider !== 'nga') ||
    customMetadata.openAccess === false
  ) {
    return null;
  }

  const resolvedOrgId = enrichment?.orgId || enrichment?.galleryId || orgId;
  const enrichmentMetadata = asRecord(enrichment?.metadata);
  const description = [record.description, getCaptionText(record.caption)]
    .filter(Boolean)
    .join(' ');
  const artist = asText(record.artist);
  const classification = asText(record.classification);
  const medium = asText(record.medium);

  const metadata = {
    ...customMetadata,
    ...(medium ? { medium } : {}),
    ...(classification ? { classification } : {}),
    ...(asText(record.date_text) ? { dateText: record.date_text } : {}),
    ...(asText(record.credit_line) ? { creditLine: record.credit_line } : {}),
    ...(asText(record.rights) ? { rights: record.rights } : {}),
    ...(asText(record.accession_number)
      ? { accessionNumber: record.accession_number }
      : {}),
    ...(asText(record.source_url) ? { sourceUrl: record.source_url } : {}),
    sourceInstitution,
    ...(asText(record.source_collection)
      ? { sourceCollection: record.source_collection }
      : {}),
    ...(asText(record.source_record_id)
      ? { sourceRecordId: record.source_record_id }
      : {}),
    ...enrichmentMetadata,
    provider: 'nga',
    isPublic: true,
    openAccess: true,
  };

  return {
    artwork: {
      id,
      orgId: resolvedOrgId,
      galleryId: resolvedOrgId,
      title,
      ...(artist ? { artist } : {}),
      ...(Number.isInteger(record.year) ? { year: record.year! } : {}),
      imageUrl,
      thumbnailUrl,
      similarity: 0,
      metadata,
    },
    fields: {
      title: normalize(title),
      artist: normalize(artist),
      classification: normalize(classification),
      medium: normalize(medium),
      description: normalize(description),
      identity: normalize(`${artist ?? ''} ${title}`),
    },
    hasStoredPalette: hasStoredPalette(metadata),
  };
};

const containsTerm = (text: string, term: string) => {
  const normalizedTerm = normalize(term);
  return ` ${text} `.includes(` ${normalizedTerm} `);
};

const getTermVariants = (term: string) => {
  const variants = new Set([term]);
  if (term === 'women') variants.add('woman');
  if (term.endsWith('ies') && term.length > 4) {
    variants.add(`${term.slice(0, -3)}y`);
  } else if (term.endsWith('s') && term.length > 3) {
    variants.add(term.slice(0, -1));
  }
  if (term.endsWith('ing') && term.length > 5) variants.add(term.slice(0, -3));
  if (term.endsWith('ed') && term.length > 4) variants.add(term.slice(0, -2));
  return [...variants];
};

const fieldContainsAny = (field: string, terms: readonly string[]) =>
  terms.some((term) =>
    getTermVariants(normalize(term)).some((variant) =>
      containsTerm(field, variant)
    )
  );

const getBestFieldWeight = (fields: SearchFields, term: string) => {
  const variants = getTermVariants(term);
  const matches = (field: string) =>
    variants.some((variant) => containsTerm(field, variant));

  if (matches(fields.title)) return 12;
  if (matches(fields.artist)) return 10;
  if (matches(fields.classification)) return 8;
  if (matches(fields.medium)) return 6;
  if (matches(fields.description)) return 3;
  return 0;
};

const scoreArtwork = (
  prepared: PreparedArtwork,
  request: NgaSpotlightSearchRequest
) => {
  const query = normalize(request.query);
  const { fields } = prepared;
  let score = 0;

  if (containsTerm(fields.identity, query)) score += 70;
  if (containsTerm(fields.title, query)) score += 55;
  if (containsTerm(fields.artist, query)) score += 45;
  if (fields.classification === query) score += 50;
  if (fields.medium === query) score += 50;

  const queryTerms = query
    .split(' ')
    .filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term));
  for (const term of queryTerms) score += getBestFieldWeight(fields, term);

  const searchableFields = Object.values(fields);
  for (const concept of CONCEPTS[request.definitionId] ?? []) {
    if (searchableFields.some((field) => fieldContainsAny(field, concept))) {
      score += 18;
    }
  }

  return score > 0 ? Math.min(1, 0.2 + score / 100) : 0;
};

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export const createNgaOfflineSpotlightSearch = ({
  orgId,
  records,
  enrichments,
}: CreateNgaOfflineSpotlightSearchOptions) => {
  const enrichmentById = getEnrichmentMap(enrichments);
  const prepared = records.flatMap((record) => {
    const id = asText(record.id);
    const artwork = prepareArtwork(
      record,
      orgId,
      id ? enrichmentById.get(id) : undefined
    );
    return artwork ? [artwork] : [];
  });

  return async (
    request: NgaSpotlightSearchRequest
  ): Promise<SearchResponse> => {
    const normalizedFacetQuery = normalize(request.query);
    const scored = prepared.flatMap((candidate) => {
      if (
        request.facet === 'classification' &&
        candidate.fields.classification !== normalizedFacetQuery
      ) {
        return [];
      }

      const similarity = scoreArtwork(candidate, request);
      return similarity >= request.minScore
        ? [
            {
              artwork: { ...candidate.artwork, similarity },
              hasStoredPalette: candidate.hasStoredPalette,
            },
          ]
        : [];
    });

    scored.sort(
      (left, right) =>
        right.artwork.similarity - left.artwork.similarity ||
        compareIds(left.artwork.id, right.artwork.id)
    );

    const ordered =
      request.definitionId === 'blue-painted-ornament'
        ? (() => {
            const paletteCandidates = scored
              .filter(({ hasStoredPalette }) => hasStoredPalette)
              .slice(0, Math.min(12, request.topK));
            const selectedIds = new Set(
              paletteCandidates.map(({ artwork }) => artwork.id)
            );
            return [
              ...paletteCandidates,
              ...scored.filter(({ artwork }) => !selectedIds.has(artwork.id)),
            ];
          })()
        : scored;
    const results = ordered
      .slice(0, request.topK)
      .map(({ artwork }) => artwork);

    return { results, count: results.length, queryTime: 0 };
  };
};
