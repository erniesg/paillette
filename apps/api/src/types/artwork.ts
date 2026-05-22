/**
 * Artwork Types and Validation Schemas
 */

import { z } from 'zod';

// ============================================================================
// Database Row Types
// ============================================================================

export interface ArtworkRow {
  id: string;
  org_id: string;
  collection_id: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  original_filename: string | null;
  image_hash: string | null;
  image_url_processed: string | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  frame_removal_confidence: number | null;
  processed_at: string | null;
  processing_error: string | null;
  embedding_id: string | null;
  title: string;
  artist: string | null;
  year: number | null;
  date_text: string | null;
  medium: string | null;
  classification: string | null;
  culture: string | null;
  origin: string | null;
  dimensions_height: number | null;
  dimensions_width: number | null;
  dimensions_depth: number | null;
  dimensions_unit: 'cm' | 'in' | 'm' | null;
  description: string | null;
  provenance: string | null;
  credit_line: string | null;
  rights: string | null;
  accession_number: string | null;
  source_url: string | null;
  source_institution: string | null;
  source_collection: string | null;
  source_record_id: string | null;
  field_sources: string;
  translations: string; // JSON
  dominant_colors: string | null; // JSON array
  color_palette: string | null; // JSON array
  color_extracted_at: string | null;
  color_extraction_version: string | null;
  custom_metadata: string; // JSON
  citation: string | null; // JSON
  created_at: string;
  updated_at: string;
  uploaded_by: string;
  deleted_at: string | null;
}

// ============================================================================
// Validation Schemas
// ============================================================================

export const DimensionsUnitSchema = z.enum(['cm', 'in', 'm']);

export const TranslationsSchema = z.record(
  z.string(),
  z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    artist: z.string().optional(),
    medium: z.string().optional(),
  })
);

export const CitationSchema = z.object({
  format: z.enum(['apa', 'mla', 'chicago', 'custom']),
  text: z.string(),
});

const hasOrgScope = (value: { org_id?: string; gallery_id?: string }) =>
  Boolean(value.org_id || value.gallery_id);

const CreateArtworkBaseSchema = z.object({
  org_id: z.string().uuid().optional(),
  gallery_id: z.string().uuid().optional(),
  collection_id: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  artist: z.string().max(255).optional(),
  year: z.number().int().min(0).max(9999).optional(),
  date_text: z.string().max(255).optional(),
  medium: z.string().max(255).optional(),
  classification: z.string().max(255).optional(),
  culture: z.string().max(255).optional(),
  origin: z.string().max(255).optional(),
  dimensions_height: z.number().positive().optional(),
  dimensions_width: z.number().positive().optional(),
  dimensions_depth: z.number().positive().optional(),
  dimensions_unit: DimensionsUnitSchema.optional(),
  description: z.string().max(5000).optional(),
  provenance: z.string().max(2000).optional(),
  credit_line: z.string().max(2000).optional(),
  rights: z.string().max(2000).optional(),
  accession_number: z.string().max(255).optional(),
  source_url: z.string().url().optional(),
  source_institution: z.string().max(255).optional(),
  source_collection: z.string().max(255).optional(),
  source_record_id: z.string().max(255).optional(),
  field_sources: z.record(z.any()).optional(),
  translations: TranslationsSchema.optional(),
  custom_metadata: z.record(z.any()).optional(),
  citation: CitationSchema.optional(),
});

export const CreateArtworkSchema = CreateArtworkBaseSchema.refine(hasOrgScope, {
  message: 'org_id is required',
});

export const UpdateArtworkSchema = CreateArtworkBaseSchema.partial().omit({
  org_id: true,
  gallery_id: true,
});

const UploadArtworkBaseSchema = z.object({
  org_id: z.string().uuid().optional(),
  gallery_id: z.string().uuid().optional(),
  collection_id: z.string().uuid().optional(),

  // Metadata (can be auto-extracted from filename or provided)
  title: z.string().min(1).max(500).optional(),
  artist: z.string().max(255).optional(),
  year: z.number().int().min(0).max(9999).optional(),
  date_text: z.string().max(255).optional(),
  medium: z.string().max(255).optional(),
  classification: z.string().max(255).optional(),
  culture: z.string().max(255).optional(),
  origin: z.string().max(255).optional(),

  dimensions_height: z.number().positive().optional(),
  dimensions_width: z.number().positive().optional(),
  dimensions_depth: z.number().positive().optional(),
  dimensions_unit: DimensionsUnitSchema.optional(),

  description: z.string().max(5000).optional(),
  provenance: z.string().max(2000).optional(),
  credit_line: z.string().max(2000).optional(),
  rights: z.string().max(2000).optional(),
  accession_number: z.string().max(255).optional(),
  source_url: z.string().url().optional(),
  source_institution: z.string().max(255).optional(),
  source_collection: z.string().max(255).optional(),
  source_record_id: z.string().max(255).optional(),
  field_sources: z.record(z.any()).optional(),

  // Client-provided image dimensions (for validation)
  image_width: z.number().positive().optional(),
  image_height: z.number().positive().optional(),

  // Optional metadata
  translations: TranslationsSchema.optional(),
  custom_metadata: z.record(z.any()).optional(),
  citation: CitationSchema.optional(),
});

export const UploadArtworkSchema = UploadArtworkBaseSchema.refine(hasOrgScope, {
  message: 'org_id is required',
});

export const ArtworkQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  gallery_id: z.string().uuid().optional(),
  collection_id: z.string().uuid().optional(),
  artist: z.string().optional(),
  year: z.number().int().optional(),
  year_min: z.number().int().optional(),
  year_max: z.number().int().optional(),
  medium: z.string().optional(),
  search: z.string().optional(), // Full-text search
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().min(0).default(0),
  sort_by: z.enum(['created_at', 'updated_at', 'title', 'artist', 'year']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================================================
// Response Types
// ============================================================================

export interface ArtworkResponse {
  id: string;
  org_id: string;
  gallery_id?: string;
  collection_id: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  original_filename: string | null;
  title: string;
  artist: string | null;
  year: number | null;
  date_text: string | null;
  medium: string | null;
  classification: string | null;
  culture: string | null;
  origin: string | null;
  dimensions: {
    height: number | null;
    width: number | null;
    depth: number | null;
    unit: 'cm' | 'in' | 'm' | null;
  };
  description: string | null;
  provenance: string | null;
  credit_line: string | null;
  rights: string | null;
  accession_number: string | null;
  source_url: string | null;
  source_institution: string | null;
  source_collection: string | null;
  source_record_id: string | null;
  field_sources: Record<string, any>;
  translations: Record<string, any>;
  colors: {
    dominant: string[] | null;
    palette: string[] | null;
  };
  custom_metadata: Record<string, any>;
  citation: {
    format: string;
    text: string;
  } | null;
  created_at: string;
  updated_at: string;
  uploaded_by: string;
}

export interface ArtworkListResponse {
  success: true;
  data: ArtworkResponse[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface ArtworkUploadResponse {
  success: true;
  data: {
    artwork: ArtworkResponse;
    upload_info: {
      size: number;
      content_type: string;
      hash: string;
    };
  };
}

// ============================================================================
// Type Exports
// ============================================================================

export type CreateArtworkInput = z.infer<typeof CreateArtworkSchema>;
export type UpdateArtworkInput = z.infer<typeof UpdateArtworkSchema>;
export type UploadArtworkInput = z.infer<typeof UploadArtworkSchema>;
export type ArtworkQuery = z.infer<typeof ArtworkQuerySchema>;
