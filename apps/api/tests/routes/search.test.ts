import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../../src/routes/search';
import type { Env } from '../../src/index';

const ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';

type DailyUsage = {
  used: number;
  quota: number;
};

type UsageEvent = {
  id: string;
  user_id: string;
  api_key_id: string | null;
  usage_date: string;
  method: string;
  path: string;
  route: string | undefined;
  query_type: string | null;
  org_id: string | null;
  collection_id: string | null;
  auth_kind: string | null;
  ip_address: string | null;
  user_agent: string | null;
  country: string | null;
  cf_ray: string | null;
  metadata: string | null;
};

type ArtworkEvent = {
  id: string;
  usage_event_id: string;
  artwork_id: string;
  org_id: string | null;
  rank: number | null;
  score: number | null;
};

const artworkRow = {
  id: '1993-01678',
  org_id: ORG_ID,
  title: 'Mangrove Tree',
  artist: 'Chen Chong Swee',
  year: null,
  date_text: 'undated',
  medium: 'Watercolour on paper',
  classification: 'Paintings',
  culture: 'Singapore',
  origin: 'Singapore',
  dimensions_height: 49,
  dimensions_width: 39,
  dimensions_depth: null,
  dimensions_unit: 'cm',
  description: 'A mangrove tree by the shore.',
  provenance: null,
  credit_line: 'Gift of the artist family',
  rights: 'Collection of National Gallery Singapore',
  accession_number: '1993-01678',
  source_url: 'https://www.nationalgallery.sg/example',
  source_institution: 'National Gallery Singapore',
  source_collection: 'National Collection',
  source_record_id: '1993-01678',
  field_sources: JSON.stringify({
    title: 'ngs',
    medium: 'ngs',
    roots_listing_url: 'roots',
  }),
  dominant_colors: JSON.stringify(['#3a5f3c', '#d8c7a3']),
  color_palette: JSON.stringify({
    colors: ['#3a5f3c', '#d8c7a3'],
    percentages: [0.55, 0.45],
  }),
  citation: JSON.stringify({
    format: 'mla',
    text: 'Chen Chong Swee. "Mangrove Tree." National Gallery Singapore.',
  }),
  image_url: 'https://r2.example.com/artworks/1993-01678.jpg',
  thumbnail_url: 'https://r2.example.com/artworks/1993-01678-thumb.jpg',
  custom_metadata: JSON.stringify({
    dimensions_text: '49 x 39 cm',
    roots_listing_url:
      'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
    generated_caption: {
      text: 'Generated caption text for Mangrove Tree.',
      model: 'mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit',
      prompt_version: 'cap-v1',
      generated_at: '2026-05-21T19:47:36.884Z',
    },
  }),
  match_score: 100,
};

const usageKey = (
  principalType: string,
  principalId: string,
  usageDate: string
) => `${principalType}:${principalId}:${usageDate}`;

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeSearchDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  run() {
    return this.db.run(this.sql, this.params);
  }

  first<T>() {
    return this.db.first<T>(this.sql, this.params);
  }

  all<T>() {
    return this.db.all<T>(this.sql, this.params);
  }
}

class FakeSearchDb {
  daily = new Map<string, DailyUsage>();
  usageEvents: UsageEvent[] = [];
  artworkEvents: ArtworkEvent[] = [];
  metadataSearchSql: string[] = [];
  apiKeyRow: {
    id: string;
    user_id: string;
    email: string;
    name: string;
  } | null = null;

  constructor(private readonly rows = [artworkRow]) {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO api_usage_daily')) {
      const [principalType, principalId, usageDate, quota] = params as [
        string,
        string,
        string,
        number,
      ];
      const key = usageKey(principalType, principalId, usageDate);
      const current = this.daily.get(key) ?? { used: 0, quota };
      current.quota = quota;
      this.daily.set(key, current);
      return { success: true, meta: { changes: 1 } };
    }

    if (
      sql.includes('UPDATE api_usage_daily') &&
      sql.includes('used = used +')
    ) {
      const [cost, principalType, principalId, usageDate] = params as [
        number,
        string,
        string,
        string,
        number,
      ];
      const key = usageKey(principalType, principalId, usageDate);
      const current = this.daily.get(key);

      if (!current || current.used + cost > current.quota) {
        return { success: true, meta: { changes: 0 } };
      }

      current.used += cost;
      this.daily.set(key, current);
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('UPDATE api_usage_daily') && sql.includes('used = CASE')) {
      const [cost, , principalType, principalId, usageDate] = params as [
        number,
        number,
        string,
        string,
        string,
      ];
      const key = usageKey(principalType, principalId, usageDate);
      const current = this.daily.get(key);

      if (current) {
        current.used = Math.max(current.used - cost, 0);
      }

      return { success: true, meta: { changes: current ? 1 : 0 } };
    }

