import { Hono } from 'hono';
import { z } from 'zod';
import { Env } from '../index';
import {
  enforceDailyQuota,
  recordArtworkResults,
  requireAuthOrApiKey,
} from '../middleware/auth';
import type {
  ApiResponse,
  SearchResponse,
  ArtworkSearchResult,
} from '../types';

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

const CAPTION_TEXT_MODEL = '@cf/baai/bge-large-en-v1.5';
const DEFAULT_JINA_MULTIMODAL_MODEL = 'jina-clip-v2';
const DEFAULT_JINA_TEXT_MODEL = 'jina-embeddings-v5-text-small';
const DEFAULT_JINA_DIMENSIONS = 1024;
const JINA_EMBEDDINGS_ENDPOINT = 'https://api.jina.ai/v1/embeddings';
const RRF_K = 60;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

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

const parseJsonObject = (value: string | null) => {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const compactObject = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
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
  similarity: number
): ArtworkSearchResult => {
  const customMetadata = parseJsonObject(artwork.custom_metadata) ?? {};
  const fieldSources = parseJsonObject(artwork.field_sources);
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
      ...customMetadata,
      medium: artwork.medium,
      dateText: artwork.date_text,
      date_text: artwork.date_text,
      classification: artwork.classification,
      culture: artwork.culture,
      origin: artwork.origin,
      dimensions,
      description: artwork.description,
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
      fieldSources,
      field_sources: fieldSources,
      dominantColors,
      dominant_colors: dominantColors,
      colorPalette,
      color_palette: colorPalette,
      citation,
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
      payload.detail || payload.code || `Jina embeddings request failed with ${response.status}`
    );
  }

  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw new Error('Jina query embedding was empty or had the wrong dimensions');
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
    topK: Math.min(Math.max(topK * 4, 20), 50),
    filter: orgId ? { galleryId: orgId } : undefined,
    returnMetadata: true,
  });

  return result.matches.map((match) => ({
    id: match.id,
    score: match.score,
    metadata: match.metadata as Record<string, unknown> | undefined,
  }));
}

async function searchCaptionVectors(
  env: Env,
  query: string,
  topK: number
): Promise<CaptionVectorMatch[]> {
  if (!env.CAPTION_VECTORIZE) {
    return [];
  }

  const queryEmbedding = await generateCaptionQueryEmbedding(env, query);
  const result = await env.CAPTION_VECTORIZE.query(queryEmbedding, {
    topK: Math.min(Math.max(topK * 4, 20), 50),
    returnMetadata: true,
  });

  return result.matches.map((match) => ({
    id: match.id,
    score: match.score,
    metadata: match.metadata as Record<string, unknown> | undefined,
  }));
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
    topK,
    filter: orgId ? { galleryId: orgId } : undefined,
    returnMetadata: true,
  });

  return result.matches
    .filter((match) => match.score >= minScore)
    .map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata as Record<string, unknown> | undefined,
    }));
}

