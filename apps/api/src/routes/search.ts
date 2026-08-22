import { Hono } from 'hono';
import { z } from 'zod';
import { Env } from '../index';
import {
  annotateUsageEvent,
  enforceDailyQuota,
  getAuth,
  recordArtworkResults,
  requireAuthOrApiKey,
} from '../middleware/auth';
import type {
  ApiResponse,
  SearchResponse,
  ArtworkSearchResult,
  SearchDegradedChannel,
} from '../types';
import { BACKABLE_NGS_PUBLIC_ARTWORK_SQL } from '../utils/ngs-public-filter';
import { getOrCreateQueryEmbedding } from '../utils/query-embedding-cache';
import {
  PublicSearchColdMissRateLimitError,
  enforcePublicSearchColdMissRateLimit,
} from '../utils/public-search-cold-miss-rate-limit';
import { getOrLoadPublicSearchResult } from '../utils/public-search-result-cache';
import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  normalizePublicSearchConstraints,
  normalizePublicSearchText,
  parsePublicSearchConstraints,
  type NgaAttributionIntent,
  type NgaSearchPlan,
  type PublicSearchConstraints,
} from '@paillette/types/public-search';
import {
  matchesNgaSearchConstraints,
  compileNgaSearchPlan,
  parseNgaSearchIntent,
  validateNgaSearchConstraints,
} from '../utils/nga-search-intent';
import {
  filterNgaRelationEvidence,
  foldNgaEvidenceText,
  matchesNgaAttributionEvidence,
  NGA_LATIN_FOLD_GROUPS,
} from '../utils/nga-search-evidence';
import {
  isAllowedPublicSearchRouteScope,
  isNgsPublicOrg,
  resolveOpenAccessProviderScope,
  resolveOrgIdentifier,
} from '../utils/orgs';

interface ArtworkSearchRow {
  id: string;
  org_id: string;
  title: string | null;
  artist: string | null;
  year: number | null;
  date_text: string | null;
  medium: string | null;
  classification: string | null;
  culture: string | null;
  origin: string | null;
  dimensions_height: number | null;
  dimensions_width: number | null;
  dimensions_depth: number | null;
  dimensions_unit: string | null;
  description: string | null;
  provenance: string | null;
  credit_line: string | null;
  rights: string | null;
  accession_number: string | null;
  source_url: string | null;
  source_institution: string | null;
  source_collection: string | null;
  source_record_id: string | null;
  field_sources: string | null;
  dominant_colors: string | null;
  color_palette: string | null;
  citation: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  custom_metadata: string | null;
}

interface ArtworkMetadataSearchRow extends ArtworkSearchRow {
  match_score: number;
}

type CaptionVectorMatch = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
};

type SearchSourceChannel =
  | 'image_embedding'
  | 'institution_caption_embedding'
  | 'generated_caption_embedding'
  | 'metadata';

type SearchSourceContribution = {
  channel: SearchSourceChannel;
  label: string;
  source: string;
  weight: number;
  rank: number;
  score?: number;
  model?: string;
  embeddingVersion?: string;
};

const CAPTION_TEXT_MODEL = '@cf/baai/bge-large-en-v1.5';
const DEFAULT_JINA_MULTIMODAL_MODEL = 'jina-clip-v2';
const DEFAULT_JINA_TEXT_MODEL = 'jina-embeddings-v5-text-small';
const DEFAULT_JINA_DIMENSIONS = 1024;
const JINA_EMBEDDINGS_ENDPOINT = 'https://api.jina.ai/v1/embeddings';
const RRF_K = 60;
const EXACT_METADATA_PRIORITY_BONUS = 0.03;
const MAX_SEARCH_RESULTS = 100;
const MAX_IMAGE_SEARCH_BYTES = 10 * 1024 * 1024;
const IMAGE_SEARCH_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const VECTORIZE_QUERY_METADATA = 'indexed' as const;
const SEARCH_DEGRADED_CHANNEL_ORDER: SearchDegradedChannel[] = [
  'image_embedding',
  'caption_embedding',
  'metadata',
  'visual_refinement',
];

const getPublicSearchClientAddress = (
  connectingIp: string | undefined,
  forwardedFor: string | undefined
) => connectingIp?.trim() || forwardedFor?.split(',')[0]?.trim();

type EmbeddingIndexVersion = 'v1' | 'v2';
type ScheduleBackgroundWork = (work: Promise<void>) => void;
type SearchFusionMode = 'legacy' | 'metadata' | 'hybrid';
type RoutedSearchIntent =
  | 'balanced'
  | 'accession_exact'
  | 'artist_exact'
  | 'title_exact'
  | 'color_visual'
  | 'medium_exact'
  | 'temporal'
  | 'formal_visual';

type PublicImageSearchIdentityInput = {
  version: 'public-image-search-v1';
  contractVersion: typeof PUBLIC_SEARCH_CONTRACT_VERSION;
  mode: 'image';
  imageDigest: string;
  orgId: string | undefined;
  provider: string | null;
  index: {
    version: EmbeddingIndexVersion;
    binding: 'VECTORIZE' | 'VECTORIZE_V2';
  };
  embedding: {
    provider: 'jina';
    endpoint: string;
    model: string;
    dimensions: number;
  };
  constraints?: PublicSearchConstraints | null;
  topK: number;
  minScore: number;
};

export const buildPublicImageSearchIdentity = (
  input: PublicImageSearchIdentityInput
) =>
  JSON.stringify({
    version: input.version,
    contractVersion: input.contractVersion,
    mode: input.mode,
    imageDigest: input.imageDigest,
    orgId: input.orgId,
    provider: input.provider,
    index: input.index,
    embedding: input.embedding,
    constraints:
      input.constraints == null
        ? null
        : normalizePublicSearchConstraints(input.constraints),
    topK: input.topK,
    minScore: input.minScore,
  });

type RoutedSearchWeights = {
  jinaImage: number;
  caption: number;
  metadata: number;
};

type RoutedSearchPlan = {
  intent: RoutedSearchIntent;
  weights: RoutedSearchWeights;
  metadataQuery?: string;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const canonicalArtworkId = (id: string) =>
  id.match(/^data_aws\d*k_(.+)$/i)?.[1] || id;

const ACCESSION_RE =
  /\b(?:\d{4}(?:\.[A-Z0-9]+(?:-[A-Z0-9]+)?){2,}|\d{4}-\d{5}(?:-\d{3})?|[A-Z]{1,4}-\d{3,6}(?:-[A-Z0-9]+)?)\b/i;
const HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b/;
const COLOR_TERMS = new Set([
  'black',
  'blue',
  'brown',
  'crimson',
  'earth',
  'green',
  'grey',
  'gray',
  'monochrome',
  'navy',
  'ochre',
  'red',
  'sage',
  'yellow',
]);
const MEDIUM_TERMS = new Set([
  'batik',
  'bronze',
  'canvas',
  'charcoal',
  'engraving',
  'etching',
  'graphite',
  'gouache',
  'ink',
  'linocut',
  'lithograph',
  'oil',
  'pencil',
  'photograph',
  'print',
  'screenprint',
  'sculpture',
  'tempera',
  'watercolour',
  'watercolor',
  'woodcut',
]);
const CLASSIFICATION_MEDIUM_TERMS = new Set([
  'photograph',
  'print',
  'sculpture',
]);
const MEDIUM_TERM_ALIASES: Record<string, string[]> = {
  linocut: ['linocut', 'lino cut'],
  photograph: ['photograph', 'photography'],
  screenprint: ['screenprint', 'screen print', 'silkscreen', 'silk screen'],
  watercolour: ['watercolour', 'watercolor'],
  watercolor: ['watercolour', 'watercolor'],
};
const FORMAL_VISUAL_TERMS = new Set(['brushwork', 'calligraphic', 'gestural']);
const SEARCH_CONTROL_WORDS = new Set([
  'a',
  'an',
  'accession',
  'and',
  'artist',
  'artwork',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'title',
  'titled',
  'to',
  'with',
  'work',
]);

const extractAccession = (query: string) =>
  query.match(ACCESSION_RE)?.[0]?.toUpperCase();

const normalizeSearchWords = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const searchQueryTokens = (query: string) =>
  normalizeSearchWords(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) => token && token.length > 1 && !SEARCH_CONTROL_WORDS.has(token)
    );

const unicodeSearchQueryTokens = (query: string) =>
  (query.normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [])
    .map((token) => token.trim())
    .filter((token) => {
      const foldedToken = foldNgaEvidenceText(token);
      return (
        [...foldedToken].length > 1 && !SEARCH_CONTROL_WORDS.has(foldedToken)
      );
    });

const NGA_LATIN_GLOB_EQUIVALENTS = new Map<string, string>(
  NGA_LATIN_FOLD_GROUPS.filter(([replacement]) => replacement.length === 1)
);
const NGA_LATIN_GLOB_EXPANSIONS = NGA_LATIN_FOLD_GROUPS.filter(
  ([replacement]) => replacement.length > 1
);

const sqliteGlobCharacterClass = (
  character: string,
  expansionEquivalents = ''
) => {
  const equivalents = NGA_LATIN_GLOB_EQUIVALENTS.get(character) || '';
  return `[${character}${character.toLocaleUpperCase('en-US')}${equivalents}${expansionEquivalents}]`;
};

const unicodeSqlCandidatePattern = (token: string) => {
  const folded = foldNgaEvidenceText(token);
  const characterClasses: string[] = [];
  for (let index = 0; index < folded.length; index += 1) {
    const expansion = NGA_LATIN_GLOB_EXPANSIONS.find(([replacement]) =>
      folded.startsWith(replacement, index)
    );
    characterClasses.push(
      sqliteGlobCharacterClass(folded[index]!, expansion?.[1])
    );
    if (expansion) index += expansion[0].length - 1;
  }
  return `*${characterClasses.join('*')}*`;
};

const normalizeArtistFacetQuery = (query: string) =>
  normalizeSearchWords(
    query
      .replace(/\([^)]*(?:\d{3,4}|born|died|b\.|d\.)[^)]*\)/gi, ' ')
      .replace(/\b(?:b|d)\.?\s*\d{3,4}\b/gi, ' ')
  );

const artistFacetTokens = (query: string) =>
  normalizeArtistFacetQuery(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token &&
        token.length > 1 &&
        !SEARCH_CONTROL_WORDS.has(token) &&
        !/^\d{3,4}$/.test(token)
    )
    .slice(0, 8);

const backableSearchSql = (orgId: string | undefined) =>
  isNgsPublicOrg(orgId) ? BACKABLE_NGS_PUBLIC_ARTWORK_SQL : '';

const providerSearchSql = (provider: string | undefined) =>
  provider
    ? "AND json_valid(custom_metadata) AND json_extract(custom_metadata, '$.provider') = ?"
    : '';

