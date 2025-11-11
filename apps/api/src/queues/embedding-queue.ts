import { Env } from '../index';
import { EmbeddingService, VectorService, EmbeddingJobPayload } from '@paillette/ai';

/**
 * Queue consumer for processing embedding generation jobs
 * Triggered when artworks are uploaded
 */
export async function processEmbeddingJob(
  batch: MessageBatch<EmbeddingJobPayload>,
  env: Env
): Promise<void> {
  const embeddingService = new EmbeddingService({ ai: env.AI });
  const vectorService = new VectorService({ vectorize: env.VECTORIZE });

  for (const message of batch.messages) {
    const job = message.body;
    const startTime = performance.now();

    try {
      console.log(`Processing embedding job for artwork: ${job.artworkId}`);

      // Fetch the image from R2
      const imageObject = await env.IMAGES.get(job.imageKey || job.imageUrl);

      if (!imageObject) {
        throw new Error(`Image not found in R2: ${job.imageKey || job.imageUrl}`);
      }

      const imageBuffer = await imageObject.arrayBuffer();

      // Generate embedding
      const embeddingResult = await embeddingService.generateImageEmbedding(
        imageBuffer
      );

      // Store embedding in Vectorize
      await vectorService.upsertVector({
        id: job.artworkId,
        values: embeddingResult.embedding,
        metadata: {
          galleryId: job.galleryId,
          artworkId: job.artworkId,
          createdAt: new Date().toISOString(),
        },
      });

      // Update artwork record in database with embedding status
      await env.DB.prepare(
        `
        UPDATE artworks
        SET
          has_embedding = 1,
          embedding_generated_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `
      )
        .bind(new Date().toISOString(), job.artworkId)
        .run();

      const duration = performance.now() - startTime;
      console.log(
        `Successfully processed embedding for artwork ${job.artworkId} in ${duration.toFixed(2)}ms`
      );

      // Acknowledge the message
      message.ack();
    } catch (error) {
      console.error(
        `Failed to process embedding job for artwork ${job.artworkId}:`,
        error
      );

      // Retry logic: retry up to 3 times
      const retryCount = job.retryCount || 0;
      if (retryCount < 3) {
        console.log(`Retrying job (attempt ${retryCount + 1}/3)...`);

        // Re-queue with incremented retry count
        await env.EMBEDDING_QUEUE.send({
          ...job,
          retryCount: retryCount + 1,
        });

        message.ack();
      } else {
        console.error(
          `Max retries exceeded for artwork ${job.artworkId}, marking as failed`
        );

        // Update artwork record to indicate embedding failed
        await env.DB.prepare(
          `
          UPDATE artworks
          SET
            has_embedding = 0,
            embedding_error = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `
        )
          .bind(
            error instanceof Error ? error.message : 'Unknown error',
            job.artworkId
          )
          .run();

        // Acknowledge to remove from queue
        message.ack();
      }
    }
  }
}

/**
 * Enqueue an embedding job for an artwork
 */
export async function enqueueEmbeddingJob(
  env: Env,
  job: EmbeddingJobPayload
): Promise<void> {
  try {
    await env.EMBEDDING_QUEUE.send(job);
    console.log(`Enqueued embedding job for artwork: ${job.artworkId}`);
  } catch (error) {
    console.error('Failed to enqueue embedding job:', error);
    throw error;
  }
}