    if (sql.includes('INSERT INTO api_usage_events')) {
      const [
        id,
        user_id,
        api_key_id,
        usage_date,
        method,
        path,
        route,
        query_type,
        org_id,
        collection_id,
        auth_kind,
        ip_address,
        user_agent,
        ,
        ,
        ,
        ,
        ,
        country,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        cf_ray,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        metadata,
      ] = params as Array<string | null | undefined>;

      this.usageEvents.push({
        id: id as string,
        user_id: user_id as string,
        api_key_id: api_key_id ?? null,
        usage_date: usage_date as string,
        method: method as string,
        path: path as string,
        route,
        query_type: query_type ?? null,
        org_id: org_id ?? null,
        collection_id: collection_id ?? null,
        auth_kind: auth_kind ?? null,
        ip_address: ip_address ?? null,
        user_agent: user_agent ?? null,
        country: country ?? null,
        cf_ray: cf_ray ?? null,
        metadata: metadata ?? null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('INSERT INTO artwork_usage_events')) {
      const [id, usageEventId, artworkId, orgId, rank, score] = params as [
        string,
        string,
        string,
        string | null,
        number | null,
        number | null,
      ];
      this.artworkEvents.push({
        id,
        usage_event_id: usageEventId,
        artwork_id: artworkId,
        org_id: orgId,
        rank,
        score,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('DELETE FROM artwork_usage_events')) {
      const [usageEventId] = params as [string];
      this.artworkEvents = this.artworkEvents.filter(
        (event) => event.usage_event_id !== usageEventId
      );
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('DELETE FROM api_usage_events')) {
      const [id] = params as [string];
      this.usageEvents = this.usageEvents.filter((event) => event.id !== id);
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('UPDATE api_keys SET last_used_at')) {
      return { success: true, meta: { changes: this.apiKeyRow ? 1 : 0 } };
    }

    return { success: true, meta: { changes: 1 } };
  }

  async first<T>(sql: string, params: unknown[]) {
    if (sql.includes('FROM api_keys ak')) {
      return this.apiKeyRow as T | null;
    }

    if (sql.includes('FROM api_usage_daily')) {
      const [principalType, principalId, usageDate] = params as [
        string,
        string,
        string,
      ];
      return (this.daily.get(usageKey(principalType, principalId, usageDate)) ??
        null) as T | null;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]) {
    const applySearchVisibility = (rows: typeof this.rows) => {
      if (!sql.includes('source_url IS NOT NULL')) {
        return rows;
      }

      return rows.filter(
        (row) =>
          row.source_url?.trim() &&
          row.accession_number?.trim() &&
          row.title?.trim()
      );
    };

    if (sql.includes('FROM artworks') && sql.includes('AS match_score')) {
      this.metadataSearchSql.push(sql);
      return {
        success: true,
        results: applySearchVisibility(this.rows),
      } as { success: boolean; results: T[] };
    }

    if (sql.includes('FROM artworks') && sql.includes('WHERE id IN')) {
      const ids = new Set(params as string[]);
      return {
        success: true,
        results: applySearchVisibility(
          this.rows.filter((row) => ids.has(row.id))
        ),
      } as { success: boolean; results: T[] };
    }

    return { success: true, results: [] as T[] };
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/orgs/:orgId', searchRoutes);
  return app;
};

const makeEnv = (db: FakeSearchDb, quota = 100): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    VECTORIZE: undefined as unknown as Vectorize,
    CACHE: {} as KVNamespace,
    AI: { run: vi.fn() } as unknown as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    DAILY_FREE_QUERY_LIMIT: String(quota),
  }) as Env;

const textSearch = (
  app: Hono<{ Bindings: Env }>,
  env: Env,
  headers: HeadersInit = { 'X-User-Id': 'user-1' },
  body: Record<string, unknown> = { query: 'pineapple', topK: 1 }
) =>
  app.request(
    `/api/v1/orgs/${ORG_ID}/search/text`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'vitest-search/1.0',
        'CF-Connecting-IP': '203.0.113.42',
        'CF-IPCountry': 'SG',
        'CF-Ray': 'test-ray',
        ...headers,
      },
      body: JSON.stringify(body),
    },
    env
  );

