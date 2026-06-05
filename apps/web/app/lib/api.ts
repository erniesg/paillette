/**
 * API client utilities for communicating with the backend
 */

import type {
  ApiResponse,
  CreateOrgInput,
  SearchResponse,
  SearchTextRequest,
  SearchImageRequest,
  Org,
  Gallery,
  Artwork,
  TranslateTextRequest,
  TranslateTextResponse,
  TranslateCostEstimate,
  TranslateDocumentResponse,
  TranslationJobStatus,
  TranslationUsageSummary,
  ExtractUsageSummary,
  PailletteApiKeyList,
  CreatedPailletteApiKey,
  DailyUsageSummary,
} from '../types';

// Get API URL from environment or use default
// In local dev, use localhost:8787 (wrangler dev default port)
const getConfiguredApiUrl = () =>
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL;

const getApiUrlForHostname = (hostname: string) => {
  const configuredApiUrl = getConfiguredApiUrl();
  const isDev = hostname === 'localhost' || hostname === '127.0.0.1';
  const usesStagingApi = hostname === 'paillette-stg.berlayar.ai';

  return (
    configuredApiUrl ||
    (isDev
      ? 'http://localhost:8787'
      : usesStagingApi
        ? 'https://paillette-api-stg.berlayar.ai'
        : 'https://paillette-api.berlayar.ai')
  );
};

const getApiUrl = () => {
  if (typeof window !== 'undefined') {
    // Client-side
    return (
      (window as any).ENV?.API_URL ||
      getApiUrlForHostname(window.location.hostname)
    );
  }

  // Server-side
  return getConfiguredApiUrl() || 'https://paillette-api.berlayar.ai';
};

const API_URL = getApiUrl();
const API_BASE = `${API_URL}/api/v1`;

export const getPublicApiBaseUrl = () => API_BASE;

type AccessTokenProvider = () => Promise<string | undefined>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
const LEGACY_NGS_ORG_ID = '00000000-0000-4000-8000-000000000101';
const NGS_ORG_SLUG = 'national-gallery-singapore';
const NGS_ORG_KEY = 'ngs';
const OPEN_ACCESS_ORG_SLUG = 'open-access-art';
const OPEN_ACCESS_ORG_KEY = 'open';

const ORG_ID_ALIASES: Record<string, string> = {
  [NGS_ORG_KEY]: NGS_ORG_ID,
  [NGS_ORG_SLUG]: NGS_ORG_ID,
  [LEGACY_NGS_ORG_ID]: NGS_ORG_ID,
  [OPEN_ACCESS_ORG_KEY]: OPEN_ACCESS_ORG_SLUG,
  [OPEN_ACCESS_ORG_SLUG]: OPEN_ACCESS_ORG_SLUG,
};

export const resolveOrgIdentifier = (orgId: string) =>
  ORG_ID_ALIASES[orgId.toLowerCase()] || orgId;

export const getPreferredOrgRouteId = (
  requestedOrgId: string,
  canonicalSlug?: string | null
) => {
  const requested = requestedOrgId.toLowerCase();
  if (ORG_ID_ALIASES[requested] === NGS_ORG_ID || requested === NGS_ORG_ID) {
    return NGS_ORG_KEY;
  }
  if (
    ORG_ID_ALIASES[requested] === OPEN_ACCESS_ORG_SLUG ||
    requested === OPEN_ACCESS_ORG_SLUG ||
    canonicalSlug === OPEN_ACCESS_ORG_SLUG
  ) {
    return OPEN_ACCESS_ORG_KEY;
  }
  return canonicalSlug || requestedOrgId;
};

const sanitizeGeneratedCaptionRecord = (record: unknown) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  return { ...(record as Record<string, unknown>) };
};

const sanitizeArtworkMetadata = (metadata: Record<string, any>) => {
  const sanitized = { ...metadata };

  if ('generated_caption' in sanitized) {
    sanitized.generated_caption = sanitizeGeneratedCaptionRecord(
      sanitized.generated_caption
    );
  }

  if ('generatedCaption' in sanitized) {
    sanitized.generatedCaption = sanitizeGeneratedCaptionRecord(
      sanitized.generatedCaption
    );
  }

  return sanitized;
};