async function getArtworksByIds(
  db: D1Database,
  ids: string[]
): Promise<Map<string, ArtworkSearchRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(
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
    `
  )
    .bind(...ids)
    .all<ArtworkSearchRow>();

  return new Map(results.map((artwork) => [artwork.id, artwork]));
}

async function searchArtworksHybrid(
  env: Env,
  orgId: string | undefined,
  query: string,
  topK: number
): Promise<ArtworkSearchResult[]> {
  const jinaConfig = getJinaConfig(env);
  const jinaMatchesPromise = searchJinaTextVectors(
    env.VECTORIZE,
    jinaConfig,
    orgId,
    query,
    topK
  ).catch((error) => {
    console.warn('Jina text query embedding failed; falling back to caption search', error);
    return [] as CaptionVectorMatch[];
  });

  const [jinaMatches, captionMatches, metadataMatches] = await Promise.all([
    jinaMatchesPromise,
    searchCaptionVectors(env, query, topK),
    searchArtworksByMetadata(env.DB, orgId, query, Math.min(Math.max(topK * 2, 10), 50)),
  ]);

  const scores = new Map<string, { score: number; vectorScore?: number }>();

  jinaMatches.forEach((match, index) => {
    scores.set(match.id, {
      score: (scores.get(match.id)?.score || 0) + 1 / (RRF_K + index + 1),
      vectorScore: match.score,
    });
  });

  captionMatches.forEach((match, index) => {
    const existing = scores.get(match.id);
    scores.set(match.id, {
      score: (existing?.score || 0) + 1 / (RRF_K + index + 1),
      vectorScore: existing?.vectorScore ?? match.score,
    });
  });

  metadataMatches.forEach((match, index) => {
    const existing = scores.get(match.id);
    scores.set(match.id, {
      score: (existing?.score || 0) + 1 / (RRF_K + index + 1),
      vectorScore: existing?.vectorScore,
    });
  });

  const rankedIds = [...scores.entries()]
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, topK)
    .map(([id]) => id);

  const artworkById = await getArtworksByIds(env.DB, rankedIds);
  const maxScore = Math.max(...[...scores.values()].map((value) => value.score), 0.001);

  return rankedIds.flatMap((id) => {
    const artwork = artworkById.get(id);
    const fused = scores.get(id);
    if (!artwork || !fused) return [];

    return mapSearchRow(artwork, Math.min(fused.score / maxScore, 1));
  });
}

async function searchArtworksByMetadata(
  db: D1Database,
  orgId: string | undefined,
  query: string,
  topK: number
): Promise<ArtworkSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const likeQuery = `%${escapeLike(normalizedQuery)}%`;
  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
  const phraseQuery =
    tokens.length === 1
      ? `% ${escapeLike(tokens[0] as string)} %`
      : `%${escapeLike(normalizedQuery)}%`;
  const tokenQueries = tokens.length
    ? tokens.map((token) => `% ${escapeLike(token)} %`)
    : [likeQuery];
  const titleText = normalizedTextSql('title');
  const artistText = normalizedTextSql('artist');
  const descriptionText = normalizedTextSql('description');
  const mediumText = normalizedTextSql('medium');
  const classificationText = normalizedTextSql('classification');
  const accessionText = normalizedTextSql('accession_number');
  const searchableExpression = `
    (${titleText} || ${artistText} || ${descriptionText} ||
     ${mediumText} || ${classificationText} || ${accessionText})
  `;
  const tokenScoreSql = tokenQueries
    .map(() => `CASE WHEN ${searchableExpression} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`)
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
    ...tokenQueries,
  ];

  const orgFilter = orgId ? 'AND org_id = ?' : '';
  const params = [
    ...scoreParams,
    ...(orgId ? [orgId] : []),
    ...tokenQueries,
    topK,
  ];

  const { results } = await db.prepare(
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
        ${tokenScoreSql}
      ) AS match_score
    FROM artworks
    WHERE deleted_at IS NULL
      ${orgFilter}
      AND (${tokenWhereSql})
    ORDER BY match_score DESC, title COLLATE NOCASE ASC
    LIMIT ?
    `
  )
    .bind(...params)
    .all<ArtworkMetadataSearchRow>();

  return results.map((artwork) =>
    mapSearchRow(artwork, Math.min(Math.max(artwork.match_score / 100, 0.01), 1))
  );
}

// Validation schemas
const textSearchSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(500),
  topK: z.number().int().positive().max(50).optional().default(10),
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
    const orgId = c.req.param('orgId') || c.req.param('galleryId');

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

    const { query, topK } = validation.data;

    const enrichedResults = await searchArtworksHybrid(
      c.env,
      orgId,
      query,
      topK
    );

    const queryTime = performance.now() - startTime;

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
    const orgId = c.req.param('orgId') || c.req.param('galleryId');

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
    const topK = Number(formData.get('topK') || '10');
    const minScore = Number(formData.get('minScore') || '0.7');

    // Convert image to ArrayBuffer
    const imageBuffer = await imageFile.arrayBuffer();

    const jinaConfig = getJinaConfig(c.env);
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

    const vectorResults = await searchJinaImageVectors(
      c.env.VECTORIZE,
      jinaConfig,
      orgId,
      imageBuffer,
      topK,
      minScore
    );

    // If no results found, return empty response
    if (vectorResults.length === 0) {
      const queryTime = performance.now() - startTime;
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
      `
    )
      .bind(...artworkIds)
      .all<ArtworkSearchRow>();

    // Combine vector results with artwork details
    const enrichedResults: ArtworkSearchResult[] = vectorResults.flatMap((vectorResult) => {
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
    });

    const queryTime = performance.now() - startTime;

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
