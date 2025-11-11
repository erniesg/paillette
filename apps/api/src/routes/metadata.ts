/**
 * Metadata API Routes
 * Handles CSV metadata upload and batch processing
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { Env } from '../index';
import { CSVParser, BatchMetadataProcessor } from '@paillette/metadata';
import type { BatchProcessResult } from '@paillette/metadata';

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/metadata/upload
 * Upload CSV file with artwork metadata for batch processing
 */
app.post('/upload', async (c) => {
  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get('csv') as File | null;
    const galleryId = formData.get('gallery_id') as string | null;

    if (!file) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_FILE',
            message: 'CSV file is required',
          },
        },
        400
      );
    }

    if (!galleryId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_GALLERY_ID',
            message: 'Gallery ID is required',
          },
        },
        400
      );
    }

    // Verify file is CSV
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'File must be a CSV file',
          },
        },
        400
      );
    }

    // Read CSV content
    const csvContent = await file.text();

    // Validate CSV structure quickly
    const structureValidation = CSVParser.validateStructure(csvContent);
    if (!structureValidation.valid) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_CSV_STRUCTURE',
            message: structureValidation.error,
          },
        },
        400
      );
    }

    // Parse and validate CSV
    const parseResult = await CSVParser.parse(csvContent);

    if (!parseResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CSV_VALIDATION_FAILED',
            message: 'CSV contains validation errors',
            details: parseResult.errors,
          },
        },
        400
      );
    }

    // Get user ID from auth context (mock for now)
    const userId = 'system'; // TODO: Get from auth middleware

    // Create upload job record
    const jobId = randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO upload_jobs (
        id, gallery_id, user_id, status, total_items,
        processed_items, failed_items, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        jobId,
        galleryId,
        userId,
        'processing',
        parseResult.rows.length,
        0,
        0,
        now,
        now
      )
      .run();

    // Process batch
    const processor = new BatchMetadataProcessor(c.env.DB);
    const batchResult = await processor.processBatch(
      parseResult.rows,
      galleryId,
      userId
    );

    // Update upload job with results
    await c.env.DB.prepare(
      `UPDATE upload_jobs
       SET status = ?, processed_items = ?, failed_items = ?,
           error_log = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        batchResult.failed.length > 0 ? 'completed' : 'completed',
        batchResult.stats.created + batchResult.stats.updated,
        batchResult.stats.failed,
        batchResult.failed.length > 0 ? JSON.stringify(batchResult.failed) : null,
        new Date().toISOString(),
        jobId
      )
      .run();

    return c.json(
      {
        success: true,
        data: {
          job_id: jobId,
          result: batchResult,
          stats: {
            ...batchResult.stats,
            file_name: file.name,
            file_size: file.size,
          },
        },
      },
      201
    );
  } catch (error) {
    console.error('Metadata upload error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: error instanceof Error ? error.message : 'Failed to process CSV',
        },
      },
      500
    );
  }
});

/**
 * POST /api/v1/metadata/validate
 * Validate CSV file without processing
 * Returns preview of first few rows and validation errors
 */
app.post('/validate', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('csv') as File | null;

    if (!file) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_FILE',
            message: 'CSV file is required',
          },
        },
        400
      );
    }

    // Read CSV content
    const csvContent = await file.text();

    // Validate structure
    const structureValidation = CSVParser.validateStructure(csvContent);
    if (!structureValidation.valid) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_CSV_STRUCTURE',
            message: structureValidation.error,
          },
        },
        400
      );
    }

    // Parse full CSV
    const parseResult = await CSVParser.parse(csvContent);

    // Get sample rows for preview
    const sampleRows = CSVParser.getSample(csvContent, 5);

    return c.json({
      success: true,
      data: {
        valid: parseResult.success,
        stats: parseResult.stats,
        errors: parseResult.errors,
        sample: sampleRows,
        file_info: {
          name: file.name,
          size: file.size,
          type: file.type,
        },
      },
    });
  } catch (error) {
    console.error('Validation error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: error instanceof Error ? error.message : 'Failed to validate CSV',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/metadata/jobs/:jobId
 * Get upload job status and results
 */
app.get('/jobs/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');

    const job = await c.env.DB.prepare(
      'SELECT * FROM upload_jobs WHERE id = ?'
    )
      .bind(jobId)
      .first();

    if (!job) {
      return c.json(
        {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Upload job not found',
          },
        },
        404
      );
    }

    return c.json({
      success: true,
      data: {
        id: job.id,
        gallery_id: job.gallery_id,
        status: job.status,
        total_items: job.total_items,
        processed_items: job.processed_items,
        failed_items: job.failed_items,
        error_log: job.error_log ? JSON.parse(job.error_log) : null,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
    });
  } catch (error) {
    console.error('Get job error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to get job',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/metadata/jobs
 * List upload jobs for a gallery
 */
app.get('/jobs', async (c) => {
  try {
    const galleryId = c.req.query('gallery_id');

    if (!galleryId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_GALLERY_ID',
            message: 'Gallery ID is required',
          },
        },
        400
      );
    }

    const result = await c.env.DB.prepare(
      'SELECT * FROM upload_jobs WHERE gallery_id = ? ORDER BY created_at DESC LIMIT 50'
    )
      .bind(galleryId)
      .all();

    const jobs = result.results.map((job: any) => ({
      id: job.id,
      gallery_id: job.gallery_id,
      status: job.status,
      total_items: job.total_items,
      processed_items: job.processed_items,
      failed_items: job.failed_items,
      created_at: job.created_at,
      updated_at: job.updated_at,
    }));

    return c.json({
      success: true,
      data: {
        jobs,
        total: jobs.length,
      },
    });
  } catch (error) {
    console.error('List jobs error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to list jobs',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/metadata/template
 * Download CSV template file
 */
app.get('/template', (c) => {
  const template = `artwork_id,title,artist,year,medium,dimensions_height,dimensions_width,dimensions_depth,dimensions_unit,description,provenance,image_filename
,Starry Night,Vincent van Gogh,1889,Oil on canvas,73.7,92.1,,cm,A famous painting depicting a swirling night sky,Museum of Modern Art,starry-night.jpg
,The Scream,Edvard Munch,1893,Oil tempera pastel and crayon on cardboard,91,73.5,,cm,Iconic expressionist painting,,the-scream.jpg`;

  return c.body(template, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="artwork-metadata-template.csv"',
  });
});

export default app;
