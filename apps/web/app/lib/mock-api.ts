/**
 * Mock API client for testing
 */

import type {
  ArtworkSearchResult,
  CreateOrgInput,
  SearchResponse,
  SearchTextRequest,
  SearchImageRequest,
  Gallery,
  Artwork,
  PailletteApiKeyList,
  CreatedPailletteApiKey,
  DailyUsageSummary,
} from '../types';

// Mock data
const mockGallery: Gallery = {
  id: 'test-gallery-123',
  name: 'Test Gallery',
  slug: 'test-gallery',
  description: 'Test gallery for E2E testing',
  website: 'https://example.com',
  apiKey: 'test-api-key',
  isPublic: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockArtworks: Artwork[] = [
  {
    id: 'artwork-1',
    title: 'Test Artwork 1',
    artist: 'Test Artist',
    year: 2024,
    medium: 'Oil on canvas',
    dimensions: { width: 100, height: 100, unit: 'cm' },
    imageUrl: 'https://via.placeholder.com/400',
    thumbnailUrl: 'https://via.placeholder.com/200',
    colors: { dominant: ['#FF0000', '#00FF00', '#0000FF'] },
    galleryId: 'test-gallery-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'artwork-2',
    title: 'Test Artwork 2',
    artist: 'Test Artist 2',
    year: 2024,
    medium: 'Acrylic',
    dimensions: { width: 80, height: 80, unit: 'cm' },
    imageUrl: 'https://via.placeholder.com/400',
    thumbnailUrl: 'https://via.placeholder.com/200',
    colors: { dominant: ['#FFFF00', '#FF00FF', '#00FFFF'] },
    galleryId: 'test-gallery-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

const toSearchResult = (
  artwork: Artwork,
  similarity: number
): ArtworkSearchResult => ({
  id: artwork.id,
  galleryId: artwork.galleryId,
  orgId: artwork.orgId || artwork.org_id || artwork.galleryId,
  title: artwork.title,
  artist: artwork.artist,
  year: artwork.year,
  imageUrl: artwork.imageUrl,
  thumbnailUrl: artwork.thumbnailUrl,
  similarity,
  metadata: {
    medium: artwork.medium,
    dimensions: artwork.dimensions,
    description: artwork.description,
    dominantColors: artwork.colors?.dominant ?? undefined,
  },
});

export class MockApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000/api/v1') {
    this.baseUrl = baseUrl;
  }

  async searchText(
    _galleryId: string,
    _request: SearchTextRequest,
    _getAccessToken?: () => Promise<string | undefined>
  ): Promise<SearchResponse> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      results: mockArtworks.map((artwork) => toSearchResult(artwork, 0.95)),
      count: mockArtworks.length,
      queryTime: 100,
    };
  }

  async searchImage(
    _galleryId: string,
    _request: SearchImageRequest,
    _getAccessToken?: () => Promise<string | undefined>
  ): Promise<SearchResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      results: mockArtworks.map((artwork) => toSearchResult(artwork, 0.92)),
      count: mockArtworks.length,
      queryTime: 100,
    };
  }

  async searchColor(
    _galleryId: string,
    request: {
      colors: string[];
      matchMode?: 'any' | 'all';
      threshold?: number;
      limit?: number;
    },
    _getAccessToken?: () => Promise<string | undefined>
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
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      results: mockArtworks.map((artwork) => ({
        artworkId: artwork.id,
        title: artwork.title || 'Untitled',
        imageUrl: artwork.imageUrl || '',
        matchedColors: request.colors.map((searchColor) => ({
          searchColor,
          artworkColor: artwork.colors?.dominant?.[0] || '#000000',
          distance: 0.1,
        })),
        averageDistance: 0.1,
        dominantColors: (artwork.colors?.dominant || []).map(
          (color, index) => ({
            color,
            rgb: { r: 255, g: 0, b: 0 },
            percentage: index === 0 ? 50 : 25,
          })
        ),
      })),
      query: {
        colors: request.colors,
        matchMode: request.matchMode || 'any',
        threshold: request.threshold || 15,
        limit: request.limit || 20,
      },
      totalResults: mockArtworks.length,
      took: 15,
    };
  }

  async getGallery(galleryId: string): Promise<Gallery> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (galleryId === 'test-gallery-123') {
      return mockGallery;
    }

    throw new Error('Gallery not found');
  }

  async listGalleries(): Promise<Gallery[]> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return [mockGallery];
  }

  async createGallery(
    input: CreateOrgInput
  ): Promise<Gallery & { api_key: string }> {
    return {
      ...mockGallery,
      ...input,
      id: 'created-gallery-123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      api_key: 'test-created-api-key',
    };
  }

  async listApiKeys(
    _getAccessToken?: () => Promise<string | undefined>
  ): Promise<PailletteApiKeyList> {
    return {
      today: new Date().toISOString().slice(0, 10),
      keys: [],
    };
  }

  async createApiKey(
    _getAccessToken?: () => Promise<string | undefined>,
    name = 'Default key'
  ): Promise<CreatedPailletteApiKey> {
    return {
      id: 'mock-api-key',
      name,
      key: 'plt_stg_mock_key_only_for_tests',
      key_prefix: 'plt_stg_mock_key',
      status: 'active',
      created_at: new Date().toISOString(),
    };
  }

  async revokeApiKey(
    _getAccessToken?: () => Promise<string | undefined>,
    _keyId?: string
  ): Promise<void> {
    return undefined;
  }

  async getTodayUsage(
    _getAccessToken?: () => Promise<string | undefined>
  ): Promise<DailyUsageSummary> {
    return {
      date: new Date().toISOString().slice(0, 10),
      used: 0,
      quota: 100,
    };
  }

  async getArtwork(_galleryId: string, artworkId: string): Promise<Artwork> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    const artwork = mockArtworks.find((a) => a.id === artworkId);
    if (!artwork) {
      throw new Error('Artwork not found');
    }

    return artwork;
  }

  async listArtworks(
    _galleryId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ artworks: Artwork[]; total: number }> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    const artworks = mockArtworks.slice(offset, offset + limit);

    return {
      artworks,
      total: mockArtworks.length,
    };
  }

  // Translation methods (mock)
  async getTranslationUsage(): Promise<any> {
    return {
      used: 0,
      quota: 10,
      remaining: 10,
    };
  }

  async getExtractUsage(): Promise<any> {
    return {
      used: 0,
      quota: 10,
      remaining: 10,
    };
  }

  async translateText(request: any): Promise<any> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      translatedText: `Translated: ${request.text}`,
      provider: 'mock',
      cached: false,
      cost: 0,
      usage: {
        used: 1,
        quota: 10,
        remaining: 9,
      },
    };
  }

  async getTranslateCostEstimate(_request: any): Promise<any> {
    return {
      characterCount: 1000,
      estimatedCost: 0.05,
      breakdown: {},
    };
  }

  async translateDocument(request: any): Promise<any> {
    return {
      jobId: 'test-job-123',
      status: 'pending',
      filename: request.file?.name || 'mock-document.pdf',
    };
  }

  async getTranslationJobStatus(jobId: string): Promise<any> {
    return {
      jobId,
      status: 'completed',
      result: {
        documentUrl: 'https://example.com/translated.pdf',
      },
    };
  }

  downloadTranslatedDocument(jobId: string): string {
    return `${this.baseUrl}/translate/document/${jobId}/download`;
  }

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
    return {
      valid: true,
      stats: { totalRows: 2, validRows: 2, invalidRows: 0 },
      errors: [],
      sample: [],
      file_info: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
    };
  }

  async uploadMetadata(
    _galleryId: string,
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
    return {
      job_id: 'mock-upload-job',
      result: {
        created: [],
        updated: [],
        failed: [],
        stats: {
          total: 0,
          created: 0,
          updated: 0,
          failed: 0,
          file_name: file.name,
          file_size: file.size,
        },
      },
    };
  }

  downloadTemplate(): string {
    return `${this.baseUrl}/metadata/template`;
  }

  async getEmbeddings(
    _galleryId: string,
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
    const limit = options?.limit || mockArtworks.length;
    const offset = options?.offset || 0;
    const artworks = mockArtworks.slice(offset, offset + limit);

    return {
      embeddings: artworks.map((artwork, index) => ({
        id: artwork.id,
        title: artwork.title || 'Untitled',
        artist: artwork.artist ?? null,
        year: artwork.year ?? null,
        medium: artwork.medium ?? null,
        imageUrl: artwork.imageUrl,
        thumbnailUrl: artwork.thumbnailUrl ?? null,
        embedding: [index, index + 1],
      })),
      total: mockArtworks.length,
      dimensions: 2,
    };
  }

  async getProcessingStats(_galleryId: string): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    hasProcessedImage: number;
    avgConfidence: number | null;
  }> {
    return {
      total: mockArtworks.length,
      pending: 0,
      processing: 0,
      completed: mockArtworks.length,
      failed: 0,
      hasProcessedImage: mockArtworks.length,
      avgConfidence: 0.95,
    };
  }

  async processFrameRemoval(
    artworkId: string
  ): Promise<{ artworkId: string; status: string; message: string }> {
    return {
      artworkId,
      status: 'queued',
      message: 'Mock frame removal queued',
    };
  }

  async batchProcessFrames(
    _galleryId: string,
    _options?: { artworkIds?: string[]; forceReprocess?: boolean }
  ): Promise<{
    orgId: string;
    galleryId?: string;
    totalQueued: number;
    skipped: number;
    message: string;
  }> {
    return {
      orgId: mockGallery.id,
      galleryId: mockGallery.id,
      totalQueued: mockArtworks.length,
      skipped: 0,
      message: 'Mock batch frame removal queued',
    };
  }
}
