/**
 * Embedding Types and Schemas
 */

import { z } from 'zod';

// ============================================================================
// Embedding Service Types
// ============================================================================

export type EmbeddingProvider = 'replicate' | 'modal' | 'huggingface';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  apiKey?: string;
  apiUrl?: string;
}

export interface ImageEmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  provider: EmbeddingProvider;
}

export interface TextEmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
}

// ============================================================================
// Queue Message Types
// ============================================================================

export interface EmbeddingJob {
  artworkId: string;
  imageUrl: string;
  imageKey: string;
  metadata: {
    title: string;
    artist?: string;
    year?: number;
    medium?: string;
    description?: string;
    galleryId: string;
  };
}

export interface EmbeddingJobResult {
  artworkId: string;
  success: boolean;
  embedding?: number[];
  error?: string;
  processingTime?: number;
}

// ============================================================================
// Vectorize Types
// ============================================================================

export interface VectorMetadata {
  artworkId: string;
  galleryId: string;
  title: string;
  artist?: string;
  year?: number;
  medium?: string;
  imageUrl: string;
  thumbnailUrl: string;
  createdAt: string;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: VectorMetadata;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

export interface SimilaritySearchOptions {
  topK?: number;
  minScore?: number;
  filter?: VectorFilter;
  returnMetadata?: boolean;
}

export interface VectorFilter {
  galleryId?: string;
  artist?: string;
  yearMin?: number;
  yearMax?: number;
  medium?: string;
}

// ============================================================================
// Validation Schemas
// ============================================================================

export const SimilaritySearchSchema = z.object({
  imageUrl: z.string().url().optional(),
  imageData: z.string().optional(), // base64 encoded
  text: z.string().optional(),
  topK: z.number().int().positive().max(100).default(20),
  minScore: z.number().min(0).max(1).default(0),
  filter: z.object({
    galleryId: z.string().uuid().optional(),
    artist: z.string().optional(),
    yearMin: z.number().int().optional(),
    yearMax: z.number().int().optional(),
    medium: z.string().optional(),
  }).optional(),
});

export const TextSearchSchema = z.object({
  query: z.string().min(1).max(1000),
  topK: z.number().int().positive().max(100).default(20),
  filter: z.object({
    galleryId: z.string().uuid().optional(),
    artist: z.string().optional(),
    yearMin: z.number().int().optional(),
    yearMax: z.number().int().optional(),
    medium: z.string().optional(),
  }).optional(),
});

export const BatchEmbeddingSchema = z.object({
  artworkIds: z.array(z.string().uuid()).min(1).max(100),
  force: z.boolean().default(false), // Force re-embedding
});

// ============================================================================
// Search Response Types
// ============================================================================

export interface SimilaritySearchResponse {
  success: true;
  data: {
    results: Array<{
      artwork_id: string;
      score: number;
      title: string;
      artist?: string;
      year?: number;
      medium?: string;
      image_url: string;
      thumbnail_url: string;
      created_at: string;
    }>;
    query_time_ms: number;
    total_results: number;
  };
}

export interface TextSearchResponse {
  success: true;
  data: {
    results: Array<{
      artwork_id: string;
      score: number;
      title: string;
      artist?: string;
      year?: number;
      medium?: string;
      description?: string;
      image_url: string;
      thumbnail_url: string;
      created_at: string;
    }>;
    query_time_ms: number;
    total_results: number;
  };
}

// ============================================================================
// Type Exports
// ============================================================================

export type SimilaritySearchInput = z.infer<typeof SimilaritySearchSchema>;
export type TextSearchInput = z.infer<typeof TextSearchSchema>;
export type BatchEmbeddingInput = z.infer<typeof BatchEmbeddingSchema>;
