import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';

// Request schemas
const TranslateTextSchema = z.object({
  text: z.string().min(1).max(50000),
  sourceLang: z.enum(['en', 'zh', 'ms', 'ta']),
  targetLang: z.enum(['en', 'zh', 'ms', 'ta']),
});

const DocumentUploadSchema = z.object({
  filename: z.string(),
  sourceLang: z.enum(['en', 'zh', 'ms', 'ta']),
  targetLang: z.enum(['en', 'zh', 'ms', 'ta']),
});

const translation = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/translate/text
 * Translate plain text instantly
 */
translation.post('/text', zValidator('json', TranslateTextSchema), async (c) => {
  const { text, sourceLang, targetLang } = c.req.valid('json');
  const start = Date.now();

  try {
    // Import translation service dynamically
    const { TranslationService } = await import('@paillette/translation');

    // Initialize service
    const translationService = new TranslationService({
      ai: c.env.AI,
      cache: c.env.CACHE,
      cacheTTL: 2592000, // 30 days
      openaiApiKey: c.env.OPENAI_API_KEY,
      youdaoAppKey: c.env.YOUDAO_APP_KEY,
      youdaoAppSecret: c.env.YOUDAO_APP_SECRET,
      googleApiKey: c.env.GOOGLE_TRANSLATE_API_KEY,
    });

    // Translate
    const result = await translationService.translate(text, sourceLang, targetLang);

    return c.json({
      success: true,
      data: {
        translatedText: result.translatedText,
        provider: result.provider,
        cached: result.cached,
        cost: result.cost,
      },
      metadata: {
        took: Date.now() - start,
        characterCount: text.length,
      },
    });
  } catch (error) {
    console.error('Translation error:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'TRANSLATION_FAILED',
          message: error instanceof Error ? error.message : 'Translation failed',
        },
      },
      500
    );
  }
});

/**
 * POST /api/v1/translate/estimate
 * Estimate translation cost
 */
translation.post(
  '/estimate',
  zValidator(
    'json',
    z.object({
      text: z.string().min(1),
      targetLang: z.enum(['en', 'zh', 'ms', 'ta']),
    })
  ),
  async (c) => {
    const { text, targetLang } = c.req.valid('json');

    try {
      const { TranslationService } = await import('@paillette/translation');

      const translationService = new TranslationService({
        ai: c.env.AI,
        cache: c.env.CACHE,
        openaiApiKey: c.env.OPENAI_API_KEY,
        youdaoAppKey: c.env.YOUDAO_APP_KEY,
        youdaoAppSecret: c.env.YOUDAO_APP_SECRET,
        googleApiKey: c.env.GOOGLE_TRANSLATE_API_KEY,
      });

      const estimate = translationService.estimateCost(text, targetLang);

      return c.json({
        success: true,
        data: {
          provider: estimate.provider,
          estimatedCost: estimate.cost,
          characterCount: text.length,
          costPerCharacter: estimate.cost / text.length,
        },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ESTIMATE_FAILED',
            message: error instanceof Error ? error.message : 'Cost estimation failed',
          },
        },
        500
      );
    }
  }
);

/**
 * POST /api/v1/translate/document
 * Upload document for translation (queued processing)
 */
translation.post('/document', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'] as File;
    const sourceLang = body['sourceLang'] as string;
    const targetLang = body['targetLang'] as string;

    if (!file) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_FILE',
            message: 'No file uploaded',
          },
        },
        400
      );
    }

    // Validate file type
    const supportedTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!supportedTypes.includes(file.type)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_FILE_TYPE',
            message: 'Only TXT, PDF, and DOCX files are supported',
            details: { supportedTypes },
          },
        },
        400
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds maximum of ${maxSize / 1024 / 1024}MB`,
          },
        },
        400
      );
    }

    // Generate job ID
    const jobId = crypto.randomUUID();

    // Upload original file to R2
    const originalKey = `translation-jobs/${jobId}/original/${file.name}`;
    await c.env.IMAGES.put(originalKey, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Create job record in database
    await c.env.DB.prepare(
      `INSERT INTO translation_jobs
       (id, filename, file_type, source_lang, target_lang, status, original_file_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        jobId,
        file.name,
        file.type,
        sourceLang,
        targetLang,
        'queued',
        originalKey,
        new Date().toISOString()
      )
      .run();

    // Queue translation job
    if (c.env.TRANSLATION_QUEUE) {
      await c.env.TRANSLATION_QUEUE.send({
        jobId,
        filename: file.name,
        fileType: file.type,
        sourceLang,
        targetLang,
        originalFileUrl: originalKey,
      });
    }

    return c.json(
      {
        success: true,
        data: {
          jobId,
          status: 'queued',
          filename: file.name,
          estimatedTime: '30-60 seconds',
        },
      },
      202
    );
  } catch (error) {
    console.error('Document upload error:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: error instanceof Error ? error.message : 'Document upload failed',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/translate/document/:jobId
 * Check translation job status
 */
translation.get('/document/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    const result = await c.env.DB.prepare(
      `SELECT id, filename, file_type, source_lang, target_lang, status,
              translated_file_url, error_message, cost, created_at, completed_at
       FROM translation_jobs
       WHERE id = ?`
    )
      .bind(jobId)
      .first();

    if (!result) {
      return c.json(
        {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Translation job not found',
          },
        },
        404
      );
    }

    const response: any = {
      success: true,
      data: {
        jobId: result.id,
        filename: result.filename,
        status: result.status,
        sourceLang: result.source_lang,
        targetLang: result.target_lang,
        createdAt: result.created_at,
      },
    };

    if (result.status === 'completed' && result.translated_file_url) {
      response.data.downloadUrl = `/api/v1/translate/document/${jobId}/download`;
      response.data.completedAt = result.completed_at;
      response.data.cost = result.cost;
    }

    if (result.status === 'failed') {
      response.data.error = result.error_message;
    }

    return c.json(response);
  } catch (error) {
    console.error('Job status check error:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'STATUS_CHECK_FAILED',
          message: error instanceof Error ? error.message : 'Failed to check job status',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/translate/document/:jobId/download
 * Download translated document
 */
translation.get('/document/:jobId/download', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    const result = await c.env.DB.prepare(
      `SELECT filename, translated_file_url, status
       FROM translation_jobs
       WHERE id = ?`
    )
      .bind(jobId)
      .first();

    if (!result) {
      return c.json(
        {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Translation job not found',
          },
        },
        404
      );
    }

    if (result.status !== 'completed') {
      return c.json(
        {
          success: false,
          error: {
            code: 'TRANSLATION_NOT_READY',
            message: `Translation is ${result.status}`,
          },
        },
        400
      );
    }

    if (!result.translated_file_url) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Translated file not available',
          },
        },
        404
      );
    }

    // Get file from R2
    const object = await c.env.IMAGES.get(result.translated_file_url);

    if (!object) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Translated file not found in storage',
          },
        },
        404
      );
    }

    // Return file with appropriate headers
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'text/plain',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    console.error('Download error:', error);

    return c.json(
      {
        success: false,
        error: {
          code: 'DOWNLOAD_FAILED',
          message: error instanceof Error ? error.message : 'Failed to download file',
        },
      },
      500
    );
  }
});

export default translation;
