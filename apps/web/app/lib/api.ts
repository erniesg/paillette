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
}

export const apiClient = new ApiClient();
