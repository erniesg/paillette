import { z } from 'zod';

// ============================================================================
// Core Entities
// ============================================================================

export const DimensionsSchema = z.object({
  height: z.number().positive(),
  width: z.number().positive(),
  depth: z.number().positive().optional(),
  unit: z.enum(['cm', 'in', 'm']),
});

export const ColorPaletteItemSchema = z.object({
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), // Hex color
  percentage: z.number().min(0).max(100),
});

export const CitationSchema = z.object({
  format: z.enum(['mla', 'apa', 'chicago']),
  text: z.string(),
});

export const TranslationSchema = z.record(
  z.string(), // language code
  z.object({
    title: z.string().optional(),
    description: z.string().optional(),
  })
);

export const ArtworkSchema = z.object({
  id: z.string().uuid(),
  galleryId: z.string().uuid(),
  collectionId: z.string().uuid().optional(),

  // Image data
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url(),
  originalFilename: z.string(),
  imageHash: z.string(),

  // Embeddings
  embeddingId: z.string(),

  // Metadata
  title: z.string(),
  artist: z.string().optional(),
  year: z.number().int().min(0).max(9999).optional(),
  medium: z.string().optional(),
  dimensions: DimensionsSchema.optional(),
  description: z.string().optional(),
  provenance: z.string().optional(),

  // Multi-language support
  translations: TranslationSchema.optional(),

  // Color analysis
  dominantColors: z.array(z.string()).optional(),
  colorPalette: z.array(ColorPaletteItemSchema).optional(),

  // Custom metadata
  customMetadata: z.record(z.any()).optional(),

  // Citation
  citation: CitationSchema.optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  uploadedBy: z.string().uuid(),
});

export const GallerySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  location: z
    .object({
      country: z.string(),
      city: z.string(),
      address: z.string().optional(),
    })
    .optional(),
  website: z.string().url().optional(),

  // Settings
  settings: z.object({
    allowPublicAccess: z.boolean(),
    enableEmbeddingProjector: z.boolean(),
    defaultLanguage: z.string(),
    supportedLanguages: z.array(z.string()),
  }),

  // API access
  apiKey: z.string(),
  apiKeyHash: z.string(),

  createdAt: z.string().datetime(),
  ownerId: z.string().uuid(),
});

export const CollectionSchema = z.object({
  id: z.string().uuid(),
  galleryId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  artworkCount: z.number().int().min(0),
  thumbnailArtworkId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  passwordHash: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'curator', 'viewer']),
  galleries: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().optional(),
});

// ============================================================================
// Type Exports (inferred from Zod schemas)
// ============================================================================

export type Dimensions = z.infer<typeof DimensionsSchema>;
export type ColorPaletteItem = z.infer<typeof ColorPaletteItemSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type Translation = z.infer<typeof TranslationSchema>;
export type Artwork = z.infer<typeof ArtworkSchema>;
export type Gallery = z.infer<typeof GallerySchema>;
export type Collection = z.infer<typeof CollectionSchema>;
export type User = z.infer<typeof UserSchema>;

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    page?: number;
    pageSize?: number;
    total?: number;
    took?: number; // milliseconds
  };
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface SearchParams extends PaginationParams {
  query?: string;
  filters?: Record<string, any>;
}

// ============================================================================
// Create/Update Input Types
// ============================================================================

export const CreateGalleryInputSchema = GallerySchema.omit({
  id: true,
  apiKey: true,
  apiKeyHash: true,
  createdAt: true,
});

export const UpdateGalleryInputSchema = CreateGalleryInputSchema.partial();

export const CreateArtworkInputSchema = ArtworkSchema.omit({
  id: true,
  embeddingId: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateArtworkInputSchema = CreateArtworkInputSchema.partial();

export type CreateGalleryInput = z.infer<typeof CreateGalleryInputSchema>;
export type UpdateGalleryInput = z.infer<typeof UpdateGalleryInputSchema>;
export type CreateArtworkInput = z.infer<typeof CreateArtworkInputSchema>;
export type UpdateArtworkInput = z.infer<typeof UpdateArtworkInputSchema>;

// ============================================================================
// Search Types
// ============================================================================

export interface TextSearchParams {
  query: string;
  galleryId: string;
  topK?: number;
  filters?: Record<string, any>;
}

export interface ImageSearchParams {
  imageUrl?: string;
  imageData?: ArrayBuffer;
  galleryId: string;
  topK?: number;
  filters?: Record<string, any>;
}

export interface ColorSearchParams {
  colors: string[]; // Hex colors
  galleryId: string;
  topK?: number;
  threshold?: number;
}

export interface SearchResult extends Artwork {
  similarity: number; // 0-1
}

// ============================================================================
// Vector/Embedding Types
// ============================================================================

export interface VectorMetadata {
  artworkId: string;
  galleryId: string;
  uploadedAt: string;
}

export interface EmbeddingJobPayload {
  artworkId: string;
  imageUrl: string;
  galleryId: string;
}

// ============================================================================
// Translation Types
// ============================================================================

export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];
}

export interface TranslationResult {
  sourceLang: string;
  translations: Record<string, string>;
  provider: string;
  confidence?: number;
}

// ============================================================================
// Upload/Processing Types
// ============================================================================

export interface UploadResult {
  key: string;
  url: string;
  thumbnailUrl?: string;
  hash: string;
}

export interface CSVParseResult {
  rows: any[];
  errors: Array<{
    row: number;
    column: string;
    message: string;
  }>;
}

export interface BatchUpdateResult {
  updated: number;
  created: number;
  failed: number;
  errors: Array<{
    id: string;
    message: string;
  }>;
}