const normalizeArtwork = (artwork: Artwork): Artwork => {
  const raw = artwork as Artwork & Record<string, any>;
  const orgId =
    raw.orgId || raw.org_id || raw.galleryId || raw.gallery_id || '';
  const rawCustomMetadata =
    raw.custom_metadata &&
    typeof raw.custom_metadata === 'object' &&
    !Array.isArray(raw.custom_metadata)
      ? raw.custom_metadata
      : {};
  const customMetadata =
    raw.custom_metadata &&
    typeof raw.custom_metadata === 'object' &&
    !Array.isArray(raw.custom_metadata)
      ? sanitizeArtworkMetadata(raw.custom_metadata)
      : raw.custom_metadata;
  const metadata = sanitizeArtworkMetadata({
    ...(raw.metadata || {}),
    ...rawCustomMetadata,
  });

  return {
    ...artwork,
    custom_metadata: customMetadata,
    orgId,
    galleryId: orgId,
    imageUrl: raw.imageUrl ?? raw.image_url ?? null,
    thumbnailUrl: raw.thumbnailUrl ?? raw.thumbnail_url ?? null,
    medium: raw.medium ?? metadata.medium,
    description: raw.description ?? metadata.description,
    dimensions: raw.dimensions,
    metadata,
    createdAt: raw.createdAt ?? raw.created_at,
    updatedAt: raw.updatedAt ?? raw.updated_at,
  };
};

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async getAuthHeaders(
    getAccessToken: AccessTokenProvider
  ): Promise<Record<string, string>> {
    const token = await getAccessToken();

    if (!token) {
      throw new Error('Sign in is required');
    }

    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private async getOptionalAuthHeaders(
    getAccessToken?: AccessTokenProvider
  ): Promise<Record<string, string>> {
    if (!getAccessToken) {
      return {};
    }

    try {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  async listApiKeys(
    getAccessToken: AccessTokenProvider
  ): Promise<PailletteApiKeyList> {
    const response = await fetch(`${this.baseUrl}/me/api-keys`, {
      headers: await this.getAuthHeaders(getAccessToken),
    });

    const data: ApiResponse<PailletteApiKeyList> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch API keys');
    }

    return data.data;
  }

  async createApiKey(
    getAccessToken: AccessTokenProvider,
    name = 'Default key'
  ): Promise<CreatedPailletteApiKey> {
    const response = await fetch(`${this.baseUrl}/me/api-keys`, {
      method: 'POST',
      headers: {
        ...(await this.getAuthHeaders(getAccessToken)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });

    const data: ApiResponse<CreatedPailletteApiKey> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to create API key');
    }

    return data.data;
  }

  async revokeApiKey(
    getAccessToken: AccessTokenProvider,
    keyId: string
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/me/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: await this.getAuthHeaders(getAccessToken),
    });

    const data: ApiResponse<{ id: string; status: string }> =
      await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to revoke API key');
    }
  }

  async getTodayUsage(
    getAccessToken: AccessTokenProvider
  ): Promise<DailyUsageSummary> {
    const response = await fetch(`${this.baseUrl}/me/usage/today`, {
      headers: await this.getAuthHeaders(getAccessToken),
    });

    const data: ApiResponse<DailyUsageSummary> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch usage');
    }

    return data.data;
  }

  /**
   * Search artworks using text query
   */
  async searchText(
    orgId: string,
    request: SearchTextRequest,
    getAccessToken?: AccessTokenProvider
  ): Promise<SearchResponse> {
    const response = await fetch(`${this.baseUrl}/orgs/${orgId}/search/text`, {
      method: 'POST',
      headers: {
        ...(await this.getOptionalAuthHeaders(getAccessToken)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

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
    orgId: string,
    request: SearchImageRequest,
    getAccessToken?: AccessTokenProvider
  ): Promise<SearchResponse> {
    const formData = new FormData();
    formData.append('image', request.image);
    if (request.topK) formData.append('topK', request.topK.toString());
    if (request.minScore)
      formData.append('minScore', request.minScore.toString());

    const response = await fetch(`${this.baseUrl}/orgs/${orgId}/search/image`, {
      method: 'POST',
      headers: await this.getOptionalAuthHeaders(getAccessToken),
      body: formData,
    });

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
    orgId: string,
    request: {
      colors: string[];
      matchMode?: 'any' | 'all';
      threshold?: number;
      limit?: number;
    },
    getAccessToken?: AccessTokenProvider
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
    const response = await fetch(`${this.baseUrl}/orgs/${orgId}/search/color`, {
      method: 'POST',
      headers: {
        ...(await this.getOptionalAuthHeaders(getAccessToken)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        colors: request.colors,
        matchMode: request.matchMode || 'any',
        threshold: request.threshold || 15,
        limit: request.limit || 20,
      }),
    });

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
   * Create a new org
   */
  async createOrg(input: CreateOrgInput): Promise<Org & { api_key: string }> {
    const response = await fetch(`${this.baseUrl}/orgs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    const data: ApiResponse<Org & { api_key: string }> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to create org');
    }

    return data.data;
  }

  /** @deprecated Use createOrg. */
  async createGallery(
    input: CreateOrgInput
  ): Promise<Gallery & { api_key: string }> {
    return this.createOrg(input);
  }

  /**
   * Get org by ID
   */
  async getOrg(orgId: string): Promise<Org> {
    const resolvedOrgId = resolveOrgIdentifier(orgId);
    const orgPath = UUID_PATTERN.test(resolvedOrgId)
      ? `/orgs/${resolvedOrgId}`
      : `/orgs/slug/${resolvedOrgId}`;
    const response = await fetch(`${this.baseUrl}${orgPath}`);
    const data: ApiResponse<Org> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch org');
    }

    return data.data;
  }

  /** @deprecated Use getOrg. */
  async getGallery(galleryId: string): Promise<Gallery> {
    return this.getOrg(galleryId);
  }

  /**
   * List all orgs
   */
  async listOrgs(): Promise<Org[]> {
    const response = await fetch(`${this.baseUrl}/orgs`);
    const data: ApiResponse<Org[]> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch orgs');
    }

    return data.data;
  }

  /** @deprecated Use listOrgs. */
  async listGalleries(): Promise<Gallery[]> {
    return this.listOrgs();
  }

  /**
   * Get artwork by ID
   */
  async getArtwork(orgId: string, artworkId: string): Promise<Artwork> {
    const response = await fetch(
      `${this.baseUrl}/orgs/${orgId}/artworks/${artworkId}`
    );
    const data: ApiResponse<Artwork> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch artwork');
    }

    return normalizeArtwork(data.data);
  }

  /**
   * List artworks for an org
   */
  async listArtworks(
    orgId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ artworks: Artwork[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    params.append('org_id', orgId);

    const url = `${this.baseUrl}/orgs/${orgId}/artworks${
      params.toString() ? `?${params}` : ''
    }`;
    const response = await fetch(url);
    const data: ApiResponse<{ artworks: Artwork[]; total: number }> & {
      pagination?: { total?: number };
    } = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch artworks');
    }

    const payload = data.data as
      | { artworks?: Artwork[]; total?: number }
      | Artwork[];
    const artworks = Array.isArray(payload) ? payload : payload.artworks || [];

    return {
      artworks: artworks.map(normalizeArtwork),
      total:
        (Array.isArray(payload) ? undefined : payload.total) ??
        data.pagination?.total ??
        artworks.length,
    };
  }

  /**
   * Upload CSV file with metadata
   */
  async uploadMetadata(
    orgId: string,
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
    formData.append('org_id', orgId);

    const response = await fetch(`${this.baseUrl}/metadata/upload`, {
      method: 'POST',
      body: formData,
    });

    const data = (await response.json()) as ApiResponse<any>;

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

    const data = (await response.json()) as ApiResponse<any>;

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
    org_id: string;
    gallery_id?: string;
    status: string;
    total_items: number;
    processed_items: number;
    failed_items: number;
    error_log: any;
    created_at: string;
    updated_at: string;
  }> {
    const response = await fetch(`${this.baseUrl}/metadata/jobs/${jobId}`);
    const data = (await response.json()) as ApiResponse<any>;

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch job');
    }

    return data.data;
  }

  /**
   * List upload jobs for org
   */
  async listUploadJobs(orgId: string): Promise<{
    jobs: Array<{
      id: string;
      org_id: string;
      gallery_id?: string;
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
      `${this.baseUrl}/metadata/jobs?org_id=${orgId}`
    );
    const data = (await response.json()) as ApiResponse<any>;

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
    orgId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{
    embeddings: Array<{
      id: string;
      title: string;
      artist: string | null;
      year: number | null;
      medium: string | null;
      imageUrl: string | null;
      thumbnailUrl: string | null;
      embedding: number[];
    }>;
    total: number;
    dimensions: number;
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    const url = `${this.baseUrl}/orgs/${orgId}/embeddings${
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
        imageUrl: string | null;
        thumbnailUrl: string | null;
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
  async getTranslationUsage(
    getAccessToken: AccessTokenProvider
  ): Promise<TranslationUsageSummary> {
    const response = await fetch(`${this.baseUrl}/translate/usage`, {
      headers: await this.getAuthHeaders(getAccessToken),
    });

    const data: ApiResponse<TranslationUsageSummary> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(
        data.error?.message || 'Failed to fetch translation usage'
      );
    }

    return data.data;
  }

  async getExtractUsage(
    getAccessToken: AccessTokenProvider
  ): Promise<ExtractUsageSummary> {
    const response = await fetch(`${this.baseUrl}/extract/usage`, {
      headers: await this.getAuthHeaders(getAccessToken),
    });

    const data: ApiResponse<ExtractUsageSummary> = await response.json();

    if (!data.success || !data.data) {
      throw new Error(data.error?.message || 'Failed to fetch extract usage');
    }

    return data.data;
  }

  async translateText(
    request: TranslateTextRequest,
    getAccessToken: AccessTokenProvider
  ): Promise<TranslateTextResponse> {
    const response = await fetch(`${this.baseUrl}/translate/text`, {
      method: 'POST',
      headers: {
        ...(await this.getAuthHeaders(getAccessToken)),
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
   * Batch process frame removal for org artworks
   */
  async batchProcessFrames(
    orgId: string,
    options?: { artworkIds?: string[]; forceReprocess?: boolean }
  ): Promise<{
    orgId: string;
    galleryId?: string;
    totalQueued: number;
    skipped: number;
    message: string;
  }> {
    const response = await fetch(
      `${this.baseUrl}/orgs/${orgId}/artworks/batch-process-frames`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      }
    );

    const data: ApiResponse<{
      orgId: string;
      galleryId?: string;
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
      throw new Error(
        data.error?.message || 'Failed to fetch processing status'
      );
    }

    return data.data;
  }

  /**
   * Get processing statistics for an org
   */
  async getProcessingStats(orgId: string): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    hasProcessedImage: number;
    avgConfidence: number | null;
  }> {
    const response = await fetch(
      `${this.baseUrl}/orgs/${orgId}/processing-stats`
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
      throw new Error(
        data.error?.message || 'Failed to fetch processing stats'
      );
    }

    return data.data;
  }
}

// Use mock API client during E2E tests
import { MockApiClient } from './mock-api';

// Check if we're in E2E test mode
const isE2ETest =
  typeof process !== 'undefined' &&
  (process.env.E2E_TEST_MODE === 'true' ||
    process.env.PLAYWRIGHT_TEST_MODE === 'true');

export const apiClient = isE2ETest ? new MockApiClient() : new ApiClient();

export const getApiClientForRequest = (request: Request) =>
  isE2ETest
    ? new MockApiClient()
    : new ApiClient(
        `${getApiUrlForHostname(new URL(request.url).hostname)}/api/v1`
      );
