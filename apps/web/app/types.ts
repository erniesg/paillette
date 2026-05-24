/**
 * Shared types for the web application
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

export interface Org {
  id: string;
  name: string;
  slug: string;
  description?: string;
  website?: string;
  apiKey: string;
  isPublic: boolean;
  settings?: GallerySettings;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use Org. */
export type Gallery = Org;

export interface GallerySettings {
  enableEmbeddingProjector?: boolean;
  supportedLanguages?: string[];
}

export interface Artwork {
  id: string;
  org_id?: string;
  orgId?: string;
  gallery_id?: string;
  galleryId: string;
  collection_id?: string | null;
  title?: string;
  artist?: string;
  year?: number;
  date_text?: string | null;
  medium?: string;
  classification?: string | null;
  culture?: string | null;
  origin?: string | null;
  dimensions?: ArtworkDimensions;
  description?: string;
  provenance?: string | null;
  credit_line?: string | null;
  rights?: string | null;
  accession_number?: string | null;
  source_url?: string | null;
  source_institution?: string | null;
  source_collection?: string | null;
  source_record_id?: string | null;
  field_sources?: Record<string, any>;
  custom_metadata?: Record<string, any>;
  colors?: {
    dominant?: string[] | null;
    palette?: any;
  };
  citation?: Citation | null;
  image_url?: string | null;
  imageUrl: string | null;
  thumbnail_url?: string | null;
  thumbnailUrl?: string | null;
  original_filename?: string | null;
  imageUrlProcessed?: string | null;
  processingStatus?: ProcessingStatus;
  frameRemovalConfidence?: number | null;
  processedAt?: string | null;
  processingError?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ArtworkDimensions {
  height?: number;
  width?: number;
  depth?: number;
  unit?: string;
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
  metadata?: ArtworkMetadata;
}

export interface ArtworkMetadata {
  medium?: string;
  dimensions?: ArtworkDimensions;
  description?: string;
  provenance?: string;
  citation?: Citation;
  dominantColors?: string[];
  colorPalette?: ColorPalette;
  translations?: Record<string, Translation>;
  [key: string]: any;
}

export interface Citation {
  format: 'mla' | 'apa' | 'chicago';
  text: string;
}

export interface ColorPalette {
  colors: string[];
  percentages: number[];
}

export interface Translation {
  title?: string;
  artist?: string;
  description?: string;
  medium?: string;
}

export interface SearchResponse {
  results: ArtworkSearchResult[];
  count: number;
  queryTime: number;
}

export interface SearchTextRequest {
  query: string;
  topK?: number;
  minScore?: number;
}

export interface SearchImageRequest {
  image: File;
  topK?: number;
  minScore?: number;
}

// Translation types
export type Language = 'en' | 'zh' | 'ms' | 'ta';

export interface TranslateTextRequest {
  text: string;
  sourceLang: Language;
  targetLang: Language;
}

export interface TranslateTextResponse {
  translatedText: string;
  provider: string;
  cached: boolean;
  cost?: number;
  usage?: TranslationUsageSummary;
}

export interface TranslationUsageSummary {
  used: number;
  quota: number;
  remaining: number;
}

export interface TranslateCostEstimate {
  estimatedCost: number;
  provider: string;
  characterCount: number;
  costPerCharacter: number;
}

export interface TranslateDocumentRequest {
  file: File;
  sourceLang: Language;
  targetLang: Language;
}

export interface TranslateDocumentResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  filename: string;
  estimatedTime?: string;
}

export interface TranslationJobStatus {
  jobId: string;
  filename: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  sourceLang: Language;
  targetLang: Language;
  createdAt: string;
  completedAt?: string;
  downloadUrl?: string;
  error?: string;
  cost?: number;
}

// Frame removal types
export interface ProcessingStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  hasProcessedImage: number;
  avgConfidence: number | null;
}

export interface PailletteApiKey {
  id: string;
  name: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  used_today: number;
  quota_today: number;
}

export interface PailletteApiKeyList {
  keys: PailletteApiKey[];
  today: string;
}

export interface CreatedPailletteApiKey {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  status: 'active';
  created_at: string;
}

export interface DailyUsageSummary {
  date: string;
  used: number;
  quota: number;
}
