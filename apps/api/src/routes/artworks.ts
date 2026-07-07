/**
 * Artwork API Routes
 * Handles artwork CRUD operations and image uploads
 */

import { Hono, type Context } from 'hono';
import { randomUUID } from 'crypto';
import { z } from 'zod';
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
import { getAuth, requireAuthOrApiKey } from '../middleware/auth';
import { uploadImage, deleteImage } from '../utils/r2';
import {
  validateImage,
  extractImageMetadata,
  checkDuplicateImage,
  parseFilename,
} from '../utils/image';
import { PUBLIC_ARTWORK_SQL } from '../utils/ngs-public-filter';
import { resolveOrgIdentifier } from '../utils/orgs';

const app = new Hono<{ Bindings: Env }>();

const JsonObjectSchema = z.record(z.any());

const NullableStringSchema = z.string().max(5000).nullable();

const UpsertArtworkSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  collection_id: z.string().min(1).max(160).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  original_filename: z.string().max(500).nullable().optional(),
  image_hash: z.string().max(256).nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  artist: z.string().max(255).nullable().optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  date_text: z.string().max(255).nullable().optional(),
  medium: z.string().max(255).nullable().optional(),
  classification: z.string().max(255).nullable().optional(),
  culture: z.string().max(255).nullable().optional(),
  origin: z.string().max(255).nullable().optional(),
  dimensions_height: z.number().positive().nullable().optional(),
  dimensions_width: z.number().positive().nullable().optional(),
  dimensions_depth: z.number().positive().nullable().optional(),
  dimensions_unit: z.enum(['cm', 'in', 'm']).nullable().optional(),
  description: NullableStringSchema.optional(),
  provenance: NullableStringSchema.optional(),
  credit_line: NullableStringSchema.optional(),
  rights: NullableStringSchema.optional(),
  accession_number: z.string().max(255).nullable().optional(),
  source_url: z.string().url().nullable().optional(),
  source_institution: z.string().max(255).nullable().optional(),
  source_collection: z.string().max(255).nullable().optional(),
  source_record_id: z.string().max(255).nullable().optional(),
  field_sources: JsonObjectSchema.optional(),
  translations: JsonObjectSchema.optional(),
  dominant_colors: z.any().optional(),
  color_palette: z.any().optional(),
  custom_metadata: JsonObjectSchema.optional(),
  citation: z.any().optional(),
});

type UpsertArtworkInput = z.infer<typeof UpsertArtworkSchema>;

const JSON_FIELDS = new Set([
  'field_sources',
  'translations',
  'dominant_colors',
  'color_palette',
  'custom_metadata',
  'citation',
]);

const UPSERT_MUTABLE_FIELDS = [
  'collection_id',
  'image_url',
  'thumbnail_url',
  'original_filename',
  'image_hash',
  'title',
  'artist',
  'year',
  'date_text',
  'medium',
  'classification',
  'culture',
  'origin',
  'dimensions_height',
  'dimensions_width',
  'dimensions_depth',
  'dimensions_unit',
  'description',
  'provenance',
  'credit_line',
  'rights',
  'accession_number',
  'source_url',
  'source_institution',
  'source_collection',
  'source_record_id',
  'field_sources',
  'translations',
  'dominant_colors',
  'color_palette',
  'custom_metadata',
  'citation',
] as const;

const toDbValue = (key: string, value: unknown) =>
  JSON_FIELDS.has(key) && value !== null && value !== undefined
    ? JSON.stringify(value)
    : value;

const getRouteOrgId = async (c: Context<{ Bindings: Env }>) =>
  resolveOrgIdentifier(
    c.env.DB,
    c.req.param('orgId') || c.req.param('galleryId')
  );

const getScopedArtwork = async (
  db: D1Database,
  id: string,
  orgId: string | undefined
) =>
  db
    .prepare(
      'SELECT * FROM artworks WHERE id = ? AND org_id = ? AND deleted_at IS NULL'
    )
    .bind(id, orgId)
    .first<ArtworkRow>();

const findArtworkForUpsert = async (
  db: D1Database,
  orgId: string | undefined,
  input: UpsertArtworkInput
) => {
  if (input.id) {
    const byId = await getScopedArtwork(db, input.id, orgId);
    if (byId) return byId;
  }

  if (input.source_record_id) {
    return db
      .prepare(
        `SELECT * FROM artworks
         WHERE org_id = ?
           AND source_record_id = ?
           AND (? IS NULL OR source_institution = ?)
           AND deleted_at IS NULL
         LIMIT 1`
      )
      .bind(
        orgId,
        input.source_record_id,
        input.source_institution ?? null,
        input.source_institution ?? null
      )
      .first<ArtworkRow>();
  }

  if (input.accession_number) {
    return db
      .prepare(
        `SELECT * FROM artworks
         WHERE org_id = ?
           AND accession_number = ?
           AND deleted_at IS NULL
         LIMIT 1`
      )
      .bind(orgId, input.accession_number)
      .first<ArtworkRow>();
  }

  return null;
};

