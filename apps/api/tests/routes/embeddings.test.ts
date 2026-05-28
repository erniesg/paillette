/**
 * Tests for embeddings API endpoint
 * GET /api/v1/galleries/:id/embeddings
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../../src/index';
import type { Env } from '../../src/index';

describe('GET /api/v1/galleries/:id/embeddings', () => {
  let env: Env;

  const mockDatabase = ({
    galleryId,
    artworks = [],
    orgExists = true,
    rejectArtworkQuery = false,
  }: {
    galleryId: string;
    artworks?: Array<Record<string, unknown>>;
    orgExists?: boolean;
    rejectArtworkQuery?: boolean;
  }) => {
    (env.DB.prepare as any).mockImplementation((sql: string) => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => {
          if (sql.includes('FROM orgs')) {
            return orgExists ? { id: galleryId } : null;
          }

          if (sql.includes('COUNT(*)')) {
            return { count: artworks.length };
          }

          return null;
        }),
        all: vi.fn(async () => {
          if (rejectArtworkQuery) {
            throw new Error('Database error');
          }

          return { results: artworks };
        }),
      };

      return statement;
    });
  };

  beforeEach(() => {
    // Mock environment bindings
    env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn(),
          first: vi.fn(),
        }),
      } as any,
      VECTORIZE: {
        getByIds: vi.fn(),
        query: vi.fn(),
      } as any,
      IMAGES: {} as any,
      CACHE: {} as any,
      AI: {} as any,
      EMBEDDING_QUEUE: {} as any,
      ENVIRONMENT: 'test',
      API_VERSION: '1.0.0',
    };
  });

  it('should return embeddings for artworks in a gallery', async () => {
    const galleryId = 'test-gallery-123';
    const mockArtworks = [
      {
        id: 'artwork-1',
        gallery_id: galleryId,
        title: 'Starry Night',
        artist: 'Vincent van Gogh',
        year: 1889,
        medium: 'Oil on canvas',
        image_url: 'https://r2.example.com/artwork-1.jpg',
        thumbnail_url: 'https://r2.example.com/artwork-1-thumb.jpg',
        embedding_id: 'artwork-1',
      },
      {
        id: 'artwork-2',
        gallery_id: galleryId,
        title: 'Mona Lisa',
        artist: 'Leonardo da Vinci',
        year: 1503,
        medium: 'Oil on poplar',
        image_url: 'https://r2.example.com/artwork-2.jpg',
        thumbnail_url: 'https://r2.example.com/artwork-2-thumb.jpg',
        embedding_id: 'artwork-2',
      },
    ];

    const mockEmbeddings = [
      {
        id: 'artwork-1',
        values: new Array(1024).fill(0).map(() => Math.random()),
      },
      {
        id: 'artwork-2',
        values: new Array(1024).fill(0).map(() => Math.random()),
      },
    ];

    mockDatabase({ galleryId, artworks: mockArtworks });

    // Mock Vectorize query
    (env.VECTORIZE.getByIds as any).mockResolvedValue(mockEmbeddings);

    const request = new Request(
      `http://localhost/api/v1/galleries/${galleryId}/embeddings`
    );
    const response = await app.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.embeddings).toHaveLength(2);
    expect(data.data.embeddings[0]).toHaveProperty('id');
    expect(data.data.embeddings[0]).toHaveProperty('title');
    expect(data.data.embeddings[0]).toHaveProperty('embedding');
    expect(data.data.embeddings[0].embedding).toHaveLength(1024);
  });

  it('should filter out artworks without embeddings', async () => {
    const galleryId = 'test-gallery-123';
    const mockArtworks = [
      {
        id: 'artwork-1',
        gallery_id: galleryId,
        title: 'With Embedding',
        artist: 'Test Artist',
        embedding_id: 'artwork-1',
        image_url: 'https://r2.example.com/artwork-1.jpg',
        thumbnail_url: 'https://r2.example.com/artwork-1-thumb.jpg',
      },
      {
        id: 'artwork-2',
        gallery_id: galleryId,
        title: 'Without Embedding',
        artist: 'Test Artist',
        embedding_id: null, // No embedding
        image_url: 'https://r2.example.com/artwork-2.jpg',
        thumbnail_url: 'https://r2.example.com/artwork-2-thumb.jpg',
      },
    ];

    const mockEmbeddings = [
      {
        id: 'artwork-1',
        values: new Array(1024).fill(0).map(() => Math.random()),
      },
    ];

    mockDatabase({ galleryId, artworks: mockArtworks });

    (env.VECTORIZE.getByIds as any).mockResolvedValue(mockEmbeddings);

    const request = new Request(
      `http://localhost/api/v1/galleries/${galleryId}/embeddings`
    );
    const response = await app.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.embeddings).toHaveLength(1);
    expect(data.data.embeddings[0].id).toBe('artwork-1');
  });

  it('should support limit and offset parameters', async () => {
    const galleryId = 'test-gallery-123';

    const request = new Request(
      `http://localhost/api/v1/galleries/${galleryId}/embeddings?limit=10&offset=20`
    );

    mockDatabase({ galleryId, artworks: [] });

    (env.VECTORIZE.getByIds as any).mockResolvedValue([]);

    const response = await app.fetch(request, env);

    // Verify DB prepare was called with correct query
    const prepareCall = (env.DB.prepare as any).mock.calls.find(
      ([sql]: [string]) => sql.includes('FROM artworks')
    )?.[0];
    expect(prepareCall).toContain('LIMIT');
    expect(prepareCall).toContain('OFFSET');
  });

  it('should return 404 if gallery does not exist', async () => {
    const galleryId = 'non-existent-gallery';

    mockDatabase({ galleryId, orgExists: false });

    const request = new Request(
      `http://localhost/api/v1/galleries/${galleryId}/embeddings`
    );
    const response = await app.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('NOT_FOUND');
  });

  it('should handle errors gracefully', async () => {
    const galleryId = 'test-gallery-123';

    mockDatabase({ galleryId, rejectArtworkQuery: true });

    const request = new Request(
      `http://localhost/api/v1/galleries/${galleryId}/embeddings`
    );
    const response = await app.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('EMBEDDINGS_FETCH_ERROR');
  });

  it('should include metadata fields (artist, year, medium)', async () => {
    const galleryId = 'test-gallery-123';
    const mockArtworks = [
      {
        id: 'artwork-1',
        gallery_id: galleryId,
        title: 'Test Artwork',
        artist: 'Test Artist',
        year: 2024,
        medium: 'Digital',
        image_url: 'https://r2.example.com/artwork-1.jpg',
        thumbnail_url: 'https://r2.example.com/artwork-1-thumb.jpg',
        embedding_id: 'artwork-1',
      },
    ];

    const mockEmbeddings = [
      {
        id: 'artwork-1',
        values: new Array(1024).fill(0).map(() => Math.random()),
      },
    ];

    mockDatabase({ galleryId, artworks: mockArtworks });

    (env.VECTORIZE.getByIds as any).mockResolvedValue(mockEmbeddings);

    const request = new Request(
      `http://localhost/api/v1/galleries/${galleryId}/embeddings`
    );
    const response = await app.fetch(request, env);
    const data = await response.json();

    expect(data.data.embeddings[0]).toHaveProperty('artist', 'Test Artist');
    expect(data.data.embeddings[0]).toHaveProperty('year', 2024);
    expect(data.data.embeddings[0]).toHaveProperty('medium', 'Digital');
  });
});