const getVectorFilter = (
  orgId: string | undefined,
  provider: string | undefined,
  constraints?: PublicSearchConstraints
) => {
  const filter: VectorizeVectorMetadataFilter = {};
  if (orgId) filter.galleryId = orgId;
  if (provider) filter.provider = provider;
  if (constraints?.dateRange) {
    filter.yearStart = { $lte: constraints.dateRange.endYear };
    filter.yearEnd = { $gte: constraints.dateRange.startYear };
  }
  if (constraints?.classifications?.length) {
    filter.classification = { $in: constraints.classifications };
  }
  if (constraints?.mediumFamilies?.length) {
    filter.mediumFamily = { $in: constraints.mediumFamilies };
  }
  if (constraints?.artistIds?.length) {
    filter.primaryArtistId = { $in: constraints.artistIds };
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
};

const getEmbeddingIndexVersion = (env: Env): EmbeddingIndexVersion =>
  env.EMBEDDING_INDEX_VERSION === 'v2' ? 'v2' : 'v1';

const getSearchFusionMode = (
  env: Env,
  _orgId: string | undefined
): SearchFusionMode => {
  if (env.SEARCH_FUSION_MODE === 'metadata') return 'metadata';
  if (env.SEARCH_FUSION_MODE === 'hybrid') return 'hybrid';
  if (env.SEARCH_FUSION_MODE === 'legacy') return 'legacy';

  return 'hybrid';
};

const getImageVectorize = (env: Env): Vectorize | undefined =>
  getEmbeddingIndexVersion(env) === 'v2' ? env.VECTORIZE_V2 : env.VECTORIZE;

const getCaptionVectorize = (env: Env): Vectorize | undefined =>
  getEmbeddingIndexVersion(env) === 'v2'
    ? env.CAPTION_VECTORIZE_V2
    : env.CAPTION_VECTORIZE;

const isCaptionVectorSearchEnabled = (env: Env) =>
  env.CAPTION_VECTOR_SEARCH_ENABLED !== 'false';

type TemporalFilter = {
  startYear: number;
  endYear: number;
  textQuery: string;
};

const canonicalizeMatches = (matches: CaptionVectorMatch[]) => {
  const byId = new Map<string, CaptionVectorMatch>();

  for (const match of matches) {
    const id = canonicalArtworkId(match.id);
    const existing = byId.get(id);
    if (!existing || match.score > existing.score) {
      byId.set(id, { ...match, id });
    }
  }

  return [...byId.values()];
};

const firstYearFromText = (value: string | null | undefined) => {
  const match = String(value || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
};

const parseTemporalFilter = (query: string): TemporalFilter | null => {
  if (extractAccession(query)) {
    return null;
  }

  const structuredRange = parseNgaSearchIntent(query).constraints.dateRange;
  if (structuredRange) {
    return {
      ...structuredRange,
      textQuery: query,
    };
  }

  const decadeMatch = query.match(/\b((?:1[0-9]{2}|20[0-9])0)'?s\b/i);
  if (decadeMatch?.[1]) {
    const startYear = Number(decadeMatch[1]);
    return {
      startYear,
      endYear: startYear + 9,
      textQuery: `${startYear}s`,
    };
  }

  const yearMatch = query.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (yearMatch?.[1]) {
    const year = Number(yearMatch[1]);
    return {
      startYear: year,
      endYear: year,
      textQuery: String(year),
    };
  }

  return null;
};

const artworkMatchesTemporalFilter = (
  artwork: ArtworkSearchRow,
  temporalFilter: TemporalFilter
) => {
  const year = artwork.year ?? firstYearFromText(artwork.date_text);
  return Boolean(
    year && year >= temporalFilter.startYear && year <= temporalFilter.endYear
  );
};

const artworkMatchesStructuredConstraints = (
  artwork: ArtworkSearchRow,
  constraints: PublicSearchConstraints
) => {
  const enriched = artwork as ArtworkSearchRow & {
    year_start?: number | null;
    year_end?: number | null;
    visual_classification?: string | null;
    medium_family?: string | null;
    primary_artist_id?: string | null;
  };
  return matchesNgaSearchConstraints(
    {
      year: artwork.year,
      yearStart: enriched.year_start,
      yearEnd: enriched.year_end,
      dateText: artwork.date_text,
      classification: artwork.classification,
      visualClassification: enriched.visual_classification,
      medium: artwork.medium,
      mediumFamily: enriched.medium_family,
      primaryArtistId: enriched.primary_artist_id,
    },
    constraints
  );
};

const searchResultMatchesStructuredConstraints = (
  result: ArtworkSearchResult,
  constraints: PublicSearchConstraints
) =>
  matchesNgaSearchConstraints(
    {
      year: result.year,
      yearStart:
        typeof result.metadata?.yearStart === 'number'
          ? result.metadata.yearStart
          : null,
      yearEnd:
        typeof result.metadata?.yearEnd === 'number'
          ? result.metadata.yearEnd
          : null,
      dateText:
        typeof result.metadata?.dateText === 'string'
          ? result.metadata.dateText
          : null,
      classification:
        typeof result.metadata?.classification === 'string'
          ? result.metadata.classification
          : null,
      visualClassification:
        typeof result.metadata?.visualClassification === 'string'
          ? result.metadata.visualClassification
          : null,
      medium:
        typeof result.metadata?.medium === 'string'
          ? result.metadata.medium
          : null,
      mediumFamily:
        typeof result.metadata?.mediumFamily === 'string'
          ? result.metadata.mediumFamily
          : null,
      primaryArtistId:
        typeof result.metadata?.primaryArtistId === 'string'
          ? result.metadata.primaryArtistId
          : null,
    },
    constraints
  );

const buildStructuredConstraintSqlForDateMode = (
  constraints: PublicSearchConstraints | undefined,
  dateMode: 'stored-range' | 'displayed-date-candidate'
): { sql: string; params: Array<string | number> } => {
  if (!constraints) return { sql: '', params: [] };

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (constraints.dateRange) {
    if (dateMode === 'displayed-date-candidate') {
      clauses.push(`(trim(coalesce(date_text, '')) <> '')`);
    } else {
      clauses.push(
        `(coalesce(year_end, year) >= ? AND coalesce(year_start, year) <= ?)`
      );
      params.push(
        constraints.dateRange.startYear,
        constraints.dateRange.endYear
      );
    }
  }
  if (constraints.classifications?.length) {
    clauses.push(
      `lower(trim(coalesce(nullif(trim(visual_classification), ''), classification, ''))) IN (${constraints.classifications.map(() => '?').join(', ')})`
    );
    params.push(
      ...constraints.classifications.map((value) => value.toLowerCase())
    );
  }
  if (constraints.mediumFamilies?.length) {
    const placeholders = constraints.mediumFamilies.map(() => '?').join(', ');
    const mediumFallbacks = constraints.mediumFamilies
      .map(() => `(' ' || lower(coalesce(medium, '')) || ' ') GLOB ?`)
      .join(' OR ');
    clauses.push(
      `(lower(trim(coalesce(medium_family, ''))) IN (${placeholders}) OR ${mediumFallbacks})`
    );
    params.push(
      ...constraints.mediumFamilies.map((value) => value.toLowerCase()),
      ...constraints.mediumFamilies.map(
        (value) => `*[^a-z0-9]${value.toLowerCase()}[^a-z0-9]*`
      )
    );
  }
  if (constraints.artistIds?.length) {
    clauses.push(
      `primary_artist_id IN (${constraints.artistIds.map(() => '?').join(', ')})`
    );
    params.push(...constraints.artistIds);
  }

  return {
    sql: clauses.length ? `AND (${clauses.join(' AND ')})` : '',
    params,
  };
};

export const buildStructuredConstraintSql = (
  constraints?: PublicSearchConstraints
) => buildStructuredConstraintSqlForDateMode(constraints, 'stored-range');

const buildFacetStructuredConstraintSql = (
  constraints?: PublicSearchConstraints
) =>
  buildStructuredConstraintSqlForDateMode(
    constraints,
    'displayed-date-candidate'
  );

const SEARCH_PUNCTUATION_SQL = [
  "'-'",
  "','",
  "'.'",
  "'/'",
  "'('",
  "')'",
  "'['",
  "']'",
  "'_'",
  "':'",
  "';'",
  'char(34)',
  'char(39)',
  'char(8216)',
  'char(8217)',
];

const normalizedTextSql = (expression: string) => {
  const normalized = SEARCH_PUNCTUATION_SQL.reduce(
    (sql, punctuation) => `replace(${sql}, ${punctuation}, ' ')`,
    `coalesce(${expression}, '')`
  );

  return `(' ' || lower(${normalized}) || ' ')`;
};

const buildRoutedSearchPlan = (
  query: string,
  forcedIntent?: 'artist_exact',
  ngaPlanMode?: NgaSearchPlan['mode']
): RoutedSearchPlan => {
  if (ngaPlanMode === 'relational') {
    return {
      intent: 'balanced',
      weights: { jinaImage: 1, caption: 1, metadata: 1 },
    };
  }
  if (forcedIntent === 'artist_exact') {
    return {
      intent: 'artist_exact',
      weights: { jinaImage: 0.1, caption: 1.5, metadata: 2.5 },
    };
  }
  const accession = extractAccession(query);
  if (accession) {
    return {
      intent: 'accession_exact',
      metadataQuery: accession,
      weights: { jinaImage: 0, caption: 0, metadata: 8 },
    };
  }

  const tokens = searchQueryTokens(query);
  if (
    HEX_COLOR_RE.test(query) ||
    tokens.some((token) => COLOR_TERMS.has(token))
  ) {
    return {
      intent: 'color_visual',
      weights: { jinaImage: 1.5, caption: 0.25, metadata: 0 },
    };
  }

  const normalizedQuery = normalizeSearchWords(query);
  if (
    tokens.some((token) => MEDIUM_TERMS.has(token)) &&
    normalizedQuery !== 'oil lamp' &&
    normalizedQuery !== 'oil lamps'
  ) {
    return {
      intent: 'medium_exact',
      weights: { jinaImage: 0.2, caption: 0.8, metadata: 3 },
    };
  }

  if (parseTemporalFilter(query)) {
    return {
      intent: 'temporal',
      weights: { jinaImage: 0.2, caption: 0.6, metadata: 4 },
    };
  }

  if (tokens.some((token) => FORMAL_VISUAL_TERMS.has(token))) {
    return {
      intent: 'formal_visual',
      weights: { jinaImage: 1.2, caption: 0.8, metadata: 0.2 },
    };
  }

  return {
    intent: 'balanced',
    weights: { jinaImage: 1, caption: 1, metadata: 1 },
  };
};

const normalizeTitleQuery = (query: string) =>
  normalizeSearchWords(
    query
      .replace(/^\s*(?:title|titled)\s*[:\-]?\s*/i, '')
      .replace(/^["']|["']$/g, '')
  );

const normalizeComparableTitle = (title: string | null | undefined) =>
  normalizeSearchWords(String(title || '').replace(/\[[^\]]+\]/g, ' '));

const withoutSearchControlWords = (value: string) =>
  normalizeSearchWords(value)
    .split(/\s+/)
    .filter((token) => token && !SEARCH_CONTROL_WORDS.has(token))
    .join(' ');

const containsNormalizedPhrase = (value: string, phrase: string) =>
  Boolean(phrase && ` ${value} `.includes(` ${phrase} `));

const exactMetadataMatchPriority = (
  query: string,
  artwork: ArtworkSearchResult
) => {
  const normalizedQuery = normalizeSearchWords(query);
  const fullTitle = normalizeSearchWords(artwork.title || '');
  const comparableTitle = normalizeComparableTitle(artwork.title);
  const artist = normalizeSearchWords(artwork.artist || '');
  const comparableArtist = withoutSearchControlWords(artwork.artist || '');
  const comparableQuery = withoutSearchControlWords(query);

  if (!normalizedQuery) return 0;

  if (
    artist &&
    comparableTitle &&
    (normalizedQuery === `${artist} ${comparableTitle}` ||
      normalizedQuery === `${comparableTitle} ${artist}` ||
      (containsNormalizedPhrase(normalizedQuery, artist) &&
        containsNormalizedPhrase(normalizedQuery, comparableTitle)) ||
      (containsNormalizedPhrase(comparableQuery, comparableArtist) &&
        containsNormalizedPhrase(normalizedQuery, comparableTitle)))
  ) {
    return 4;
  }

  if (normalizedQuery === fullTitle || normalizedQuery === comparableTitle) {
    return 3;
  }

  return artist &&
    (normalizedQuery === artist || comparableQuery === comparableArtist)
    ? 2
    : 0;
};

const exactMediumMatchPriority = (
  query: string,
  artwork: ArtworkSearchResult
) => {
  const requestedTerms = searchQueryTokens(query).filter((token) =>
    MEDIUM_TERMS.has(token)
  );
  if (!requestedTerms.length) return 0;

  const metadata = artwork.metadata || {};
  const medium = normalizeSearchWords(String(metadata.medium || ''));
  const classification = normalizeSearchWords(
    String(metadata.classification || '')
  );
  const matches = (value: string, term: string) =>
    (MEDIUM_TERM_ALIASES[term] || [term]).some((alias) =>
      containsNormalizedPhrase(value, alias)
    );
  const materialTerms = requestedTerms.filter(
    (term) => !CLASSIFICATION_MEDIUM_TERMS.has(term)
  );
  const classificationTerms = requestedTerms.filter((term) =>
    CLASSIFICATION_MEDIUM_TERMS.has(term)
  );
  const materialMatch = materialTerms.some((term) => matches(medium, term));
  const classificationMatch = classificationTerms.some((term) =>
    matches(classification, term)
  );

  if (materialMatch && (!classificationTerms.length || classificationMatch)) {
    return 3;
  }
  if (materialMatch) return 2;
  if (classificationMatch) return 1;
  return 0;
};

const refineRoutedSearchPlan = (
  route: RoutedSearchPlan,
  query: string,
  metadataMatches: ArtworkSearchResult[]
): RoutedSearchPlan => {
  if (route.intent === 'accession_exact' || route.intent === 'artist_exact') {
    return route;
  }
  const titleQuery = normalizeTitleQuery(query);
  if (
    titleQuery &&
    metadataMatches.some(
      (match) => normalizeSearchWords(match.title || '') === titleQuery
    )
  ) {
    return {
      intent: 'title_exact',
      weights: { jinaImage: 0.15, caption: 1.2, metadata: 4 },
    };
  }
  return route;
};

const searchDescriptionSql = (orgId: string | undefined) =>
  isNgsPublicOrg(orgId)
    ? `CASE
        WHEN lower(coalesce(json_extract(field_sources, '$.description'), '')) LIKE '%roots%'
          THEN coalesce(description, '')
        ELSE ''
      END`
    : 'description';

const parseJsonObject = (value: string | null) => {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const prepareSearchMetadata = (
  artwork: ArtworkSearchRow,
  customMetadata: Record<string, unknown>,
  fieldSources: Record<string, unknown> | undefined
) => {
  return {
    description: artwork.description,
    customMetadata,
    fieldSources,
  };
};

const compactObject = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== null
    )
  ) as Partial<T>;

const buildDimensions = (artwork: ArtworkSearchRow) => {
  const dimensions = compactObject({
    height: artwork.dimensions_height,
    width: artwork.dimensions_width,
    depth: artwork.dimensions_depth,
    unit: artwork.dimensions_unit,
  });

  return Object.keys(dimensions).length ? dimensions : undefined;
};

const mapSearchRow = (
  artwork: ArtworkSearchRow,
  similarity: number,
  searchSources?: SearchSourceContribution[]
): ArtworkSearchResult => {
  const structured = artwork as ArtworkSearchRow & {
    year_start?: number | null;
    year_end?: number | null;
    subclassification?: string | null;
    visual_classification?: string | null;
    medium_family?: string | null;
    primary_artist_id?: string | null;
  };
  const customMetadata =
    (parseJsonObject(artwork.custom_metadata) as Record<string, unknown>) ?? {};
  const fieldSources = parseJsonObject(artwork.field_sources) as
    | Record<string, unknown>
    | undefined;
  const sanitized = prepareSearchMetadata(
    artwork,
    customMetadata,
    fieldSources
  );
  const dominantColors = parseJsonObject(artwork.dominant_colors);
  const colorPalette = parseJsonObject(artwork.color_palette);
  const citation = parseJsonObject(artwork.citation);
  const dimensions = buildDimensions(artwork);

  return {
    id: artwork.id,
    orgId: artwork.org_id,
    galleryId: artwork.org_id,
    title: artwork.title || undefined,
    artist: artwork.artist || undefined,
    year: artwork.year || undefined,
    imageUrl: artwork.image_url,
    thumbnailUrl: artwork.thumbnail_url,
    similarity,
    metadata: compactObject({
      ...sanitized.customMetadata,
      medium: artwork.medium,
      mediumFamily: structured.medium_family,
      dateText: artwork.date_text,
      date_text: artwork.date_text,
      yearStart: structured.year_start,
      yearEnd: structured.year_end,
      classification: artwork.classification,
      subclassification: structured.subclassification,
      visualClassification: structured.visual_classification,
      primaryArtistId: structured.primary_artist_id,
      culture: artwork.culture,
      origin: artwork.origin,
      dimensions,
      description: sanitized.description,
      provenance: artwork.provenance,
      creditLine: artwork.credit_line,
      credit_line: artwork.credit_line,
      rights: artwork.rights,
      accessionNumber: artwork.accession_number,
      accession_number: artwork.accession_number,
      sourceUrl: artwork.source_url,
      source_url: artwork.source_url,
      sourceInstitution: artwork.source_institution,
      source_institution: artwork.source_institution,
      sourceCollection: artwork.source_collection,
      source_collection: artwork.source_collection,
      sourceRecordId: artwork.source_record_id,
      source_record_id: artwork.source_record_id,
      fieldSources: sanitized.fieldSources,
      field_sources: sanitized.fieldSources,
      dominantColors,
      dominant_colors: dominantColors,
      colorPalette,
      color_palette: colorPalette,
      citation,
      searchSources,
      search_sources: searchSources,
    }),
  };
};

const l2Normalize = (values: number[]) => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    return values;
  }

  return values.map((value) => value / norm);
};

async function generateCloudflareCaptionQueryEmbedding(
  ai: Ai,
  query: string
): Promise<number[]> {
  const result = await ai.run(CAPTION_TEXT_MODEL, {
    text: query,
  });
  const embedding = (result as { data?: number[][] }).data?.[0];

  if (!embedding?.length) {
    throw new Error('Caption query embedding was empty');
  }

  return l2Normalize(embedding);
}

type JinaEmbeddingInput = string | { image: string };

export async function generateJinaQueryEmbedding(
  apiKey: string,
  input: JinaEmbeddingInput,
  model = DEFAULT_JINA_MULTIMODAL_MODEL,
  dimensions = DEFAULT_JINA_DIMENSIONS,
  endpoint = JINA_EMBEDDINGS_ENDPOINT,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<number[]> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error('Query embedding request timed out')),
    options.timeoutMs ?? 8_000
  );

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [input],
        normalized: true,
        embedding_type: 'float',
        task: 'retrieval.query',
        dimensions,
        truncate: true,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }

  const payload = await response.json<{
    data?: Array<{ embedding?: number[] | string }>;
    detail?: string;
    code?: string;
  }>();

  if (!response.ok) {
    throw new Error(
      payload.detail ||
        payload.code ||
        `Jina embeddings request failed with ${response.status}`
    );
  }

  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw new Error(
      'Jina query embedding was empty or had the wrong dimensions'
    );
  }

  return l2Normalize(embedding);
}

