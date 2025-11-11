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
}

export interface SearchTextRequest {
  query: string;
  topK?: number;
  minScore?: number;
}

export interface SearchImageRequest {
  topK?: number;
  minScore?: number;
  // Image will come from multipart form data
}

export interface ArtworkSearchResult {
  id: string;
  galleryId: string;
  title?: string;
  artist?: string;
  year?: number;
  imageUrl: string;
  thumbnailUrl?: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface SearchResponse {
  results: ArtworkSearchResult[];
  count: number;
  queryTime: number;
}
