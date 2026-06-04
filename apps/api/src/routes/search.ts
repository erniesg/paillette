import { Hono } from 'hono';
import { z } from 'zod';
import { Env } from '../index';
import {
  annotateUsageEvent,
  enforceDailyQuota,
  recordArtworkResults,
  requireAuthOrApiKey,
} from '../middleware/auth';
import type {
  ApiResponse,
  SearchResponse,
  ArtworkSearchResult,
} from '../types';
import { BACKABLE_NGS_PUBLIC_ARTWORK_SQL } from '../utils/ngs-public-filter';
import { isNgsPublicOrg, resolveOrgIdentifier } from '../utils/orgs';

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
const MAX_SEARCH_RESULTS = 100;
const VECTORIZE_QUERY_METADATA = 'indexed' as const;

type EmbeddingIndexVersion = 'v1' | 'v2';
type SearchFusionMode = 'legacy' | 'metadata' | 'hybrid';
type RoutedSearchIntent =
  | 'balanced'
  | 'accession_exact'
  | 'color_visual'
  | 'temporal'
  | 'formal_visual';

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
  /\b(?:\d{4}-\d{5}(?:-\d{3})?|[A-Z]{1,4}-\d{3,6}(?:-[A-Z0-9]+)?)\b/i;
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

const backableSearchSql = (orgId: string | undefined) =>
  isNgsPublicOrg(orgId) ? BACKABLE_NGS_PUBLIC_ARTWORK_SQL : '';

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

const normalizedTextSql = (expression: string) => `
  (' ' || lower(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(coalesce(${expression}, ''), '-', ' '),
              ',', ' '
            ),
            '.', ' '
          ),
          '/', ' '
        ),
        '(', ' '
      ),
      ')', ' '
    )
  ) || ' ')
`;

const buildRoutedSearchPlan = (query: string): RoutedSearchPlan => {
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

  if (parseTemporalFilter(query)) {
    return {
      intent: 'temporal',
      weights: { jinaImage: 0.2, caption: 0.6, metadata: 4 },
    };
  }

  if (tokens.some((token) => FORMAL_VISUAL_TERMS.has(token))) {
    return {
      intent: 'formal_visual',
      weights: { jinaImage: 1.2, caption: 0.8, metadata: 0 },
    };
  }

  return {
    intent: 'balanced',
    weights: { jinaImage: 1, caption: 1, metadata: 0 },
  };
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
      dateText: artwork.date_text,
      date_text: artwork.date_text,
      classification: artwork.classification,
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

async function generateJinaQueryEmbedding(
  apiKey: string,
  input: JinaEmbeddingInput,
  model = DEFAULT_JINA_MULTIMODAL_MODEL,
  dimensions = DEFAULT_JINA_DIMENSIONS
): Promise<number[]> {
  const response = await fetch(JINA_EMBEDDINGS_ENDPOINT, {
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
  });

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
  apiKey: env.JINA_API_KEY,
  model: env.JINA_MULTIMODAL_MODEL || DEFAULT_JINA_MULTIMODAL_MODEL,
  dimensions: getJinaDimensions(env.JINA_EMBEDDING_DIMENSIONS),
});

const getCaptionConfig = (env: Env) => ({
  provider: env.CAPTION_EMBEDDING_PROVIDER || 'cloudflare-bge',
  model: env.JINA_TEXT_MODEL || DEFAULT_JINA_TEXT_MODEL,
  dimensions: getJinaDimensions(env.JINA_TEXT_EMBEDDING_DIMENSIONS),
});

async function generateCaptionQueryEmbedding(
  env: Env,
  query: string
): Promise<number[]> {
  const captionConfig = getCaptionConfig(env);
  if (captionConfig.provider === 'jina') {
    if (!env.JINA_API_KEY) {
      throw new Error('JINA_API_KEY is required for Jina caption search');
    }

    return generateJinaQueryEmbedding(
      env.JINA_API_KEY,
      query,
      captionConfig.model,
      captionConfig.dimensions
    );
  }

  return generateCloudflareCaptionQueryEmbedding(env.AI, query);
}

