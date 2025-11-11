/**
 * Embeddings API Routes
 * Handles fetching artwork embeddings for visualization
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import type { ApiResponse } from '../types';

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
  imageUrl: string;
  thumbnailUrl: string;
  embedding: number[];
}

export interface EmbeddingsResponse {
  embeddings: ArtworkEmbedding[];
  total: number;
  dimensions: number;
}

export const embeddingsRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /galleries/:galleryId/embeddings
 * Fetch artwork embeddings for visualization
 */
embeddingsRoutes.get('/embeddings', async (c) => {
  const startTime = performance.now();

  try {
    const galleryId = c.req.param('galleryId');
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

    // First, verify gallery exists
    const galleryCheck = await c.env.DB.prepare(
      'SELECT id FROM galleries WHERE id = ?'
    )
      .bind(galleryId)
      .first();

    if (!galleryCheck) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gallery not found',
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
      WHERE gallery_id = ? AND embedding_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `
    )
      .bind(galleryId, limit, offset)
      .all<{
        id: string;
        title: string;
        artist: string | null;
        year: number | null;
        medium: string | null;
        image_url: string;
        thumbnail_url: string;
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
    const { count: total } = await c.env.DB.prepare(
      `
      SELECT COUNT(*) as count
      FROM artworks
      WHERE gallery_id = ? AND embedding_id IS NOT NULL
      `
    )
      .bind(galleryId)
      .first<{ count: number }>();

    // Fetch embeddings from Vectorize
    const embeddingIds = artworks.map((a) => a.embedding_id);
    const vectorResults = await c.env.VECTORIZE.getByIds(embeddingIds);

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
        total: total || 0,
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
