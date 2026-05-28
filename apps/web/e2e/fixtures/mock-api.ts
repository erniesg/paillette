/**
 * Mock API responses for E2E tests
 */

import type { Page, Route } from '@playwright/test';
import type {
  ApiResponse,
  Gallery,
  Artwork,
  SearchResponse,
} from '../../app/types';

// Mock gallery data
export const mockGallery: Gallery = {
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

// Mock artworks
export const mockArtworks: Artwork[] = [
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

// Mock search results
export const mockSearchResponse: SearchResponse = {
  results: mockArtworks.map((artwork) => ({
    id: artwork.id,
    galleryId: artwork.galleryId,
    title: artwork.title,
    artist: artwork.artist,
    year: artwork.year,
    imageUrl: artwork.imageUrl,
    thumbnailUrl: artwork.thumbnailUrl,
    similarity: 0.95,
    metadata: {
      medium: artwork.medium,
      dimensions: artwork.dimensions,
      dominantColors: artwork.colors?.dominant ?? undefined,
    },
  })),
  count: mockArtworks.length,
  queryTime: 100,
};

/**
 * Set up API mocking for a page
 */
export async function setupApiMocks(page: Page) {
  // Mock gallery endpoint
  await page.route('**/api/v1/galleries/*', async (route: Route) => {
    const url = route.request().url();

    // Get gallery by ID
    if (route.request().method() === 'GET' && !url.includes('/search')) {
      const response: ApiResponse<Gallery> = {
        success: true,
        data: mockGallery,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
      return;
    }

    // Color search
    if (url.includes('/search/color')) {
      const response: ApiResponse<SearchResponse> = {
        success: true,
        data: mockSearchResponse,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
      return;
    }

    // Text search
    if (url.includes('/search/text')) {
      const response: ApiResponse<SearchResponse> = {
        success: true,
        data: mockSearchResponse,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
      return;
    }

    // Image search
    if (url.includes('/search/image')) {
      const response: ApiResponse<SearchResponse> = {
        success: true,
        data: mockSearchResponse,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
      return;
    }

    // Artworks list
    if (url.includes('/artworks')) {
      const response: ApiResponse<{ artworks: Artwork[]; total: number }> = {
        success: true,
        data: {
          artworks: mockArtworks,
          total: mockArtworks.length,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
      return;
    }

    // Default: continue with actual request
    await route.continue();
  });

  // Mock health check
  await page.route('**/api/health', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', timestamp: Date.now() }),
    });
  });
}

/**
 * Setup API mocks that return errors
 */
export async function setupApiMocksWithErrors(page: Page) {
  await page.route('**/api/v1/**', async (route: Route) => {
    const response: ApiResponse<never> = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Mock API error',
      },
    };
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}