describe('Search API auth and quota behavior', () => {
  let app: Hono<{ Bindings: Env }>;
  let db: FakeSearchDb;
  let env: Env;

  beforeEach(() => {
    app = makeApp();
    db = new FakeSearchDb();
    env = makeEnv(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 401 for unauthenticated text search', async () => {
    const res = await textSearch(app, env, {});
    const body = (await res.json()) as any;

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(db.daily.size).toBe(0);
    expect(db.usageEvents).toHaveLength(0);
  });

  it('returns results, rate limit headers, and one usage record for a registered user', async () => {
    const res = await textSearch(app, env);
    const body = (await res.json()) as any;
    const today = new Date().toISOString().slice(0, 10);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
    expect(body.success).toBe(true);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({
      id: '1993-01678',
      title: 'Mangrove Tree',
      artist: 'Chen Chong Swee',
      metadata: {
        medium: 'Watercolour on paper',
        sourceInstitution: 'National Gallery Singapore',
        accessionNumber: '1993-01678',
        generated_caption: {
          text: 'Generated caption text for Mangrove Tree.',
        },
      },
    });

    expect(db.daily.get(usageKey('user', 'user-1', today))).toEqual({
      used: 1,
      quota: 100,
    });
    expect(db.usageEvents).toHaveLength(1);
    expect(db.usageEvents[0]).toMatchObject({
      method: 'POST',
      path: `/api/v1/orgs/${ORG_ID}/search/text`,
      query_type: 'vector_search',
      org_id: ORG_ID,
      auth_kind: 'user',
      ip_address: '203.0.113.42',
      country: 'SG',
      cf_ray: 'test-ray',
    });
    expect(JSON.parse(db.usageEvents[0].metadata || '{}')).toHaveProperty('cf');
    expect(db.artworkEvents).toHaveLength(1);
    expect(db.artworkEvents[0]).toMatchObject({
      artwork_id: '1993-01678',
      org_id: ORG_ID,
      rank: 1,
    });
  });

  it('keeps source-backed records searchable even when no image asset is available', async () => {
    db = new FakeSearchDb([
      {
        ...artworkRow,
        id: '1991-00255',
        title: 'Running Script Calligraphy',
        accession_number: '1991-00255',
        source_record_id: '1991-00255',
        image_url: null,
        thumbnail_url: null,
        match_score: 100,
      },
    ]);
    env = makeEnv(db);

    const res = await textSearch(app, env);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({
      id: '1991-00255',
      title: 'Running Script Calligraphy',
      imageUrl: null,
      thumbnailUrl: null,
      metadata: {
        accessionNumber: '1991-00255',
        sourceUrl: 'https://www.nationalgallery.sg/example',
      },
    });
  });

  it('returns Roots caption provenance instead of stripping it from NGS search results', async () => {
    db = new FakeSearchDb([
      {
        ...artworkRow,
        description: 'Roots catalogue caption text.',
        field_sources: JSON.stringify({
          ...JSON.parse(artworkRow.field_sources),
          description: 'roots',
        }),
        custom_metadata: JSON.stringify({
          roots_listing_url:
            'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
          source_records: {
            roots: {
              pageid: '1029142',
              caption: 'Roots catalogue caption text.',
            },
            roots_listing_url:
              'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
          },
          source_provenance: {
            description: {
              source: 'roots',
              ref: 'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
            },
          },
          generated_caption: {
            text: 'Generated caption text for Mangrove Tree.',
            sources: [
              'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
            ],
          },
        }),
      },
    ]);
    env = makeEnv(db);

    const res = await textSearch(app, env);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0]).toMatchObject({
      metadata: {
        description: 'Roots catalogue caption text.',
        field_sources: {
          description: 'roots',
        },
        roots_listing_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
        source_records: {
          roots: {
            caption: 'Roots catalogue caption text.',
          },
        },
        generated_caption: {
          sources: [
            'https://www.roots.gov.sg/Collection-Landing/listing/1029142',
          ],
        },
      },
    });
  });

  it('filters caption vector search by the resolved org id', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: artworkRow.id, score: 0.9, metadata: {} }],
      }),
    };
    env = {
      ...env,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      CAPTION_VECTOR_SEARCH_ENABLED: 'true',
      SEARCH_FUSION_MODE: 'hybrid',
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'mangrove tree by the shore',
        topK: 1,
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].id).toBe(artworkRow.id);
    expect(captionVectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { galleryId: ORG_ID },
      })
    );
  });

  it('uses generated caption embeddings by default and exposes them as a search source', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [
          {
            id: artworkRow.id,
            score: 0.91,
            metadata: {
              model: 'jina-embeddings-v5-text-small',
              embeddingVersion: 'v2',
            },
          },
        ],
      }),
    };
    env = {
      ...env,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'quiet shore',
        topK: 1,
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(captionVectorize.query).toHaveBeenCalled();
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        channel: 'generated_caption_embedding',
        source: 'custom_metadata.generated_caption.text',
        label: 'Generated caption embedding',
        score: 0.91,
        model: 'jina-embeddings-v5-text-small',
        embeddingVersion: 'v2',
      })
    );
  });

  it('does not use NGS payload descriptions as the metadata caption-search source', async () => {
    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'mangrove shore',
        topK: 1,
      }
    );

    expect(res.status).toBe(200);
    expect(db.metadataSearchSql[0]).toContain(
      "json_extract(field_sources, '$.description')"
    );
    expect(db.metadataSearchSql[0]).toContain("ELSE ''");
  });

  it('excludes NGS rows that cannot link back to a public NGS or Roots source', async () => {
    db = new FakeSearchDb([
      {
        ...artworkRow,
        id: '1991-00227-001',
        title: 'Complexity and Simplicity, 89',
        accession_number: '1991-00227-001',
        source_record_id: '1991-00227-001',
        source_url: null,
        match_score: 100,
      },
    ]);
    env = makeEnv(db);

    const res = await textSearch(app, env);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(0);
    expect(db.artworkEvents).toHaveLength(0);
  });

  it('tracks API key users against principal_type=api_key', async () => {
    db.apiKeyRow = {
      id: 'key-1',
      user_id: 'user-from-key',
      email: 'api@example.com',
      name: 'API User',
    };

    const res = await textSearch(app, env, { 'X-API-Key': 'plt_stg_test' });
    const body = (await res.json()) as any;
    const today = new Date().toISOString().slice(0, 10);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(db.daily.get(usageKey('api_key', 'key-1', today))).toEqual({
      used: 1,
      quota: 100,
    });
    expect(db.usageEvents[0]).toMatchObject({
      user_id: 'user-from-key',
      api_key_id: 'key-1',
      auth_kind: 'api_key',
    });
  });

  it('lets the public search proxy key bypass user quota in production', async () => {
    env = {
      ...env,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const res = await textSearch(app, env, {
      'X-API-Key': 'public-search-secret',
    });
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(body.success).toBe(true);
    expect(body.data.results).toHaveLength(1);
    expect(db.daily.size).toBe(0);
    expect(db.usageEvents).toHaveLength(0);
    expect(db.artworkEvents).toHaveLength(0);
  });

  it('does not consume quota or keep usage events for invalid requests', async () => {
    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: '' }
    );
    const today = new Date().toISOString().slice(0, 10);

    expect(res.status).toBe(400);
    expect(db.daily.get(usageKey('user', 'user-1', today))).toEqual({
      used: 0,
      quota: 100,
    });
    expect(db.usageEvents).toHaveLength(0);
    expect(db.artworkEvents).toHaveLength(0);
  });

  it('returns 429 DAILY_QUOTA_EXCEEDED on the 101st query in the same UTC day', async () => {
    for (let i = 0; i < 100; i += 1) {
      const res = await textSearch(app, env);
      expect(res.status).toBe(200);
    }

    const res = await textSearch(app, env);
    const body = (await res.json()) as any;
    const today = new Date().toISOString().slice(0, 10);

    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(body.error.code).toBe('DAILY_QUOTA_EXCEEDED');
    expect(body.error.details).toEqual({ used: 100, quota: 100 });
    expect(db.daily.get(usageKey('user', 'user-1', today))?.used).toBe(100);
    expect(db.usageEvents).toHaveLength(100);
  });

  it('keeps concurrent 110 requests capped at the atomic daily quota', async () => {
    const requests = Array.from({ length: 110 }, () => textSearch(app, env));
    const responses = await Promise.all(requests);
    const statusCounts = responses.reduce<Record<number, number>>(
      (counts, response) => {
        counts[response.status] = (counts[response.status] || 0) + 1;
        return counts;
      },
      {}
    );
    const today = new Date().toISOString().slice(0, 10);

    expect(statusCounts[200]).toBe(100);
    expect(statusCounts[429]).toBe(10);
    expect(db.daily.get(usageKey('user', 'user-1', today))?.used).toBe(100);
    expect(db.usageEvents).toHaveLength(100);
    expect(db.artworkEvents).toHaveLength(100);
  });

  it('resets quota by UTC date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T23:59:58.000Z'));
    env = makeEnv(db, 1);

    expect((await textSearch(app, env)).status).toBe(200);
    expect((await textSearch(app, env)).status).toBe(429);

    vi.setSystemTime(new Date('2026-05-23T00:00:01.000Z'));
    expect((await textSearch(app, env)).status).toBe(200);

    expect(db.daily.get(usageKey('user', 'user-1', '2026-05-22'))).toEqual({
      used: 1,
      quota: 1,
    });
    expect(db.daily.get(usageKey('user', 'user-1', '2026-05-23'))).toEqual({
      used: 1,
      quota: 1,
    });
  });
});
