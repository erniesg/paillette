/**
 * Search API Routes
 * Handles similarity search, text search, and AI-powered artwork discovery
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import {
  SimilaritySearchSchema,
  TextSearchSchema,
  BatchEmbeddingSchema,
  type SimilaritySearchResponse,
  type TextSearchResponse,
} from '../types/embedding';
import {
  generateImageEmbedding,
  generateTextEmbeddingWorkersAI,
  validateEmbedding,
  normalizeEmbedding,
} from '../utils/embedding';
import {
  searchSimilarArtworks,
  searchArtworksByText,
  findSimilarToArtwork,
} from '../utils/vectorize';
import { processBatchEmbedding } from '../queues/embedding-consumer';

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// Similarity Search (Image-to-Image)
// ============================================================================

/**
 * POST /api/v1/search/similar
 * Find visually similar artworks by image
 */
app.post('/similar', async (c) => {
  try {
    const body = await c.req.json();

    // Validate request
    const validationResult = SimilaritySearchSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid search parameters',
            details: validationResult.error.issues,
          },
        },
        400
      );
    }

    const searchParams = validationResult.data;
    const startTime = Date.now();

    // Generate query embedding
    let queryEmbedding: number[];

    if (searchParams.imageUrl) {
      // Generate embedding for external image URL
      if (!c.env.REPLICATE_API_KEY) {
        return c.json(
          {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Image embedding service not configured',
            },
          },
          503
        );
      }

      const embeddingResult = await generateImageEmbedding(searchParams.imageUrl, {
        provider: 'replicate',
        apiKey: c.env.REPLICATE_API_KEY,
      });

      if (!validateEmbedding(embeddingResult.embedding, embeddingResult.dimensions)) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_EMBEDDING',
              message: 'Failed to generate valid embedding',
            },
          },
          500
        );
      }

      queryEmbedding = normalizeEmbedding(embeddingResult.embedding);
    } else if (searchParams.imageData) {
      // TODO: Handle base64 image data
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Base64 image search not yet implemented',
          },
        },
        501
      );
    } else {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_PARAMETER',
            message: 'Either imageUrl or imageData must be provided',
          },
        },
        400
      );
    }

    // Perform similarity search
    const results = await searchSimilarArtworks(c.env.VECTORIZE, queryEmbedding, {
      topK: searchParams.topK,
      minScore: searchParams.minScore,
      filter: searchParams.filter,
      returnMetadata: true,
    });

    const queryTime = Date.now() - startTime;

    // Map results to response format
    const response: SimilaritySearchResponse = {
      success: true,
      data: {
        results: results.map((result) => ({
          artwork_id: result.id,
          score: result.score,
          title: result.metadata.title,
          artist: result.metadata.artist,
          year: result.metadata.year,
          medium: result.metadata.medium,
          image_url: result.metadata.imageUrl,
          thumbnail_url: result.metadata.thumbnailUrl,
          created_at: result.metadata.createdAt,
        })),
        query_time_ms: queryTime,
        total_results: results.length,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('Similarity search error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'SEARCH_FAILED',
          message: error instanceof Error ? error.message : 'Search failed',
        },
      },
      500
    );
  }
});

// ============================================================================
// Similar to Artwork (Find Similar)
// ============================================================================

/**
 * GET /api/v1/search/similar/:artworkId
 * Find artworks similar to a specific artwork
 */
app.get('/similar/:artworkId', async (c) => {
  try {
    const artworkId = c.req.param('artworkId');
    const query = c.req.query();

    // Parse query parameters
    const topK = query.limit ? parseInt(query.limit) : 20;
    const minScore = query.min_score ? parseFloat(query.min_score) : 0;

    const startTime = Date.now();

    // Find similar artworks
    const results = await findSimilarToArtwork(
      c.env.VECTORIZE,
      artworkId,
      c.env.DB,
      {
        topK,
        minScore,
        returnMetadata: true,
      }
    );

    const queryTime = Date.now() - startTime;

    // Map results to response format
    const response: SimilaritySearchResponse = {
      success: true,
      data: {
        results: results.map((result) => ({
          artwork_id: result.id,
          score: result.score,
          title: result.metadata.title,
          artist: result.metadata.artist,
          year: result.metadata.year,
          medium: result.metadata.medium,
          image_url: result.metadata.imageUrl,
          thumbnail_url: result.metadata.thumbnailUrl,
          created_at: result.metadata.createdAt,
        })),
        query_time_ms: queryTime,
        total_results: results.length,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('Find similar error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'SEARCH_FAILED',
          message: error instanceof Error ? error.message : 'Search failed',
        },
      },
      500
    );
  }
});