const getJinaDimensions = (value: string | undefined) => {
  const dimensions = Number(value || DEFAULT_JINA_DIMENSIONS);
  return Number.isFinite(dimensions) && dimensions > 0
    ? dimensions
    : DEFAULT_JINA_DIMENSIONS;
};

const getJinaConfig = (env: Env) => ({
  apiKey: env.QUERY_EMBEDDING_API_TOKEN || env.JINA_API_KEY,
  endpoint: env.QUERY_EMBEDDING_API_URL || JINA_EMBEDDINGS_ENDPOINT,
  model: env.JINA_MULTIMODAL_MODEL || DEFAULT_JINA_MULTIMODAL_MODEL,
  dimensions: getJinaDimensions(env.JINA_EMBEDDING_DIMENSIONS),
  timeoutMs: env.QUERY_EMBEDDING_API_URL ? 20_000 : 8_000,
});

const getCachedJinaQueryEmbedding = (
  env: Env,
  query: string,
  config: ReturnType<typeof getJinaConfig>,
  model: string,
  dimensions: number,
  schedule?: ScheduleBackgroundWork
) =>
  getOrCreateQueryEmbedding({
    cache: env.CACHE,
    query,
    model,
    endpointIdentity: config.endpoint,
    dimensions,
    indexVersion: `${PUBLIC_SEARCH_CONTRACT_VERSION}:${getEmbeddingIndexVersion(env)}:retrieval.query`,
    schedule,
    generate: (normalizedQuery) =>
      generateJinaQueryEmbedding(
        config.apiKey!,
        normalizedQuery,
        model,
        dimensions,
        config.endpoint,
        { timeoutMs: config.timeoutMs }
      ),
  });

const cosineSimilarity = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (!a.length || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index] || 0;
    const valueB = b[index] || 0;
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dot / denominator : null;
};

const getImageVectorsByIds = async (vectorize: Vectorize, ids: string[]) => {
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 20) {
    chunks.push(ids.slice(offset, offset + 20));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk) => vectorize.getByIds(chunk))
  );
  return chunkResults.flat();
};

