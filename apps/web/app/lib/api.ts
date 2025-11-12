/**
 * API client utilities for communicating with the backend
 */

import type {
  ApiResponse,
  SearchResponse,
  SearchTextRequest,
  SearchImageRequest,
  Gallery,
  Artwork,
  TranslateTextRequest,
  TranslateTextResponse,
  TranslateCostEstimate,
  TranslateDocumentResponse,
  TranslationJobStatus,
} from '../types';

// Get API URL from environment or use default
const API_URL =
  typeof window !== 'undefined'
    ? (window as any).ENV?.API_URL || 'https://paillette-stg.workers.dev'
    : 'https://paillette-stg.workers.dev';

const API_BASE = `${API_URL}/api/v1`;

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Search artworks using text query
   */
  async searchText(
    galleryId: string,
    request: SearchTextRequest
  ): Promise<SearchResponse> {
    const response = await fetch(
      `${this.baseUrl}/galleries/${galleryId}/search/text`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }
    );

    const data: ApiResponse<SearchResponse> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Search failed');
    }

    return data.data;
  }

  /**
   * Search artworks using image upload
   */
  async searchImage(
    galleryId: string,
    request: SearchImageRequest
  ): Promise<SearchResponse> {
    const formData = new FormData();
    formData.append('image', request.image);
    if (request.topK) formData.append('topK', request.topK.toString());
    if (request.minScore)
      formData.append('minScore', request.minScore.toString());

    const response = await fetch(
      `${this.baseUrl}/galleries/${galleryId}/search/image`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const data: ApiResponse<SearchResponse> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Search failed');
    }

    return data.data;
  }

  /**
   * Search artworks by color similarity
   */
  async searchColor(
    galleryId: string,
    request: {
      colors: string[];
      matchMode?: 'any' | 'all';
      threshold?: number;
      limit?: number;
    }
  ): Promise<{
    results: Array<{
      artworkId: string;
      title: string;
      imageUrl: string;
      matchedColors: Array<{
        searchColor: string;
        artworkColor: string;
        distance: number;
      }>;
      averageDistance: number;
      dominantColors: Array<{
        color: string;
        rgb: { r: number; g: number; b: number };
        percentage: number;
      }>;
    }>;
    query: {
      colors: string[];
      matchMode: 'any' | 'all';
      threshold: number;
      limit: number;
    };
    totalResults: number;
    took: number;
  }> {
    const response = await fetch(
      `${this.baseUrl}/galleries/${galleryId}/search/color`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          colors: request.colors,
          matchMode: request.matchMode || 'any',
          threshold: request.threshold || 15,
          limit: request.limit || 20,
        }),
      }
    );

    const data: ApiResponse<{
      results: Array<{
        artworkId: string;
        title: string;
        imageUrl: string;
        matchedColors: Array<{
          searchColor: string;
          artworkColor: string;
          distance: number;
        }>;
        averageDistance: number;
        dominantColors: Array<{
          color: string;
          rgb: { r: number; g: number; b: number };
          percentage: number;
        }>;
      }>;
      query: {
        colors: string[];
        matchMode: 'any' | 'all';
        threshold: number;
        limit: number;
      };
      totalResults: number;
      took: number;
    }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Color search failed');
    }

    return data.data;
  }

  /**
   * Get gallery by ID
   */
  async getGallery(galleryId: string): Promise<Gallery> {
    const response = await fetch(`${this.baseUrl}/galleries/${galleryId}`);
    const data: ApiResponse<Gallery> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch gallery');
    }

    return data.data;
  }

  /**
   * List all galleries
   */
  async listGalleries(): Promise<Gallery[]> {
    const response = await fetch(`${this.baseUrl}/galleries`);
    const data: ApiResponse<{ galleries: Gallery[] }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch galleries');
    }

    return data.data.galleries;
  }

  /**
   * Get artwork by ID
   */
  async getArtwork(galleryId: string, artworkId: string): Promise<Artwork> {
    const response = await fetch(
      `${this.baseUrl}/galleries/${galleryId}/artworks/${artworkId}`
    );
    const data: ApiResponse<Artwork> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch artwork');
    }

    return data.data;
  }

  /**
   * List artworks for a gallery
   */
  async listArtworks(
    galleryId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ artworks: Artwork[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/galleries/${galleryId}/artworks${
      params.toString() ? `?${params}` : ''
    }`;
    const response = await fetch(url);
    const data: ApiResponse<{ artworks: Artwork[]; total: number }> =
      await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch artworks');
    }

    return data.data;
  }

  /**
   * Upload CSV file with metadata
   */
  async uploadMetadata(
    galleryId: string,
    file: File
  ): Promise<{
    job_id: string;
    result: {
      created: Array<{ id: string; title: string }>;
      updated: Array<{ id: string; title: string }>;
      failed: Array<{ row: number; error: string }>;
      stats: {
        total: number;
        created: number;
        updated: number;
        failed: number;
        file_name: string;
        file_size: number;
      };
    };
  }> {
    const formData = new FormData();
    formData.append('csv', file);
    formData.append('gallery_id', galleryId);

    const response = await fetch(`${this.baseUrl}/metadata/upload`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Upload failed');
    }

    return data.data;
  }

  /**
   * Validate CSV file without uploading
   */
  async validateMetadata(file: File): Promise<{
    valid: boolean;
    stats: {
      totalRows: number;
      validRows: number;
      invalidRows: number;
    };
    errors: Array<{
      row: number;
      column: string;
      message: string;
      value: any;
    }>;
    sample: any[];
    file_info: {
      name: string;
      size: number;
      type: string;
    };
  }> {
    const formData = new FormData();
    formData.append('csv', file);

    const response = await fetch(`${this.baseUrl}/metadata/validate`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Validation failed');
    }

    return data.data;
  }

  /**
   * Get upload job status
   */
  async getUploadJob(jobId: string): Promise<{
    id: string;
    gallery_id: string;
    status: string;
    total_items: number;
    processed_items: number;
    failed_items: number;
    error_log: any;
    created_at: string;
    updated_at: string;
  }> {
    const response = await fetch(`${this.baseUrl}/metadata/jobs/${jobId}`);
    const data = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch job');
    }

    return data.data;
  }

  /**
   * List upload jobs for gallery
   */
  async listUploadJobs(galleryId: string): Promise<{
    jobs: Array<{
      id: string;
      gallery_id: string;
      status: string;
      total_items: number;
      processed_items: number;
      failed_items: number;
      created_at: string;
      updated_at: string;
    }>;
    total: number;
  }> {
    const response = await fetch(
      `${this.baseUrl}/metadata/jobs?gallery_id=${galleryId}`
    );
    const data = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to list jobs');
    }

    return data.data;
  }

  /**
   * Download CSV template
   */
  downloadTemplate(): string {
    return `${this.baseUrl}/metadata/template`;
  }

  /**
   * Get artwork embeddings for visualization
   */
  async getEmbeddings(
    galleryId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{
    embeddings: Array<{
      id: string;
      title: string;
      artist: string | null;
      year: number | null;
      medium: string | null;
      imageUrl: string;
      thumbnailUrl: string;
      embedding: number[];
    }>;
    total: number;
    dimensions: number;
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/galleries/${galleryId}/embeddings${
      params.toString() ? `?${params}` : ''
    }`;
    const response = await fetch(url);
    const data: ApiResponse<{
      embeddings: Array<{
        id: string;
        title: string;
        artist: string | null;
        year: number | null;
        medium: string | null;
        imageUrl: string;
        thumbnailUrl: string;
        embedding: number[];
      }>;
      total: number;
      dimensions: number;
    }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch embeddings');
    }

    return data.data;
  }

  /**
   * Translate text
   */
  async translateText(
    request: TranslateTextRequest
  ): Promise<TranslateTextResponse> {
    const response = await fetch(`${this.baseUrl}/translate/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    const data: ApiResponse<TranslateTextResponse> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Translation failed');
    }

    return data.data;
  }

  /**
   * Estimate translation cost
   */
  async estimateTranslationCost(
    text: string,
    targetLang: string
  ): Promise<TranslateCostEstimate> {
    const response = await fetch(`${this.baseUrl}/translate/estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, targetLang }),
    });

    const data: ApiResponse<TranslateCostEstimate> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Cost estimation failed');
    }

    return data.data;
  }

  /**
   * Upload document for translation
   */
  async translateDocument(
    file: File,
    sourceLang: string,
    targetLang: string
  ): Promise<TranslateDocumentResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceLang', sourceLang);
    formData.append('targetLang', targetLang);

    const response = await fetch(`${this.baseUrl}/translate/document`, {
      method: 'POST',
      body: formData,
    });

    const data: ApiResponse<TranslateDocumentResponse> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Document upload failed');
    }

    return data.data;
  }

  /**
   * Get translation job status
   */
  async getTranslationJobStatus(jobId: string): Promise<TranslationJobStatus> {
    const response = await fetch(`${this.baseUrl}/translate/document/${jobId}`);
    const data: ApiResponse<TranslationJobStatus> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch job status');
    }

    return data.data;
  }

  /**
   * Download translated document
   */
  downloadTranslatedDocument(jobId: string): string {
    return `${this.baseUrl}/translate/document/${jobId}/download`;
  }

  /**
   * Process frame removal for a single artwork
   */
  async processFrameRemoval(
    artworkId: string
  ): Promise<{ artworkId: string; status: string; message: string }> {
    const response = await fetch(
      `${this.baseUrl}/artworks/${artworkId}/process-frame`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data: ApiResponse<{
      artworkId: string;
      status: string;
      message: string;
    }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Frame processing failed');
    }

    return data.data;
  }

  /**
   * Batch process frame removal for gallery artworks
   */
  async batchProcessFrames(
    galleryId: string,
    options?: { artworkIds?: string[]; forceReprocess?: boolean }
  ): Promise<{
    galleryId: string;
    totalQueued: number;
    skipped: number;
    message: string;
  }> {
    const response = await fetch(
      `${this.baseUrl}/galleries/${galleryId}/artworks/batch-process-frames`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      }
    );

    const data: ApiResponse<{
      galleryId: string;
      totalQueued: number;
      skipped: number;
      message: string;
    }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Batch processing failed');
    }

    return data.data;
  }

  /**
   * Get frame processing status for an artwork
   */
  async getProcessingStatus(artworkId: string): Promise<{
    artworkId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    confidence: number | null;
    processedImageUrl: string | null;
    processedAt: string | null;
    error: string | null;
  }> {
    const response = await fetch(
      `${this.baseUrl}/artworks/${artworkId}/processing-status`
    );

    const data: ApiResponse<{
      artworkId: string;
      status: 'pending' | 'processing' | 'completed' | 'failed';
      confidence: number | null;
      processedImageUrl: string | null;
      processedAt: string | null;
      error: string | null;
    }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch processing status');
    }

    return data.data;
  }

  /**
   * Get processing statistics for a gallery
   */
  async getProcessingStats(galleryId: string): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    hasProcessedImage: number;
    avgConfidence: number | null;
  }> {
    const response = await fetch(
      `${this.baseUrl}/galleries/${galleryId}/processing-stats`
    );

    const data: ApiResponse<{
      total: number;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      hasProcessedImage: number;
      avgConfidence: number | null;
    }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch processing stats');
    }

    return data.data;
  }
}

export const apiClient = new ApiClient();
