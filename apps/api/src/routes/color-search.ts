import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Env } from '../index';
import {
  ColorSearchQuerySchema,
  ColorSimilarity,
  type ColorPaletteItem,
  type ColorSearchResult,
  type ColorSearchResultItem,
} from '@paillette/color-extraction';
import type { ApiResponse } from '../types';

export const colorSearchRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /galleries/:galleryId/search/color
 * Search artworks by color similarity
 */
colorSearchRoutes.post('/search/color', async (c) => {
  const startTime = performance.now();

  try {
    const galleryId = c.req.param('galleryId');

    // Parse and validate request body
    const body = await c.req.json();
    const validation = ColorSearchQuerySchema.safeParse(body);

    if (!validation.success) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid color search parameters',
            details: validation.error.flatten(),
          },
        },
        400
      );
    }

    const query = validation.data;

    // Query artworks with color data
    const artworks = await c.env.DB.prepare(
      `
      SELECT
        id,
        title,
        artist,
        image_url,
        dominant_colors,
        color_palette
      FROM artworks
      WHERE gallery_id = ?
        AND dominant_colors IS NOT NULL
        AND deleted_at IS NULL
      `
    )
      .bind(galleryId)
      .all();

    if (!artworks.success || !artworks.results) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to query artworks',
          },
        },
        500
      );
    }

    // Search for matching artworks
    const results: ColorSearchResultItem[] = [];

    for (const artwork of artworks.results) {
      try {
        // Parse color palette
        const dominantColors: ColorPaletteItem[] = JSON.parse(
          artwork.dominant_colors as string
        );

        // Find matching colors for this artwork
        const artworkMatches: ColorSearchResultItem['matchedColors'] = [];

        for (const searchColor of query.colors) {
          const matches = ColorSimilarity.findSimilarColors(
            searchColor,
            dominantColors,
            query.threshold
          );

          matches.forEach((match) => {
            artworkMatches.push({
              searchColor,
              artworkColor: match.color.color,
              distance: match.distance,
            });
          });
        }

        // Determine if this artwork matches based on matchMode
        const hasMatch =
          query.matchMode === 'any'
            ? artworkMatches.length > 0
            : query.colors.every((searchColor) =>
                artworkMatches.some((m) => m.searchColor === searchColor)
              );

        if (hasMatch) {
          // Calculate average distance for ranking
          const avgDistance =
            artworkMatches.length > 0
              ? artworkMatches.reduce((sum, m) => sum + m.distance, 0) /
                artworkMatches.length
              : Infinity;

          results.push({
            artworkId: artwork.id as string,
            title: artwork.title as string,
            imageUrl: artwork.image_url as string,
            matchedColors: artworkMatches,
            averageDistance: avgDistance,
            dominantColors,
          });
        }
      } catch (error) {
        // Skip artworks with invalid color data
        console.error(`Failed to process artwork ${artwork.id}:`, error);
      }
    }

    // Sort by average distance (best matches first)
    results.sort((a, b) => a.averageDistance - b.averageDistance);

    // Apply limit
    const limitedResults = results.slice(0, query.limit);

    const response: ApiResponse<ColorSearchResult> = {
      success: true,
      data: {
        results: limitedResults,
        query,
        totalResults: limitedResults.length,
        took: performance.now() - startTime,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('Color search error:', error);

    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to perform color search',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      500
    );
  }
});

/**
 * GET /galleries/:galleryId/artworks/:artworkId/colors
 * Get color palette for a specific artwork
 */
colorSearchRoutes.get('/artworks/:artworkId/colors', async (c) => {
  try {
    const galleryId = c.req.param('galleryId');
    const artworkId = c.req.param('artworkId');

    const artwork = await c.env.DB.prepare(
      `
      SELECT
        id,
        title,
        dominant_colors,
        color_palette,
        color_extracted_at
      FROM artworks
      WHERE id = ?
        AND gallery_id = ?
        AND deleted_at IS NULL
      `
    )
      .bind(artworkId, galleryId)
      .first();

    if (!artwork) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Artwork not found',
          },
        },
        404
      );
    }

    const dominantColors = artwork.dominant_colors
      ? JSON.parse(artwork.dominant_colors as string)
      : [];

    return c.json<ApiResponse>({
      success: true,
      data: {
        artworkId: artwork.id,
        title: artwork.title,
        dominantColors,
        extractedAt: artwork.color_extracted_at,
      },
    });
  } catch (error) {
    console.error('Get artwork colors error:', error);

    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get artwork colors',
        },
      },
      500
    );
  }
});

/**
 * POST /galleries/:galleryId/artworks/:artworkId/extract-colors
 * Trigger color extraction for a specific artwork
 */
colorSearchRoutes.post('/artworks/:artworkId/extract-colors', async (c) => {
  try {
    const galleryId = c.req.param('galleryId');
    const artworkId = c.req.param('artworkId');

    // Verify artwork exists
    const artwork = await c.env.DB.prepare(
      `
      SELECT id, image_url
      FROM artworks
      WHERE id = ?
        AND gallery_id = ?
        AND deleted_at IS NULL
      `
    )
      .bind(artworkId, galleryId)
      .first();

    if (!artwork) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Artwork not found',
          },
        },
        404
      );
    }

    // Queue color extraction job
    await c.env.EMBEDDING_QUEUE.send({
      type: 'extract-colors',
      artworkId,
      imageUrl: artwork.image_url,
    });

    return c.json<ApiResponse>({
      success: true,
      data: {
        artworkId,
        message: 'Color extraction queued',
      },
    });
  } catch (error) {
    console.error('Extract colors error:', error);

    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to queue color extraction',
        },
      },
      500
    );
  }
});

/**
 * POST /galleries/:galleryId/artworks/batch-extract-colors
 * Trigger batch color extraction for all artworks in a gallery
 */
colorSearchRoutes.post('/artworks/batch-extract-colors', async (c) => {
  try {
    const galleryId = c.req.param('galleryId');

    // Get all artworks without color data
    const artworks = await c.env.DB.prepare(
      `
      SELECT id, image_url
      FROM artworks
      WHERE gallery_id = ?
        AND (dominant_colors IS NULL OR dominant_colors = '')
        AND deleted_at IS NULL
      `
    )
      .bind(galleryId)
      .all();

    if (!artworks.success || !artworks.results) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to query artworks',
          },
        },
        500
      );
    }

    // Queue color extraction jobs
    let queued = 0;
    for (const artwork of artworks.results) {
      try {
        await c.env.EMBEDDING_QUEUE.send({
          type: 'extract-colors',
          artworkId: artwork.id,
          imageUrl: artwork.image_url,
        });
        queued++;
      } catch (error) {
        console.error(`Failed to queue ${artwork.id}:`, error);
      }
    }

    return c.json<ApiResponse>({
      success: true,
      data: {
        queued,
        total: artworks.results.length,
        message: `Queued ${queued} artworks for color extraction`,
      },
    });
  } catch (error) {
    console.error('Batch extract colors error:', error);

    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to queue batch color extraction',
        },
      },
      500
    );
  }
});