const rerankByVisualRefinement = async (
  env: Env,
  results: ArtworkSearchResult[],
  visualRefinement: string,
  schedule?: ScheduleBackgroundWork,
  degradedChannels?: Set<SearchDegradedChannel>
) => {
  const vectorize = getImageVectorize(env);
  const config = getJinaConfig(env);
  if (!vectorize || !config.apiKey || results.length < 2) {
    return results;
  }

  try {
    const candidateIds = results.map((result) => canonicalArtworkId(result.id));
    const [queryEmbedding, vectors] = await Promise.all([
      getCachedJinaQueryEmbedding(
        env,
        visualRefinement,
        config,
        config.model,
        config.dimensions,
        schedule
      ),
      getImageVectorsByIds(vectorize, candidateIds),
    ]);
    const visualScoreById = new Map<string, number>();

    for (const vector of vectors) {
      const similarity = cosineSimilarity(queryEmbedding, vector.values);
      if (similarity !== null) {
        visualScoreById.set(canonicalArtworkId(vector.id), similarity);
      }
    }

    if (!visualScoreById.size) {
      return results;
    }

    const visualRankById = new Map(
      [...visualScoreById.entries()]
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
        .map(([id], index) => [id, index + 1])
    );
    const scored = results.map((result, index) => {
      const id = canonicalArtworkId(result.id);
      const visualRank = visualRankById.get(id);
      return {
        result,
        originalIndex: index,
        visualRank,
        visualScore: visualScoreById.get(id),
        score:
          2 / (RRF_K + index + 1) + (visualRank ? 3 / (RRF_K + visualRank) : 0),
      };
    });

    scored.sort(
      (a, b) => b.score - a.score || a.originalIndex - b.originalIndex
    );
    const maxScore = scored[0]?.score || 1;

    return scored.map(({ result, score, visualRank, visualScore }) => ({
      ...result,
      similarity: score / maxScore,
      metadata: {
        ...result.metadata,
        visual_refinement: {
          query: visualRefinement,
          rank: visualRank || null,
          score: visualScore ?? null,
          method: 'candidate_vector_rrf',
        },
      },
    }));
  } catch (error) {
    degradedChannels?.add('visual_refinement');
    console.warn(
      'Visual refinement failed; preserving base text ranking',
      error
    );
    return results;
  }
};

const getCaptionConfig = (env: Env) => ({
  provider: env.CAPTION_EMBEDDING_PROVIDER || 'cloudflare-bge',
  model: env.JINA_TEXT_MODEL || DEFAULT_JINA_TEXT_MODEL,
  dimensions: getJinaDimensions(env.JINA_TEXT_EMBEDDING_DIMENSIONS),
});

const getSearchResultModelIdentity = (env: Env) => {
  const image = getJinaConfig(env);
  const caption = getCaptionConfig(env);

  return JSON.stringify({
    image: {
      provider: 'jina',
      endpoint: image.endpoint,
      model: image.model,
      dimensions: image.dimensions,
    },
    caption:
      caption.provider === 'jina'
        ? {
            provider: caption.provider,
            endpoint: image.endpoint,
            model: caption.model,
            dimensions: caption.dimensions,
          }
        : {
            provider: caption.provider,
            model: CAPTION_TEXT_MODEL,
          },
    captionVectorSearchEnabled: isCaptionVectorSearchEnabled(env),
  });
};

async function generateCaptionQueryEmbedding(
  env: Env,
  query: string,
  schedule?: ScheduleBackgroundWork
): Promise<number[]> {
  const captionConfig = getCaptionConfig(env);
  if (captionConfig.provider === 'jina') {
    const queryConfig = getJinaConfig(env);
    if (!queryConfig.apiKey) {
      throw new Error(
        'A query embedding API token is required for caption search'
      );
    }

    return getCachedJinaQueryEmbedding(
      env,
      query,
      queryConfig,
      captionConfig.model,
      captionConfig.dimensions,
      schedule
    );
  }

  return generateCloudflareCaptionQueryEmbedding(env.AI, query);
}

async function searchJinaTextVectors(
  env: Env,
  vectorize: Vectorize | undefined,
  config: ReturnType<typeof getJinaConfig>,
  orgId: string | undefined,
  provider: string | undefined,
  query: string,
  topK: number,
  structuredConstraints?: PublicSearchConstraints,
  schedule?: ScheduleBackgroundWork
): Promise<CaptionVectorMatch[]> {
  if (!vectorize || !config.apiKey) {
    return [];
  }

  const queryEmbedding = await getCachedJinaQueryEmbedding(
    env,
    query,
    config,
    config.model,
    config.dimensions,
    schedule
  );
  const result = await vectorize.query(queryEmbedding, {
    topK: Math.min(Math.max(topK * 4, 20), MAX_SEARCH_RESULTS),
    filter: getVectorFilter(orgId, provider, structuredConstraints),
    returnValues: false,
    returnMetadata: VECTORIZE_QUERY_METADATA,
  });

  return canonicalizeMatches(
    result.matches.map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata as Record<string, unknown> | undefined,
    }))
  );
}

async function searchCaptionVectors(
  env: Env,
  vectorize: Vectorize | undefined,
  orgId: string | undefined,
  provider: string | undefined,
  query: string,
  topK: number,
  structuredConstraints?: PublicSearchConstraints,
  schedule?: ScheduleBackgroundWork
): Promise<CaptionVectorMatch[]> {
  if (!vectorize || !isCaptionVectorSearchEnabled(env)) {
    return [];
  }

  const queryEmbedding = await generateCaptionQueryEmbedding(
    env,
    query,
    schedule
  );
  const result = await vectorize.query(queryEmbedding, {
    topK: Math.min(Math.max(topK * 4, 20), MAX_SEARCH_RESULTS),
    filter: getVectorFilter(orgId, provider, structuredConstraints),
    returnValues: false,
    returnMetadata: VECTORIZE_QUERY_METADATA,
  });

  return canonicalizeMatches(
    result.matches.map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata as Record<string, unknown> | undefined,
    }))
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function searchJinaImageVectors(
  vectorize: Vectorize,
  config: ReturnType<typeof getJinaConfig>,
  orgId: string | undefined,
  provider: string | undefined,
  imageBuffer: ArrayBuffer,
  topK: number,
  minScore: number,
  structuredConstraints?: PublicSearchConstraints
): Promise<CaptionVectorMatch[]> {
  if (!config.apiKey) {
    throw new Error('JINA_API_KEY is required for image search');
  }

  const queryEmbedding = await generateJinaQueryEmbedding(
    config.apiKey,
    {
      image: arrayBufferToBase64(imageBuffer),
    },
    config.model,
    config.dimensions,
    config.endpoint,
    { timeoutMs: config.timeoutMs }
  );
  const result = await vectorize.query(queryEmbedding, {
    topK: Math.min(Math.max(topK, 1), MAX_SEARCH_RESULTS),
    filter: getVectorFilter(orgId, provider, structuredConstraints),
    returnValues: false,
    returnMetadata: VECTORIZE_QUERY_METADATA,
  });

  return canonicalizeMatches(
    result.matches
      .filter((match) => match.score >= minScore)
      .map((match) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata as Record<string, unknown> | undefined,
      }))
  );
}

async function getArtworksByIds(
  db: D1Database,
  ids: string[],
  orgId?: string,
  provider?: string
): Promise<Map<string, ArtworkSearchRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const artworks: ArtworkSearchRow[] = [];
  const chunkSize = 80;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const orgFilter = orgId ? 'AND org_id = ?' : '';
    const providerFilter = providerSearchSql(provider);
    const { results } = await db
      .prepare(
        `
      SELECT
        id,
        org_id,
        title,
        artist,
        year,
        year_start,
        year_end,
        date_text,
        medium,
        medium_family,
        classification,
        subclassification,
        visual_classification,
        primary_artist_id,
        culture,
        origin,
        dimensions_height,
        dimensions_width,
        dimensions_depth,
        dimensions_unit,
        description,
        provenance,
        credit_line,
        rights,
        accession_number,
        source_url,
        source_institution,
        source_collection,
        source_record_id,
        field_sources,
        dominant_colors,
        color_palette,
        citation,
        image_url,
        thumbnail_url,
        custom_metadata
      FROM artworks
      WHERE id IN (${placeholders})
        AND deleted_at IS NULL
        ${orgFilter}
        ${providerFilter}
        ${backableSearchSql(orgId)}
      `
      )
      .bind(
        ...chunk,
        ...(orgId ? [orgId] : []),
        ...(provider ? [provider] : [])
      )
      .all<ArtworkSearchRow>();

    artworks.push(...results);
  }

  return new Map(artworks.map((artwork) => [artwork.id, artwork]));
}

export type NgaAttributionSearchScope = {
  orgId?: string;
  provider: 'nga';
};

export async function searchNgaAttributionMatches(
  db: D1Database,
  scope: NgaAttributionSearchScope,
  intent: NgaAttributionIntent,
  constraints: PublicSearchConstraints | undefined,
  topK: number
): Promise<ArtworkSearchResult[]> {
  const targetTokens = unicodeSearchQueryTokens(intent.targetText).slice(0, 8);
  if (!targetTokens.length) return [];

  const artistText = `coalesce(artist, '')`;
  const relationshipsText = `(CASE
      WHEN json_valid(custom_metadata)
        THEN coalesce(json_extract(custom_metadata, '$.ngaArtists.relationships'), '')
      ELSE ''
    END)`;
  const evidenceText = `(${artistText} || ' ' || ${relationshipsText})`;
  const targetQueries = targetTokens.map(unicodeSqlCandidatePattern);
  const buildTokenCandidateSql = () => `${evidenceText} GLOB ?`;
  const tokenScoreSql = targetQueries
    .map(() => `CASE WHEN ${buildTokenCandidateSql()} THEN 10 ELSE 0 END`)
    .join(' + ');
  const tokenWhereSql = targetQueries.map(buildTokenCandidateSql).join(' AND ');
  const orgFilter = scope.orgId ? 'AND org_id = ?' : '';
  const providerFilter = providerSearchSql(scope.provider);
  const structuredFilter = buildStructuredConstraintSql(constraints);
  const approved: ArtworkSearchResult[] = [];
  const pageSize = Math.min(Math.max(topK * 2, 10), MAX_SEARCH_RESULTS);
  let offset = 0;

  while (approved.length < topK) {
    const { results } = await db
      .prepare(
        `
      SELECT
        id,
        org_id,
        title,
        artist,
        year,
        year_start,
        year_end,
        date_text,
        medium,
        medium_family,
        classification,
        subclassification,
        visual_classification,
        primary_artist_id,
        culture,
        origin,
        dimensions_height,
        dimensions_width,
        dimensions_depth,
        dimensions_unit,
        description,
        provenance,
        credit_line,
        rights,
        accession_number,
        source_url,
        source_institution,
        source_collection,
        source_record_id,
        field_sources,
        dominant_colors,
        color_palette,
        citation,
        image_url,
        thumbnail_url,
        custom_metadata,
        (${tokenScoreSql}) AS match_score
      FROM artworks
      WHERE deleted_at IS NULL
        ${orgFilter}
        ${providerFilter}
        ${backableSearchSql(scope.orgId)}
        ${structuredFilter.sql}
        AND ${tokenWhereSql}
      ORDER BY match_score DESC, title COLLATE NOCASE ASC, id ASC
      LIMIT ? OFFSET ?
      `
      )
      .bind(
        ...targetQueries,
        ...(scope.orgId ? [scope.orgId] : []),
        ...(scope.provider ? [scope.provider] : []),
        ...structuredFilter.params,
        ...targetQueries,
        pageSize,
        offset
      )
      .all<ArtworkMetadataSearchRow>();

    if (!results.length) break;

    for (const [index, artwork] of results.entries()) {
      const similarity = Math.min(
        Math.max(artwork.match_score / (targetTokens.length * 10), 0.01),
        1
      );
      const mapped = mapSearchRow(artwork, similarity, [
        {
          channel: 'metadata',
          label: 'NGA catalogue artist',
          source:
            'artworks.artist and custom_metadata.ngaArtists.relationships',
          weight: 1,
          rank: offset + index + 1,
          score: similarity,
        },
      ]);
      if (
        constraints &&
        !searchResultMatchesStructuredConstraints(mapped, constraints)
      ) {
        continue;
      }
      if (
        !matchesNgaAttributionEvidence(
          {
            artist: mapped.artist,
            primaryArtistId: mapped.metadata?.primaryArtistId,
            ngaArtists: mapped.metadata?.ngaArtists,
          },
          intent
        )
      ) {
        continue;
      }
      approved.push({
        ...mapped,
        metadata: {
          ...(mapped.metadata || {}),
          relationEvidence: {
            verified: true,
            source: 'catalogue_artist',
          },
        },
      });
      if (approved.length === topK) break;
    }

    offset += results.length;
    if (results.length < pageSize) break;
  }

  return approved;
}

