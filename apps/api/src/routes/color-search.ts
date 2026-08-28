import { Hono } from 'hono';
import { Env } from '../index';
import {
  ColorSearchQuerySchema,
  ColorSimilarity,
  type ColorPaletteItem,
  type ColorSearchResult,
  type ColorSearchResultItem,
} from '@paillette/color-extraction';
import {
  annotateUsageEvent,
  enforceDailyQuota,
  getAuth,
  prepareApiUsageEvent,
  recordArtworkResults,
  requireAuthOrApiKey,
  requireOrgMutationAccess,
} from '../middleware/auth';
import type { ApiResponse } from '../types';
import { BACKABLE_NGS_PUBLIC_ARTWORK_SQL } from '../utils/ngs-public-filter';
import {
  isNgsPublicOrg,
  resolveOpenAccessProviderScope,
  resolveOrgIdentifier,
} from '../utils/orgs';
import {
  reserveNgaPublicSearchQuota,
  reserveNgaPublicSearchQuotaWithUsageEvent,
} from '../utils/nga-search-quota';
import type { PublicSearchQuota } from '@paillette/types';

export const colorSearchRoutes = new Hono<{ Bindings: Env }>();

const backableColorSearchSql = (orgId: string | undefined) =>
  isNgsPublicOrg(orgId) ? BACKABLE_NGS_PUBLIC_ARTWORK_SQL : '';

const providerColorSearchSql = (provider: string | undefined) =>
  provider
    ? "AND json_valid(custom_metadata) AND json_extract(custom_metadata, '$.provider') = ?"
    : '';

const setNgaSearchQuotaHeaders = (
  c: { header: (name: string, value: string) => void },
  quota: PublicSearchQuota
) => {
  c.header('X-NGA-Search-Limit', String(quota.limit));
  c.header('X-NGA-Search-Used', String(quota.used));
  c.header('X-NGA-Search-Remaining', String(quota.remaining));
};

const annotateAcceptedColorSearchUsage = async (
  c: any,
  metadata: Parameters<typeof annotateUsageEvent>[1]
) => {
  try {
    await annotateUsageEvent(c, metadata);
  } catch (error) {
    console.warn('Accepted color search usage annotation failed:', error);
  }
};

colorSearchRoutes.use(
  '/search/*',
  requireAuthOrApiKey as any,
  enforceDailyQuota({ queryType: 'color_search' }) as any
);

/**
 * POST /orgs/:orgId/search/color
 * Search artworks by color similarity
 */
