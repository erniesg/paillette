/**
 * Embeddings API Routes
 * Handles fetching artwork embeddings for visualization
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import type { ApiResponse } from '../types';
import { resolveOrgIdentifier } from '../utils/orgs';

// Validation schema
const embeddingsQuerySchema = z.object({
  limit: z.number().int().positive().max(1000).optional().default(500),
  offset: z.number().int().min(0).optional().default(0),
});

export interface ArtworkEmbedding {
  id: string;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  embedding: number[];
}

export interface EmbeddingsResponse {
  embeddings: ArtworkEmbedding[];
  total: number;
  dimensions: number;
}

const VECTORIZE_GET_BY_IDS_LIMIT = 20;

const getEmbeddingVectorize = (env: Env): Vectorize =>
  env.EMBEDDING_INDEX_VERSION?.trim().toLowerCase() === 'v2'
    ? env.VECTORIZE_V2 || env.VECTORIZE
    : env.VECTORIZE;

const getVectorsByIds = async (vectorize: Vectorize, ids: string[]) => {
  const vectors: Awaited<ReturnType<Vectorize['getByIds']>> = [];

  for (
    let offset = 0;
    offset < ids.length;
    offset += VECTORIZE_GET_BY_IDS_LIMIT
  ) {
    const chunk = ids.slice(offset, offset + VECTORIZE_GET_BY_IDS_LIMIT);
    vectors.push(...(await vectorize.getByIds(chunk)));
  }

  return vectors;
};

export const embeddingsRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /orgs/:orgId/embeddings
 * Fetch artwork embeddings for visualization
 */
embeddingsRoutes.get('/embeddings', async (c) => {
  const startTime = performance.now();

  try {
    const orgId = await resolveOrgIdentifier(
      c.env.DB,
      c.req.param('orgId') || c.req.param('galleryId')
    );
    const query = c.req.query();

    // Validate query parameters
    const validation = embeddingsQuerySchema.safeParse({
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });

    if (!validation.success) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid query parameters',
            details: validation.error.flatten(),
          },
        },
        400
      );
    }

    const { limit, offset } = validation.data;

    // First, verify org exists
    const orgCheck = await c.env.DB.prepare('SELECT id FROM orgs WHERE id = ?')
      .bind(orgId)
      .first();

    if (!orgCheck) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Org not found',
          },
        },
        404
      );
    }

    // Fetch artworks with embeddings from database
    const { results: artworks } = await c.env.DB.prepare(
      `
      SELECT
        id,
        title,
        artist,
        year,
        medium,
        image_url,
        thumbnail_url,
        embedding_id
      FROM artworks
      WHERE org_id = ? AND embedding_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `
    )
      .bind(orgId, limit, offset)
      .all<{
        id: string;
        title: string;
        artist: string | null;
        year: number | null;
        medium: string | null;
        image_url: string | null;
        thumbnail_url: string | null;
        embedding_id: string;
      }>();

    // If no artworks found, return empty response
    if (artworks.length === 0) {
      const queryTime = performance.now() - startTime;
      return c.json<ApiResponse<EmbeddingsResponse>>({
        success: true,
        data: {
          embeddings: [],
          total: 0,
          dimensions: 1024,
        },
        meta: {
          timestamp: new Date().toISOString(),
          duration: queryTime,
        },
      });
    }

    // Get total count of artworks with embeddings
    const totalRow = await c.env.DB.prepare(
      `
      SELECT COUNT(*) as count
      FROM artworks
      WHERE org_id = ? AND embedding_id IS NOT NULL
      `
    )
      .bind(orgId)
      .first<{ count: number }>();

    // Fetch embeddings from Vectorize. Cloudflare caps getByIds payloads at 20.
    const embeddingIds = artworks
      .map((a) => a.embedding_id)
      .filter((id): id is string => Boolean(id));
    const vectorResults = await getVectorsByIds(
      getEmbeddingVectorize(c.env),
      embeddingIds
    );

    // Create a map for quick lookup
    const embeddingsMap = new Map(
      vectorResults.map((v: any) => [v.id, v.values])
    );

    // Combine artwork metadata with embeddings
    const enrichedEmbeddings: ArtworkEmbedding[] = artworks
      .map((artwork) => {
        const embedding = embeddingsMap.get(artwork.embedding_id);
        if (!embedding) return null;

        return {
          id: artwork.id,
          title: artwork.title,
          artist: artwork.artist,
          year: artwork.year,
          medium: artwork.medium,
          imageUrl: artwork.image_url,
          thumbnailUrl: artwork.thumbnail_url,
          embedding: embedding,
        };
      })
      .filter((e): e is ArtworkEmbedding => e !== null);

    const queryTime = performance.now() - startTime;

    return c.json<ApiResponse<EmbeddingsResponse>>({
      success: true,
      data: {
        embeddings: enrichedEmbeddings,
        total: totalRow?.count || 0,
        dimensions: 1024, // Jina CLIP v2 dimensions
      },
      meta: {
        timestamp: new Date().toISOString(),
        duration: queryTime,
      },
    });
  } catch (error) {
    console.error('Embeddings fetch error:', error);
    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'EMBEDDINGS_FETCH_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to fetch embeddings',
        },
      },
      500
    );
  }
});