async function searchArtworksHybrid(
  env: Env,
  orgId: string | undefined,
  provider: string | undefined,
  query: string,
  topK: number,
  forcedIntent?: 'artist_exact',
  schedule?: ScheduleBackgroundWork,
  degradedChannels?: Set<SearchDegradedChannel>,
  structuredConstraints?: PublicSearchConstraints,
  ngaPlanMode?: NgaSearchPlan['mode']
): Promise<ArtworkSearchResult[]> {
  const fusionMode = getSearchFusionMode(env, orgId);
  if (fusionMode === 'legacy' || fusionMode === 'metadata') {
    const metadataResults = await searchArtworksByMetadata(
      env.DB,
      orgId,
      provider,
      query,
      structuredConstraints ? MAX_SEARCH_RESULTS : topK,
      structuredConstraints
    );
    return structuredConstraints
      ? metadataResults
          .filter((result) =>
            matchesNgaSearchConstraints(
              {
                year: result.year,
                yearStart:
                  typeof result.metadata?.yearStart === 'number'
                    ? result.metadata.yearStart
                    : null,
                yearEnd:
                  typeof result.metadata?.yearEnd === 'number'
                    ? result.metadata.yearEnd
                    : null,
                dateText:
                  typeof result.metadata?.dateText === 'string'
                    ? result.metadata.dateText
                    : null,
                classification:
                  typeof result.metadata?.classification === 'string'
                    ? result.metadata.classification
                    : null,
                visualClassification:
                  typeof result.metadata?.visualClassification === 'string'
                    ? result.metadata.visualClassification
                    : null,
                medium:
                  typeof result.metadata?.medium === 'string'
                    ? result.metadata.medium
                    : null,
                mediumFamily:
                  typeof result.metadata?.mediumFamily === 'string'
                    ? result.metadata.mediumFamily
                    : null,
                primaryArtistId:
                  typeof result.metadata?.primaryArtistId === 'string'
                    ? result.metadata.primaryArtistId
                    : null,
              },
              structuredConstraints
            )
          )
          .slice(0, topK)
      : metadataResults;
  }

  const routedPlan = buildRoutedSearchPlan(query, forcedIntent, ngaPlanMode);
  const initialRoute = structuredConstraints?.artistIds?.length
    ? {
        ...routedPlan,
        weights: { ...routedPlan.weights, caption: 0 },
      }
    : routedPlan;
  const metadataQuery = initialRoute.metadataQuery || query;
  const temporalFilter = parseTemporalFilter(metadataQuery);
  const jinaConfig = getJinaConfig(env);
  const imageVectorize = getImageVectorize(env);
  const captionVectorize = getCaptionVectorize(env);
  const captionConfig = getCaptionConfig(env);
  const imageChannelAvailable = Boolean(imageVectorize && jinaConfig.apiKey);
  const captionChannelAvailable = Boolean(
    captionVectorize &&
      isCaptionVectorSearchEnabled(env) &&
      (captionConfig.provider !== 'jina' || jinaConfig.apiKey) &&
      (captionConfig.provider === 'jina' || env.AI)
  );
  if (initialRoute.weights.jinaImage > 0 && !imageChannelAvailable) {
    degradedChannels?.add('image_embedding');
  }
  if (initialRoute.weights.caption > 0 && !captionChannelAvailable) {
    degradedChannels?.add('caption_embedding');
  }
  const jinaMatchesPromise =
    initialRoute.weights.jinaImage > 0 && imageChannelAvailable
      ? searchJinaTextVectors(
          env,
          imageVectorize,
          jinaConfig,
          orgId,
          provider,
          query,
          topK,
          structuredConstraints,
          schedule
        ).catch((error) => {
          degradedChannels?.add('image_embedding');
          console.warn(
            'Jina text query embedding failed; falling back to caption search',
            error
          );
          return [] as CaptionVectorMatch[];
        })
      : Promise.resolve([] as CaptionVectorMatch[]);

  const [jinaMatches, captionMatches, metadataMatches] = await Promise.all([
    jinaMatchesPromise,
    initialRoute.weights.caption > 0 && captionChannelAvailable
      ? searchCaptionVectors(
          env,
          captionVectorize,
          orgId,
          provider,
          query,
          topK,
          structuredConstraints,
          schedule
        ).catch((error) => {
          degradedChannels?.add('caption_embedding');
          console.warn(
            'Caption query embedding failed; continuing without caption vectors',
            error
          );
          return [] as CaptionVectorMatch[];
        })
      : Promise.resolve([] as CaptionVectorMatch[]),
    initialRoute.weights.metadata > 0
        ? (forcedIntent === 'artist_exact'
          ? searchArtworksByArtistFacet(
              env.DB,
              orgId,
              provider,
              query,
              topK,
              structuredConstraints
            )
          : searchArtworksByMetadata(
              env.DB,
              orgId,
              provider,
              metadataQuery,
              Math.min(Math.max(topK * 2, 10), MAX_SEARCH_RESULTS),
              structuredConstraints
            )
        ).catch((error) => {
          degradedChannels?.add('metadata');
          console.warn(
            'Metadata search failed during hybrid search; continuing with vector channels',
            error
          );
          return [] as ArtworkSearchResult[];
        })
      : Promise.resolve([] as ArtworkSearchResult[]),
  ]);
  const route =
    ngaPlanMode === 'relational'
      ? initialRoute
      : refineRoutedSearchPlan(initialRoute, query, metadataMatches);
  const artistCandidateIds =
    forcedIntent === 'artist_exact'
      ? new Set(metadataMatches.map((match) => match.id))
      : null;
  const eligibleJinaMatches = artistCandidateIds
    ? jinaMatches.filter((match) => artistCandidateIds.has(match.id))
    : jinaMatches;
  const eligibleCaptionMatches = artistCandidateIds
    ? captionMatches.filter((match) => artistCandidateIds.has(match.id))
    : captionMatches;

  const scores = new Map<
    string,
    {
      score: number;
      vectorScore?: number;
      searchSources: SearchSourceContribution[];
    }
  >();

  const addRankedMatches = (
    matches: Array<{
      id: string;
      score?: number;
      similarity?: number;
      metadata?: Record<string, unknown>;
    }>,
    weight: number,
    source:
      | Omit<
          SearchSourceContribution,
          'weight' | 'rank' | 'score' | 'model' | 'embeddingVersion'
        >
      | ((match: {
          id: string;
          score?: number;
          similarity?: number;
          metadata?: Record<string, unknown>;
        }) => Omit<
          SearchSourceContribution,
          'weight' | 'rank' | 'score' | 'model' | 'embeddingVersion'
        >)
  ) => {
    if (weight <= 0) return;

    matches.forEach((match, index) => {
      const existing = scores.get(match.id);
      const score =
        typeof match.score === 'number'
          ? match.score
          : typeof match.similarity === 'number'
            ? match.similarity
            : undefined;
      const model =
        typeof match.metadata?.model === 'string'
          ? match.metadata.model
          : undefined;
      const embeddingVersion =
        typeof match.metadata?.embeddingVersion === 'string'
          ? match.metadata.embeddingVersion
          : undefined;
      const resolvedSource =
        typeof source === 'function' ? source(match) : source;
      scores.set(match.id, {
        score: (existing?.score || 0) + weight / (RRF_K + index + 1),
        vectorScore: existing?.vectorScore ?? match.score,
        searchSources: [
          ...(existing?.searchSources || []),
          compactObject({
            ...resolvedSource,
            weight,
            rank: index + 1,
            score,
            model,
            embeddingVersion,
          }) as SearchSourceContribution,
        ],
      });
    });
  };

  addRankedMatches(eligibleJinaMatches, route.weights.jinaImage, {
    channel: 'image_embedding',
    label: 'Image embedding',
    source: 'image_url',
  });
  addRankedMatches(eligibleCaptionMatches, route.weights.caption, (match) => {
    const institutionCaption =
      match.metadata?.sourceKind === 'institution_caption_embedding';
    return {
      channel: institutionCaption
        ? 'institution_caption_embedding'
        : 'generated_caption_embedding',
      label: institutionCaption
        ? 'Institution caption embedding'
        : 'Generated caption embedding',
      source:
        typeof match.metadata?.sourceField === 'string'
          ? match.metadata.sourceField
          : institutionCaption
            ? 'description'
            : 'custom_metadata.generated_caption.text',
    };
  });
  addRankedMatches(metadataMatches, route.weights.metadata, {
    channel: 'metadata',
    label: 'Catalogue metadata',
    source: 'artworks metadata fields',
  });

  const exactFieldPriorityById = new Map(
    metadataMatches.map((match) => [
      canonicalArtworkId(match.id),
      Math.max(
        exactMetadataMatchPriority(query, match),
        route.intent === 'medium_exact'
          ? exactMediumMatchPriority(query, match)
          : 0
      ),
    ])
  );
  const rankingScoreById = new Map(
    [...scores.entries()].map(([id, value]) => [
      id,
      value.score +
        (exactFieldPriorityById.get(id) || 0) * EXACT_METADATA_PRIORITY_BONUS,
    ])
  );
  const rankedCandidateIds = [...scores.entries()]
    .sort(
      ([idA], [idB]) =>
        (rankingScoreById.get(idB) || 0) - (rankingScoreById.get(idA) || 0)
    )
    .map(([id]) => id);
  const rankedIds =
    temporalFilter || structuredConstraints
      ? rankedCandidateIds
      : rankedCandidateIds.slice(0, topK);

  const artworkById = await getArtworksByIds(
    env.DB,
    rankedIds,
    orgId,
    provider
  );
  const maxScore = Math.max(...rankingScoreById.values(), 0.001);

  const results = rankedIds.flatMap((id) => {
    const artwork = artworkById.get(id);
    const fused = scores.get(id);
    if (!artwork || !fused) return [];

    if (
      temporalFilter &&
      !artworkMatchesTemporalFilter(artwork, temporalFilter)
    ) {
      return [];
    }
    if (
      structuredConstraints &&
      !artworkMatchesStructuredConstraints(artwork, structuredConstraints)
    ) {
      return [];
    }

    return mapSearchRow(
      artwork,
      Math.min((rankingScoreById.get(id) || fused.score) / maxScore, 1),
      fused.searchSources
    );
  });

  return results.slice(0, topK);
}

