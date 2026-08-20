/**
 * API-specific types and interfaces
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ResponseMeta {
  timestamp: string;
  requestId?: string;
  duration?: number;
  search?: {
    cacheable: boolean;
    degradedChannels: SearchDegradedChannel[];
  };
}

export type SearchDegradedChannel =
  | 'image_embedding'
  | 'caption_embedding'
  | 'metadata'
  | 'visual_refinement';

export interface SearchTextRequest {
  query: string;
  topK?: number;
  minScore?: number;
  facet?: 'artist';
  constraints?: import('@paillette/types/public-search').PublicSearchConstraints;
}

export interface SearchImageRequest {
  topK?: number;
  minScore?: number;
  // Image will come from multipart form data
}

export interface ArtworkSearchResult {
  id: string;
  orgId?: string;
  galleryId: string;
  title?: string;
  artist?: string;
  year?: number;
  imageUrl: string | null;
  thumbnailUrl?: string | null;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface SearchResponse {
  results: ArtworkSearchResult[];
  count: number;
  queryTime: number;
  interpretation?: import('@paillette/types/public-search').PublicSearchInterpretation;
}
