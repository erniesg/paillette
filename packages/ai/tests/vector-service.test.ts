import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorService } from '../src/vector-service';
import { VectorMetadata, VectorSearchOptions } from '../src/types';

describe('VectorService', () => {
  let mockVectorize: Vectorize;
  let vectorService: VectorService;

  beforeEach(() => {
    // Mock Cloudflare Vectorize binding
    mockVectorize = {
      upsert: vi.fn(),
      query: vi.fn(),
      getByIds: vi.fn(),
      deleteByIds: vi.fn(),
    } as unknown as Vectorize;

    vectorService = new VectorService({ vectorize: mockVectorize });
  });

  describe('upsertVector', () => {
    it('should store a single vector with metadata', async () => {
      // Arrange
      const artworkId = 'artwork-123';
      const embedding = new Array(1024).fill(0).map(() => Math.random());
      const metadata: VectorMetadata = {
        galleryId: 'gallery-1',
        artworkId,
        title: 'Starry Night',
        artist: 'Vincent van Gogh',
        year: 1889,
        createdAt: new Date().toISOString(),
      };

      vi.mocked(mockVectorize.upsert).mockResolvedValue({
        count: 1,
        ids: [artworkId],
      });

      // Act
      const result = await vectorService.upsertVector({
        id: artworkId,
        values: embedding,
        metadata,
      });

      // Assert
      expect(mockVectorize.upsert).toHaveBeenCalledWith([
        {
          id: artworkId,
          values: embedding,
          metadata,
        },
      ]);
      expect(result.success).toBe(true);
      expect(result.id).toBe(artworkId);
    });

    it('should handle upsert errors gracefully', async () => {
      // Arrange
      const artworkId = 'artwork-456';
      const embedding = new Array(1024).fill(0.5);
      const metadata: VectorMetadata = {
        galleryId: 'gallery-1',
        artworkId,
        createdAt: new Date().toISOString(),
      };

      vi.mocked(mockVectorize.upsert).mockRejectedValue(
        new Error('Vectorize service error')
      );

      // Act & Assert
      await expect(
        vectorService.upsertVector({
          id: artworkId,
          values: embedding,
          metadata,
        })
      ).rejects.toThrow('Failed to upsert vector');
    });

    it('should validate vector dimensions', async () => {
      // Arrange
      const artworkId = 'artwork-789';
      const wrongDimensionEmbedding = new Array(512).fill(0.5); // Wrong size
      const metadata: VectorMetadata = {
        galleryId: 'gallery-1',
        artworkId,
        createdAt: new Date().toISOString(),
      };

      // Act & Assert
      await expect(
        vectorService.upsertVector({
          id: artworkId,
          values: wrongDimensionEmbedding,
          metadata,
        })
      ).rejects.toThrow('Vector dimensions must be 1024');
    });
  });

  describe('upsertBatch', () => {
    it('should store multiple vectors in batch', async () => {
      // Arrange
      const vectors = [
        {
          id: 'artwork-1',
          values: new Array(1024).fill(0.1),
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-1',
            createdAt: new Date().toISOString(),
          },
        },
        {
          id: 'artwork-2',
          values: new Array(1024).fill(0.2),
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-2',
            createdAt: new Date().toISOString(),
          },
        },
        {
          id: 'artwork-3',
          values: new Array(1024).fill(0.3),
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-3',
            createdAt: new Date().toISOString(),
          },
        },
      ];

      vi.mocked(mockVectorize.upsert).mockResolvedValue({
        count: 3,
        ids: ['artwork-1', 'artwork-2', 'artwork-3'],
      });

      // Act
      const result = await vectorService.upsertBatch(vectors);

      // Assert
      expect(mockVectorize.upsert).toHaveBeenCalledWith(vectors);
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.ids).toEqual(['artwork-1', 'artwork-2', 'artwork-3']);
    });

    it('should handle empty batch', async () => {
      // Act & Assert
      await expect(vectorService.upsertBatch([])).rejects.toThrow(
        'Batch cannot be empty'
      );
    });
  });

  describe('search', () => {
    it('should find similar vectors by query embedding', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0).map(() => Math.random());
      const options: VectorSearchOptions = {
        topK: 10,
        galleryId: 'gallery-1',
      };

      const mockMatches = [
        {
          id: 'artwork-1',
          score: 0.95,
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-1',
            title: 'Starry Night',
            artist: 'Vincent van Gogh',
            year: 1889,
            createdAt: '2025-11-07T10:00:00Z',
          },
        },
        {
          id: 'artwork-2',
          score: 0.89,
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-2',
            title: 'The Scream',
            artist: 'Edvard Munch',
            year: 1893,
            createdAt: '2025-11-07T10:01:00Z',
          },
        },
      ];

      vi.mocked(mockVectorize.query).mockResolvedValue({
        matches: mockMatches,
        count: 2,
      });

      // Act
      const results = await vectorService.search(queryEmbedding, options);

      // Assert
      expect(mockVectorize.query).toHaveBeenCalledWith(queryEmbedding, {
        topK: 10,
        filter: { galleryId: 'gallery-1' },
        returnMetadata: true,
      });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('artwork-1');
      expect(results[0].score).toBe(0.95);
      expect(results[0].metadata).toBeDefined();
    });

    it('should filter by gallery ID', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.5);
      const options: VectorSearchOptions = {
        galleryId: 'gallery-ngs',
        topK: 5,
      };

      vi.mocked(mockVectorize.query).mockResolvedValue({
        matches: [],
        count: 0,
      });

      // Act
      await vectorService.search(queryEmbedding, options);

      // Assert
      expect(mockVectorize.query).toHaveBeenCalledWith(
        queryEmbedding,
        expect.objectContaining({
          filter: { galleryId: 'gallery-ngs' },
        })
      );
    });

    it('should apply minimum similarity score threshold', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.5);
      const options: VectorSearchOptions = {
        topK: 10,
        minScore: 0.8,
      };

      const mockMatches = [
        { id: 'artwork-1', score: 0.95, metadata: {} as VectorMetadata },
        { id: 'artwork-2', score: 0.85, metadata: {} as VectorMetadata },
        { id: 'artwork-3', score: 0.75, metadata: {} as VectorMetadata }, // Below threshold
        { id: 'artwork-4', score: 0.65, metadata: {} as VectorMetadata }, // Below threshold
      ];

      vi.mocked(mockVectorize.query).mockResolvedValue({
        matches: mockMatches,
        count: 4,
      });

      // Act
      const results = await vectorService.search(queryEmbedding, options);

      // Assert
      expect(results).toHaveLength(2); // Only artwork-1 and artwork-2
      expect(results.every((r) => r.score >= 0.8)).toBe(true);
    });

    it('should return empty array when no results found', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.5);

      vi.mocked(mockVectorize.query).mockResolvedValue({
        matches: [],
        count: 0,
      });

      // Act
      const results = await vectorService.search(queryEmbedding);

      // Assert
      expect(results).toEqual([]);
    });

    it('should handle vectorize search errors', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.5);
      vi.mocked(mockVectorize.query).mockRejectedValue(
        new Error('Vectorize unavailable')
      );

      // Act & Assert
      await expect(vectorService.search(queryEmbedding)).rejects.toThrow(
        'Failed to search vectors'
      );
    });

    it('should use default topK of 10 when not specified', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.5);

      vi.mocked(mockVectorize.query).mockResolvedValue({
        matches: [],
        count: 0,
      });

      // Act
      await vectorService.search(queryEmbedding);

      // Assert
      expect(mockVectorize.query).toHaveBeenCalledWith(
        queryEmbedding,
        expect.objectContaining({
          topK: 10,
        })
      );
    });

    it('should exclude metadata when includeMetadata is false', async () => {
      // Arrange
      const queryEmbedding = new Array(1024).fill(0.5);
      const options: VectorSearchOptions = {
        includeMetadata: false,
      };

      vi.mocked(mockVectorize.query).mockResolvedValue({
        matches: [
          { id: 'artwork-1', score: 0.95 },
          { id: 'artwork-2', score: 0.88 },
        ],
        count: 2,
      });

      // Act
      const results = await vectorService.search(queryEmbedding, options);

      // Assert
      expect(mockVectorize.query).toHaveBeenCalledWith(
        queryEmbedding,
        expect.objectContaining({
          returnMetadata: false,
        })
      );
      expect(results[0].metadata).toBeUndefined();
    });
  });

  describe('getByIds', () => {
    it('should retrieve vectors by IDs', async () => {
      // Arrange
      const ids = ['artwork-1', 'artwork-2'];
      const mockVectors = [
        {
          id: 'artwork-1',
          values: new Array(1024).fill(0.1),
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-1',
            createdAt: '2025-11-07T10:00:00Z',
          } as VectorMetadata,
        },
        {
          id: 'artwork-2',
          values: new Array(1024).fill(0.2),
          metadata: {
            galleryId: 'gallery-1',
            artworkId: 'artwork-2',
            createdAt: '2025-11-07T10:01:00Z',
          } as VectorMetadata,
        },
      ];

      vi.mocked(mockVectorize.getByIds).mockResolvedValue(mockVectors);

      // Act
      const results = await vectorService.getByIds(ids);

      // Assert
      expect(mockVectorize.getByIds).toHaveBeenCalledWith(ids);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('artwork-1');
    });
  });

  describe('deleteVector', () => {
    it('should delete a vector by ID', async () => {
      // Arrange
      const artworkId = 'artwork-123';
      vi.mocked(mockVectorize.deleteByIds).mockResolvedValue({
        count: 1,
        ids: [artworkId],
      });

      // Act
      const result = await vectorService.deleteVector(artworkId);

      // Assert
      expect(mockVectorize.deleteByIds).toHaveBeenCalledWith([artworkId]);
      expect(result.success).toBe(true);
      expect(result.deletedId).toBe(artworkId);
    });

    it('should handle deletion errors', async () => {
      // Arrange
      const artworkId = 'artwork-456';
      vi.mocked(mockVectorize.deleteByIds).mockRejectedValue(
        new Error('Vectorize error')
      );

      // Act & Assert
      await expect(vectorService.deleteVector(artworkId)).rejects.toThrow(
        'Failed to delete vector'
      );
    });
  });

  describe('deleteBatch', () => {
    it('should delete multiple vectors', async () => {
      // Arrange
      const ids = ['artwork-1', 'artwork-2', 'artwork-3'];
      vi.mocked(mockVectorize.deleteByIds).mockResolvedValue({
        count: 3,
        ids,
      });

      // Act
      const result = await vectorService.deleteBatch(ids);

      // Assert
      expect(mockVectorize.deleteByIds).toHaveBeenCalledWith(ids);
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
    });
  });
});
