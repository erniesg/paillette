import type { Env } from '../types';

/**
 * Translation queue job message
 */
export interface TranslationJobMessage {
  jobId: string;
  filename: string;
  fileType: string;
  sourceLang: 'en' | 'zh' | 'ms' | 'ta';
  targetLang: 'en' | 'zh' | 'ms' | 'ta';
  originalFileUrl: string;
}

/**
 * Translation queue consumer
 * Processes document translation jobs asynchronously
 */
export async function handleTranslationQueue(
  batch: MessageBatch<TranslationJobMessage>,
  env: Env
): Promise<void> {
  console.log(`Processing ${batch.messages.length} translation jobs`);

  for (const message of batch.messages) {
    try {
      await processTranslationJob(message.body, env);
      message.ack();
    } catch (error) {
      console.error(`Failed to process translation job ${message.body.jobId}:`, error);
      message.retry();
    }
  }
}

/**
 * Process a single translation job
 */
async function processTranslationJob(
  job: TranslationJobMessage,
  env: Env
): Promise<void> {
  console.log(`Processing translation job ${job.jobId}`);

  try {
    // Update status to processing
    await env.DB.prepare(
      `UPDATE translation_jobs
       SET status = 'processing', started_at = ?
       WHERE id = ?`
    )
      .bind(new Date().toISOString(), job.jobId)
      .run();

    // Get original file from R2
    const originalFile = await env.IMAGES.get(job.originalFileUrl);

    if (!originalFile) {
      throw new Error('Original file not found in storage');
    }

    const fileBuffer = await originalFile.arrayBuffer();

    // Extract text from document
    const { DocumentProcessor } = await import('@paillette/document-processor');
    const processor = new DocumentProcessor();

    let extractedText: string;
    let wordCount = 0;
    let chunks: string[] = [];

    try {
      const extracted = await processor.extract(fileBuffer, job.filename);
      extractedText = extracted.text;
      wordCount = extracted.metadata.wordCount || 0;
      chunks = extracted.chunks || [extractedText];
    } catch (error) {
      // If document processing fails, try simple text extraction
      console.warn('Document processing failed, falling back to text extraction:', error);
      extractedText = new TextDecoder('utf-8').decode(fileBuffer);
      wordCount = extractedText.split(/\s+/).length;
      chunks = [extractedText];
    }

    // Initialize translation service
    const { TranslationService } = await import('@paillette/translation');
    const translationService = new TranslationService({
      ai: env.AI,
      cache: env.CACHE,
      openaiApiKey: env.OPENAI_API_KEY,
      youdaoAppKey: env.YOUDAO_APP_KEY,
      youdaoAppSecret: env.YOUDAO_APP_SECRET,
      googleApiKey: env.GOOGLE_TRANSLATE_API_KEY,
    });

    // Translate text in chunks
    const translatedChunks: string[] = [];
    let totalCost = 0;
    let provider = '';

    for (const chunk of chunks) {
      const result = await translationService.translate(
        chunk,
        job.sourceLang,
        job.targetLang
      );
      translatedChunks.push(result.translatedText);
      totalCost += result.cost || 0;
      provider = result.provider;
    }

    const translatedText = translatedChunks.join('\n\n');

    // Create translated file
    const translatedBuffer = new TextEncoder().encode(translatedText);

    // Determine output filename
    const outputFilename = job.filename.replace(/\.[^.]+$/, '') + `_${job.targetLang}.txt`;
    const translatedKey = `translation-jobs/${job.jobId}/translated/${outputFilename}`;

    // Upload translated file to R2
    await env.IMAGES.put(translatedKey, translatedBuffer, {
      httpMetadata: {
        contentType: 'text/plain; charset=utf-8',
      },
    });

    // Update job record with success
    await env.DB.prepare(
      `UPDATE translation_jobs
       SET status = 'completed',
           translated_file_url = ?,
           word_count = ?,
           character_count = ?,
           chunk_count = ?,
           provider = ?,
           cost = ?,
           completed_at = ?
       WHERE id = ?`
    )
      .bind(
        translatedKey,
        wordCount,
        extractedText.length,
        chunks.length,
        provider,
        totalCost,
        new Date().toISOString(),
        job.jobId
      )
      .run();

    console.log(`Translation job ${job.jobId} completed successfully`);
  } catch (error) {
    console.error(`Translation job ${job.jobId} failed:`, error);

    // Get current retry count
    const jobRecord = await env.DB.prepare(
      'SELECT retry_count FROM translation_jobs WHERE id = ?'
    )
      .bind(job.jobId)
      .first<{ retry_count: number }>();

    const retryCount = (jobRecord?.retry_count || 0) + 1;
    const maxRetries = 3;

    if (retryCount >= maxRetries) {
      // Mark as failed after max retries
      await env.DB.prepare(
        `UPDATE translation_jobs
         SET status = 'failed',
             error_message = ?,
             retry_count = ?,
             completed_at = ?
         WHERE id = ?`
      )
        .bind(
          error instanceof Error ? error.message : 'Unknown error',
          retryCount,
          new Date().toISOString(),
          job.jobId
        )
        .run();
    } else {
      // Increment retry count and keep as queued
      await env.DB.prepare(
        `UPDATE translation_jobs
         SET status = 'queued',
             retry_count = ?,
             error_message = ?
         WHERE id = ?`
      )
        .bind(
          retryCount,
          error instanceof Error ? error.message : 'Unknown error',
          job.jobId
        )
        .run();

      // Re-queue the job
      throw error; // This will trigger message.retry()
    }
  }
}