colorSearchRoutes.post('/search/color', async (c) => {
  const startTime = performance.now();

  try {
    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    if (
      getAuth(c as any).scopes.includes('public_search') &&
      resolveOpenAccessProviderScope(requestedOrgId) !== 'nga'
    ) {
      return c.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PUBLIC_SEARCH_ENDPOINT_NOT_ALLOWED',
            message:
              'Public color search is available only for National Gallery of Art',
          },
        },
        403
      );
    }
    const provider = resolveOpenAccessProviderScope(requestedOrgId);
    const orgId = await resolveOrgIdentifier(c.env.DB, requestedOrgId);

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
    let ngaQuota: PublicSearchQuota | undefined;
    if (provider === 'nga') {
      try {
        const usageEvent = (c as any).get('usageEventId')
          ? undefined
          : prepareApiUsageEvent(c as any, {
              queryType: 'color_search',
              orgId: orgId || null,
              metadata: { search: { mode: 'color' } },
              onlyWhenPreviousStatementChanged: true,
            });
        const reservation = usageEvent
          ? await reserveNgaPublicSearchQuotaWithUsageEvent(
              c.env.DB,
              usageEvent
            )
          : await reserveNgaPublicSearchQuota(c.env.DB);
        setNgaSearchQuotaHeaders(c, reservation.quota);
        if (!reservation.admitted) {
          return c.json<ApiResponse>(
            {
              success: false,
              error: {
                code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
                message: 'NGA public search quota has been exhausted',
                details: { quota: reservation.quota },
              },
            },
            429
          );
        }
        ngaQuota = reservation.quota;
      } catch (error) {
        console.error('NGA public search quota reservation failed:', error);
        return c.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'NGA_PUBLIC_SEARCH_QUOTA_UNAVAILABLE',
              message: 'NGA public search quota is temporarily unavailable',
            },
          },
          503
        );
      }

    }

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
      WHERE org_id = ?
        AND dominant_colors IS NOT NULL
        AND image_url IS NOT NULL
        AND deleted_at IS NULL
        ${providerColorSearchSql(provider)}
        ${backableColorSearchSql(orgId)}
      `
    )
      .bind(orgId, ...(provider ? [provider] : []))
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

    await recordArtworkResults(
      c as any,
      limitedResults.map((result, index) => ({
        artworkId: result.artworkId,
        galleryId: orgId,
        rank: index + 1,
        score: 1 / (1 + result.averageDistance),
      }))
    );

    await annotateAcceptedColorSearchUsage(c as any, {
      search: {
        mode: 'color',
        cacheDisposition: 'BYPASS',
        ...(ngaQuota ? { quotaRemaining: ngaQuota.remaining } : {}),
      },
    });

    const response: ApiResponse<
      ColorSearchResult & { quota?: PublicSearchQuota }
    > = {
      success: true,
      data: {
        results: limitedResults,
        query,
        totalResults: limitedResults.length,
        took: performance.now() - startTime,
        ...(ngaQuota ? { quota: ngaQuota } : {}),
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
          details: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      },
      500
    );
  }
});

/**
 * GET /orgs/:orgId/artworks/:artworkId/colors
 * Get color palette for a specific artwork
 */
colorSearchRoutes.get('/artworks/:artworkId/colors', async (c) => {
  try {
    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    const provider = resolveOpenAccessProviderScope(requestedOrgId);
    const orgId = await resolveOrgIdentifier(c.env.DB, requestedOrgId);
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
        AND org_id = ?
        AND deleted_at IS NULL
        ${providerColorSearchSql(provider)}
        ${backableColorSearchSql(orgId)}
      `
    )
      .bind(artworkId, orgId, ...(provider ? [provider] : []))
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
 * POST /orgs/:orgId/artworks/:artworkId/extract-colors
 * Trigger color extraction for a specific artwork
 */
colorSearchRoutes.post(
  '/artworks/:artworkId/extract-colors',
  requireAuthOrApiKey as any,
  async (c) => {
  try {
    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    const provider = resolveOpenAccessProviderScope(requestedOrgId);
    const orgId = await resolveOrgIdentifier(c.env.DB, requestedOrgId);
    const artworkId = c.req.param('artworkId');

    const denied = await requireOrgMutationAccess(c as any, orgId);
    if (denied) return denied;

    // Verify artwork exists
    const artwork = await c.env.DB.prepare(
      `
      SELECT id, image_url
      FROM artworks
      WHERE id = ?
        AND org_id = ?
        AND image_url IS NOT NULL
        AND deleted_at IS NULL
        ${providerColorSearchSql(provider)}
      `
    )
      .bind(artworkId, orgId, ...(provider ? [provider] : []))
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
  }
);

/**
 * POST /orgs/:orgId/artworks/batch-extract-colors
 * Trigger batch color extraction for all artworks in an org
 */
colorSearchRoutes.post(
  '/artworks/batch-extract-colors',
  requireAuthOrApiKey as any,
  async (c) => {
  try {
    const requestedOrgId = c.req.param('orgId') || c.req.param('galleryId');
    const provider = resolveOpenAccessProviderScope(requestedOrgId);
    const orgId = await resolveOrgIdentifier(c.env.DB, requestedOrgId);

    const denied = await requireOrgMutationAccess(c as any, orgId);
    if (denied) return denied;

    // Get all artworks without color data
    const artworks = await c.env.DB.prepare(
      `
      SELECT id, image_url
      FROM artworks
      WHERE org_id = ?
        AND (dominant_colors IS NULL OR dominant_colors = '')
        AND image_url IS NOT NULL
        AND deleted_at IS NULL
        ${providerColorSearchSql(provider)}
      `
    )
      .bind(orgId, ...(provider ? [provider] : []))
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
  }
);