const updateArtworkRecord = async (
  db: D1Database,
  existing: ArtworkRow,
  input: UpsertArtworkInput
) => {
  const updates: string[] = [];
  const params: unknown[] = [];

  for (const key of UPSERT_MUTABLE_FIELDS) {
    if (input[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(toDbValue(key, input[key]));
    }
  }

  if (updates.length === 0) {
    return existing;
  }

  params.push(existing.id, existing.org_id);
  await db
    .prepare(
      `UPDATE artworks
       SET ${updates.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`
    )
    .bind(...params)
    .run();

  return getScopedArtwork(db, existing.id, existing.org_id);
};

const createArtworkRecord = async (
  db: D1Database,
  orgId: string,
  input: UpsertArtworkInput,
  uploadedBy: string
) => {
  const artworkId = input.id || randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO artworks (
        id, org_id, collection_id, image_url, thumbnail_url,
        original_filename, image_hash,
        image_url_processed, processing_status, frame_removal_confidence, processed_at, processing_error,
        embedding_id,
        title, artist, year, date_text, medium, classification, culture, origin,
        dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
        description, provenance, credit_line, rights, accession_number,
        source_url, source_institution, source_collection, source_record_id,
        field_sources, translations,
        dominant_colors, color_palette, color_extracted_at, color_extraction_version,
        custom_metadata, citation,
        created_at, updated_at, uploaded_by, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      artworkId,
      orgId,
      input.collection_id ?? null,
      input.image_url ?? null,
      input.thumbnail_url ?? null,
      input.original_filename ?? null,
      input.image_hash ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      input.title!,
      input.artist ?? null,
      input.year ?? null,
      input.date_text ?? null,
      input.medium ?? null,
      input.classification ?? null,
      input.culture ?? null,
      input.origin ?? null,
      input.dimensions_height ?? null,
      input.dimensions_width ?? null,
      input.dimensions_depth ?? null,
      input.dimensions_unit ?? null,
      input.description ?? null,
      input.provenance ?? null,
      input.credit_line ?? null,
      input.rights ?? null,
      input.accession_number ?? null,
      input.source_url ?? null,
      input.source_institution ?? null,
      input.source_collection ?? null,
      input.source_record_id ?? null,
      JSON.stringify(input.field_sources ?? {}),
      JSON.stringify(input.translations ?? {}),
      input.dominant_colors !== undefined
        ? JSON.stringify(input.dominant_colors)
        : null,
      input.color_palette !== undefined
        ? JSON.stringify(input.color_palette)
        : null,
      null,
      'v1',
      JSON.stringify(input.custom_metadata ?? {}),
      input.citation !== undefined ? JSON.stringify(input.citation) : null,
      now,
      now,
      uploadedBy,
      null
    )
    .run();

  return getScopedArtwork(db, artworkId, orgId);
};

// ============================================================================
// Helper Functions
// ============================================================================

function mapArtworkRowToResponse(row: ArtworkRow): ArtworkResponse {
  return {
    id: row.id,
    org_id: row.org_id,
    gallery_id: row.org_id,
    collection_id: row.collection_id,
    image_url: row.image_url,
    thumbnail_url: row.thumbnail_url,
    original_filename: row.original_filename,
    title: row.title,
    artist: row.artist,
    year: row.year,
    date_text: row.date_text,
    medium: row.medium,
    classification: row.classification,
    culture: row.culture,
    origin: row.origin,
    dimensions: {
      height: row.dimensions_height,
      width: row.dimensions_width,
      depth: row.dimensions_depth,
      unit: row.dimensions_unit,
    },
    description: row.description,
    provenance: row.provenance,
    credit_line: row.credit_line,
    rights: row.rights,
    accession_number: row.accession_number,
    source_url: row.source_url,
    source_institution: row.source_institution,
    source_collection: row.source_collection,
    source_record_id: row.source_record_id,
    field_sources: row.field_sources ? JSON.parse(row.field_sources) : {},
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
app.post('/upload', requireAuthOrApiKey as any, async (c) => {
  try {
    const auth = getAuth(c as any);
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
    const orgId = uploadData.org_id || uploadData.gallery_id!;

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
        orgId
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
      uploadedBy: auth.userId,
      galleryId: orgId,
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
      org_id: orgId,
      collection_id: uploadData.collection_id || null,
      image_url: uploadResult.url,
      thumbnail_url: thumbnailUrl,
      original_filename: file.name,
      image_hash: imageMetadata.hash || '',
      image_url_processed: null,
      processing_status: null,
      frame_removal_confidence: null,
      processed_at: null,
      processing_error: null,
      embedding_id: null,
      title: uploadData.title || filenameMetadata.title || file.name,
      artist: uploadData.artist || filenameMetadata.artist || null,
      year: uploadData.year || filenameMetadata.year || null,
      date_text: uploadData.date_text || null,
      medium: uploadData.medium || null,
      classification: uploadData.classification || null,
      culture: uploadData.culture || null,
      origin: uploadData.origin || null,
      dimensions_height: uploadData.dimensions_height || null,
      dimensions_width: uploadData.dimensions_width || null,
      dimensions_depth: uploadData.dimensions_depth || null,
      dimensions_unit: uploadData.dimensions_unit || null,
      description: uploadData.description || null,
      provenance: uploadData.provenance || null,
      credit_line: uploadData.credit_line || null,
      rights: uploadData.rights || null,
      accession_number: uploadData.accession_number || null,
      source_url: uploadData.source_url || null,
      source_institution: uploadData.source_institution || null,
      source_collection: uploadData.source_collection || null,
      source_record_id: uploadData.source_record_id || null,
      field_sources: JSON.stringify(uploadData.field_sources || {}),
      translations: JSON.stringify(uploadData.translations || {}),
      dominant_colors: null,
      color_palette: null,
      color_extracted_at: null,
      color_extraction_version: 'v1',
      custom_metadata: JSON.stringify(uploadData.custom_metadata || {}),
      citation: uploadData.citation
        ? JSON.stringify(uploadData.citation)
        : null,
      created_at: now,
      updated_at: now,
      uploaded_by: auth.userId,
      deleted_at: null,
    };

    // Insert into database
    await c.env.DB.prepare(
      `INSERT INTO artworks (
        id, org_id, collection_id, image_url, thumbnail_url,
        original_filename, image_hash,
        image_url_processed, processing_status, frame_removal_confidence, processed_at, processing_error,
        embedding_id,
        title, artist, year, date_text, medium, classification, culture, origin,
        dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
        description, provenance, credit_line, rights, accession_number,
        source_url, source_institution, source_collection, source_record_id,
        field_sources, translations,
        dominant_colors, color_palette, color_extracted_at, color_extraction_version,
        custom_metadata, citation,
        created_at, updated_at, uploaded_by, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        artwork.id,
        artwork.org_id,
        artwork.collection_id,
        artwork.image_url,
        artwork.thumbnail_url,
        artwork.original_filename,
        artwork.image_hash,
        artwork.image_url_processed,
        artwork.processing_status,
        artwork.frame_removal_confidence,
        artwork.processed_at,
        artwork.processing_error,
        artwork.embedding_id,
        artwork.title,
        artwork.artist,
        artwork.year,
        artwork.date_text,
        artwork.medium,
        artwork.classification,
        artwork.culture,
        artwork.origin,
        artwork.dimensions_height,
        artwork.dimensions_width,
        artwork.dimensions_depth,
        artwork.dimensions_unit,
        artwork.description,
        artwork.provenance,
        artwork.credit_line,
        artwork.rights,
        artwork.accession_number,
        artwork.source_url,
        artwork.source_institution,
        artwork.source_collection,
        artwork.source_record_id,
        artwork.field_sources,
        artwork.translations,
        artwork.dominant_colors,
        artwork.color_palette,
        artwork.color_extracted_at,
        artwork.color_extraction_version,
        artwork.custom_metadata,
        artwork.citation,
        artwork.created_at,
        artwork.updated_at,
        artwork.uploaded_by,
        artwork.deleted_at
      )
      .run();

    await c.env.DB.prepare(
      `INSERT INTO assets (
        id, artwork_id, org_id, role, storage_provider, object_key, url,
        mime_type, size_bytes, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        randomUUID(),
        artwork.id,
        artwork.org_id,
        'original',
        'r2',
        uploadResult.key,
        uploadResult.url,
        uploadResult.contentType,
        uploadResult.size,
        JSON.stringify({
          originalFilename: file.name,
          imageHash: imageMetadata.hash || null,
        }),
        now,
        now
      )
      .run();

    // Queue for embedding generation
    await c.env.EMBEDDING_QUEUE.send({
      artworkId: artwork.id,
      imageUrl: artwork.image_url!,
      imageKey: uploadResult.key,
      galleryId: artwork.org_id,
    });

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
          message:
            error instanceof Error ? error.message : 'Failed to upload artwork',
        },
      },
      500
    );
  }
});

