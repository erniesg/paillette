import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env } from '../index';
import { EmbeddingService } from '@paillette/ai';
import { VectorService } from '@paillette/ai';
import type {
  ApiResponse,
  SearchResponse,
  ArtworkSearchResult,
} from '../types';

// Validation schemas
const textSearchSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(500),
  topK: z.number().int().positive().max(50).optional().default(10),
  minScore: z.number().min(0).max(1).optional().default(0.7),
});

const imageSearchSchema = z.object({
  topK: z.number().int().positive().max(50).optional().default(10),
  minScore: z.number().min(0).max(1).optional().default(0.7),
});

export const searchRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /search/text
 * Search artworks using natural language text query
 */
searchRoutes.post('/search/text', async (c) => {
  const startTime = performance.now();

  try {
    // Get gallery ID from params
    const galleryId = c.req.param('galleryId');

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

    // Initialize services
    const embeddingService = new EmbeddingService({ ai: c.env.AI });
    const vectorService = new VectorService({ vectorize: c.env.VECTORIZE });

    // Generate embedding for query text
    const queryEmbedding = await embeddingService.generateTextEmbedding(query);

    // Search for similar vectors
    const vectorResults = await vectorService.search(queryEmbedding.embedding, {
      topK,
      galleryId,
      minScore,
      includeMetadata: true,
    });

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
        gallery_id,
        title,
        artist,
        year,
        image_url,
        thumbnail_url,
        metadata
      FROM artworks
      WHERE id IN (${placeholders})
      `
    )
      .bind(...artworkIds)
      .all();

    // Combine vector results with artwork details
    const enrichedResults: ArtworkSearchResult[] = vectorResults
      .map((vectorResult) => {
        const artwork = artworks.find((a: any) => a.id === vectorResult.id);
        if (!artwork) return null;

        return {
          id: artwork.id,
          galleryId: artwork.gallery_id,
          title: artwork.title,
          artist: artwork.artist,
          year: artwork.year,
          imageUrl: artwork.image_url,
          thumbnailUrl: artwork.thumbnail_url,
          similarity: vectorResult.score,
          metadata: artwork.metadata
            ? JSON.parse(artwork.metadata as string)
            : undefined,
        };
      })
      .filter((r): r is ArtworkSearchResult => r !== null);

    const queryTime = performance.now() - startTime;

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
    // Get gallery ID from params
    const galleryId = c.req.param('galleryId');

    // Parse multipart form data
    const formData = await c.req.formData();
    const imageFile = formData.get('image');

    if (!imageFile || !(imageFile instanceof File)) {
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

    // Initialize services
    const embeddingService = new EmbeddingService({ ai: c.env.AI });
    const vectorService = new VectorService({ vectorize: c.env.VECTORIZE });

    // Generate embedding for query image
    const queryEmbedding =
      await embeddingService.generateImageEmbedding(imageBuffer);

    // Search for similar vectors
    const vectorResults = await vectorService.search(queryEmbedding.embedding, {
      topK,
      galleryId,
      minScore,
      includeMetadata: true,
    });

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
        gallery_id,
        title,
        artist,
        year,
        image_url,
        thumbnail_url,
        metadata
      FROM artworks
      WHERE id IN (${placeholders})
      `
    )
      .bind(...artworkIds)
      .all();

    // Combine vector results with artwork details
    const enrichedResults: ArtworkSearchResult[] = vectorResults
      .map((vectorResult) => {
        const artwork = artworks.find((a: any) => a.id === vectorResult.id);
        if (!artwork) return null;

        return {
          id: artwork.id,
          galleryId: artwork.gallery_id,
          title: artwork.title,
          artist: artwork.artist,
          year: artwork.year,
          imageUrl: artwork.image_url,
          thumbnailUrl: artwork.thumbnail_url,
          similarity: vectorResult.score,
          metadata: artwork.metadata
            ? JSON.parse(artwork.metadata as string)
            : undefined,
        };
      })
      .filter((r): r is ArtworkSearchResult => r !== null);

    const queryTime = performance.now() - startTime;

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
