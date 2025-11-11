/**
 * Frame Removal API Routes
 * Endpoints for triggering and managing frame removal processing
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  enqueueFrameRemoval,
  batchEnqueueFrameRemoval,
} from '../queues/frame-removal-queue';

const frameRemoval = new Hono<{ Bindings: Env }>();

// ============================================================================
// Validation Schemas
// ============================================================================

const ProcessFrameSchema = z.object({
  artworkId: z.string().uuid(),
});

const BatchProcessSchema = z.object({
  galleryId: z.string().uuid(),
  artworkIds: z.array(z.string().uuid()).optional(),
  forceReprocess: z.boolean().default(false),
});

const ProcessingStatusSchema = z.object({
  artworkId: z.string().uuid(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /artworks/:id/process-frame
 * Queue a single artwork for frame removal processing
 */
frameRemoval.post(
  '/artworks/:id/process-frame',
  zValidator('param', ProcessFrameSchema),
  async (c) => {
    const { artworkId } = c.req.param();
    const user = c.get('user'); // From auth middleware

    try {
      // Get artwork details
      const artwork = await c.env.DB.prepare(
        `SELECT id, image_url, gallery_id, processing_status
         FROM artworks
         WHERE id = ?`
      )
        .bind(artworkId)
        .first<{
          id: string;
          image_url: string;
          gallery_id: string;
          processing_status: string | null;
        }>();

      if (!artwork) {
        return c.json(
          {
            success: false,
            error: {
              code: 'ARTWORK_NOT_FOUND',
              message: 'Artwork not found',
            },
          },
          404
        );
      }

      // Check if already processing
      if (artwork.processing_status === 'processing') {
        return c.json(
          {
            success: false,
            error: {
              code: 'ALREADY_PROCESSING',
              message: 'Artwork is already being processed',
            },
          },
          409
        );
      }

      // Update status to pending
      await c.env.DB.prepare(
        `UPDATE artworks
         SET processing_status = 'pending'
         WHERE id = ?`
      )
        .bind(artworkId)
        .run();

      // Enqueue for processing
      await enqueueFrameRemoval(
        c.env.FRAME_REMOVAL_QUEUE,
        artwork.id,
        artwork.image_url,
        artwork.gallery_id
      );

      return c.json({
        success: true,
        data: {
          artworkId: artwork.id,
          status: 'queued',
          message: 'Artwork queued for frame removal processing',
        },
      });
    } catch (error) {
      console.error('Frame removal enqueue error:', error);
      return c.json(
        {
          success: false,
          error: {
            code: 'ENQUEUE_ERROR',
            message: 'Failed to queue artwork for processing',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        500
      );
    }
  }
);

/**
 * POST /galleries/:galleryId/artworks/batch-process-frames
 * Queue multiple artworks for frame removal processing
 */
frameRemoval.post(
  '/galleries/:galleryId/artworks/batch-process-frames',
  zValidator('json', BatchProcessSchema),
  async (c) => {
    const { galleryId } = c.req.param();
    const { artworkIds, forceReprocess } = await c.req.json();

    try {
      // Build query based on input
      let query = `
        SELECT id, image_url, gallery_id, processing_status
        FROM artworks
        WHERE gallery_id = ?
      `;

      const bindings: string[] = [galleryId];

      // Filter by specific artwork IDs if provided
      if (artworkIds && artworkIds.length > 0) {
        const placeholders = artworkIds.map(() => '?').join(',');
        query += ` AND id IN (${placeholders})`;
        bindings.push(...artworkIds);
      }

      // Skip already processed unless force reprocess
      if (!forceReprocess) {
        query += ` AND (processing_status IS NULL OR processing_status = 'failed')`;
      }

      const results = await c.env.DB.prepare(query)
        .bind(...bindings)
        .all<{
          id: string;
          image_url: string;
          gallery_id: string;
          processing_status: string | null;
        }>();

      if (!results.results || results.results.length === 0) {
        return c.json({
          success: true,
          data: {
            queuedCount: 0,
            message: 'No artworks to process',
          },
        });
      }

      // Update all to pending status
      const artworkIdsToProcess = results.results.map((a) => a.id);
      const updatePlaceholders = artworkIdsToProcess.map(() => '?').join(',');

      await c.env.DB.prepare(
        `UPDATE artworks
         SET processing_status = 'pending'
         WHERE id IN (${updatePlaceholders})`
      )
        .bind(...artworkIdsToProcess)
        .run();

      // Batch enqueue
      await batchEnqueueFrameRemoval(
        c.env.FRAME_REMOVAL_QUEUE,
        results.results.map((a) => ({
          id: a.id,
          imageUrl: a.image_url,
          galleryId: a.gallery_id,
        }))
      );

      return c.json({
        success: true,
        data: {
          queuedCount: results.results.length,
          message: `${results.results.length} artworks queued for frame removal`,
        },
      });
    } catch (error) {
      console.error('Batch frame removal enqueue error:', error);
      return c.json(
        {
          success: false,
          error: {
            code: 'BATCH_ENQUEUE_ERROR',
            message: 'Failed to queue artworks for processing',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        500
      );
    }
  }
);

/**
 * GET /artworks/:id/processing-status
 * Get processing status for an artwork
 */
frameRemoval.get('/artworks/:id/processing-status', async (c) => {
  const { id: artworkId } = c.req.param();

  try {
    const artwork = await c.env.DB.prepare(
      `SELECT
         processing_status,
         frame_removal_confidence,
         image_url_processed,
         processed_at,
         processing_error
       FROM artworks
       WHERE id = ?`
    )
      .bind(artworkId)
      .first<{
        processing_status: string | null;
        frame_removal_confidence: number | null;
        image_url_processed: string | null;
        processed_at: string | null;
        processing_error: string | null;
      }>();

    if (!artwork) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ARTWORK_NOT_FOUND',
            message: 'Artwork not found',
          },
        },
        404
      );
    }

    return c.json({
      success: true,
      data: {
        status: artwork.processing_status || 'not_queued',
        confidence: artwork.frame_removal_confidence,
        processedImageUrl: artwork.image_url_processed,
        processedAt: artwork.processed_at,
        error: artwork.processing_error,
      },
    });
  } catch (error) {
    console.error('Get processing status error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'STATUS_ERROR',
          message: 'Failed to get processing status',
        },
      },
      500
    );
  }
});

/**
 * GET /galleries/:galleryId/processing-stats
 * Get aggregate processing statistics for a gallery
 */
frameRemoval.get('/galleries/:galleryId/processing-stats', async (c) => {
  const { galleryId } = c.req.param();

  try {
    const stats = await c.env.DB.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN processing_status = 'pending' THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN processing_status = 'processing' THEN 1 ELSE 0 END) as processing,
         SUM(CASE WHEN processing_status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN image_url_processed IS NOT NULL THEN 1 ELSE 0 END) as has_processed_image,
         AVG(CASE WHEN frame_removal_confidence IS NOT NULL THEN frame_removal_confidence ELSE NULL END) as avg_confidence
       FROM artworks
       WHERE gallery_id = ?`
    )
      .bind(galleryId)
      .first<{
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
        has_processed_image: number;
        avg_confidence: number | null;
      }>();

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get processing stats error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'STATS_ERROR',
          message: 'Failed to get processing statistics',
        },
      },
      500
    );
  }
});

export default frameRemoval;