// ============================================================================
// Text Search (Semantic Search)
// ============================================================================

/**
 * POST /api/v1/search/text
 * Search artworks by text description using semantic search
 */
app.post('/text', async (c) => {
  try {
    const body = await c.req.json();

    // Validate request
    const validationResult = TextSearchSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid search parameters',
            details: validationResult.error.issues,
          },
        },
        400
      );
    }

    const searchParams = validationResult.data;
    const startTime = Date.now();

    // Generate text embedding using Workers AI
    const embeddingResult = await generateTextEmbeddingWorkersAI(
      c.env.AI,
      searchParams.query
    );

    const queryEmbedding = normalizeEmbedding(embeddingResult.embedding);

    // Perform text-based similarity search
    const results = await searchArtworksByText(c.env.VECTORIZE, queryEmbedding, {
      topK: searchParams.topK,
      filter: searchParams.filter,
      returnMetadata: true,
    });

    const queryTime = Date.now() - startTime;

    // Fetch additional artwork details from database
    const artworkIds = results.map((r) => r.id);
    const artworks = await c.env.DB.prepare(
      `SELECT id, title, artist, year, medium, description, image_url, created_at
       FROM artworks
       WHERE id IN (${artworkIds.map(() => '?').join(', ')})`
    )
      .bind(...artworkIds)
      .all<{
        id: string;
        title: string;
        artist: string | null;
        year: number | null;
        medium: string | null;
        description: string | null;
        image_url: string;
        created_at: string;
      }>();

    // Create artwork map for quick lookup
    const artworkMap = new Map(artworks.results.map((a) => [a.id, a]));

    // Map results to response format with descriptions
    const response: TextSearchResponse = {
      success: true,
      data: {
        results: results
          .map((result) => {
            const artwork = artworkMap.get(result.id);
            if (!artwork) return null;

            return {
              artwork_id: result.id,
              score: result.score,
              title: artwork.title,
              artist: artwork.artist || undefined,
              year: artwork.year || undefined,
              medium: artwork.medium || undefined,
              description: artwork.description || undefined,
              image_url: artwork.image_url,
              thumbnail_url: artwork.image_url.replace(/(\.[^.]+)$/, '_thumb$1'),
              created_at: artwork.created_at,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null),
        query_time_ms: queryTime,
        total_results: results.length,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('Text search error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'SEARCH_FAILED',
          message: error instanceof Error ? error.message : 'Search failed',
        },
      },
      500
    );
  }
});

// ============================================================================
// Batch Embedding Generation
// ============================================================================

/**
 * POST /api/v1/search/batch-embed
 * Trigger batch embedding generation for artworks
 */
app.post('/batch-embed', async (c) => {
  try {
    const body = await c.req.json();

    // Validate request
    const validationResult = BatchEmbeddingSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid batch parameters',
            details: validationResult.error.issues,
          },
        },
        400
      );
    }

    const params = validationResult.data;

    // Queue artworks for embedding generation
    await processBatchEmbedding(params.artworkIds, c.env);

    return c.json({
      success: true,
      data: {
        queued: params.artworkIds.length,
        artwork_ids: params.artworkIds,
      },
    });
  } catch (error) {
    console.error('Batch embedding error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'BATCH_FAILED',
          message: error instanceof Error ? error.message : 'Batch processing failed',
        },
      },
      500
    );
  }
});

// ============================================================================
// Health Check
// ============================================================================

/**
 * GET /api/v1/search/health
 * Check search service health
 */
app.get('/health', async (c) => {
  try {
    // Check Vectorize connection
    const indexInfo = await c.env.VECTORIZE.describe();

    return c.json({
      success: true,
      data: {
        vectorize: {
          connected: true,
          dimensions: indexInfo.dimensions,
          count: indexInfo.vectorsCount || 0,
        },
        workers_ai: {
          connected: true,
        },
        replicate: {
          configured: !!c.env.REPLICATE_API_KEY,
        },
      },
    });
  } catch (error) {
    console.error('Health check error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: error instanceof Error ? error.message : 'Health check failed',
        },
      },
      500
    );
  }
});

export default app;
