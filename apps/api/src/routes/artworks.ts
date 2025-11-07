/**
 * Artwork API Routes
 * Handles artwork CRUD operations and image uploads
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { Env } from '../index';
import {
  UploadArtworkSchema,
  UpdateArtworkSchema,
  ArtworkQuerySchema,
  type ArtworkRow,
  type ArtworkResponse,
  type ArtworkListResponse,
  type ArtworkUploadResponse,
} from '../types/artwork';
import type { EmbeddingJob } from '../types/embedding';
import {
  uploadImage,
  uploadThumbnail,
  deleteImage,
} from '../utils/r2';
import {
  validateImage,
  extractImageMetadata,
  checkDuplicateImage,
  parseFilename,
} from '../utils/image';

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// Helper Functions
// ============================================================================

function mapArtworkRowToResponse(row: ArtworkRow): ArtworkResponse {
  return {
    id: row.id,
    gallery_id: row.gallery_id,
    collection_id: row.collection_id,
    image_url: row.image_url,
    thumbnail_url: row.thumbnail_url,
    original_filename: row.original_filename,
    title: row.title,
    artist: row.artist,
    year: row.year,
    medium: row.medium,
    dimensions: {
      height: row.dimensions_height,
      width: row.dimensions_width,
      depth: row.dimensions_depth,
      unit: row.dimensions_unit,
    },
    description: row.description,
    provenance: row.provenance,
    translations: row.translations ? JSON.parse(row.translations) : {},
    colors: {
      dominant: row.dominant_colors ? JSON.parse(row.dominant_colors) : null,
      palette: row.color_palette ? JSON.parse(row.color_palette) : null,
    },
    custom_metadata: row.custom_metadata ? JSON.parse(row.custom_metadata) : {},
    citation: row.citation ? JSON.parse(row.citation) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    uploaded_by: row.uploaded_by,
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/v1/artworks/upload
 * Upload a new artwork with image
 */