async function searchJinaTextVectors(
  vectorize: Vectorize | undefined,
  config: ReturnType<typeof getJinaConfig>,
  orgId: string | undefined,
  query: string,
  topK: number
): Promise<CaptionVectorMatch[]> {
  if (!vectorize || !config.apiKey) {
    return [];
  }

  const queryEmbedding = await generateJinaQueryEmbedding(
    config.apiKey,
    query,
    config.model,
    config.dimensions
  );
  const result = await vectorize.query(queryEmbedding, {
    topK: Math.min(Math.max(topK * 4, 20), MAX_SEARCH_RESULTS),
    filter: orgId ? { galleryId: orgId } : undefined,
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
  query: string,
  topK: number
): Promise<CaptionVectorMatch[]> {
  if (!vectorize || !isCaptionVectorSearchEnabled(env)) {
    return [];
  }

  const queryEmbedding = await generateCaptionQueryEmbedding(env, query);
  const result = await vectorize.query(queryEmbedding, {
    topK: Math.min(Math.max(topK * 4, 20), MAX_SEARCH_RESULTS),
    filter: orgId ? { galleryId: orgId } : undefined,
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
  imageBuffer: ArrayBuffer,
  topK: number,
  minScore: number
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
    config.dimensions
  );
  const result = await vectorize.query(queryEmbedding, {
    topK: Math.min(Math.max(topK, 1), MAX_SEARCH_RESULTS),
    filter: orgId ? { galleryId: orgId } : undefined,
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
  orgId?: string
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
    const { results } = await db
      .prepare(
        `
      SELECT
        id,
        org_id,
        title,
        artist,
        year,
        date_text,
        medium,
        classification,
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
        ${backableSearchSql(orgId)}
      `
      )
      .bind(...chunk, ...(orgId ? [orgId] : []))
      .all<ArtworkSearchRow>();

    artworks.push(...results);
  }

  return new Map(artworks.map((artwork) => [artwork.id, artwork]));
}

async function searchArtworksHybrid(
  env: Env,
  orgId: string | undefined,
  query: string,
  topK: number
): Promise<ArtworkSearchResult[]> {
  const fusionMode = getSearchFusionMode(env, orgId);
  if (fusionMode === 'legacy' || fusionMode === 'metadata') {
    return searchArtworksByMetadata(env.DB, orgId, query, topK);
  }

  const route = buildRoutedSearchPlan(query);
  const metadataQuery = route.metadataQuery || query;
  const temporalFilter = parseTemporalFilter(metadataQuery);
  const jinaConfig = getJinaConfig(env);
  const imageVectorize = getImageVectorize(env);
  const captionVectorize = getCaptionVectorize(env);
  const jinaMatchesPromise =
    route.weights.jinaImage > 0
      ? searchJinaTextVectors(
          imageVectorize,
          jinaConfig,
          orgId,
          query,
          topK
        ).catch((error) => {
          console.warn(
            'Jina text query embedding failed; falling back to caption search',
            error
          );
          return [] as CaptionVectorMatch[];
        })
      : Promise.resolve([] as CaptionVectorMatch[]);

  const [jinaMatches, captionMatches, metadataMatches] = await Promise.all([
    jinaMatchesPromise,
    route.weights.caption > 0
      ? searchCaptionVectors(env, captionVectorize, orgId, query, topK)
      : Promise.resolve([] as CaptionVectorMatch[]),
    route.weights.metadata > 0
      ? searchArtworksByMetadata(
          env.DB,
          orgId,
          metadataQuery,
          Math.min(Math.max(topK * 2, 10), MAX_SEARCH_RESULTS)
        ).catch((error) => {
          console.warn(
            'Metadata search failed during hybrid search; continuing with vector channels',
            error
          );
          return [] as ArtworkSearchResult[];
        })
      : Promise.resolve([] as ArtworkSearchResult[]),
  ]);

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
    source: Omit<
      SearchSourceContribution,
      'weight' | 'rank' | 'score' | 'model' | 'embeddingVersion'
    >
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
      scores.set(match.id, {
        score: (existing?.score || 0) + weight / (RRF_K + index + 1),
        vectorScore: existing?.vectorScore ?? match.score,
        searchSources: [
          ...(existing?.searchSources || []),
          compactObject({
            ...source,
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

  addRankedMatches(jinaMatches, route.weights.jinaImage, {
    channel: 'image_embedding',
    label: 'Image embedding',
    source: 'image_url',
  });
  addRankedMatches(captionMatches, route.weights.caption, {
    channel: 'generated_caption_embedding',
    label: 'Generated caption embedding',
    source: 'custom_metadata.generated_caption.text',
  });
  addRankedMatches(metadataMatches, route.weights.metadata, {
    channel: 'metadata',
    label: 'Catalogue metadata',
    source: 'artworks metadata fields',
  });

  const rankedCandidateIds = [...scores.entries()]
    .sort(([, a], [, b]) => b.score - a.score)
    .map(([id]) => id);
  const rankedIds = temporalFilter
    ? rankedCandidateIds
    : rankedCandidateIds.slice(0, topK);

  const artworkById = await getArtworksByIds(env.DB, rankedIds, orgId);
  const maxScore = Math.max(
    ...[...scores.values()].map((value) => value.score),
    0.001
  );

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

    return mapSearchRow(
      artwork,
      Math.min(fused.score / maxScore, 1),
      fused.searchSources
    );
  });

  return results.slice(0, topK);
}

async function searchArtworksByMetadata(
  db: D1Database,
  orgId: string | undefined,
  query: string,
  topK: number
): Promise<ArtworkSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedWordQuery = normalizeSearchWords(query);
  const temporalFilter = parseTemporalFilter(query);
  const likeQuery = `%${escapeLike(normalizedWordQuery || normalizedQuery)}%`;
  const tokens = searchQueryTokens(query).slice(0, 5);
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
  const whereSql = temporalFilter
    ? `AND (${temporalWhereSql} OR (${tokenWhereSql}))`
    : `AND (${tokenWhereSql})`;
  const params = [
    ...scoreParams,
    ...(orgId ? [orgId] : []),
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
      date_text,
      medium,
      classification,
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
      ${backableSearchSql(orgId)}
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
});

export const searchRoutes = new Hono<{ Bindings: Env }>();

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
    const orgId = await resolveOrgIdentifier(
      c.env.DB,
      c.req.param('orgId') || c.req.param('galleryId')
    );

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

    const { query, topK, minScore } = validation.data;

    const enrichedResults = await searchArtworksHybrid(
      c.env,
      orgId,
      query,
      topK
    );

    const queryTime = performance.now() - startTime;

    await annotateUsageEvent(c as any, {
      search: {
        mode: 'text',
        query,
        topK,
        minScore,
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
    const orgId = await resolveOrgIdentifier(
      c.env.DB,
      c.req.param('orgId') || c.req.param('galleryId')
    );

    // Parse multipart form data
    const formData = await c.req.formData();
    const imageFile = formData.get('image') as File | string | null;

    if (!imageFile || typeof imageFile === 'string') {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Image file is required',
          },
        },
        400
      );
    }

    // Validate image format
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(imageFile.type)) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: `Invalid image format. Allowed: ${allowedTypes.join(', ')}`,
          },
        },
        400
      );
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

    const vectorResults = await searchJinaImageVectors(
      imageVectorize,
      jinaConfig,
      orgId,
      imageBuffer,
      topK,
      minScore
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

    // Fetch artwork details from database
    const artworkIds = vectorResults.map((r) => r.id);
    const placeholders = artworkIds.map(() => '?').join(',');

    const { results: artworks } = await c.env.DB.prepare(
      `
      SELECT
        id,
        org_id,
        title,
        artist,
        year,
        date_text,
        medium,
        classification,
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
        ${backableSearchSql(orgId)}
      `
    )
      .bind(...artworkIds)
      .all<ArtworkSearchRow>();

    // Combine vector results with artwork details
    const enrichedResults: ArtworkSearchResult[] = vectorResults.flatMap(
      (vectorResult) => {
        const artwork = artworks.find((a) => a.id === vectorResult.id);
        if (!artwork) return [];

        return [
          {
            id: artwork.id,
            orgId: artwork.org_id,
            galleryId: artwork.org_id,
            title: artwork.title || undefined,
            artist: artwork.artist || undefined,
            year: artwork.year || undefined,
            imageUrl: artwork.image_url,
            thumbnailUrl: artwork.thumbnail_url,
            similarity: vectorResult.score,
            metadata: mapSearchRow(artwork, vectorResult.score).metadata,
          },
        ];
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
