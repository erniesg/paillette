/**
 * Embedding Queue Consumer
 * Processes artwork uploads and generates embeddings asynchronously
 */

import type { Env } from '../index';
import type { EmbeddingJob, EmbeddingJobResult } from '../types/embedding';
import type { VectorMetadata } from '../types/embedding';
import {
  generateImageEmbedding,
  validateEmbedding,
  normalizeEmbedding,
} from '../utils/embedding';
import { insertArtworkEmbedding } from '../utils/vectorize';

/**
 * Queue consumer for embedding generation
 */
export default {
  async queue(
    batch: MessageBatch<EmbeddingJob>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} embedding jobs`);

    const results: EmbeddingJobResult[] = [];

    for (const message of batch.messages) {
      const job = message.body;
      const startTime = Date.now();

      try {
        console.log(`Processing embedding for artwork ${job.artworkId}`);

        // Check if REPLICATE_API_KEY is configured
        if (!env.REPLICATE_API_KEY) {
          throw new Error('REPLICATE_API_KEY not configured');
        }

        // Generate R2 public URL for the image
        // Note: You'll need to configure R2 custom domain or public access
        const imageUrl = job.imageUrl;

        // Generate image embedding using Replicate
        const embeddingResult = await generateImageEmbedding(imageUrl, {
          provider: 'replicate',
          apiKey: env.REPLICATE_API_KEY,
        });

        // Validate embedding
        if (!validateEmbedding(embeddingResult.embedding, embeddingResult.dimensions)) {
          throw new Error('Invalid embedding generated');
        }

        // Normalize embedding (optional but recommended for cosine similarity)
        const normalizedEmbedding = normalizeEmbedding(embeddingResult.embedding);

        // Prepare metadata for Vectorize
        const metadata: VectorMetadata = {
          artworkId: job.artworkId,
          galleryId: job.metadata.galleryId,
          title: job.metadata.title,
          artist: job.metadata.artist,
          year: job.metadata.year,
          medium: job.metadata.medium,
          imageUrl: job.imageUrl,
          thumbnailUrl: job.imageUrl.replace(/(\.[^.]+)$/, '_thumb$1'),
          createdAt: new Date().toISOString(),
        };

        // Insert into Vectorize
        await insertArtworkEmbedding(
          env.VECTORIZE,
          job.artworkId,
          normalizedEmbedding,
          metadata
        );

        // Update artwork record with embedding ID
        await env.DB.prepare(
          'UPDATE artworks SET embedding_id = ? WHERE id = ?'
        )
          .bind(job.artworkId, job.artworkId)
          .run();

        const processingTime = Date.now() - startTime;

        results.push({
          artworkId: job.artworkId,
          success: true,
          embedding: normalizedEmbedding,
          processingTime,
        });

        console.log(
          `Successfully processed embedding for ${job.artworkId} in ${processingTime}ms`
        );

        // Acknowledge message
        message.ack();
      } catch (error) {
        const processingTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        console.error(
          `Failed to process embedding for ${job.artworkId}:`,
          errorMessage
        );

        results.push({
          artworkId: job.artworkId,
          success: false,
          error: errorMessage,
          processingTime,
        });

        // Retry logic: retry message up to 3 times
        if (message.attempts < 3) {
          console.log(`Retrying message for ${job.artworkId} (attempt ${message.attempts + 1})`);
          message.retry();
        } else {
          console.error(`Max retries reached for ${job.artworkId}, discarding message`);

          // Log failure to audit log
          await env.DB.prepare(
            `INSERT INTO audit_logs (entity_type, entity_id, action, changes, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
          )
            .bind(
              'artwork',
              job.artworkId,
              'update',
              JSON.stringify({
                embedding_generation_failed: true,
                error: errorMessage,
                attempts: message.attempts,
              })
            )
            .run();

          message.ack(); // Acknowledge to remove from queue
        }
      }
    }

    // Log batch summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const avgTime = results.reduce((sum, r) => sum + (r.processingTime || 0), 0) / results.length;

    console.log(
      `Batch complete: ${successful} successful, ${failed} failed, avg time: ${avgTime.toFixed(0)}ms`
    );
  },
};

/**
 * Batch embedding queue consumer
 * Processes multiple artworks in a single job for efficiency
 */
export async function processBatchEmbedding(
  artworkIds: string[],
  env: Env
): Promise<EmbeddingJobResult[]> {
  const results: EmbeddingJobResult[] = [];

  // Fetch artwork details
  const artworks = await env.DB.prepare(
    `SELECT id, gallery_id, image_url, title, artist, year, medium, description
     FROM artworks
     WHERE id IN (${artworkIds.map(() => '?').join(', ')})`
  )
    .bind(...artworkIds)
    .all<{
      id: string;
      gallery_id: string;
      image_url: string;
      title: string;
      artist: string | null;
      year: number | null;
      medium: string | null;
      description: string | null;
    }>();

  for (const artwork of artworks.results) {
    const job: EmbeddingJob = {
      artworkId: artwork.id,
      imageUrl: artwork.image_url,
      imageKey: artwork.image_url.split('/').slice(-3).join('/'),
      metadata: {
        galleryId: artwork.gallery_id,
        title: artwork.title,
        artist: artwork.artist || undefined,
        year: artwork.year || undefined,
        medium: artwork.medium || undefined,
        description: artwork.description || undefined,
      },
    };

    // Queue for processing
    await env.EMBEDDING_QUEUE.send(job);
  }

  console.log(`Queued ${artworks.results.length} artworks for embedding generation`);

  return results;
}
