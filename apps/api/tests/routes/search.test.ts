import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../../src/routes/search';
import { Env } from '../../src/index';

describe('Search API', () => {
  let app: Hono<{ Bindings: Env }>;
  let mockEnv: Partial<Env>;

  beforeEach(() => {
    // Mock environment bindings
    mockEnv = {
      DB: {} as D1Database,
      IMAGES: {} as R2Bucket,
      VECTORIZE: {
        query: vi.fn(),
        upsert: vi.fn(),
        getByIds: vi.fn(),
        deleteByIds: vi.fn(),
      } as unknown as Vectorize,
      AI: {
        run: vi.fn(),
      } as unknown as Ai,
      CACHE: {} as KVNamespace,
      EMBEDDING_QUEUE: {} as Queue,
      ENVIRONMENT: 'test',
      API_VERSION: 'v1',
    };

    app = new Hono<{ Bindings: Env }>();
    app.route('/api/v1/galleries/:galleryId', searchRoutes);
  });

  describe('POST /api/v1/galleries/:galleryId/search/text', () => {
    it('should return artwork results for text query', async () => {
      // Arrange
      const galleryId = 'gallery-ngs';
      const query = 'impressionist landscape painting';

      // Mock AI embedding generation
      const mockQueryEmbedding = new Array(768).fill(0.5);
      vi.mocked(mockEnv.AI!.run).mockResolvedValue({
        data: [mockQueryEmbedding],
      });

      // Mock vector search results
      const mockVectorResults = [
        {
          id: 'artwork-1',
          score: 0.95,
          metadata: {
            galleryId,
            artworkId: 'artwork-1',
            title: 'Starry Night',
            artist: 'Vincent van Gogh',
            year: 1889,
          },
        },
        {
          id: 'artwork-2',
          score: 0.88,
          metadata: {
            galleryId,
            artworkId: 'artwork-2',
            title: 'The Scream',
            artist: 'Edvard Munch',
            year: 1893,
          },
        },
      ];
      vi.mocked(mockEnv.VECTORIZE!.query).mockResolvedValue({
        matches: mockVectorResults,
        count: 2,
      });

      // Mock database artwork details
      const mockDbResults = [
        {
          id: 'artwork-1',
          gallery_id: galleryId,
          title: 'Starry Night',
          artist: 'Vincent van Gogh',
          year: 1889,
          image_url: 'https://r2.example.com/artwork-1.jpg',
          thumbnail_url: 'https://r2.example.com/artwork-1-thumb.jpg',
        },
        {
          id: 'artwork-2',
          gallery_id: galleryId,
          title: 'The Scream',
          artist: 'Edvard Munch',
          year: 1893,
          image_url: 'https://r2.example.com/artwork-2.jpg',
          thumbnail_url: 'https://r2.example.com/artwork-2-thumb.jpg',
        },
      ];

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockDbResults }),
          }),
        }),
      };
      mockEnv.DB = mockDb as unknown as D1Database;

      // Act
      const res = await app.request(
        `/api/v1/galleries/${galleryId}/search/text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.results).toHaveLength(2);
      expect(json.data.results[0]).toMatchObject({
        id: 'artwork-1',
        title: 'Starry Night',
        artist: 'Vincent van Gogh',
        similarity: 0.95,
      });
      expect(json.data.count).toBe(2);
      expect(json.data.queryTime).toBeGreaterThan(0);
    });

    it('should return 400 for empty query', async () => {
      // Act
      const res = await app.request(
        '/api/v1/galleries/gallery-1/search/text',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '' }),
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for missing query', async () => {
      // Act
      const res = await app.request(
        '/api/v1/galleries/gallery-1/search/text',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('should handle topK parameter', async () => {
      // Arrange
      const galleryId = 'gallery-1';
      const mockEmbedding = new Array(768).fill(0.5);
      vi.mocked(mockEnv.AI!.run).mockResolvedValue({
        data: [mockEmbedding],
      });
      vi.mocked(mockEnv.VECTORIZE!.query).mockResolvedValue({
        matches: [],
        count: 0,
      });

      // Act
      await app.request(`/api/v1/galleries/${galleryId}/search/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', topK: 20 }),
      }, mockEnv as Env);

      // Assert
      expect(mockEnv.VECTORIZE!.query).toHaveBeenCalledWith(
        mockEmbedding,
        expect.objectContaining({ topK: 20 })
      );
    });

    it('should filter by minimum similarity score', async () => {
      // Arrange
      const galleryId = 'gallery-1';
      const mockEmbedding = new Array(768).fill(0.5);
      const mockResults = [
        { id: 'art-1', score: 0.9, metadata: {} },
        { id: 'art-2', score: 0.7, metadata: {} },
        { id: 'art-3', score: 0.5, metadata: {} },
      ];

      vi.mocked(mockEnv.AI!.run).mockResolvedValue({
        data: [mockEmbedding],
      });
      vi.mocked(mockEnv.VECTORIZE!.query).mockResolvedValue({
        matches: mockResults,
        count: 3,
      });
      mockEnv.DB = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        }),
      } as unknown as D1Database;

      // Act
      const res = await app.request(
        `/api/v1/galleries/${galleryId}/search/text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test', minScore: 0.75 }),
        },
        mockEnv as Env
      );

      // Assert
      const json = await res.json();
      // Should only return art-1 and art-2 (scores >= 0.75)
      expect(json.data.results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty results when no matches found', async () => {
      // Arrange
      const mockEmbedding = new Array(768).fill(0.5);
      vi.mocked(mockEnv.AI!.run).mockResolvedValue({
        data: [mockEmbedding],
      });
      vi.mocked(mockEnv.VECTORIZE!.query).mockResolvedValue({
        matches: [],
        count: 0,
      });

      // Act
      const res = await app.request(
        '/api/v1/galleries/gallery-1/search/text',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'nonexistent artwork' }),
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.results).toEqual([]);
      expect(json.data.count).toBe(0);
    });
  });

  describe('POST /api/v1/galleries/:galleryId/search/image', () => {
    it('should return similar artworks for uploaded image', async () => {
      // Arrange
      const galleryId = 'gallery-1';
      const mockImageData = new Uint8Array([1, 2, 3, 4, 5]);
      const mockEmbedding = new Array(1024).fill(0.5);

      vi.mocked(mockEnv.AI!.run).mockResolvedValue({
        data: [mockEmbedding],
      });
      vi.mocked(mockEnv.VECTORIZE!.query).mockResolvedValue({
        matches: [
          {
            id: 'artwork-1',
            score: 0.92,
            metadata: { galleryId, artworkId: 'artwork-1' },
          },
        ],
        count: 1,
      });
      mockEnv.DB = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  id: 'artwork-1',
                  gallery_id: galleryId,
                  title: 'Similar Artwork',
                  image_url: 'https://r2.example.com/artwork-1.jpg',
                },
              ],
            }),
          }),
        }),
      } as unknown as D1Database;

      // Create multipart form data
      const formData = new FormData();
      formData.append('image', new Blob([mockImageData]), 'query.jpg');

      // Act
      const res = await app.request(
        `/api/v1/galleries/${galleryId}/search/image`,
        {
          method: 'POST',
          body: formData,
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.results).toHaveLength(1);
      expect(json.data.results[0].similarity).toBe(0.92);
    });

    it('should return 400 for missing image', async () => {
      // Act
      const res = await app.request(
        '/api/v1/galleries/gallery-1/search/image',
        {
          method: 'POST',
          body: new FormData(),
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for invalid image format', async () => {
      // Arrange
      const formData = new FormData();
      formData.append('image', new Blob(['not an image']), 'test.txt');

      // Act
      const res = await app.request(
        '/api/v1/galleries/gallery-1/search/image',
        {
          method: 'POST',
          body: formData,
        },
        mockEnv as Env
      );

      // Assert
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });
});
