/**
 * Frame Removal Queue Consumer
 * Processes artwork images to detect and remove frames
 */

import { FrameDetector } from '@paillette/image-processing';
import { uploadImage } from '../utils/r2';
import type { Env } from '../types';

export interface FrameRemovalMessage {
  artworkId: string;
  imageUrl: string;
  galleryId: string;
}

/**
 * Queue consumer handler for frame removal jobs
 * Processes one artwork at a time
 */
export async function handleFrameRemoval(
  batch: MessageBatch<FrameRemovalMessage>,
  env: Env
): Promise<void> {
  const detector = new FrameDetector();

  for (const message of batch.messages) {
    const { artworkId, imageUrl, galleryId } = message.body;

    try {
      // Update status to processing
      await env.DB.prepare(
        `UPDATE artworks
         SET processing_status = 'processing'
         WHERE id = ?`
      )
        .bind(artworkId)
        .run();

      // Download image
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // Process frame removal
      const result = await detector.removeFrame(imageBuffer);

      if (!result.success || !result.processedImageBuffer) {
        // No frame detected or processing failed
        await env.DB.prepare(
          `UPDATE artworks
           SET processing_status = 'completed',
               frame_removal_confidence = ?,
               processed_at = datetime('now'),
               processing_error = ?
           WHERE id = ?`
        )
          .bind(
            result.detection.confidence,
            result.error || 'No frame detected',
            artworkId
          )
          .run();

        message.ack();
        continue;
      }

      // Upload processed image to R2
      const processedImageUrl = await uploadProcessedImage(
        env.BUCKET,
        result.processedImageBuffer,
        artworkId,
        galleryId
      );

      // Update database with processed image URL
      await env.DB.prepare(
        `UPDATE artworks
         SET image_url_processed = ?,
             processing_status = 'completed',
             frame_removal_confidence = ?,
             processed_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          processedImageUrl,
          result.detection.confidence,
          artworkId
        )
        .run();

      console.log(
        `Frame removal completed for artwork ${artworkId} with confidence ${result.detection.confidence}`
      );

      message.ack();
    } catch (error) {
      console.error(`Frame removal failed for artwork ${artworkId}:`, error);

      // Update status to failed
      await env.DB.prepare(
        `UPDATE artworks
         SET processing_status = 'failed',
             processing_error = ?,
             processed_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          error instanceof Error ? error.message : 'Unknown error',
          artworkId
        )
        .run();

      message.retry();
    }
  }
}

/**
 * Upload processed image to R2 storage
 */
async function uploadProcessedImage(
  bucket: R2Bucket,
  imageBuffer: Buffer,
  artworkId: string,
  galleryId: string
): Promise<string> {
  const key = `artworks/${galleryId}/${artworkId}_processed.jpg`;

  await bucket.put(key, imageBuffer, {
    httpMetadata: {
      contentType: 'image/jpeg',
    },
    customMetadata: {
      artworkId,
      galleryId,
      type: 'frame-removed',
      processedAt: new Date().toISOString(),
    },
  });

  // Return public URL
  return `https://images.paillette.art/${key}`;
}

/**
 * Enqueue artwork for frame removal processing
 */
export async function enqueueFrameRemoval(
  queue: Queue<FrameRemovalMessage>,
  artworkId: string,
  imageUrl: string,
  galleryId: string
): Promise<void> {
  await queue.send({
    artworkId,
    imageUrl,
    galleryId,
  });
}

/**
 * Batch enqueue multiple artworks for processing
 */
export async function batchEnqueueFrameRemoval(
  queue: Queue<FrameRemovalMessage>,
  artworks: Array<{ id: string; imageUrl: string; galleryId: string }>
): Promise<void> {
  const messages = artworks.map((artwork) => ({
    body: {
      artworkId: artwork.id,
      imageUrl: artwork.imageUrl,
      galleryId: artwork.galleryId,
    },
  }));

  // Queue supports batch sending (max 100 per batch)
  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    await queue.sendBatch(batch);
  }
}