/**
 * POST /api/v1/orgs/:orgId/artworks/upsert
 * Create or update an artwork metadata record by id, source_record_id, or accession_number.
 */
app.post('/upsert', requireAuthOrApiKey as any, async (c) => {
  try {
    const orgId = await getRouteOrgId(c);
    if (!orgId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Org ID is required',
          },
        },
        400
      );
    }

    const validation = UpsertArtworkSchema.safeParse(await c.req.json());
    if (!validation.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid artwork record',
            details: validation.error.issues,
          },
        },
        400
      );
    }

    const input = validation.data;
    const existing = await findArtworkForUpsert(c.env.DB, orgId, input);
    const auth = getAuth(c as any);

    if (existing) {
      const updated = await updateArtworkRecord(c.env.DB, existing, input);
      return c.json({
        success: true,
        data: {
          created: false,
          artwork: mapArtworkRowToResponse(updated || existing),
        },
      });
    }

    if (!input.title) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'title is required when creating an artwork record',
          },
        },
        400
      );
    }

    const created = await createArtworkRecord(
      c.env.DB,
      orgId,
      input,
      auth.userId
    );
    return c.json(
      {
        success: true,
        data: {
          created: true,
          artwork: mapArtworkRowToResponse(created!),
        },
      },
      201
    );
  } catch (error) {
    console.error('Artwork upsert error:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UPSERT_FAILED',
          message:
            error instanceof Error ? error.message : 'Failed to upsert artwork',
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
    const routeOrgId = await resolveOrgIdentifier(
      c.env.DB,
      c.req.param('orgId') || c.req.param('galleryId')
    );
    const queryOrgId =
      query.org_id || query.gallery_id
        ? await resolveOrgIdentifier(c.env.DB, query.org_id || query.gallery_id)
        : routeOrgId;
    const validatedQuery = ArtworkQuerySchema.parse({
      org_id: queryOrgId,
      collection_id: query.collection_id,
      artist: query.artist,
      year: query.year ? parseInt(query.year) : undefined,
      year_min: query.year_min ? parseInt(query.year_min) : undefined,
      year_max: query.year_max ? parseInt(query.year_max) : undefined,
      medium: query.medium,
      search: query.search,
      public_only:
        query.public_only === 'true' || query.public_only === '1' || undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
    });

    // Build query
    let sql = 'SELECT * FROM artworks WHERE 1=1 AND deleted_at IS NULL';
    const params: any[] = [];

    const validatedOrgId = validatedQuery.org_id || validatedQuery.gallery_id;
    if (validatedOrgId) {
      sql += ' AND org_id = ?';
      params.push(validatedOrgId);
    }

    if (validatedQuery.collection_id) {
      sql += ' AND collection_id = ?';
      params.push(validatedQuery.collection_id);
    }

    if (validatedQuery.public_only) {
      sql += PUBLIC_ARTWORK_SQL;
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
    const countResult = await c.env.DB.prepare(
      sql.replace('SELECT *', 'SELECT COUNT(*) as count')
    )
      .bind(...params)
      .first<{ count: number }>();

    const total = countResult?.count || 0;

    // Add sorting and pagination
    sql += ` ORDER BY ${validatedQuery.sort_by} ${validatedQuery.sort_order}`;
    sql += ' LIMIT ? OFFSET ?';
    params.push(validatedQuery.limit, validatedQuery.offset);

    // Execute query
    const result = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<ArtworkRow>();

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
          message:
            error instanceof Error ? error.message : 'Failed to query artworks',
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

    const orgId = await getRouteOrgId(c);
    const artwork = await getScopedArtwork(c.env.DB, id, orgId);

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
          message:
            error instanceof Error ? error.message : 'Failed to get artwork',
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
app.patch('/:id', requireAuthOrApiKey as any, async (c) => {
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
    const orgId = await getRouteOrgId(c);
    const existing = await getScopedArtwork(c.env.DB, id, orgId);

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

    params.push(id, existing.org_id);

    await c.env.DB.prepare(
      `UPDATE artworks SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ? AND org_id = ?`
    )
      .bind(...params)
      .run();

    // Fetch updated artwork
    const updated = await getScopedArtwork(c.env.DB, id, existing.org_id);

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
          message:
            error instanceof Error ? error.message : 'Failed to update artwork',
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
app.delete('/:id', requireAuthOrApiKey as any, async (c) => {
  try {
    const id = c.req.param('id');

    // Get artwork to delete images
    const orgId = await getRouteOrgId(c);
    const artwork = await getScopedArtwork(c.env.DB, id, orgId);

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
    if (artwork.image_url) {
      const imageKey = artwork.image_url.split('/').slice(-3).join('/');
      await deleteImage(c.env.IMAGES, imageKey);
    }

    // Delete from database
    await c.env.DB.prepare('DELETE FROM artworks WHERE id = ? AND org_id = ?')
      .bind(id, artwork.org_id)
      .run();

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
          message:
            error instanceof Error ? error.message : 'Failed to delete artwork',
        },
      },
      500
    );
  }
});

export default app;
