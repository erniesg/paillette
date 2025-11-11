import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingService } from '../src/embedding-service';
import { EMBEDDING_MODELS } from '../src/types';

describe('EmbeddingService', () => {
  let mockAi: Ai;
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    // Mock Cloudflare AI binding
    mockAi = {
      run: vi.fn(),
    } as unknown as Ai;

    embeddingService = new EmbeddingService({ ai: mockAi });
  });

  describe('generateImageEmbedding', () => {
    it('should generate embedding for image using Jina CLIP v2', async () => {
      // Arrange
      const mockImageData = new Uint8Array([1, 2, 3, 4, 5]); // Fake image data
      const mockEmbedding = new Array(1024).fill(0).map(() => Math.random());

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      const result = await embeddingService.generateImageEmbedding(
        mockImageData.buffer
      );

      // Assert
      expect(mockAi.run).toHaveBeenCalledWith(
        EMBEDDING_MODELS.IMAGE_JINA_CLIP_V2,
        {
          image: Array.from(mockImageData),
        }
      );
      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.dimensions).toBe(1024);
      expect(result.model).toBe(EMBEDDING_MODELS.IMAGE_JINA_CLIP_V2);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should handle empty image data', async () => {
      // Arrange
      const emptyImage = new Uint8Array([]).buffer;

      // Act & Assert
      await expect(
        embeddingService.generateImageEmbedding(emptyImage)
      ).rejects.toThrow('Image data cannot be empty');
    });

    it('should handle Cloudflare AI errors gracefully', async () => {
      // Arrange
      const mockImageData = new Uint8Array([1, 2, 3]).buffer;
      vi.mocked(mockAi.run).mockRejectedValue(
        new Error('Cloudflare AI service unavailable')
      );

      // Act & Assert
      await expect(
        embeddingService.generateImageEmbedding(mockImageData)
      ).rejects.toThrow('Failed to generate image embedding');
    });

    it('should measure duration accurately', async () => {
      // Arrange
      const mockImageData = new Uint8Array([1, 2, 3]).buffer;
      const mockEmbedding = new Array(1024).fill(0.5);

      vi.mocked(mockAi.run).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ data: [mockEmbedding] });
            }, 100); // Simulate 100ms processing time
          })
      );

      // Act
      const result = await embeddingService.generateImageEmbedding(
        mockImageData
      );

      // Assert
      expect(result.durationMs).toBeGreaterThanOrEqual(100);
      expect(result.durationMs).toBeLessThan(200); // Should not be too much overhead
    });
  });

  describe('generateTextEmbedding', () => {
    it('should generate embedding for text using BGE model', async () => {
      // Arrange
      const testQuery = 'impressionist landscape painting with sunset';
      const mockEmbedding = new Array(768).fill(0).map(() => Math.random());

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      const result = await embeddingService.generateTextEmbedding(testQuery);

      // Assert
      expect(mockAi.run).toHaveBeenCalledWith(EMBEDDING_MODELS.TEXT_BGE, {
        text: testQuery,
      });
      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.dimensions).toBe(768);
      expect(result.model).toBe(EMBEDDING_MODELS.TEXT_BGE);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should handle empty text input', async () => {
      // Arrange
      const emptyText = '';

      // Act & Assert
      await expect(
        embeddingService.generateTextEmbedding(emptyText)
      ).rejects.toThrow('Text query cannot be empty');
    });

    it('should handle very long text by truncating', async () => {
      // Arrange
      const longText = 'a'.repeat(10000); // 10k characters
      const mockEmbedding = new Array(768).fill(0.5);

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      const result = await embeddingService.generateTextEmbedding(longText);

      // Assert
      expect(result.embedding).toEqual(mockEmbedding);
      // Verify text was truncated to max length (typically 512 tokens ~2048 chars)
      const calledText = vi.mocked(mockAi.run).mock.calls[0][1].text;
      expect(calledText.length).toBeLessThanOrEqual(2048);
    });

    it('should normalize whitespace in queries', async () => {
      // Arrange
      const messyQuery = '  impressionist   landscape  \n\t painting  ';
      const mockEmbedding = new Array(768).fill(0.5);

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      await embeddingService.generateTextEmbedding(messyQuery);

      // Assert
      const calledText = vi.mocked(mockAi.run).mock.calls[0][1].text;
      expect(calledText).toBe('impressionist landscape painting');
    });
  });

  describe('generateBatchEmbeddings', () => {
    it('should generate embeddings for multiple images efficiently', async () => {
      // Arrange
      const images = [
        new Uint8Array([1, 2, 3]).buffer,
        new Uint8Array([4, 5, 6]).buffer,
        new Uint8Array([7, 8, 9]).buffer,
      ];
      const mockEmbedding = new Array(1024).fill(0.5);

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      const results = await embeddingService.generateBatchEmbeddings(images);

      // Assert
      expect(results).toHaveLength(3);
      expect(mockAi.run).toHaveBeenCalledTimes(3);
      results.forEach((result) => {
        expect(result.embedding).toEqual(mockEmbedding);
        expect(result.dimensions).toBe(1024);
      });
    });

    it('should handle partial failures in batch processing', async () => {
      // Arrange
      const images = [
        new Uint8Array([1, 2, 3]).buffer,
        new Uint8Array([4, 5, 6]).buffer,
      ];
      const mockEmbedding = new Array(1024).fill(0.5);

      vi.mocked(mockAi.run)
        .mockResolvedValueOnce({ data: [mockEmbedding] }) // First succeeds
        .mockRejectedValueOnce(new Error('API Error')); // Second fails

      // Act
      const results = await embeddingService.generateBatchEmbeddings(images, {
        continueOnError: true,
      });

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].embedding).toEqual(mockEmbedding);
      expect(results[1]).toBeNull(); // Failed embedding is null
    });
  });

  describe('custom model configuration', () => {
    it('should use custom image model when specified', async () => {
      // Arrange
      const customService = new EmbeddingService({
        ai: mockAi,
        imageModel: EMBEDDING_MODELS.IMAGE_CLIP,
      });
      const mockImageData = new Uint8Array([1, 2, 3]).buffer;
      const mockEmbedding = new Array(512).fill(0.5);

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      await customService.generateImageEmbedding(mockImageData);

      // Assert
      expect(mockAi.run).toHaveBeenCalledWith(EMBEDDING_MODELS.IMAGE_CLIP, {
        image: expect.any(Array),
      });
    });

    it('should use custom text model when specified', async () => {
      // Arrange
      const customService = new EmbeddingService({
        ai: mockAi,
        textModel: EMBEDDING_MODELS.TEXT_SMALL,
      });
      const mockEmbedding = new Array(384).fill(0.5);

      vi.mocked(mockAi.run).mockResolvedValue({
        data: [mockEmbedding],
      });

      // Act
      await customService.generateTextEmbedding('test query');

      // Assert
      expect(mockAi.run).toHaveBeenCalledWith(EMBEDDING_MODELS.TEXT_SMALL, {
        text: 'test query',
      });
    });
  });

  describe('error handling and logging', () => {
    it('should log errors with context', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'error');
      const mockImageData = new Uint8Array([1, 2, 3]).buffer;
      vi.mocked(mockAi.run).mockRejectedValue(new Error('AI Service Error'));

      // Act & Assert
      await expect(
        embeddingService.generateImageEmbedding(mockImageData)
      ).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate image embedding'),
        expect.any(Error)
      );
    });
  });
});
