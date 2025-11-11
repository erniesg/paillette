/**
 * Artwork Types and Validation Schemas
 */

import { z } from 'zod';

// ============================================================================
// Database Row Types
// ============================================================================

export interface ArtworkRow {
  id: string;
  gallery_id: string;
  collection_id: string | null;
  image_url: string;
  thumbnail_url: string;
  original_filename: string;
  image_hash: string;
  image_url_processed: string | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  frame_removal_confidence: number | null;
  processed_at: string | null;
  processing_error: string | null;
  embedding_id: string | null;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  dimensions_height: number | null;
  dimensions_width: number | null;
  dimensions_depth: number | null;
  dimensions_unit: 'cm' | 'in' | 'm' | null;
  description: string | null;
  provenance: string | null;
  translations: string; // JSON
  dominant_colors: string | null; // JSON array
  color_palette: string | null; // JSON array
  custom_metadata: string; // JSON
  citation: string | null; // JSON
  created_at: string;
  updated_at: string;
  uploaded_by: string;
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

export const CreateArtworkSchema = z.object({
  gallery_id: z.string().uuid(),
  collection_id: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  artist: z.string().max(255).optional(),
  year: z.number().int().min(0).max(9999).optional(),
  medium: z.string().max(255).optional(),
  dimensions_height: z.number().positive().optional(),
  dimensions_width: z.number().positive().optional(),
  dimensions_depth: z.number().positive().optional(),
  dimensions_unit: DimensionsUnitSchema.optional(),
  description: z.string().max(5000).optional(),
  provenance: z.string().max(2000).optional(),
  translations: TranslationsSchema.optional(),
  custom_metadata: z.record(z.any()).optional(),
  citation: CitationSchema.optional(),
});

export const UpdateArtworkSchema = CreateArtworkSchema.partial().omit({
  gallery_id: true,
});

export const UploadArtworkSchema = z.object({
  gallery_id: z.string().uuid(),
  collection_id: z.string().uuid().optional(),

  // Metadata (can be auto-extracted from filename or provided)
  title: z.string().min(1).max(500).optional(),
  artist: z.string().max(255).optional(),
  year: z.number().int().min(0).max(9999).optional(),
  medium: z.string().max(255).optional(),

  dimensions_height: z.number().positive().optional(),
  dimensions_width: z.number().positive().optional(),
  dimensions_depth: z.number().positive().optional(),
  dimensions_unit: DimensionsUnitSchema.optional(),

  description: z.string().max(5000).optional(),
  provenance: z.string().max(2000).optional(),

  // Client-provided image dimensions (for validation)
  image_width: z.number().positive().optional(),
  image_height: z.number().positive().optional(),

  // Optional metadata
  translations: TranslationsSchema.optional(),
  custom_metadata: z.record(z.any()).optional(),
  citation: CitationSchema.optional(),
});

export const ArtworkQuerySchema = z.object({
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
  gallery_id: string;
  collection_id: string | null;
  image_url: string;
  thumbnail_url: string;
  original_filename: string;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  dimensions: {
    height: number | null;
    width: number | null;
    depth: number | null;
    unit: 'cm' | 'in' | 'm' | null;
  };
  description: string | null;
  provenance: string | null;
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