app.post('/upload', async (c) => {
  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MISSING_FILE',
            message: 'Image file is required',
          },
        },
        400
      );
    }

    // Parse metadata from form data
    const metadataJson = formData.get('metadata') as string | null;
    let metadata: any = {};

    if (metadataJson) {
      try {
        metadata = JSON.parse(metadataJson);
      } catch (e) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_METADATA',
              message: 'Metadata must be valid JSON',
            },
          },
          400
        );
      }
    }

    // Validate metadata schema
    const validationResult = UploadArtworkSchema.safeParse(metadata);
    if (!validationResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid metadata',
            details: validationResult.error.issues,
          },
        },
        400
      );
    }

    const uploadData = validationResult.data;

    // Validate image file
    const imageValidation = validateImage(file);
    if (!imageValidation.valid) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_IMAGE',
            message: imageValidation.error,
          },
        },
        400
      );
    }

    // Extract image metadata
    const imageMetadata = await extractImageMetadata(file);

    // Check for duplicate
    if (imageMetadata.hash) {
      const isDuplicate = await checkDuplicateImage(
        c.env.DB,
        imageMetadata.hash,
        uploadData.gallery_id
      );

      if (isDuplicate) {
        return c.json(
          {
            success: false,
            error: {
              code: 'DUPLICATE_IMAGE',
              message: 'This image has already been uploaded to this gallery',
            },
          },
          409
        );
      }
    }

    // Parse filename for metadata hints if not provided
    const filenameMetadata = parseFilename(file.name);

    // Upload image to R2
    const uploadResult = await uploadImage(c.env.IMAGES, file, {
      originalFilename: file.name,
      uploadedBy: 'system', // TODO: Get from auth context
      galleryId: uploadData.gallery_id,
      width: uploadData.image_width,
      height: uploadData.image_height,
      hash: imageMetadata.hash,
    });

    // TODO: Generate thumbnail
    // For now, use the same URL as thumbnail
    const thumbnailUrl = uploadResult.url;

    // Create artwork record
    const artworkId = randomUUID();
    const now = new Date().toISOString();

    const artwork: ArtworkRow = {
      id: artworkId,
      gallery_id: uploadData.gallery_id,
      collection_id: uploadData.collection_id || null,
      image_url: uploadResult.url,
      thumbnail_url: thumbnailUrl,
      original_filename: file.name,
      image_hash: imageMetadata.hash || '',
      embedding_id: null,
      title: uploadData.title || filenameMetadata.title || file.name,
      artist: uploadData.artist || filenameMetadata.artist || null,
      year: uploadData.year || filenameMetadata.year || null,
      medium: uploadData.medium || null,
      dimensions_height: uploadData.dimensions_height || null,
      dimensions_width: uploadData.dimensions_width || null,
      dimensions_depth: uploadData.dimensions_depth || null,
      dimensions_unit: uploadData.dimensions_unit || null,
      description: uploadData.description || null,
      provenance: uploadData.provenance || null,
      translations: JSON.stringify(uploadData.translations || {}),
      dominant_colors: null,
      color_palette: null,
      custom_metadata: JSON.stringify(uploadData.custom_metadata || {}),
      citation: uploadData.citation ? JSON.stringify(uploadData.citation) : null,
      created_at: now,
      updated_at: now,
      uploaded_by: 'system', // TODO: Get from auth context
    };

    // Insert into database
    await c.env.DB.prepare(
      `INSERT INTO artworks (
        id, gallery_id, collection_id, image_url, thumbnail_url,
        original_filename, image_hash, embedding_id,
        title, artist, year, medium,
        dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
        description, provenance, translations,
        dominant_colors, color_palette, custom_metadata, citation,
        created_at, updated_at, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        artwork.id,
        artwork.gallery_id,
        artwork.collection_id,
        artwork.image_url,
        artwork.thumbnail_url,
        artwork.original_filename,
        artwork.image_hash,
        artwork.embedding_id,
        artwork.title,
        artwork.artist,
        artwork.year,
        artwork.medium,
        artwork.dimensions_height,
        artwork.dimensions_width,
        artwork.dimensions_depth,
        artwork.dimensions_unit,
        artwork.description,
        artwork.provenance,
        artwork.translations,
        artwork.dominant_colors,
        artwork.color_palette,
        artwork.custom_metadata,
        artwork.citation,
        artwork.created_at,
        artwork.updated_at,
        artwork.uploaded_by
      )
      .run();

    // Queue for embedding generation
    const embeddingJob: EmbeddingJob = {
      artworkId: artwork.id,
      imageUrl: artwork.image_url,
      imageKey: uploadResult.key,
      metadata: {
        galleryId: artwork.gallery_id,
        title: artwork.title,
        artist: artwork.artist || undefined,
        year: artwork.year || undefined,
        medium: artwork.medium || undefined,
        description: artwork.description || undefined,
      },
    };

    await c.env.EMBEDDING_QUEUE.send(embeddingJob);
    console.log(`Queued embedding generation for artwork ${artwork.id}`);

    const response: ArtworkUploadResponse = {
      success: true,
      data: {
        artwork: mapArtworkRowToResponse(artwork),
        upload_info: {
          size: uploadResult.size,
          content_type: uploadResult.contentType,
          hash: imageMetadata.hash || '',
        },
      },
    };

    return c.json(response, 201);
  } catch (error) {
    console.error('Upload error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: error instanceof Error ? error.message : 'Failed to upload artwork',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/artworks
 * List artworks with filtering and pagination
 */
app.get('/', async (c) => {
  try {
    const query = c.req.query();
    const validatedQuery = ArtworkQuerySchema.parse({
      gallery_id: query.gallery_id,
      collection_id: query.collection_id,
      artist: query.artist,
      year: query.year ? parseInt(query.year) : undefined,
      year_min: query.year_min ? parseInt(query.year_min) : undefined,
      year_max: query.year_max ? parseInt(query.year_max) : undefined,
      medium: query.medium,
      search: query.search,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
    });

    // Build query
    let sql = 'SELECT * FROM artworks WHERE 1=1';
    const params: any[] = [];

    if (validatedQuery.gallery_id) {
      sql += ' AND gallery_id = ?';
      params.push(validatedQuery.gallery_id);
    }

    if (validatedQuery.collection_id) {
      sql += ' AND collection_id = ?';
      params.push(validatedQuery.collection_id);
    }

    if (validatedQuery.artist) {
      sql += ' AND artist LIKE ?';
      params.push(`%${validatedQuery.artist}%`);
    }

    if (validatedQuery.year) {
      sql += ' AND year = ?';
      params.push(validatedQuery.year);
    }

    if (validatedQuery.year_min) {
      sql += ' AND year >= ?';
      params.push(validatedQuery.year_min);
    }

    if (validatedQuery.year_max) {
      sql += ' AND year <= ?';
      params.push(validatedQuery.year_max);
    }

    if (validatedQuery.medium) {
      sql += ' AND medium LIKE ?';
      params.push(`%${validatedQuery.medium}%`);
    }

    if (validatedQuery.search) {
      sql += ' AND (title LIKE ? OR artist LIKE ? OR description LIKE ?)';
      const searchTerm = `%${validatedQuery.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    const countResult = await c.env.DB.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as count'))
      .bind(...params)
      .first<{ count: number }>();

    const total = countResult?.count || 0;

    // Add sorting and pagination
    sql += ` ORDER BY ${validatedQuery.sort_by} ${validatedQuery.sort_order}`;
    sql += ' LIMIT ? OFFSET ?';
    params.push(validatedQuery.limit, validatedQuery.offset);

    // Execute query
    const result = await c.env.DB.prepare(sql).bind(...params).all<ArtworkRow>();

    const artworks = result.results.map(mapArtworkRowToResponse);

    const response: ArtworkListResponse = {
      success: true,
      data: artworks,
      pagination: {
        total,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
        has_more: validatedQuery.offset + validatedQuery.limit < total,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('List error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to query artworks',
        },
      },
      500
    );
  }
});

