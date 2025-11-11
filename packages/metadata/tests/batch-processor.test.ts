/**
 * Batch Metadata Processor Tests
 * Tests batch creation and update operations for artwork metadata
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BatchMetadataProcessor } from '../src/batch-processor';
import type { ArtworkRow } from '../src/types';

// Mock D1 database
class MockD1Database {
  private artworks: Map<string, any> = new Map();
  private preparedStatements: Map<string, any> = new Map();

  prepare(query: string) {
    const statement = {
      query,
      params: [] as any[],
      bind: (...params: any[]) => {
        statement.params = params;
        return statement;
      },
      first: async () => {
        // Handle SELECT queries
        if (query.includes('SELECT') && query.includes('WHERE id = ?')) {
          const id = statement.params[0];
          return this.artworks.get(id) || null;
        }
        if (query.includes('SELECT') && query.includes('WHERE image_hash = ?')) {
          const hash = statement.params[0];
          const galleryId = statement.params[1];
          for (const artwork of this.artworks.values()) {
            if (artwork.image_hash === hash && artwork.gallery_id === galleryId) {
              return artwork;
            }
          }
          return null;
        }
        if (query.includes('SELECT') && query.includes('WHERE original_filename = ?')) {
          const filename = statement.params[0];
          const galleryId = statement.params[1];
          for (const artwork of this.artworks.values()) {
            if (artwork.original_filename === filename && artwork.gallery_id === galleryId) {
              return { id: artwork.id };
            }
          }
          return null;
        }
        return null;
      },
      all: async () => {
        // Handle SELECT queries
        if (query.includes('SELECT') && query.includes('WHERE gallery_id = ?')) {
          const galleryId = statement.params[0];
          const results = Array.from(this.artworks.values()).filter(
            (a) => a.gallery_id === galleryId
          );
          return { results };
        }
        return { results: [] };
      },
      run: async () => {
        // Handle INSERT queries
        if (query.includes('INSERT INTO artworks')) {
          const artwork = {
            id: statement.params[0],
            gallery_id: statement.params[1],
            collection_id: statement.params[2],
            image_url: statement.params[3],
            thumbnail_url: statement.params[4],
            original_filename: statement.params[5],
            image_hash: statement.params[6],
            embedding_id: statement.params[7],
            title: statement.params[8],
            artist: statement.params[9],
            year: statement.params[10],
            medium: statement.params[11],
            dimensions_height: statement.params[12],
            dimensions_width: statement.params[13],
            dimensions_depth: statement.params[14],
            dimensions_unit: statement.params[15],
            description: statement.params[16],
            provenance: statement.params[17],
            translations: statement.params[18],
            dominant_colors: statement.params[19],
            color_palette: statement.params[20],
            custom_metadata: statement.params[21],
            citation: statement.params[22],
            created_at: statement.params[23],
            updated_at: statement.params[24],
            uploaded_by: statement.params[25],
          };
          this.artworks.set(artwork.id, artwork);
          return { success: true };
        }
        // Handle UPDATE queries
        if (query.includes('UPDATE artworks')) {
          // Extract id from params (last param in UPDATE ... WHERE id = ?)
          const id = statement.params[statement.params.length - 1];
          const existing = this.artworks.get(id);
          if (existing) {
            // Simple update simulation - in real impl, would parse SET clause
            const updated = { ...existing, updated_at: new Date().toISOString() };
            // Parse the update fields from params
            // For simplicity, just update title if it's a simple update
            if (statement.params.length === 2) {
              updated.title = statement.params[0];
            }
            this.artworks.set(id, updated);
            return { success: true };
          }
          return { success: false };
        }
        return { success: true };
      },
    };
    return statement;
  }

  // Helper to seed test data
  seed(id: string, data: any) {
    this.artworks.set(id, { id, ...data });
  }

  // Helper to get all artworks
  getAll() {
    return Array.from(this.artworks.values());
  }

  // Helper to clear all data
  clear() {
    this.artworks.clear();
  }
}

describe('BatchMetadataProcessor', () => {
  let mockDb: MockD1Database;
  let processor: BatchMetadataProcessor;
  const testGalleryId = 'test-gallery-123';
  const testUserId = 'test-user-456';

  beforeEach(() => {
    mockDb = new MockD1Database();
    processor = new BatchMetadataProcessor(mockDb as any);
  });

  describe('processBatch - Create Operations', () => {
    it('should create new artworks from CSV rows without artwork_id', async () => {
      const csvRows: ArtworkRow[] = [
        {
          title: 'Starry Night',
          artist: 'Vincent van Gogh',
          year: 1889,
          medium: 'Oil on canvas',
          dimensions_height: 73.7,
          dimensions_width: 92.1,
          dimensions_unit: 'cm',
          description: 'A famous painting',
        },
        {
          title: 'The Scream',
          artist: 'Edvard Munch',
          year: 1893,
          medium: 'Oil, tempera, pastel',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.created).toBe(2);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.failed).toBe(0);
      expect(result.created).toHaveLength(2);
      expect(result.created[0].title).toBe('Starry Night');
      expect(result.created[1].title).toBe('The Scream');

      // Verify artworks were created in DB
      const allArtworks = mockDb.getAll();
      expect(allArtworks).toHaveLength(2);
    });

    it('should handle empty CSV rows gracefully', async () => {
      const result = await processor.processBatch([], testGalleryId, testUserId);

      expect(result.stats.created).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.failed).toBe(0);
      expect(result.created).toHaveLength(0);
    });

    it('should assign placeholder image URLs for metadata-only uploads', async () => {
      const csvRows: ArtworkRow[] = [
        {
          title: 'Metadata Only Artwork',
          artist: 'Test Artist',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.created).toBe(1);
      expect(result.created[0].title).toBe('Metadata Only Artwork');

      // Verify placeholder URLs were assigned
      const artwork = mockDb.getAll()[0];
      expect(artwork.image_url).toContain('placeholder');
      expect(artwork.thumbnail_url).toContain('placeholder');
    });
  });

  describe('processBatch - Update Operations', () => {
    it('should update existing artworks when artwork_id is provided', async () => {
      // Seed existing artwork
      const existingId = 'artwork-123';
      mockDb.seed(existingId, {
        gallery_id: testGalleryId,
        title: 'Original Title',
        artist: 'Original Artist',
        year: 2000,
        image_url: 'https://example.com/image.jpg',
        thumbnail_url: 'https://example.com/thumb.jpg',
        original_filename: 'image.jpg',
        image_hash: 'hash123',
        embedding_id: null,
        translations: '{}',
        custom_metadata: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        uploaded_by: testUserId,
      });

      const csvRows: ArtworkRow[] = [
        {
          artwork_id: existingId,
          title: 'Updated Title',
          artist: 'Updated Artist',
          year: 2024,
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.created).toBe(0);
      expect(result.stats.updated).toBe(1);
      expect(result.stats.failed).toBe(0);
      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].id).toBe(existingId);
      expect(result.updated[0].title).toBe('Updated Title');
    });

    it('should fail update when artwork_id does not exist', async () => {
      const csvRows: ArtworkRow[] = [
        {
          artwork_id: 'non-existent-id',
          title: 'This Should Fail',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.created).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.failed).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('not found');
    });
  });

  describe('processBatch - Mixed Operations', () => {
    it('should handle mixed create and update operations in same batch', async () => {
      // Seed existing artwork
      const existingId = 'artwork-existing';
      mockDb.seed(existingId, {
        gallery_id: testGalleryId,
        title: 'Existing Artwork',
        artist: 'Existing Artist',
        image_url: 'https://example.com/existing.jpg',
        thumbnail_url: 'https://example.com/existing-thumb.jpg',
        original_filename: 'existing.jpg',
        image_hash: 'hash-existing',
        embedding_id: null,
        translations: '{}',
        custom_metadata: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        uploaded_by: testUserId,
      });

      const csvRows: ArtworkRow[] = [
        {
          artwork_id: existingId,
          title: 'Updated Existing',
          year: 2024,
        },
        {
          title: 'New Artwork 1',
          artist: 'New Artist',
        },
        {
          title: 'New Artwork 2',
          artist: 'Another Artist',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.created).toBe(2);
      expect(result.stats.updated).toBe(1);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.total).toBe(3);
    });
  });

  describe('processBatch - Error Handling', () => {
    it('should continue processing after individual row failures', async () => {
      const csvRows: ArtworkRow[] = [
        {
          title: 'Valid Artwork 1',
        },
        {
          artwork_id: 'non-existent',
          title: 'This will fail',
        },
        {
          title: 'Valid Artwork 2',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.created).toBe(2);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.failed).toBe(1);
      expect(result.created).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
    });

    it('should collect error details for failed rows', async () => {
      const csvRows: ArtworkRow[] = [
        {
          artwork_id: 'bad-id-1',
          title: 'Fail 1',
        },
        {
          artwork_id: 'bad-id-2',
          title: 'Fail 2',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      expect(result.stats.failed).toBe(2);
      expect(result.failed).toHaveLength(2);
      result.failed.forEach((failure) => {
        expect(failure.row).toBeGreaterThan(0);
        expect(failure.error).toBeDefined();
        expect(typeof failure.error).toBe('string');
      });
    });
  });

  describe('processBatch - Image Filename Matching', () => {
    it('should match artworks by image_filename for updates without artwork_id', async () => {
      // Seed existing artwork with known filename
      const existingId = 'artwork-with-file';
      mockDb.seed(existingId, {
        gallery_id: testGalleryId,
        title: 'Original Title',
        artist: 'Original Artist',
        image_url: 'https://example.com/starry-night.jpg',
        thumbnail_url: 'https://example.com/starry-night-thumb.jpg',
        original_filename: 'starry-night.jpg',
        image_hash: 'hash-starry',
        embedding_id: null,
        translations: '{}',
        custom_metadata: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        uploaded_by: testUserId,
      });

      const csvRows: ArtworkRow[] = [
        {
          title: 'Updated Title via Filename',
          artist: 'Updated Artist',
          image_filename: 'starry-night.jpg',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      // Should update existing artwork by matching filename
      expect(result.stats.created).toBe(0);
      expect(result.stats.updated).toBe(1);
      expect(result.updated[0].id).toBe(existingId);
      expect(result.updated[0].title).toBe('Updated Title via Filename');
    });

    it('should create new artwork when image_filename does not match', async () => {
      const csvRows: ArtworkRow[] = [
        {
          title: 'New Artwork',
          image_filename: 'non-existent-file.jpg',
        },
      ];

      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );

      // Should create new artwork since filename doesn't match
      expect(result.stats.created).toBe(1);
      expect(result.stats.updated).toBe(0);
    });
  });

  describe('Performance', () => {
    it('should process 1000 rows in reasonable time', async () => {
      const csvRows: ArtworkRow[] = Array.from({ length: 1000 }, (_, i) => ({
        title: `Artwork ${i + 1}`,
        artist: `Artist ${i % 100}`,
        year: 1900 + (i % 123),
      }));

      const startTime = Date.now();
      const result = await processor.processBatch(
        csvRows,
        testGalleryId,
        testUserId
      );
      const elapsed = Date.now() - startTime;

      expect(result.stats.created).toBe(1000);
      expect(result.stats.failed).toBe(0);

      // Should complete in less than 10 seconds
      expect(elapsed).toBeLessThan(10000);

      console.log(`Processed 1000 rows in ${elapsed}ms`);
    });
  });
});
