/**
 * Mock API client for testing
 */

import type {
  ApiResponse,
  SearchResponse,
  SearchTextRequest,
  SearchImageRequest,
  Gallery,
  Artwork,
} from '../types';

// Mock data
const mockGallery: Gallery = {
  id: 'test-gallery-123',
  name: 'Test Gallery',
  description: 'Test gallery for E2E testing',
  location: 'Singapore',
  artworkCount: 100,
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
    dimensions: '100x100cm',
    imageUrl: 'https://via.placeholder.com/400',
    thumbnailUrl: 'https://via.placeholder.com/200',
    dominantColors: ['#FF0000', '#00FF00', '#0000FF'],
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
    dimensions: '80x80cm',
    imageUrl: 'https://via.placeholder.com/400',
    thumbnailUrl: 'https://via.placeholder.com/200',
    dominantColors: ['#FFFF00', '#FF00FF', '#00FFFF'],
    galleryId: 'test-gallery-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

export class MockApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000/api/v1') {
    this.baseUrl = baseUrl;
  }

  async searchText(
    galleryId: string,
    request: SearchTextRequest
  ): Promise<SearchResponse> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      results: mockArtworks.map((artwork) => ({
        artwork,
        score: 0.95,
      })),
      total: mockArtworks.length,
      query: request.query,
    };
  }

  async searchImage(
    galleryId: string,
    request: SearchImageRequest
  ): Promise<SearchResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      results: mockArtworks.map((artwork) => ({
        artwork,
        score: 0.92,
      })),
      total: mockArtworks.length,
      query: 'image search',
    };
  }

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
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      results: mockArtworks.map((artwork) => ({
        artworkId: artwork.id,
        title: artwork.title,
        imageUrl: artwork.imageUrl || '',
        matchedColors: request.colors.map((searchColor) => ({
          searchColor,
          artworkColor: artwork.dominantColors?.[0] || '#000000',
          distance: 0.1,
        })),
        averageDistance: 0.1,
        dominantColors: (artwork.dominantColors || []).map((color, index) => ({
          color,
          rgb: { r: 255, g: 0, b: 0 },
          percentage: index === 0 ? 50 : 25,
        })),
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

  async getArtwork(galleryId: string, artworkId: string): Promise<Artwork> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    const artwork = mockArtworks.find((a) => a.id === artworkId);
    if (!artwork) {
      throw new Error('Artwork not found');
    }

    return artwork;
  }

  async listArtworks(
    galleryId: string,
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
  async translateText(request: any): Promise<any> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      success: true,
      data: {
        translations: request.texts.map((text: string) => ({
          sourceText: text,
          translatedText: `Translated: ${text}`,
          sourceLang: 'en',
          targetLang: request.target,
        })),
      },
    };
  }

  async getTranslateCostEstimate(request: any): Promise<any> {
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
}
