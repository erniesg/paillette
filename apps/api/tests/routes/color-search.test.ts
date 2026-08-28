import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { colorSearchRoutes } from '../../src/routes/color-search';
import { searchRoutes } from '../../src/routes/search';
import type { Env } from '../../src/index';
import {
  createMcpInternalCapability,
  MCP_INTERNAL_CAPABILITY_HEADER,
  type AuthPrincipal,
} from '../../src/middleware/auth';

describe('Color Search API', () => {
  let app: Hono<{ Bindings: Env }>;
  let mockEnv: Env;
  let testGalleryId: string;
  let ngsQuota: { used: number; hard_limit: number };
  let usageEventInserts: number;
  let dailyQuotaChargeUpdates: number;
  let failUsageEventUpdates: boolean;
  let failUsageEventInserts: boolean;
  let failColorSearchMessage: string | null;
  let mutationAuthorizedUserIds: Set<string>;
  const ngsOrgId = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
  const authHeaders = {
    'Content-Type': 'application/json',
    'X-User-Id': 'test-user',
  };

  const request = (path: string, init?: RequestInit) =>
    app.request(path, init, mockEnv);

  beforeEach(() => {
    testGalleryId = 'test-gallery-123';
    ngsQuota = { used: 0, hard_limit: 1000 };
    usageEventInserts = 0;
    dailyQuotaChargeUpdates = 0;
    failUsageEventUpdates = false;
    failUsageEventInserts = false;
    failColorSearchMessage = null;
    mutationAuthorizedUserIds = new Set(['test-user']);
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
            sql,
            bind: (...values: unknown[]) => {
              params = values;
              return statement;
            },
            all: vi.fn(async () => {
              if (sql.includes('dominant_colors IS NOT NULL')) {
                if (failColorSearchMessage) {
                  throw new Error(failColorSearchMessage);
                }
                return { success: true, results: [artwork] };
              }

              if (sql.includes('dominant_colors IS NULL')) {
                return {
                  success: true,
                  results: [
                    { id: 'needs-colors', image_url: artwork.image_url },
                  ],
                };
              }

              return { success: true, results: [] };
            }),
            first: vi.fn(async () => {
              if (sql.includes('nga_public_search_quota')) {
                if (sql.includes('UPDATE nga_public_search_quota')) {
                  if (ngsQuota.used >= ngsQuota.hard_limit) return null;
                  ngsQuota.used += 1;
                }
                return ngsQuota;
              }
              if (sql.includes('SELECT 1 AS allowed')) {
                return mutationAuthorizedUserIds.has(params[0] as string)
                  ? { allowed: 1 }
                  : null;
              }
              if (sql.includes('FROM orgs')) {
                return { id: testGalleryId };
              }

              if (params[0] === 'nonexistent') {
                return null;
              }

              return artwork;
            }),
            run: vi.fn(async () => {
              if (sql.includes('UPDATE nga_public_search_quota')) {
                if (ngsQuota.used >= ngsQuota.hard_limit) {
                  return { success: true, meta: { changes: 0 }, results: [] };
                }
                ngsQuota.used += 1;
                return {
                  success: true,
                  meta: { changes: 1 },
                  results: [ngsQuota],
                };
              }
              if (
                sql.includes('UPDATE api_usage_daily') &&
                sql.includes('used = used + ?')
              ) {
                dailyQuotaChargeUpdates += 1;
              }
              if (sql.includes('INSERT INTO api_usage_events')) {
                if (failUsageEventInserts) {
                  throw new Error('usage telemetry unavailable');
                }
                usageEventInserts += 1;
              }
              if (
                sql.includes('UPDATE api_usage_events SET metadata') &&
                failUsageEventUpdates
              ) {
                throw new Error('usage telemetry update unavailable');
              }
              return { success: true, meta: { changes: 1 } };
            }),
          };
          return statement;
        }),
        batch: vi.fn(async (statements: Array<any>) => {
          const quotaBefore = { ...ngsQuota };
          const usageBefore = usageEventInserts;
          let previousChanges = 0;
          try {
            const results = [];
            for (const statement of statements) {
              if (
                statement.sql.includes('INSERT INTO api_usage_events') &&
                statement.sql.includes('WHERE changes() = 1') &&
                previousChanges !== 1
              ) {
                results.push({ success: true, meta: { changes: 0 }, results: [] });
                continue;
              }
              const result = await statement.run();
              previousChanges = result.meta.changes;
              results.push(result);
            }
            return results;
          } catch (error) {
            ngsQuota = quotaBefore;
            usageEventInserts = usageBefore;
            throw error;
          }
        }),
      } as unknown as D1Database,
      AI: {} as any,
      VECTORIZE: {} as any,
      IMAGES: {} as R2Bucket,
      CACHE: {} as KVNamespace,
      EMBEDDING_QUEUE: {
        send: vi.fn(async () => undefined),
      } as unknown as Queue,
      ENVIRONMENT: 'test',
      API_VERSION: 'v1',
      DAILY_FREE_QUERY_LIMIT: '100',
      API_KEY_PEPPER: 'test-only-mcp-capability-key',
      MCP_INTERNAL_CAPABILITY_SECRET: 'test-only-mcp-capability-key',
    };

    app = new Hono<{ Bindings: Env }>();
    app.route(`/galleries/:galleryId`, colorSearchRoutes);
  });

  describe('POST /search/color', () => {
    it('does not disclose an internal color-search failure through the public NGA route', async () => {
      testGalleryId = 'open-access-art';
      failColorSearchMessage = 'INTERNAL_COLOR_SEARCH_SENTINEL';

      const res = await request('/galleries/nga/search/color', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ colors: ['#FF5733'] }),
      });
      const payload = await res.text();

      expect(res.status).toBe(500);
      expect(payload).not.toContain('INTERNAL_COLOR_SEARCH_SENTINEL');
      expect(JSON.parse(payload)).toMatchObject({
        error: {
          code: 'PUBLIC_SEARCH_UNAVAILABLE',
          message: 'Public search is temporarily unavailable',
        },
      });
    });

    it('charges an NGS color search once when mounted with the generic search router', async () => {
      const integratedApp = new Hono<{ Bindings: Env }>();
      integratedApp.route('/galleries/:galleryId', searchRoutes);
      integratedApp.route('/galleries/:galleryId', colorSearchRoutes);

      const res = await integratedApp.request('/galleries/ngs/search/color', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ colors: ['#FF5733'] }),
      }, mockEnv);

      expect(res.status).toBe(200);
      expect(dailyQuotaChargeUpdates).toBe(1);
      expect(usageEventInserts).toBe(1);
    });

    it('logs an accepted NGA color search from the public search principal', async () => {
      testGalleryId = 'open-access-art';
      const integratedApp = new Hono<{ Bindings: Env }>();
      integratedApp.route('/galleries/:galleryId', searchRoutes);
      integratedApp.route('/galleries/:galleryId', colorSearchRoutes);

      const res = await integratedApp.request('/galleries/nga/search/color', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'public-search-web',
        },
        body: JSON.stringify({ colors: ['#FF5733'] }),
      }, mockEnv);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get('X-NGA-Search-Remaining')).toBe('999');
      expect(ngsQuota.used).toBe(1);
      expect(dailyQuotaChargeUpdates).toBe(0);
      expect(usageEventInserts).toBe(1);
      expect(
        (mockEnv.DB.prepare as any).mock.calls.some(([sql]: [string]) =>
          sql.includes('api_usage_daily')
        )
      ).toBe(false);
      expect(body.data.quota).toEqual({
        limit: 1000,
        used: 1,
        remaining: 999,
      });
    });

    it('fails closed without a quota debit when NGA usage logging fails', async () => {
      testGalleryId = 'open-access-art';
      failUsageEventInserts = true;
      const integratedApp = new Hono<{ Bindings: Env }>();
      integratedApp.route('/galleries/:galleryId', searchRoutes);
      integratedApp.route('/galleries/:galleryId', colorSearchRoutes);

      const res = await integratedApp.request('/galleries/nga/search/color', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ colors: ['#FF5733'] }),
      }, mockEnv);

      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe(
        'NGA_PUBLIC_SEARCH_QUOTA_UNAVAILABLE'
      );
      expect(ngsQuota.used).toBe(0);
      expect(usageEventInserts).toBe(0);
      expect(
        (mockEnv.DB.prepare as any).mock.calls.some(([sql]: [string]) =>
          sql.includes('dominant_colors IS NOT NULL')
        )
      ).toBe(false);
    });

    it('should search by single color', async () => {
      const searchColor = '#FF5733'; // Orange-red

      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: [searchColor],
          threshold: 10,
          limit: 20,
        }),
      });

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

    it('charges and provider-scopes an NGA color search through the open alias', async () => {
      testGalleryId = 'open-access-art';
      const res = await request('/galleries/open/search/color', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ colors: ['#FF5733'], threshold: 10 }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get('X-NGA-Search-Remaining')).toBe('999');
      expect(ngsQuota.used).toBe(1);
      expect(body.success).toBe(true);
      const colorSql = (mockEnv.DB.prepare as any).mock.calls
        .map(([sql]: [string]) => sql)
        .find((sql: string) => sql.includes('dominant_colors IS NOT NULL'));
      expect(colorSql).toContain(
        "json_extract(custom_metadata, '$.provider') = ?"
      );
      expect(
        (mockEnv.DB.prepare as any).mock.calls.some(([sql]: [string]) =>
          sql.includes('api_usage_daily')
        )
      ).toBe(false);
    });

    it('keeps an admitted NGA color search successful when telemetry annotation fails', async () => {
      testGalleryId = 'open-access-art';
      failUsageEventUpdates = true;
      const res = await request('/galleries/nga/search/color', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ colors: ['#FF5733'], threshold: 10 }),
      });

      expect(res.status).toBe(200);
      expect(ngsQuota.used).toBe(1);
      expect(usageEventInserts).toBe(1);
    });

    it('scopes the NGA color route to NGA provider rows', async () => {
      testGalleryId = 'open-access-art';

      const res = await request('/galleries/nga/search/color', {
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
        "json_extract(custom_metadata, '$.provider') = ?"
      );
    });

    it('should search by multiple colors (ANY mode)', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF0000', '#00FF00'],
          matchMode: 'any',
          threshold: 15,
          limit: 20,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.query.matchMode).toBe('any');
    });

    it('should search by multiple colors (ALL mode)', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF0000', '#00FF00'],
          matchMode: 'all',
          threshold: 15,
          limit: 20,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.query.matchMode).toBe('all');
    });

    it('should return results sorted by average distance', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF5733'],
          threshold: 20,
          limit: 10,
        }),
      });

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
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['invalid-color'],
          threshold: 10,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('should reject empty colors array', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: [],
          threshold: 10,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();

      expect(body.success).toBe(false);
    });

    it('should limit results to requested limit', async () => {
      const limit = 5;

      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF5733'],
          threshold: 20,
          limit,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.results.length).toBeLessThanOrEqual(limit);
    });

    it('should use default values for optional parameters', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF5733'],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.query.matchMode).toBe('any'); // default
      expect(body.data.query.threshold).toBe(10); // default
      expect(body.data.query.limit).toBe(20); // default
    });

    it('should include matched colors in results', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF5733'],
          threshold: 15,
        }),
      });

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
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: ['#FF5733'],
          threshold: 35, // Too high
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject more than 5 colors', async () => {
      const res = await request(`/galleries/${testGalleryId}/search/color`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          colors: [
            '#FF0000',
            '#00FF00',
            '#0000FF',
            '#FFFF00',
            '#FF00FF',
            '#00FFFF',
          ],
          threshold: 10,
        }),
      });

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
          headers: authHeaders,
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('artworkId', artworkId);
    });

    it.each([
      ['viewer', { 'X-User-Id': 'viewer' }],
      ['public search key', { 'X-User-Id': 'public-search-web' }],
      [
        'forged internal MCP capability',
        {
          'X-User-Id': 'viewer',
          [MCP_INTERNAL_CAPABILITY_HEADER]: 'v1.forged.invalid',
        },
      ],
    ])('denies %s before reading artwork or enqueueing', async (_name, headers) => {
      const res = await request(
        `/galleries/${testGalleryId}/artworks/test-artwork-123/extract-colors`,
        { method: 'POST', headers }
      );

      expect(res.status).toBe(403);
      expect(mockEnv.EMBEDDING_QUEUE.send).not.toHaveBeenCalled();
      expect(
        (mockEnv.DB.prepare as any).mock.calls.some(([sql]: [string]) =>
          sql.includes('FROM artworks')
        )
      ).toBe(false);
    });

    it('denies a signed internal MCP handoff without an organisation role', async () => {
      const capability = await createMcpInternalCapability(
        mockEnv,
        {
          kind: 'user',
          userId: 'mcp-viewer',
          scopes: ['mcp:read'],
        } satisfies AuthPrincipal,
        'POST',
        `/galleries/${testGalleryId}/artworks/test-artwork-123/extract-colors`
      );

      const res = await request(
        `/galleries/${testGalleryId}/artworks/test-artwork-123/extract-colors`,
        {
          method: 'POST',
          headers: { [MCP_INTERNAL_CAPABILITY_HEADER]: capability },
        }
      );

      expect(res.status).toBe(403);
      expect(mockEnv.EMBEDDING_QUEUE.send).not.toHaveBeenCalled();
      expect(
        (mockEnv.DB.prepare as any).mock.calls.some(([sql]: [string]) =>
          sql.includes('FROM artworks')
        )
      ).toBe(false);
    });

    it('requires a global admin to extract NGA colors', async () => {
      testGalleryId = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';
      mutationAuthorizedUserIds = new Set(['global-admin']);

      const curator = await request(
        '/galleries/nga/artworks/test-artwork-123/extract-colors',
        { method: 'POST', headers: { 'X-User-Id': 'curator' } }
      );
      expect(curator.status).toBe(403);
      expect(mockEnv.EMBEDDING_QUEUE.send).not.toHaveBeenCalled();

      const globalAdmin = await request(
        '/galleries/nga/artworks/test-artwork-123/extract-colors',
        { method: 'POST', headers: { 'X-User-Id': 'global-admin' } }
      );
      expect(globalAdmin.status).toBe(200);
      expect(mockEnv.EMBEDDING_QUEUE.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /artworks/batch-extract-colors', () => {
    it('denies a viewer before reading artworks or enqueueing', async () => {
      const res = await request(
        `/galleries/${testGalleryId}/artworks/batch-extract-colors`,
        { method: 'POST', headers: { 'X-User-Id': 'viewer' } }
      );

      expect(res.status).toBe(403);
      expect(mockEnv.EMBEDDING_QUEUE.send).not.toHaveBeenCalled();
      expect(
        (mockEnv.DB.prepare as any).mock.calls.some(([sql]: [string]) =>
          sql.includes('FROM artworks')
        )
      ).toBe(false);
    });

    it('should trigger batch color extraction', async () => {
      const res = await request(
        `/galleries/${testGalleryId}/artworks/batch-extract-colors`,
        {
          method: 'POST',
          headers: authHeaders,
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
