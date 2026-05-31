import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { colorSearchRoutes } from '../../src/routes/color-search';
import type { Env } from '../../src/index';

describe('Color Search API', () => {
  let app: Hono<{ Bindings: Env }>;
  let mockEnv: Env;
  let testGalleryId: string;
  const ngsOrgId = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
  const authHeaders = {
    'Content-Type': 'application/json',
    'X-User-Id': 'public-search-web',
  };

  const request = (path: string, init?: RequestInit) =>
    app.request(path, init, mockEnv);

  beforeEach(() => {
    testGalleryId = 'test-gallery-123';
    const artwork = {
      id: 'test-artwork-123',
      title: 'Test Artwork',
      artist: 'Test Artist',
      image_url: 'https://r2.example.com/artwork.jpg',
      dominant_colors: JSON.stringify([
        { color: '#FF5733', rgb: { r: 255, g: 87, b: 51 }, percentage: 70 },
        { color: '#333333', rgb: { r: 51, g: 51, b: 51 }, percentage: 30 },
      ]),
      color_palette: null,
      color_extracted_at: '2026-05-27T00:00:00.000Z',
    };

    // Mock environment
    mockEnv = {
      DB: {
        prepare: vi.fn((sql: string) => {
          let params: unknown[] = [];
          const statement = {
            bind: (...values: unknown[]) => {
              params = values;
              return statement;
            },
            all: vi.fn(async () => {
              if (sql.includes('dominant_colors IS NOT NULL')) {
                return { success: true, results: [artwork] };
              }

              if (sql.includes('dominant_colors IS NULL')) {
                return {
                  success: true,
                  results: [{ id: 'needs-colors', image_url: artwork.image_url }],
                };
              }

              return { success: true, results: [] };
            }),
            first: vi.fn(async () => {
              if (sql.includes('FROM orgs')) {
                return { id: testGalleryId };
              }

              if (params[0] === 'nonexistent') {
                return null;
              }

              return artwork;
            }),
            run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
          };
          return statement;
        }),
        batch: vi.fn(async () => []),
      } as unknown as D1Database,
      AI: {} as any,
      VECTORIZE: {} as any,
      IMAGES: {} as R2Bucket,
      CACHE: {} as KVNamespace,
      EMBEDDING_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
      ENVIRONMENT: 'test',
      API_VERSION: 'v1',
      DAILY_FREE_QUERY_LIMIT: '100',
    };

    app = new Hono<{ Bindings: Env }>();
    app.route(`/galleries/:galleryId`, colorSearchRoutes);
  });

  describe('POST /search/color', () => {
    it('should search by single color', async () => {
      const searchColor = '#FF5733'; // Orange-red

      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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

    it('applies the NGS public artwork filter to color search', async () => {
      testGalleryId = ngsOrgId;

      const res = await request('/galleries/ngs/search/color', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF5733'],
          threshold: 10,
        }),
      });

      expect(res.status).toBe(200);
      const colorSql = (mockEnv.DB.prepare as any).mock.calls
        .map(([sql]: [string]) => sql)
        .find((sql: string) => sql.includes('dominant_colors IS NOT NULL'));

      expect(colorSql).toContain(
        "source_url LIKE 'https://www.roots.gov.sg/%'"
      );
      expect(colorSql).toContain("UPPER(accession_number) LIKE '%-(AB)'");
      expect(colorSql).toContain(
        "source_institution = 'National Gallery Singapore'"
      );
    });

    it('should search by multiple colors (ANY mode)', async () => {
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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

      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            colors: ['#FF5733'],
            threshold: 35, // Too high
          }),
        }
      );

      expect(res.status).toBe(400);
    });

    it('should reject more than 5 colors', async () => {
      const res = await request(
        `/galleries/${testGalleryId}/search/color`,
        {
          method: 'POST',
          headers: authHeaders,
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

      const res = await request(
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
      const res = await request(
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

      const res = await request(
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
      const res = await request(
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