async function searchArtworksByMetadata(
  db: D1Database,
  orgId: string | undefined,
  provider: string | undefined,
  query: string,
  topK: number,
  structuredConstraints?: PublicSearchConstraints
): Promise<ArtworkSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedWordQuery = normalizeSearchWords(query);
  const temporalFilter = parseTemporalFilter(query);
  const likeQuery = `%${escapeLike(normalizedWordQuery || normalizedQuery)}%`;
  const tokens = searchQueryTokens(query).slice(0, 8);
  const phraseQuery =
    tokens.length === 1
      ? `% ${escapeLike(tokens[0] as string)} %`
      : `%${escapeLike(normalizedWordQuery || normalizedQuery)}%`;
  const tokenQueries = tokens.length
    ? tokens.map((token) => `% ${escapeLike(token)} %`)
    : [likeQuery];
  const titleText = normalizedTextSql('title');
  const artistText = normalizedTextSql('artist');
  const dateText = normalizedTextSql('date_text');
  const descriptionText = normalizedTextSql(searchDescriptionSql(orgId));
  const mediumText = normalizedTextSql('medium');
  const classificationText = normalizedTextSql('classification');
  const accessionText = normalizedTextSql('accession_number');
  const searchableExpression = `
    (${titleText} || ${artistText} || ${dateText} || ${descriptionText} ||
     ${mediumText} || ${classificationText} || ${accessionText})
  `;
  const temporalLikeQuery = temporalFilter
    ? `%${escapeLike(temporalFilter.textQuery)}%`
    : null;
  const temporalScoreSql = temporalFilter
    ? `CASE WHEN year BETWEEN ? AND ? THEN 120 ELSE 0 END +
       CASE WHEN ${dateText} LIKE ? ESCAPE '\\' THEN 80 ELSE 0 END +`
    : '';
  const temporalWhereSql = temporalFilter
    ? `(year BETWEEN ? AND ? OR ${dateText} LIKE ? ESCAPE '\\')`
    : '';
  const tokenScoreSql = tokenQueries
    .map(
      () =>
        `CASE WHEN ${searchableExpression} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`
    )
    .join(' + ');
  const tokenWhereSql = tokenQueries
    .map(() => `${searchableExpression} LIKE ? ESCAPE '\\'`)
    .join(' AND ');
  const scoreParams = [
    normalizedQuery,
    phraseQuery,
    phraseQuery,
    phraseQuery,
    phraseQuery,
    phraseQuery,
    phraseQuery,
    ...(temporalFilter && temporalLikeQuery
      ? [temporalFilter.startYear, temporalFilter.endYear, temporalLikeQuery]
      : []),
    ...tokenQueries,
  ];

  const orgFilter = orgId ? 'AND org_id = ?' : '';
  const providerFilter = providerSearchSql(provider);
  const structuredFilter = buildStructuredConstraintSql(structuredConstraints);
  const whereSql = temporalFilter
    ? `AND (${temporalWhereSql} OR (${tokenWhereSql}))`
    : `AND (${tokenWhereSql})`;
  const params = [
    ...scoreParams,
    ...(orgId ? [orgId] : []),
    ...(provider ? [provider] : []),
    ...structuredFilter.params,
    ...(temporalFilter && temporalLikeQuery
      ? [temporalFilter.startYear, temporalFilter.endYear, temporalLikeQuery]
      : []),
    ...tokenQueries,
    topK,
  ];

  const { results } = await db
    .prepare(
      `
    SELECT
      id,
      org_id,
      title,
      artist,
      year,
      year_start,
      year_end,
      date_text,
      medium,
      medium_family,
      classification,
      subclassification,
      visual_classification,
      primary_artist_id,
      culture,
      origin,
      dimensions_height,
      dimensions_width,
      dimensions_depth,
      dimensions_unit,
      description,
      provenance,
      credit_line,
      rights,
      accession_number,
      source_url,
      source_institution,
      source_collection,
      source_record_id,
      field_sources,
      dominant_colors,
      color_palette,
      citation,
      image_url,
      thumbnail_url,
      custom_metadata,
      (
        CASE WHEN lower(coalesce(title, '')) = ? THEN 100 ELSE 0 END +
        CASE WHEN ${titleText} LIKE ? ESCAPE '\\' THEN 60 ELSE 0 END +
        CASE WHEN ${artistText} LIKE ? ESCAPE '\\' THEN 45 ELSE 0 END +
        CASE WHEN ${descriptionText} LIKE ? ESCAPE '\\' THEN 30 ELSE 0 END +
        CASE WHEN ${mediumText} LIKE ? ESCAPE '\\' THEN 25 ELSE 0 END +
        CASE WHEN ${classificationText} LIKE ? ESCAPE '\\' THEN 25 ELSE 0 END +
        CASE WHEN ${accessionText} LIKE ? ESCAPE '\\' THEN 35 ELSE 0 END +
        ${temporalScoreSql}
        ${tokenScoreSql}
      ) AS match_score
    FROM artworks
    WHERE deleted_at IS NULL
      ${orgFilter}
      ${providerFilter}
      ${backableSearchSql(orgId)}
      ${structuredFilter.sql}
      ${whereSql}
    ORDER BY match_score DESC, title COLLATE NOCASE ASC
    LIMIT ?
    `
    )
    .bind(...params)
    .all<ArtworkMetadataSearchRow>();

  return results.map((artwork) =>
    mapSearchRow(
      artwork,
      Math.min(Math.max(artwork.match_score / 100, 0.01), 1)
    )
  );
}

async function searchArtworksByArtistFacet(
  db: D1Database,
  orgId: string | undefined,
  provider: string | undefined,
  query: string,
  topK: number,
  structuredConstraints?: PublicSearchConstraints
): Promise<ArtworkSearchResult[]> {
  const normalizedQuery = normalizeArtistFacetQuery(query);
  const tokens = artistFacetTokens(query);
  if (!normalizedQuery || tokens.length === 0) {
    return [];
  }

  const artistText = normalizedTextSql('artist');
  const phraseQuery = `% ${escapeLike(normalizedQuery)} %`;
  const tokenQueries = tokens.map((token) => `% ${escapeLike(token)} %`);
  const tokenScoreSql = tokenQueries
    .map(() => `CASE WHEN ${artistText} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`)
    .join(' + ');
  const tokenWhereSql = tokenQueries
    .map(() => `${artistText} LIKE ? ESCAPE '\\'`)
    .join(' AND ');
  const orgFilter = orgId ? 'AND org_id = ?' : '';
  const providerFilter = providerSearchSql(provider);
  const structuredFilter =
    buildFacetStructuredConstraintSql(structuredConstraints);
  const whereSql = `AND (${artistText} LIKE ? ESCAPE '\\' OR (${tokenWhereSql}))`;
  const baseParams = [
    normalizedQuery,
    phraseQuery,
    ...tokenQueries,
    ...(orgId ? [orgId] : []),
    ...(provider ? [provider] : []),
    ...structuredFilter.params,
    phraseQuery,
    ...tokenQueries,
  ];
  const approvedResults: ArtworkSearchResult[] = [];
  let offset = 0;

  while (approvedResults.length < topK) {
    const { results } = await db
      .prepare(
        `
    SELECT
      id,
      org_id,
      title,
      artist,
      year,
      year_start,
      year_end,
      date_text,
      medium,
      medium_family,
      classification,
      subclassification,
      visual_classification,
      primary_artist_id,
      culture,
      origin,
      dimensions_height,
      dimensions_width,
      dimensions_depth,
      dimensions_unit,
      description,
      provenance,
      credit_line,
      rights,
      accession_number,
      source_url,
      source_institution,
      source_collection,
      source_record_id,
      field_sources,
      dominant_colors,
      color_palette,
      citation,
      image_url,
      thumbnail_url,
      custom_metadata,
      (
        CASE WHEN lower(trim(coalesce(artist, ''))) = ? THEN 120 ELSE 0 END +
        CASE WHEN ${artistText} LIKE ? ESCAPE '\\' THEN 100 ELSE 0 END +
        ${tokenScoreSql}
      ) AS match_score
    FROM artworks
    WHERE deleted_at IS NULL
      AND artist IS NOT NULL
      AND trim(artist) <> ''
      ${orgFilter}
      ${providerFilter}
      ${backableSearchSql(orgId)}
      ${structuredFilter.sql}
      ${whereSql}
    ORDER BY match_score DESC, artist COLLATE NOCASE ASC, year ASC, title COLLATE NOCASE ASC, id ASC
    LIMIT ? OFFSET ?
    `
      )
      .bind(...baseParams, topK, offset)
      .all<ArtworkMetadataSearchRow>();

    if (!results.length) break;

    for (const [index, artwork] of results.entries()) {
      const similarity = Math.min(
        Math.max(artwork.match_score / 120, 0.01),
        1
      );
      const mapped = mapSearchRow(artwork, similarity, [
        {
          channel: 'metadata',
          label: 'Artist',
          source: 'artworks.artist',
          weight: 1,
          rank: offset + index + 1,
          score: similarity,
        },
      ]);
      if (
        !structuredConstraints ||
        searchResultMatchesStructuredConstraints(mapped, structuredConstraints)
      ) {
        approvedResults.push(mapped);
        if (approvedResults.length === topK) break;
      }
    }

    offset += results.length;
    if (results.length < topK) break;
  }

  return approvedResults;
}

async function searchArtworksByClassificationFacet(
  db: D1Database,
  orgId: string | undefined,
  provider: string | undefined,
  query: string,
  topK: number,
  structuredConstraints?: PublicSearchConstraints
): Promise<ArtworkSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const orgFilter = orgId ? 'AND org_id = ?' : '';
  const providerFilter = providerSearchSql(provider);
  const structuredFilter =
    buildFacetStructuredConstraintSql(structuredConstraints);
  const baseParams = [
    ...(orgId ? [orgId] : []),
    ...(provider ? [provider] : []),
    ...structuredFilter.params,
    normalizedQuery,
  ];
  const approvedResults: ArtworkSearchResult[] = [];
  let offset = 0;

  while (approvedResults.length < topK) {
    const { results } = await db
      .prepare(
        `
    SELECT
      id,
      org_id,
      title,
      artist,
      year,
      year_start,
      year_end,
      date_text,
      medium,
      medium_family,
      classification,
      subclassification,
      visual_classification,
      primary_artist_id,
      culture,
      origin,
      dimensions_height,
      dimensions_width,
      dimensions_depth,
      dimensions_unit,
      description,
      provenance,
      credit_line,
      rights,
      accession_number,
      source_url,
      source_institution,
      source_collection,
      source_record_id,
      field_sources,
      dominant_colors,
      color_palette,
      citation,
      image_url,
      thumbnail_url,
      custom_metadata,
      100 AS match_score
    FROM artworks
    WHERE deleted_at IS NULL
      AND classification IS NOT NULL
      AND trim(classification) <> ''
      ${orgFilter}
      ${providerFilter}
      ${backableSearchSql(orgId)}
      ${structuredFilter.sql}
      AND lower(trim(classification)) = ?
    ORDER BY year ASC, title COLLATE NOCASE ASC, id ASC
    LIMIT ? OFFSET ?
    `
      )
      .bind(...baseParams, topK, offset)
      .all<ArtworkMetadataSearchRow>();

    if (!results.length) break;

    for (const [index, artwork] of results.entries()) {
      const mapped = mapSearchRow(artwork, 1, [
        {
          channel: 'metadata',
          label: 'Classification',
          source: 'artworks.classification',
          weight: 1,
          rank: offset + index + 1,
          score: 1,
        },
      ]);
      if (
        !structuredConstraints ||
        searchResultMatchesStructuredConstraints(mapped, structuredConstraints)
      ) {
        approvedResults.push(mapped);
        if (approvedResults.length === topK) break;
      }
    }

    offset += results.length;
    if (results.length < topK) break;
  }

  return approvedResults;
}