/**
 * GET /api/v1/artworks/:id
 * Get artwork by ID
 */
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const artwork = await c.env.DB.prepare('SELECT * FROM artworks WHERE id = ?')
      .bind(id)
      .first<ArtworkRow>();

    if (!artwork) {
      return c.json(
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

    return c.json({
      success: true,
      data: mapArtworkRowToResponse(artwork),
    });
  } catch (error) {
    console.error('Get error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to get artwork',
        },
      },
      500
    );
  }
});

/**
 * PATCH /api/v1/artworks/:id
 * Update artwork metadata
 */
app.patch('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();

    // Validate update data
    const validationResult = UpdateArtworkSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid update data',
            details: validationResult.error.issues,
          },
        },
        400
      );
    }

    const updateData = validationResult.data;

    // Check if artwork exists
    const existing = await c.env.DB.prepare('SELECT * FROM artworks WHERE id = ?')
      .bind(id)
      .first<ArtworkRow>();

    if (!existing) {
      return c.json(
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

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];

    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined) {
        // Handle JSON fields
        if (['translations', 'custom_metadata', 'citation'].includes(key)) {
          updates.push(`${key} = ?`);
          params.push(JSON.stringify(value));
        } else {
          updates.push(`${key} = ?`);
          params.push(value);
        }
      }
    });

    if (updates.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NO_UPDATES',
            message: 'No valid fields to update',
          },
        },
        400
      );
    }

    params.push(id);

    await c.env.DB.prepare(
      `UPDATE artworks SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(...params)
      .run();

    // Fetch updated artwork
    const updated = await c.env.DB.prepare('SELECT * FROM artworks WHERE id = ?')
      .bind(id)
      .first<ArtworkRow>();

    return c.json({
      success: true,
      data: mapArtworkRowToResponse(updated!),
    });
  } catch (error) {
    console.error('Update error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update artwork',
        },
      },
      500
    );
  }
});

/**
 * DELETE /api/v1/artworks/:id
 * Delete artwork and its images
 */
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Get artwork to delete images
    const artwork = await c.env.DB.prepare('SELECT * FROM artworks WHERE id = ?')
      .bind(id)
      .first<ArtworkRow>();

    if (!artwork) {
      return c.json(
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

    // Extract R2 key from URL
    const imageKey = artwork.image_url.split('/').slice(-3).join('/');

    // Delete from R2
    await deleteImage(c.env.IMAGES, imageKey);

    // Delete from database
    await c.env.DB.prepare('DELETE FROM artworks WHERE id = ?').bind(id).run();

    return c.json({
      success: true,
      message: 'Artwork deleted successfully',
    });
  } catch (error) {
    console.error('Delete error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DELETE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to delete artwork',
        },
      },
      500
    );
  }
});

export default app;
