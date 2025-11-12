import { Env } from '../index';
import { EmbeddingService, VectorService, EmbeddingJobPayload } from '@paillette/ai';
import { ColorExtractor } from '@paillette/color-extraction';

type QueueMessage = EmbeddingJobPayload & {
  type?: 'generate-embedding' | 'extract-colors';
};

/**
 * Queue consumer for processing embedding generation and color extraction jobs
 * Triggered when artworks are uploaded or color extraction is requested
 */
export async function processEmbeddingJob(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  const embeddingService = new EmbeddingService({ ai: env.AI });
  const vectorService = new VectorService({ vectorize: env.VECTORIZE });

  for (const message of batch.messages) {
    const job = message.body;
    const startTime = performance.now();

    try {
      // Determine job type (default to embedding generation for backwards compatibility)
      const jobType = job.type || 'generate-embedding';

      if (jobType === 'extract-colors') {
        // Process color extraction
        await processColorExtraction(job, env);
        message.ack();
        continue;
      }

      // Process embedding generation (default)
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
 * Process color extraction for an artwork
 */
async function processColorExtraction(
  job: QueueMessage,
  env: Env
): Promise<void> {
  const startTime = performance.now();

  try {
    console.log(`Processing color extraction for artwork: ${job.artworkId}`);

    // Fetch the image from R2 or use URL directly
    let imageUrl = job.imageUrl;

    // If we have an image key, construct the R2 URL
    if (job.imageKey) {
      const imageObject = await env.IMAGES.get(job.imageKey);
      if (!imageObject) {
        throw new Error(`Image not found in R2: ${job.imageKey}`);
      }
      // For node-vibrant, we need a URL or buffer
      // Since R2Object can be converted to buffer, let's use that
      const buffer = await imageObject.arrayBuffer();
      const result = await ColorExtractor.extractFromBuffer(Buffer.from(buffer), 5);

      // Store color data in database
      await env.DB.prepare(
        `
        UPDATE artworks
        SET
          dominant_colors = ?,
          color_palette = ?,
          color_extracted_at = ?,
          color_extraction_version = 'v1',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `
      )
        .bind(
          JSON.stringify(result.dominantColors),
          JSON.stringify(result.palette),
          result.extractedAt,
          job.artworkId
        )
        .run();

      const duration = performance.now() - startTime;
      console.log(
        `Successfully extracted colors for artwork ${job.artworkId} in ${duration.toFixed(2)}ms`
      );

      return;
    }

    // Otherwise, use the URL directly
    if (!imageUrl) {
      throw new Error('No image URL or key provided');
    }

    const result = await ColorExtractor.extract(imageUrl, 5);

    // Store color data in database
    await env.DB.prepare(
      `
      UPDATE artworks
      SET
        dominant_colors = ?,
        color_palette = ?,
        color_extracted_at = ?,
        color_extraction_version = 'v1',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    )
      .bind(
        JSON.stringify(result.dominantColors),
        JSON.stringify(result.palette),
        result.extractedAt,
        job.artworkId
      )
      .run();

    const duration = performance.now() - startTime;
    console.log(
      `Successfully extracted colors for artwork ${job.artworkId} in ${duration.toFixed(2)}ms`
    );
  } catch (error) {
    console.error(
      `Failed to extract colors for artwork ${job.artworkId}:`,
      error
    );

    // Retry logic
    const retryCount = job.retryCount || 0;
    if (retryCount < 3) {
      console.log(`Retrying color extraction (attempt ${retryCount + 1}/3)...`);
      await env.EMBEDDING_QUEUE.send({
        ...job,
        retryCount: retryCount + 1,
      });
    } else {
      console.error(
        `Max retries exceeded for color extraction of artwork ${job.artworkId}`
      );
    }

    throw error;
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

/**
 * Enqueue a color extraction job for an artwork
 */
export async function enqueueColorExtractionJob(
  env: Env,
  artworkId: string,
  imageUrl: string,
  imageKey?: string
): Promise<void> {
  try {
    await env.EMBEDDING_QUEUE.send({
      type: 'extract-colors',
      artworkId,
      imageUrl,
      imageKey,
      galleryId: '', // Not needed for color extraction
    });
    console.log(`Enqueued color extraction job for artwork: ${artworkId}`);
  } catch (error) {
    console.error('Failed to enqueue color extraction job:', error);
    throw error;
  }
}