async function hasExactArtistFacetMatch(
  db: D1Database,
  orgId: string | undefined,
  provider: string | undefined,
  query: string
) {
  const normalizedQuery = normalizeArtistFacetQuery(query);
  const tokens = artistFacetTokens(query);
  if (!normalizedQuery || tokens.length < 2) {
    return false;
  }

  const artistText = normalizedTextSql('artist');
  const orgFilter = orgId ? 'AND org_id = ?' : '';
  const providerFilter = providerSearchSql(provider);
  const params = [
    ...(orgId ? [orgId] : []),
    ...(provider ? [provider] : []),
    normalizedQuery,
  ];
  const { results } = await db
    .prepare(
      `
    SELECT id
    FROM artworks
    WHERE deleted_at IS NULL
      AND artist IS NOT NULL
      AND trim(artist) <> ''
      ${orgFilter}
      ${providerFilter}
      ${backableSearchSql(orgId)}
      AND trim(${artistText}) = ?
    LIMIT 1
    `
    )
    .bind(...params)
    .all<{ id: string }>();

  return results.length > 0;
}

// Validation schemas
const textSearchSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(500),
  topK: z
    .number()
    .int()
    .positive()
    .max(MAX_SEARCH_RESULTS)
    .optional()
    .default(10),
  minScore: z.number().min(0).max(1).optional().default(0.7),
  facet: z.enum(['artist', 'classification']).optional(),
  visualRefinement: z.string().trim().min(1).max(100).optional(),
  constraints: z
    .object({
      dateRange: z
        .object({ startYear: z.number().int(), endYear: z.number().int() })
        .optional(),
      classifications: z.array(z.string().min(1)).max(8).optional(),
      mediumFamilies: z.array(z.string().min(1)).max(8).optional(),
      artistIds: z.array(z.string().min(1)).max(8).optional(),
    })
    .strict()
    .optional(),
});

class InvalidImageSearchRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageSearchRequestError';
  }
}

const parseImageSearchConstraints = (
  value: File | string | null
): PublicSearchConstraints | undefined => {
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidImageSearchRequestError(
      'Constraints must be a JSON object'
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new InvalidImageSearchRequestError(
      'Constraints must contain valid JSON'
    );
  }

  try {
    return parsePublicSearchConstraints(decoded);
  } catch (error) {
    throw new InvalidImageSearchRequestError(
      error instanceof Error
        ? error.message
        : 'Constraints do not match the public search contract'
    );
  }
};

export const searchRoutes = new Hono<{ Bindings: Env }>();

searchRoutes.use('/search/image', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

searchRoutes.use(
  '/search/*',
  requireAuthOrApiKey as any,
  enforceDailyQuota({ queryType: 'vector_search' }) as any
);

/**
 * POST /search/text
 * Search artworks using natural language text query
 */
searchRoutes.post('/search/text', async (c) => {
  const startTime = performance.now();

  try {
    // Use orgId for new routes; galleryId is accepted for legacy mounts.
    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    const isPublicSearchPrincipal = getAuth(c as any).scopes.includes(
      'public_search'
    );
    if (
      isPublicSearchPrincipal &&
      !isAllowedPublicSearchRouteScope(requestedOrgId)
    ) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PUBLIC_SEARCH_SCOPE_NOT_ALLOWED',
            message: 'This organization is not available to public search',
          },
        },
        403
      );
    }

    // Parse and validate request body
    const body = await c.req.json();
    const validation = textSearchSchema.safeParse(body);

    if (!validation.success) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid search parameters',
            details: validation.error.flatten(),
          },
        },
        400
      );
    }

    const { query, topK, minScore, facet, visualRefinement, constraints } =
      validation.data;
    if (
      isPublicSearchPrincipal &&
      (topK !== MAX_SEARCH_RESULTS ||
        minScore !== 0 ||
        visualRefinement !== undefined)
    ) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_PUBLIC_SEARCH_REQUEST',
            message:
              'Public search requires topK=100, minScore=0, and no visual refinement',
          },
        },
        400
      );
    }

    const provider = resolveOpenAccessProviderScope(requestedOrgId);
    const orgId = await resolveOrgIdentifier(c.env.DB, requestedOrgId);
    const structuredSearchEnabled =
      provider === 'nga' &&
      (c.env as Env & { NGA_STRUCTURED_SEARCH_ENABLED?: string })
        .NGA_STRUCTURED_SEARCH_ENABLED !== 'false';
    const compiledNgaPlan = structuredSearchEnabled
      ? compileNgaSearchPlan(query, constraints)
      : undefined;
    const ngaPlan = compiledNgaPlan?.relation
      ? {
          ...compiledNgaPlan,
          relationEvidence: {
            policy:
              compiledNgaPlan.relation.kind === 'derived_from'
                ? ('catalogue_derivation' as const)
                : ('visible_subject' as const),
            status: 'candidate' as const,
          },
        }
      : compiledNgaPlan;
    const parsedInterpretation = structuredSearchEnabled
      ? parseNgaSearchIntent(query, constraints)
      : undefined;
    const interpretation =
      parsedInterpretation && ngaPlan
        ? {
            ...parsedInterpretation,
            constraints: ngaPlan.constraints,
            ...(ngaPlan.relation
              ? { relation: ngaPlan.relation }
              : { relation: undefined }),
            ...(ngaPlan.relationEvidence
              ? { relationEvidence: ngaPlan.relationEvidence }
              : { relationEvidence: undefined }),
          }
        : undefined;
    const constraintError = interpretation
      ? validateNgaSearchConstraints(interpretation.constraints)
      : null;
    if (constraintError) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_SEARCH_CONSTRAINTS',
            message: constraintError,
          },
        },
        400
      );
    }
    const structuredConstraints = ngaPlan?.constraints;
    // A facet query is itself the selected facet value (for example,
    // "Painting") and must not be replaced by the residual free-text plan.
    // Non-facet searches use the compiled residual so stale structured chip
    // words cannot leak back into semantic or metadata retrieval.
    const retrievalQuery = facet ? query : ngaPlan?.retrievalQuery || query;
    const degradedChannels = new Set<SearchDegradedChannel>();
    const scheduleBackgroundWork: ScheduleBackgroundWork = (work) => {
      try {
        c.executionCtx.waitUntil(work);
      } catch {
        // The promise has already started; local/test runtimes may not expose
        // a Worker execution context.
      }
    };
    let resolvedFacet = facet;
    const executeSearch = async (): Promise<SearchResponse> => {
      const exactFreeTextArtist =
        ngaPlan?.mode !== 'relational' &&
        ngaPlan?.mode !== 'attribution' &&
        !facet &&
        (await hasExactArtistFacetMatch(
          c.env.DB,
          orgId,
          provider,
          retrievalQuery
        ));
      resolvedFacet = exactFreeTextArtist ? 'artist' : facet;
      const retrievalTopK =
        ngaPlan?.mode === 'relational' ? MAX_SEARCH_RESULTS : topK;

      const baseResults =
        ngaPlan?.mode === 'attribution' && ngaPlan.attribution
          ? await searchNgaAttributionMatches(
              c.env.DB,
              { orgId, provider: 'nga' },
              ngaPlan.attribution,
              structuredConstraints,
              topK
            )
          : facet === 'artist'
            ? await searchArtworksByArtistFacet(
                c.env.DB,
                orgId,
                provider,
                retrievalQuery,
                retrievalTopK,
                structuredConstraints
              )
            : facet === 'classification'
              ? await searchArtworksByClassificationFacet(
                  c.env.DB,
                  orgId,
                  provider,
                  retrievalQuery,
                  retrievalTopK,
                  structuredConstraints
                )
              : await searchArtworksHybrid(
                  c.env,
                  orgId,
                  provider,
                  retrievalQuery,
                  retrievalTopK,
                  exactFreeTextArtist ? 'artist_exact' : undefined,
                  scheduleBackgroundWork,
                  degradedChannels,
                  structuredConstraints,
                  ngaPlan?.mode
                );
      const constrainedResults = structuredConstraints
        ? baseResults.filter((result) =>
            searchResultMatchesStructuredConstraints(
              result,
              structuredConstraints
            )
          )
        : baseResults;
      const enrichedResults = visualRefinement
        ? await rerankByVisualRefinement(
            c.env,
            constrainedResults,
            visualRefinement,
            scheduleBackgroundWork,
            degradedChannels
          )
        : constrainedResults;
      const hydratedResults = structuredConstraints
        ? enrichedResults.filter((result) =>
            searchResultMatchesStructuredConstraints(
              result,
              structuredConstraints
            )
          )
        : enrichedResults;
      const finalResults = (
        ngaPlan?.relation
          ? filterNgaRelationEvidence(hydratedResults, ngaPlan)
          : hydratedResults
      ).slice(0, topK);
      const responseInterpretation = interpretation
        ? {
            ...interpretation,
            ...(ngaPlan?.relationEvidence
              ? {
                  relationEvidence: {
                    ...ngaPlan.relationEvidence,
                    status: finalResults.length
                      ? ('verified' as const)
                      : ('unverified' as const),
                  },
                }
              : {}),
          }
        : undefined;

      return {
        results: finalResults,
        count: finalResults.length,
        queryTime: performance.now() - startTime,
        ...(responseInterpretation
          ? { interpretation: responseInterpretation }
          : {}),
      };
    };

    let cacheHeader = 'BYPASS';
    let responseCacheable = true;
    let searchResponse: SearchResponse;

    if (isPublicSearchPrincipal) {
      const cached = await getOrLoadPublicSearchResult({
        cache: c.env.CACHE,
        query: retrievalQuery,
        orgId,
        provider,
        facet,
        visualRefinement,
        topK,
        minScore,
        embeddingIndexVersion: getEmbeddingIndexVersion(c.env),
        fusionMode: getSearchFusionMode(c.env, orgId),
        modelIdentity: getSearchResultModelIdentity(c.env),
        parserVersion: interpretation?.parserVersion,
        constraints: structuredConstraints,
        ngaPlan,
        schedule: scheduleBackgroundWork,
        load: async () => {
          await enforcePublicSearchColdMissRateLimit({
            cache: c.env.CACHE,
            clientAddress: getPublicSearchClientAddress(
              c.req.header('CF-Connecting-IP'),
              c.req.header('X-Forwarded-For')
            ),
            searchIdentity: JSON.stringify({
              contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
              query: normalizePublicSearchText(retrievalQuery),
              orgId,
              provider: provider || null,
              facet: facet || null,
              parserVersion: interpretation?.parserVersion || null,
              constraints: structuredConstraints || null,
              ngaPlan: ngaPlan
                ? {
                    version: ngaPlan.version,
                    mode: ngaPlan.mode,
                    relation: ngaPlan.relation || null,
                    relationEvidencePolicy:
                      ngaPlan.relationEvidence?.policy || null,
                  }
                : null,
            }),
            countRepeatedRequests: true,
            limit: Number(c.env.PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE || ''),
          });
          const response = await executeSearch();
          return {
            response,
            cacheable: degradedChannels.size === 0,
          };
        },
      });
      const cachedRelationEvidence =
        cached.response.interpretation?.relationEvidence;
      searchResponse = {
        ...cached.response,
        ...(interpretation
          ? {
              interpretation: {
                ...interpretation,
                ...(cachedRelationEvidence
                  ? { relationEvidence: cachedRelationEvidence }
                  : {}),
              },
            }
          : {}),
      };
      cacheHeader = cached.disposition.toUpperCase();
      // A coalesced follower cannot observe the leader's degradation set, so
      // keep it out of downstream caches conservatively.
      responseCacheable =
        cached.disposition !== 'coalesced' && degradedChannels.size === 0;
    } else {
      searchResponse = await executeSearch();
      responseCacheable = degradedChannels.size === 0;
    }
    c.header('X-Paillette-Search-Cache', cacheHeader);

    await annotateUsageEvent(c as any, {
      search: {
        mode: 'text',
        query,
        visualRefinement,
        facet: resolvedFacet,
        topK,
        minScore,
        resultCount: searchResponse.count,
        queryTime: searchResponse.queryTime,
      },
    });

    await recordArtworkResults(
      c as any,
      searchResponse.results.map((result, index) => ({
        artworkId: result.id,
        galleryId: result.orgId || result.galleryId,
        rank: index + 1,
        score: result.similarity,
      }))
    );

    return c.json<ApiResponse<SearchResponse>>({
      success: true,
      data: searchResponse,
      meta: {
        timestamp: new Date().toISOString(),
        search: {
          cacheable: responseCacheable,
          degradedChannels: SEARCH_DEGRADED_CHANNEL_ORDER.filter((channel) =>
            degradedChannels.has(channel)
          ),
        },
      },
    });
  } catch (error) {
    if (error instanceof PublicSearchColdMissRateLimitError) {
      c.header('Retry-After', String(error.retryAfterSeconds));
      c.header('X-Paillette-Search-Cache', 'MISS');
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PUBLIC_SEARCH_COLD_MISS_RATE_LIMITED',
            message: 'Too many unique public searches; try again shortly',
          },
        },
        429
      );
    }
    console.error('Text search error:', error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'SEARCH_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to perform search',
        },
      },
      500
    );
  }
});

