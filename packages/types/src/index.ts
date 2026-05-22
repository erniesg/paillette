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
  orgId: z.string().uuid(),
  collectionId: z.string().uuid().optional(),

  // Image data
  imageUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  originalFilename: z.string().nullable().optional(),
  imageHash: z.string().nullable().optional(),

  // Embeddings
  embeddingId: z.string(),

  // Metadata
  title: z.string(),
  artist: z.string().optional(),
  year: z.number().int().min(0).max(9999).optional(),
  dateText: z.string().optional(),
  medium: z.string().optional(),
  classification: z.string().optional(),
  culture: z.string().optional(),
  origin: z.string().optional(),
  dimensions: DimensionsSchema.optional(),
  description: z.string().optional(),
  provenance: z.string().optional(),
  creditLine: z.string().optional(),
  rights: z.string().optional(),
  accessionNumber: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  sourceInstitution: z.string().optional(),
  sourceCollection: z.string().optional(),
  sourceRecordId: z.string().optional(),
  fieldSources: z.record(z.any()).optional(),

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

export const OrgSchema = z.object({
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

/** @deprecated Use OrgSchema. */
export const GallerySchema = OrgSchema;

export const CollectionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
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
  orgs: z.array(z.string().uuid()),
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
export type Org = z.infer<typeof OrgSchema>;
/** @deprecated Use Org. */
export type Gallery = Org;
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

export const CreateOrgInputSchema = OrgSchema.omit({
  id: true,
  apiKey: true,
  apiKeyHash: true,
  createdAt: true,
});

export const UpdateOrgInputSchema = CreateOrgInputSchema.partial();
/** @deprecated Use CreateOrgInputSchema. */
export const CreateGalleryInputSchema = CreateOrgInputSchema;
/** @deprecated Use UpdateOrgInputSchema. */
export const UpdateGalleryInputSchema = UpdateOrgInputSchema;

export const CreateArtworkInputSchema = ArtworkSchema.omit({
  id: true,
  embeddingId: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateArtworkInputSchema = CreateArtworkInputSchema.partial();

export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgInputSchema>;
/** @deprecated Use CreateOrgInput. */
export type CreateGalleryInput = CreateOrgInput;
/** @deprecated Use UpdateOrgInput. */
export type UpdateGalleryInput = UpdateOrgInput;
export type CreateArtworkInput = z.infer<typeof CreateArtworkInputSchema>;
export type UpdateArtworkInput = z.infer<typeof UpdateArtworkInputSchema>;

// ============================================================================
// Search Types
// ============================================================================

export interface TextSearchParams {
  query: string;
  orgId: string;
  topK?: number;
  filters?: Record<string, any>;
}

export interface ImageSearchParams {
  imageUrl?: string;
  imageData?: ArrayBuffer;
  orgId: string;
  topK?: number;
  filters?: Record<string, any>;
}

export interface ColorSearchParams {
  colors: string[]; // Hex colors
  orgId: string;
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
  orgId: string;
  uploadedAt: string;
}

export interface EmbeddingJobPayload {
  artworkId: string;
  imageUrl: string;
  orgId: string;
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
