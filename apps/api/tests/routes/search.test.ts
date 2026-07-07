import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../../src/routes/search';
import { isHiddenNgsPublicAccession } from '../../src/utils/ngs-public-filter';
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

const makeArtworkRow = (overrides: Partial<typeof artworkRow>) => ({
  ...artworkRow,
  ...overrides,
});

const usageKey = (
  principalType: string,
  principalId: string,
  usageDate: string
) => `${principalType}:${principalId}:${usageDate}`;

const normalizeArtistForTest = (value: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

    if (sql.includes('UPDATE api_usage_events SET metadata')) {
      const [metadata, id] = params as [string, string];
      const event = this.usageEvents.find((usageEvent) => usageEvent.id === id);
      if (event) {
        event.metadata = metadata;
      }
      return { success: true, meta: { changes: event ? 1 : 0 } };
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
          row.title?.trim() &&
          !isHiddenNgsPublicAccession(row.accession_number, row.source_url)
      );
    };

    if (sql.includes('FROM artworks') && sql.includes('AS match_score')) {
      this.metadataSearchSql.push(sql);
      if (
        sql.includes('AND artist IS NOT NULL') &&
        sql.includes('ORDER BY match_score DESC, artist')
      ) {
        const normalizedQuery = String(params[0] || '');
        const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
        const matchingRows = this.rows.filter((row) => {
          const normalizedArtist = normalizeArtistForTest(row.artist);
          return (
            normalizedArtist === normalizedQuery ||
            tokens.every((token) =>
              ` ${normalizedArtist} `.includes(` ${token} `)
            )
          );
        });

        return {
          success: true,
          results: applySearchVisibility(matchingRows).map((row, index) => ({
            ...row,
            match_score:
              normalizeArtistForTest(row.artist) === normalizedQuery
                ? 120
                : 100 - index,
          })),
        } as unknown as { success: boolean; results: T[] };
      }

      return {
        success: true,
        results: applySearchVisibility(this.rows),
      } as { success: boolean; results: T[] };
    }

    if (
      sql.includes('FROM artworks') &&
      sql.includes('SELECT id') &&
      sql.includes('artist IS NOT NULL')
    ) {
      const normalizedQuery = String(params[params.length - 1] || '');
      return {
        success: true,
        results: applySearchVisibility(
          this.rows.filter(
            (row) => normalizeArtistForTest(row.artist) === normalizedQuery
          )
        ).map((row) => ({ id: row.id })),
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
    SEARCH_FUSION_MODE: 'metadata',
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
    const usageMetadata = JSON.parse(db.usageEvents[0].metadata || '{}');
    expect(usageMetadata).toHaveProperty('cf');
    expect(usageMetadata.search).toMatchObject({
      mode: 'text',
      query: 'pineapple',
      topK: 1,
      minScore: 0.7,
      resultCount: 1,
    });
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

  it('keeps validated NGS rows searchable when their public source URL is Roots', async () => {
    db = new FakeSearchDb([
      {
        ...artworkRow,
        id: '2013-00170',
        title: 'Charity Ride',
        accession_number: '2013-00170',
        source_record_id: '2013-00170',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1271927',
        match_score: 100,
      },
    ]);
    env = makeEnv(db);

    const res = await textSearch(app, env);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({
      id: '2013-00170',
      title: 'Charity Ride',
      metadata: {
        sourceInstitution: 'National Gallery Singapore',
        sourceCollection: 'National Collection',
        sourceUrl:
          'https://www.roots.gov.sg/Collection-Landing/listing/1271927',
      },
    });
    expect(db.metadataSearchSql[0]).toContain(
      "source_institution = 'National Gallery Singapore'"
    );
    expect(db.metadataSearchSql[0]).not.toContain(
      "source_url LIKE 'https://www.nationalgallery.sg/%'"
    );
  });

  it('excludes museum rows that only link to Roots', async () => {
    db = new FakeSearchDb([
      {
        ...artworkRow,
        id: 'AB1999-00041',
        title: 'Angkor Wat, 1965',
        artist: 'Latiff Mohidin',
        accession_number: 'AB1999-00041',
        source_record_id: 'AB1999-00041',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1103589',
        match_score: 100,
      },
      {
        ...artworkRow,
        id: 'HP-0126',
        title: 'Balek Kampong',
        artist: 'Lim Cheng Hoe',
        accession_number: 'HP-0126',
        source_record_id: 'HP-0126',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1129656',
        match_score: 100,
      },
      {
        ...artworkRow,
        id: 'GI-0286-(AB)',
        title: 'Singapore River',
        artist: 'Lim Cheng Hoe',
        accession_number: 'GI-0286-(AB)',
        source_record_id: 'GI-0286-(AB)',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1030183',
        match_score: 100,
      },
      {
        ...artworkRow,
        id: '2013-00591',
        title: 'Istana Art Collection Work',
        artist: 'Unknown',
        accession_number: '2013-00591',
        source_record_id: '2013-00591',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1284239',
        match_score: 100,
      },
    ]);
    env = makeEnv(db);

    const res = await textSearch(app, env);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(0);
    expect(db.metadataSearchSql[0]).toContain(
      "UPPER(accession_number) LIKE 'AB%'"
    );
    expect(db.metadataSearchSql[0]).toContain(
      "UPPER(accession_number) LIKE 'HP-%'"
    );
    expect(db.metadataSearchSql[0]).toContain(
      "UPPER(accession_number) LIKE '%-(AB)'"
    );
    expect(db.metadataSearchSql[0]).toContain("'2013-00591'");
    expect(db.metadataSearchSql[0]).toContain(
      "source_url LIKE 'https://www.roots.gov.sg/%'"
    );
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

  it('keeps bare keywords semantic in hybrid search instead of exact metadata routing', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [
          {
            id: artworkRow.id,
            score: 0.88,
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
        query: 'rabbit',
        topK: 10,
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(1);
    expect(captionVectorize.query).toHaveBeenCalled();
    expect(db.metadataSearchSql).toHaveLength(0);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        channel: 'generated_caption_embedding',
        source: 'custom_metadata.generated_caption.text',
      })
    );
  });

  it('routes explicit artist facets through the artist field without vector search', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: artworkRow.id, score: 0.88, metadata: {} }],
      }),
    };
    env = {
      ...env,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
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
        query: 'Chen Chong Swee',
        topK: 10,
        facet: 'artist',
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({
      id: artworkRow.id,
      artist: 'Chen Chong Swee',
    });
    expect(captionVectorize.query).not.toHaveBeenCalled();
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.metadataSearchSql[0]).toContain('artist IS NOT NULL');
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        channel: 'metadata',
        label: 'Artist',
        source: 'artworks.artist',
      })
    );
    const usageMetadata = JSON.parse(db.usageEvents[0].metadata || '{}');
    expect(usageMetadata.search).toMatchObject({
      query: 'Chen Chong Swee',
      facet: 'artist',
      resultCount: 1,
    });
  });

  it('uses the defined artist list to detect exact typed artist names', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: artworkRow.id, score: 0.88, metadata: {} }],
      }),
    };
    env = {
      ...env,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
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
        query: 'Chen Chong Swee',
        topK: 10,
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0]).toMatchObject({
      id: artworkRow.id,
      artist: 'Chen Chong Swee',
    });
    expect(captionVectorize.query).not.toHaveBeenCalled();
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        label: 'Artist',
        source: 'artworks.artist',
      })
    );
    const usageMetadata = JSON.parse(db.usageEvents[0].metadata || '{}');
    expect(usageMetadata.search).toMatchObject({
      query: 'Chen Chong Swee',
      facet: 'artist',
    });
  });

  it('prioritizes exact free-text matches from the canonical artist list', async () => {
    const artistCases = [
      { query: 'chen chong swee', artist: 'Chen Chong Swee' },
      { query: 'GEORGETTE CHEN', artist: 'Georgette Chen' },
      { query: 'liu Kang', artist: 'Liu Kang' },
      { query: 'Lim Cheng Hoe', artist: 'Lim Cheng Hoe' },
      { query: 'zhang YIQIAN', artist: 'Zhang Yiqian' },
    ];
    db = new FakeSearchDb(
      artistCases.map(({ artist }, index) =>
        makeArtworkRow({
          id: `artist-${index + 1}`,
          title: `${artist} work`,
          artist,
          accession_number: `ARTIST-${index + 1}`,
          source_record_id: `ARTIST-${index + 1}`,
          match_score: 100,
        })
      )
    );
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: 'semantic-match', score: 0.92, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      SEARCH_FUSION_MODE: 'hybrid',
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    for (const { query, artist } of artistCases) {
      db.metadataSearchSql = [];
      captionVectorize.query.mockClear();
      vi.mocked(env.AI.run).mockClear();

      const res = await textSearch(
        app,
        env,
        { 'X-User-Id': 'user-1' },
        {
          query,
          topK: 10,
        }
      );
      const body = (await res.json()) as any;
      const usageEvent = db.usageEvents[db.usageEvents.length - 1];
      const usageMetadata = JSON.parse(usageEvent.metadata || '{}');

      expect(res.status).toBe(200);
      expect(body.data.results.length).toBeGreaterThan(0);
      expect(
        body.data.results.every(
          (result: { artist?: string }) => result.artist === artist
        )
      ).toBe(true);
      expect(captionVectorize.query).not.toHaveBeenCalled();
      expect(env.AI.run).not.toHaveBeenCalled();
      expect(db.metadataSearchSql).toHaveLength(1);
      expect(body.data.results[0].metadata.search_sources).toContainEqual(
        expect.objectContaining({
          label: 'Artist',
          source: 'artworks.artist',
        })
      );
      expect(usageMetadata.search).toMatchObject({
        query,
        facet: 'artist',
      });
    }
  });

  it('keeps accession numbers and years metadata-routed in hybrid search', async () => {
    env = {
      ...env,
      SEARCH_FUSION_MODE: 'hybrid',
    };

    const accessionRes = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: '1993-01678',
        topK: 10,
      }
    );
    const accessionBody = (await accessionRes.json()) as any;

    expect(accessionRes.status).toBe(200);
    expect(accessionBody.data.results[0].id).toBe(artworkRow.id);
    expect(db.metadataSearchSql).toHaveLength(1);

    db.metadataSearchSql = [];

    const yearRes = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: '1957',
        topK: 10,
      }
    );

    expect(yearRes.status).toBe(200);
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.metadataSearchSql[0]).toContain('year BETWEEN ? AND ?');
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