/**
 * POST /search/image
 * Search artworks using an uploaded image
 */
searchRoutes.post('/search/image', async (c) => {
  const startTime = performance.now();

  try {
    // Use orgId for new routes; galleryId is accepted for legacy mounts.
    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    const isPublicSearchPrincipal = getAuth(c as any).scopes.includes(
      'public_search'
    );
    if (
      isPublicSearchPrincipal &&
      !isAllowedPublicSearchRouteScope(requestedOrgId)
    ) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PUBLIC_SEARCH_SCOPE_NOT_ALLOWED',
            message: 'This organization is not available to public search',
          },
        },
        403
      );
    }
    const provider = resolveOpenAccessProviderScope(requestedOrgId);
    const orgId = await resolveOrgIdentifier(c.env.DB, requestedOrgId);

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      throw new InvalidImageSearchRequestError('Malformed multipart form data');
    }

    const imageEntries = formData.getAll('image') as unknown as Array<
      File | string
    >;
    const imageFile = imageEntries[0];
    if (
      imageEntries.length !== 1 ||
      !imageFile ||
      typeof imageFile === 'string'
    ) {
      throw new InvalidImageSearchRequestError(
        'Exactly one image file is required'
      );
    }
    if (imageFile.size === 0) {
      throw new InvalidImageSearchRequestError('Image file must not be empty');
    }
    if (!IMAGE_SEARCH_MIME_TYPES.has(imageFile.type)) {
      throw new InvalidImageSearchRequestError(
        'Image must be a JPEG, PNG, or WebP file'
      );
    }
    if (imageFile.size > MAX_IMAGE_SEARCH_BYTES) {
      throw new InvalidImageSearchRequestError(
        'Image must be 10 MB or smaller'
      );
    }

    const constraintEntries = formData.getAll(
      'constraints'
    ) as unknown as Array<File | string>;
    if (constraintEntries.length > 1) {
      throw new InvalidImageSearchRequestError(
        'Constraints must be provided at most once'
      );
    }
    const constraints = parseImageSearchConstraints(
      constraintEntries[0] ?? null
    );

    for (const field of ['topK', 'minScore'] as const) {
      if (formData.getAll(field).length > 1) {
        throw new InvalidImageSearchRequestError(
          `${field} must be provided at most once`
        );
      }
    }

    // Get optional parameters from form data
    const requestedTopK = Number(formData.get('topK') || '10');
    const requestedMinScore = Number(formData.get('minScore') || '0.7');
    const topK = Number.isFinite(requestedTopK)
      ? Math.min(Math.max(Math.round(requestedTopK), 1), MAX_SEARCH_RESULTS)
      : 10;
    const minScore = Number.isFinite(requestedMinScore)
      ? Math.min(Math.max(requestedMinScore, 0), 1)
      : 0.7;

    // Convert image to ArrayBuffer
    const imageBuffer = await imageFile.arrayBuffer();

    const jinaConfig = getJinaConfig(c.env);
    const imageVectorize = getImageVectorize(c.env);
    if (!jinaConfig.apiKey) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'IMAGE_EMBEDDING_UNAVAILABLE',
            message: `Image search requires JINA_API_KEY so the query image can be embedded with ${jinaConfig.model}.`,
          },
        },
        501
      );
    }
    if (!imageVectorize) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'IMAGE_INDEX_UNAVAILABLE',
            message: `No image vector index is configured for embedding version ${getEmbeddingIndexVersion(c.env)}.`,
          },
        },
        501
      );
    }

    if (isPublicSearchPrincipal) {
      const imageDigest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', imageBuffer)),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join('');
      await enforcePublicSearchColdMissRateLimit({
        cache: c.env.CACHE,
        clientAddress: getPublicSearchClientAddress(
          c.req.header('CF-Connecting-IP'),
          c.req.header('X-Forwarded-For')
        ),
        searchIdentity: buildPublicImageSearchIdentity({
          version: 'public-image-search-v1',
          contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
          mode: 'image',
          imageDigest,
          orgId,
          provider: provider || null,
          index: {
            version: getEmbeddingIndexVersion(c.env),
            binding:
              getEmbeddingIndexVersion(c.env) === 'v2'
                ? 'VECTORIZE_V2'
                : 'VECTORIZE',
          },
          embedding: {
            provider: 'jina',
            endpoint: jinaConfig.endpoint,
            model: jinaConfig.model,
            dimensions: jinaConfig.dimensions,
          },
          constraints,
          topK,
          minScore,
        }),
        countRepeatedRequests: true,
        limit: Number(c.env.PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE || ''),
      });
    }

    const vectorResults = await searchJinaImageVectors(
      imageVectorize,
      jinaConfig,
      orgId,
      provider,
      imageBuffer,
      topK,
      minScore,
      constraints
    );

    // If no results found, return empty response
    if (vectorResults.length === 0) {
      const queryTime = performance.now() - startTime;
      await annotateUsageEvent(c as any, {
        search: {
          mode: 'image',
          image: {
            name: imageFile.name || null,
            type: imageFile.type || null,
            size: imageFile.size,
          },
          topK,
          minScore,
          ...(constraints !== undefined ? { constraints } : {}),
          resultCount: 0,
          queryTime,
        },
      });
      return c.json<ApiResponse<SearchResponse>>({
        success: true,
        data: {
          results: [],
          count: 0,
          queryTime,
        },
      });
    }

    // Fetch artwork details from database using the same route provider scope.
    const artworkIds = vectorResults.map((r) => r.id);
    const artworkById = await getArtworksByIds(
      c.env.DB,
      artworkIds,
      orgId,
      provider
    );

    // Combine vector results with artwork details
    const enrichedResults: ArtworkSearchResult[] = vectorResults.flatMap(
      (vectorResult) => {
        const artwork = artworkById.get(vectorResult.id);
        if (!artwork) return [];

        const result = mapSearchRow(artwork, vectorResult.score);
        if (
          constraints !== undefined &&
          !searchResultMatchesStructuredConstraints(result, constraints)
        ) {
          return [];
        }
        return [result];
      }
    );

    const queryTime = performance.now() - startTime;

    await annotateUsageEvent(c as any, {
      search: {
        mode: 'image',
        image: {
          name: imageFile.name || null,
          type: imageFile.type || null,
          size: imageFile.size,
        },
        topK,
        minScore,
        ...(constraints !== undefined ? { constraints } : {}),
        resultCount: enrichedResults.length,
        queryTime,
      },
    });

    await recordArtworkResults(
      c as any,
      enrichedResults.map((result, index) => ({
        artworkId: result.id,
        galleryId: result.orgId || result.galleryId,
        rank: index + 1,
        score: result.similarity,
      }))
    );

    return c.json<ApiResponse<SearchResponse>>({
      success: true,
      data: {
        results: enrichedResults,
        count: enrichedResults.length,
        queryTime,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof InvalidImageSearchRequestError) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: error.message },
        },
        400
      );
    }
    if (error instanceof PublicSearchColdMissRateLimitError) {
      c.header('Retry-After', String(error.retryAfterSeconds));
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PUBLIC_SEARCH_COLD_MISS_RATE_LIMITED',
            message: 'Too many public image searches; try again shortly',
          },
        },
        429
      );
    }
    console.error('Image search error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to perform search';
    const embeddingUnavailable =
      message.includes('No such model @cf/jinaai/jina-clip-v2') ||
      message.includes('Jina') ||
      message.includes('AUTH_');

    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: embeddingUnavailable
            ? 'IMAGE_EMBEDDING_UNAVAILABLE'
            : 'SEARCH_ERROR',
          message: embeddingUnavailable
            ? 'Image search requires a working Jina query embedding service that matches the vectors loaded in Vectorize.'
            : message,
        },
      },
      embeddingUnavailable ? 501 : 500
    );
  }
});
