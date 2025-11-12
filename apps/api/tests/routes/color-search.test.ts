import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { colorSearchRoutes } from '../../src/routes/color-search';
import type { Env } from '../../src/index';

describe('Color Search API', () => {
  let app: Hono;
  let mockEnv: Env;
  let testGalleryId: string;

  beforeEach(() => {
    testGalleryId = 'test-gallery-123';

    // Mock environment
    mockEnv = {
      DB: {} as D1Database,
      AI: {} as any,
      VECTORIZE_INDEX: {} as any,
      ARTWORK_IMAGES_BUCKET: {} as R2Bucket,
      EMBEDDING_QUEUE: {} as Queue,
    };

    app = new Hono<{ Bindings: Env }>();
    app.route(`/galleries/:galleryId`, colorSearchRoutes);
  });

  describe('POST /search/color', () => {
    it('should search by single color', async () => {
      const searchColor = '#FF5733'; // Orange-red

      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: [searchColor],
            threshold: 10,
            limit: 20,
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('results');
      expect(body.data).toHaveProperty('query');
      expect(Array.isArray(body.data.results)).toBe(true);
    });

    it('should search by multiple colors (ANY mode)', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF0000', '#00FF00'],
            matchMode: 'any',
            threshold: 15,
            limit: 20,
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.query.matchMode).toBe('any');
    });

    it('should search by multiple colors (ALL mode)', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF0000', '#00FF00'],
            matchMode: 'all',
            threshold: 15,
            limit: 20,
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.query.matchMode).toBe('all');
    });

    it('should return results sorted by average distance', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF5733'],
            threshold: 20,
            limit: 10,
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      if (body.data.results.length > 1) {
        for (let i = 0; i < body.data.results.length - 1; i++) {
          expect(body.data.results[i].averageDistance).toBeLessThanOrEqual(
            body.data.results[i + 1].averageDistance
          );
        }
      }
    });

    it('should reject invalid hex colors', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['invalid-color'],
            threshold: 10,
          }),
        }
      );

      expect(res.status).toBe(400);
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('should reject empty colors array', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: [],
            threshold: 10,
          }),
        }
      );

      expect(res.status).toBe(400);
      const body = await res.json();

      expect(body.success).toBe(false);
    });

    it('should limit results to requested limit', async () => {
      const limit = 5;

      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF5733'],
            threshold: 20,
            limit,
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.results.length).toBeLessThanOrEqual(limit);
    });

    it('should use default values for optional parameters', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF5733'],
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.query.matchMode).toBe('any'); // default
      expect(body.data.query.threshold).toBe(10); // default
      expect(body.data.query.limit).toBe(20); // default
    });

    it('should include matched colors in results', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF5733'],
            threshold: 15,
          }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      if (body.data.results.length > 0) {
        const result = body.data.results[0];
        expect(result).toHaveProperty('matchedColors');
        expect(Array.isArray(result.matchedColors)).toBe(true);

        if (result.matchedColors.length > 0) {
          expect(result.matchedColors[0]).toHaveProperty('searchColor');
          expect(result.matchedColors[0]).toHaveProperty('artworkColor');
          expect(result.matchedColors[0]).toHaveProperty('distance');
        }
      }
    });

    it('should reject threshold above 30', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF5733'],
            threshold: 35, // Too high
          }),
        }
      );

      expect(res.status).toBe(400);
    });

    it('should reject more than 5 colors', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colors: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'],
            threshold: 10,
          }),
        }
      );

      expect(res.status).toBe(400);
    });
  });

  describe('GET /artworks/:artworkId/colors', () => {
    it('should return color palette for an artwork', async () => {
      const artworkId = 'test-artwork-123';

      const res = await app.request(
        `/galleries/${testGalleryId}/artworks/${artworkId}/colors`,
        {
          method: 'GET',
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('dominantColors');
      expect(Array.isArray(body.data.dominantColors)).toBe(true);
    });

    it('should return 404 for non-existent artwork', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/artworks/nonexistent/colors`,
        {
          method: 'GET',
        }
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /artworks/:artworkId/extract-colors', () => {
    it('should trigger color extraction for an artwork', async () => {
      const artworkId = 'test-artwork-123';

      const res = await app.request(
        `/galleries/${testGalleryId}/artworks/${artworkId}/extract-colors`,
        {
          method: 'POST',
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('artworkId', artworkId);
    });
  });

  describe('POST /artworks/batch-extract-colors', () => {
    it('should trigger batch color extraction', async () => {
      const res = await app.request(
        `/galleries/${testGalleryId}/artworks/batch-extract-colors`,
        {
          method: 'POST',
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('queued');
      expect(typeof body.data.queued).toBe('number');
    });
  });
});
