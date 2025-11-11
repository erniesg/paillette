/**
 * AI and embedding-related types for Paillette
 */

export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[];
  /** Dimension of the embedding */
  dimensions: number;
  /** Model used to generate the embedding */
  model: string;
  /** Time taken to generate embedding in milliseconds */
  durationMs: number;
}

export interface VectorMetadata {
  /** Gallery ID this artwork belongs to */
  galleryId: string;
  /** Artwork ID */
  artworkId: string;
  /** Optional: Artwork title */
  title?: string;
  /** Optional: Artist name */
  artist?: string;
  /** Optional: Year created */
  year?: number;
  /** Timestamp when embedding was created */
  createdAt: string;
}

export interface VectorUpsertOptions {
  /** Vector ID (usually artwork ID) */
  id: string;
  /** Embedding vector */
  values: number[];
  /** Metadata for filtering */
  metadata: VectorMetadata;
}

export interface VectorSearchOptions {
  /** Number of results to return */
  topK?: number;
  /** Gallery ID to filter by */
  galleryId?: string;
  /** Minimum similarity score (0-1) */
  minScore?: number;
  /** Include metadata in results */
  includeMetadata?: boolean;
}

export interface VectorSearchResult {
  /** Vector ID (artwork ID) */
  id: string;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Metadata if requested */
  metadata?: VectorMetadata;
}

export interface EmbeddingServiceConfig {
  /** Cloudflare AI binding */
  ai: Ai;
  /** Image embedding model */
  imageModel?: string;
  /** Text embedding model */
  textModel?: string;
}

export interface VectorServiceConfig {
  /** Cloudflare Vectorize binding */
  vectorize: Vectorize;
  /** Index name */
  indexName?: string;
}

export interface EmbeddingJobPayload {
  /** Artwork ID to generate embedding for */
  artworkId: string;
  /** Gallery ID */
  galleryId: string;
  /** Image URL in R2 */
  imageUrl: string;
  /** Optional: Image key in R2 */
  imageKey?: string;
  /** Retry attempt number */
  retryCount?: number;
}

export interface EmbeddingJobResult {
  /** Whether the job succeeded */
  success: boolean;
  /** Artwork ID */
  artworkId: string;
  /** Embedding ID in Vectorize */
  embeddingId?: string;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

export const EMBEDDING_MODELS = {
  /** CLIP model for image embeddings (512 dimensions) */
  IMAGE_CLIP: '@cf/openai/clip-vit-base-patch16',
  /** Jina CLIP v2 for better image embeddings (1024 dimensions) */
  IMAGE_JINA_CLIP_V2: '@cf/jinaai/jina-clip-v2',
  /** BGE model for text embeddings (768 dimensions) */
  TEXT_BGE: '@cf/baai/bge-base-en-v1.5',
  /** Smaller text embedding model (384 dimensions) */
  TEXT_SMALL: '@cf/baai/bge-small-en-v1.5',
} as const;

export const DEFAULT_VECTOR_DIMENSIONS = 1024; // Jina CLIP v2
export const DEFAULT_TOP_K = 10;
export const MIN_SIMILARITY_SCORE = 0.7;
export const MAX_RETRY_ATTEMPTS = 3;
