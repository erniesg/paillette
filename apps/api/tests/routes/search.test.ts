import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  buildStructuredConstraintSql,
  generateJinaQueryEmbedding,
  searchRoutes,
} from '../../src/routes/search';
import * as searchRouteExports from '../../src/routes/search';
import { isHiddenNgsPublicAccession } from '../../src/utils/ngs-public-filter';
import { resetPublicSearchColdMissRateLimitForTests } from '../../src/utils/public-search-cold-miss-rate-limit';
import type { Env } from '../../src/index';
import { NGS_SEARCH_SPOTLIGHT_ASSET_REVISION } from '../../src/generated/ngs-search-spotlight-asset';

const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
const NGA_ROUTE_ID = 'nga';

describe('buildStructuredConstraintSql', () => {
  it('keeps numeric date overlap and bindings for ordinary metadata retrieval', () => {
    const result = buildStructuredConstraintSql({
      dateRange: { startYear: 1800, endYear: 1900 },
    });

    expect(result.sql).toContain('coalesce(year_end, year) >= ?');
    expect(result.sql).toContain('coalesce(year_start, year) <= ?');
    expect(result.params).toEqual([1800, 1900]);
  });

  it('falls back from a blank visual classification to catalogue classification', () => {
    const result = buildStructuredConstraintSql({
      classifications: ['Painting'],
    });

    expect(result.sql).toContain(
      "coalesce(nullif(trim(visual_classification), ''), classification, '')"
    );
    expect(result.params).toEqual(['painting']);
  });

  it('allows raw medium text to match even when canonical medium family is populated', () => {
    const result = buildStructuredConstraintSql({
      mediumFamilies: ['woodcut'],
    });

    expect(result.sql).toContain(
      "lower(trim(coalesce(medium_family, ''))) IN (?) OR (' ' || lower(coalesce(medium, '')) || ' ') GLOB ?"
    );
    expect(result.sql).not.toContain("trim(coalesce(medium_family, '')) = ''");
    expect(result.params).toEqual(['woodcut', '*[^a-z0-9]woodcut[^a-z0-9]*']);
  });
});

type DailyUsage = {
  used: number;
  quota: number;
};

type NgaPublicSearchQuotaUsage = {
  used: number;
  hard_limit: number;
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
  org_id: NGS_ORG_ID,
  title: 'Mangrove Tree',
  artist: 'Chen Chong Swee',
  year: null,
  year_start: null,
  year_end: null,
  date_text: 'undated',
  medium: 'Watercolour on paper',
  medium_family: null,
  classification: 'Paintings',
  subclassification: null,
  visual_classification: null,
  primary_artist_id: null,
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

const makeNgaArtworkRow = (overrides: Partial<typeof artworkRow> = {}) =>
  makeArtworkRow({
    ...overrides,
    custom_metadata: JSON.stringify({
      ...JSON.parse(artworkRow.custom_metadata),
      provider: 'nga',
      ...JSON.parse(overrides.custom_metadata || '{}'),
    }),
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

const ngaGlobPatternMatches = (value: string, pattern: unknown) => {
  const source = String(pattern);
  let expression = '^';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '*') {
      expression += '.*';
      continue;
    }
    if (character === '?') {
      expression += '.';
      continue;
    }
    if (character === '[') {
      const closing = source.indexOf(']', index + 1);
      if (closing !== -1) {
        expression += source.slice(index, closing + 1);
        index = closing;
        continue;
      }
    }
    expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
  }
  return new RegExp(`${expression}$`, 'su').test(value);
};

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
  ngaPublicSearchQuota: NgaPublicSearchQuotaUsage = {
    used: 0,
    hard_limit: 1000,
  };
  usageEvents: UsageEvent[] = [];
  artworkEvents: ArtworkEvent[] = [];
  metadataSearchSql: string[] = [];
  metadataSearchParams: unknown[][] = [];
  exactArtistPreflightSql: string[] = [];
  failArtworkUsageInserts = false;
  failUsageEventInserts = false;
  failUsageEventUpdates = false;
  failNgaPublicSearchQuota = false;
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
    if (sql.includes('nga_public_search_quota')) {
      if (this.failNgaPublicSearchQuota) {
        throw new Error('NGA quota storage unavailable');
      }
      return { success: true, meta: { changes: 1 } };
    }

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
      if (this.failUsageEventInserts) {
        throw new Error('usage telemetry unavailable');
      }
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
      if (this.failArtworkUsageInserts) {
        throw new Error('artwork usage telemetry unavailable');
      }
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
      if (this.failUsageEventUpdates) {
        throw new Error('usage telemetry update unavailable');
      }
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
    if (sql.includes('nga_public_search_quota')) {
      if (this.failNgaPublicSearchQuota) {
        throw new Error('NGA quota storage unavailable');
      }
      if (sql.includes('UPDATE nga_public_search_quota')) {
        if (
          this.ngaPublicSearchQuota.used >= this.ngaPublicSearchQuota.hard_limit
        ) {
          return null;
        }
        this.ngaPublicSearchQuota.used += 1;
      }
      return this.ngaPublicSearchQuota as T;
    }

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
    const applyProviderScope = (rows: typeof this.rows) => {
      if (!sql.includes("json_extract(custom_metadata, '$.provider') = ?")) {
        return rows;
      }

      const provider = params.find((param) => param === 'nga');
      return rows.filter((row) => {
        try {
          return JSON.parse(row.custom_metadata || '{}').provider === provider;
        } catch {
          return false;
        }
      });
    };

    const applySearchVisibility = (rows: typeof this.rows) => {
      const providerRows = applyProviderScope(rows);
      if (!sql.includes('source_url IS NOT NULL')) {
        return providerRows;
      }

      return providerRows.filter(
        (row) =>
          row.source_url?.trim() &&
          row.accession_number?.trim() &&
          row.title?.trim() &&
          !isHiddenNgsPublicAccession(row.accession_number, row.source_url)
      );
    };

    const applyStructuredConstraintSql = (
      rows: typeof this.rows,
      initialParamIndex: number
    ) => {
      let constrainedRows = rows;
      let paramIndex = initialParamIndex;

      if (sql.includes("trim(coalesce(date_text, '')) <> ''")) {
        constrainedRows = constrainedRows.filter((row) =>
          Boolean(row.date_text?.trim())
        );
      } else if (sql.includes('coalesce(year_end, year) >= ?')) {
        const requestedStart = Number(params[paramIndex]);
        const requestedEnd = Number(params[paramIndex + 1]);
        paramIndex += 2;
        constrainedRows = constrainedRows.filter((row) => {
          const structured = row as typeof row & {
            year_start?: number | null;
            year_end?: number | null;
          };
          const rowStart = structured.year_start ?? row.year;
          const rowEnd = structured.year_end ?? row.year;
          return (
            rowStart !== null &&
            rowEnd !== null &&
            rowEnd >= requestedStart &&
            rowStart <= requestedEnd
          );
        });
      }

      const classificationParams =
        sql.match(
          /lower\(trim\(coalesce\(visual_classification, classification, ''\)\)\) IN \(([^)]*)\)/
        )?.[1] ||
        sql.match(
          /lower\(trim\(coalesce\(nullif\(trim\(visual_classification\), ''\), classification, ''\)\)\) IN \(([^)]*)\)/
        )?.[1];
      if (classificationParams) {
        const count = classificationParams.match(/\?/g)?.length || 0;
        const classifications = new Set(
          params
            .slice(paramIndex, paramIndex + count)
            .map((value) => String(value).toLowerCase())
        );
        paramIndex += count;
        constrainedRows = constrainedRows.filter((row) => {
          const structured = row as typeof row & {
            visual_classification?: string | null;
          };
          const visualClassification = structured.visual_classification ?? null;
          const classification = sql.includes(
            "nullif(trim(visual_classification), '')"
          )
            ? visualClassification?.trim() || row.classification || ''
            : (visualClassification ?? row.classification ?? '');
          return classifications.has(
            String(classification).trim().toLowerCase()
          );
        });
      }

      const mediumParams = sql.match(
        /lower\(trim\(coalesce\(medium_family, ''\)\)\) IN \(([^)]*)\)/
      )?.[1];
      if (mediumParams) {
        const count = mediumParams.match(/\?/g)?.length || 0;
        const mediumFamilies = new Set(
          params
            .slice(paramIndex, paramIndex + count)
            .map((value) => String(value).toLowerCase())
        );
        paramIndex += count;
        const mediumFallbacks = params
          .slice(paramIndex, paramIndex + count)
          .map((value) => {
            const pattern = String(value).toLowerCase();
            return sql.includes(' GLOB ?')
              ? pattern.replace('*[^a-z0-9]', '').replace('[^a-z0-9]*', '')
              : pattern.replaceAll('%', '');
          });
        paramIndex += count;
        constrainedRows = constrainedRows.filter((row) => {
          const structured = row as typeof row & {
            medium_family?: string | null;
          };
          const mediumFamily = String(structured.medium_family || '')
            .trim()
            .toLowerCase();
          const rawMedium = String(row.medium || '').toLowerCase();
          const rawMediumMatches = mediumFallbacks.some((value) =>
            sql.includes(' GLOB ?')
              ? new RegExp(
                  `(^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`
                ).test(rawMedium)
              : rawMedium.includes(value)
          );
          return (
            mediumFamilies.has(mediumFamily) ||
            ((!sql.includes("trim(coalesce(medium_family, '')) = '' AND") ||
              !mediumFamily) &&
              rawMediumMatches)
          );
        });
      }

      const artistParams = sql.match(/primary_artist_id IN \(([^)]*)\)/)?.[1];
      if (artistParams) {
        const count = artistParams.match(/\?/g)?.length || 0;
        const artistIds = new Set(
          params
            .slice(paramIndex, paramIndex + count)
            .map((value) => String(value))
        );
        constrainedRows = constrainedRows.filter((row) => {
          const structured = row as typeof row & {
            primary_artist_id?: string | null;
          };
          return Boolean(
            structured.primary_artist_id &&
              artistIds.has(structured.primary_artist_id)
          );
        });
      }

      return constrainedRows;
    };

    if (sql.includes('FROM artworks') && sql.includes('AS match_score')) {
      this.metadataSearchSql.push(sql);
      this.metadataSearchParams.push(params);
      if (
        sql.includes("'$.ngaArtists.relationships'") &&
        sql.includes('ORDER BY match_score DESC, title COLLATE NOCASE ASC')
      ) {
        const probeGroups = JSON.parse(String(params[0] || '[]')) as string[][];
        const structuredParamIndex =
          1 +
          Number(sql.includes('AND org_id = ?')) +
          Number(
            sql.includes("json_extract(custom_metadata, '$.provider') = ?")
          );
        const matchingRows = this.rows.filter((row) => {
          let names: string[] = [];
          try {
            const relationships = JSON.parse(row.custom_metadata || '{}')
              .ngaArtists?.relationships as
              | Array<{
                  alternativeNames?: unknown[];
                  forwardDisplayName?: unknown;
                  preferredDisplayName?: unknown;
                }>
              | undefined;
            if (relationships?.length) {
              names = relationships.flatMap((relationship) => [
                String(relationship.preferredDisplayName || ''),
                String(relationship.forwardDisplayName || ''),
                ...(relationship.alternativeNames || []).map(String),
              ]);
            }
          } catch {
            names = [];
          }
          if (!names.length) names = [String(row.artist || '')];
          return probeGroups.every((patterns) =>
            patterns.some((pattern) =>
              names.some((name) => ngaGlobPatternMatches(name, pattern))
            )
          );
        });
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);

        return {
          success: true,
          results: applyStructuredConstraintSql(
            applySearchVisibility(matchingRows),
            structuredParamIndex
          )
            .slice(offset, offset + limit)
            .map((row) => ({
              ...row,
              match_score: probeGroups.length * 10,
            })),
        } as unknown as { success: boolean; results: T[] };
      }

      if (sql.includes('lower(trim(classification)) = ?')) {
        const hasOffset = sql.includes('OFFSET ?');
        const normalizedQuery = String(
          params[params.length - (hasOffset ? 3 : 2)] || ''
        ).toLowerCase();
        const limit = Number(params[params.length - (hasOffset ? 2 : 1)]);
        const offset = hasOffset ? Number(params[params.length - 1]) : 0;
        const structuredParamIndex =
          Number(sql.includes('AND org_id = ?')) +
          Number(
            sql.includes("json_extract(custom_metadata, '$.provider') = ?")
          );
        return {
          success: true,
          results: applyStructuredConstraintSql(
            applySearchVisibility(
              this.rows.filter(
                (row) =>
                  row.classification?.trim().toLowerCase() === normalizedQuery
              )
            ),
            structuredParamIndex
          )
            .slice(offset, offset + limit)
            .map((row) => ({ ...row, match_score: 100 })),
        } as unknown as { success: boolean; results: T[] };
      }

      if (
        sql.includes('AND artist IS NOT NULL') &&
        sql.includes('ORDER BY match_score DESC, artist')
      ) {
        const hasOffset = sql.includes('OFFSET ?');
        const normalizedQuery = String(params[0] || '');
        const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
        const scoreParamCount =
          sql.slice(0, sql.indexOf('AS match_score')).match(/\?/g)?.length || 0;
        const structuredParamIndex =
          scoreParamCount +
          Number(sql.includes('AND org_id = ?')) +
          Number(
            sql.includes("json_extract(custom_metadata, '$.provider') = ?")
          );
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
          results: applyStructuredConstraintSql(
            applySearchVisibility(matchingRows),
            structuredParamIndex
          )
            .slice(
              hasOffset ? Number(params[params.length - 1]) : 0,
              (hasOffset ? Number(params[params.length - 1]) : 0) +
                Number(params[params.length - (hasOffset ? 2 : 1)])
            )
            .map((row, index) => ({
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
      this.exactArtistPreflightSql.push(sql);
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

const makeEmbeddingCache = () => {
  const values = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, JSON.parse(value) as unknown);
    }),
  } as unknown as KVNamespace;
};

const textSearch = (
  app: Hono<{ Bindings: Env }>,
  env: Env,
  headers: HeadersInit = { 'X-User-Id': 'user-1' },
  body: Record<string, unknown> = { query: 'pineapple', topK: 1 },
  routeOrgId = NGS_ORG_ID
) =>
  app.request(
    `/api/v1/orgs/${routeOrgId}/search/text`,
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

const imageSearch = (
  app: Hono<{ Bindings: Env }>,
  env: Env,
  headers: HeadersInit = { 'X-User-Id': 'user-1' },
  routeOrgId = NGS_ORG_ID,
  formData?: FormData
) => {
  const body = formData || new FormData();
  if (!formData) {
    body.append(
      'image',
      new File([new Uint8Array([1, 2, 3, 4])], 'query.png', {
        type: 'image/png',
      })
    );
  }

  return app.request(
    `/api/v1/orgs/${routeOrgId}/search/image`,
    {
      method: 'POST',
      headers: {
        'User-Agent': 'vitest-search/1.0',
        'CF-Connecting-IP': '203.0.113.42',
        ...headers,
      },
      body,
    },
    env
  );
};

const ngsSearchSpotlights = (
  app: Hono<{ Bindings: Env }>,
  env: Env,
  headers?: HeadersInit,
  routeOrgId = 'ngs',
  revision = NGS_SEARCH_SPOTLIGHT_ASSET_REVISION
) =>
  app.request(
    `/api/v1/orgs/${routeOrgId}/search-spotlights/${revision}`,
    { headers },
    env
  );

describe('NGA search spotlight cache', () => {
  it('requires authentication before returning the private cached results', async () => {
    const response = await ngsSearchSpotlights(
      makeApp(),
      makeEnv(new FakeSearchDb())
    );

    expect(response.status).toBe(401);
  });

  it('returns every NGS Try result set from the immutable private cache', async () => {
    const response = await ngsSearchSpotlights(
      makeApp(),
      makeEnv(new FakeSearchDb()),
      { 'X-User-Id': 'user-1' }
    );
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        provider: string;
        suggestions: Array<{
          artworks: Array<{ imageUrl?: string; thumbnailUrl?: string }>;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, max-age=31536000, immutable'
    );
    expect(response.headers.get('Vary')).toBe('Authorization');
    expect(payload.success).toBe(true);
    expect(payload.data.provider).toBe('ngs');
    expect(payload.data.suggestions).toHaveLength(10);
    expect(
      payload.data.suggestions.map((suggestion) => suggestion.artworks.length)
    ).toEqual([30, 28, 28, 30, 26, 26, 28, 30, 30, 29]);
    expect(payload.data.suggestions[0]?.artworks[0]?.thumbnailUrl).toMatch(
      /^http:\/\/localhost\/api\/v1\/assets\//
    );
  });

  it('does not serve the private NGS cache under another org route', async () => {
    const response = await ngsSearchSpotlights(
      makeApp(),
      makeEnv(new FakeSearchDb()),
      { 'X-User-Id': 'user-1' },
      'nga'
    );

    expect(response.status).toBe(404);
  });
});

describe('NGA public search quota', () => {
  it('returns the visible lifetime quota without consuming it', async () => {
    const db = new FakeSearchDb();
    const response = await makeApp().request(
      '/api/v1/orgs/nga/search/quota',
      { headers: { 'X-User-Id': 'user-1' } },
      makeEnv(db)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const payload = (await response.json()) as any;
    expect(response.headers.get('X-NGA-Search-Limit')).toBe('1000');
    expect(response.headers.get('X-NGA-Search-Used')).toBe('0');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('1000');
    expect(payload.data).toEqual({ limit: 1000, used: 0, remaining: 1000 });
    expect(db.usageEvents).toHaveLength(0);
  });

  it.each([
    {
      name: 'requires authentication',
      headers: undefined,
      routeOrgId: NGS_ORG_ID,
      status: 401,
    },
    {
      name: 'hides the counter from other orgs',
      headers: { 'X-User-Id': 'user-1' },
      routeOrgId: NGS_ORG_ID,
      status: 404,
    },
  ])(
    'never caches or consumes quota when it $name',
    async ({ headers, routeOrgId, status }) => {
      const db = new FakeSearchDb();
      const response = await makeApp().request(
        `/api/v1/orgs/${routeOrgId}/search/quota`,
        { headers },
        makeEnv(db)
      );

      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(db.ngaPublicSearchQuota.used).toBe(0);
      expect(db.usageEvents).toHaveLength(0);
    }
  );

  it('does not cache or consume quota when the quota status read fails', async () => {
    const db = new FakeSearchDb();
    db.failNgaPublicSearchQuota = true;
    const response = await makeApp().request(
      '/api/v1/orgs/nga/search/quota',
      { headers: { 'X-User-Id': 'user-1' } },
      makeEnv(db)
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(db.ngaPublicSearchQuota.used).toBe(0);
    expect(db.usageEvents).toHaveLength(0);
  });

  it('charges and logs an NGA cached Try query', async () => {
    const db = new FakeSearchDb([makeNgaArtworkRow()]);
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      {
        query: '  A STILL LIFE of tropical fruit and flowers  ',
        topK: 1,
        minScore: 0.99,
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    expect(payload.data.quota).toEqual({
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    expect(payload.data.results).toHaveLength(1);
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(db.usageEvents).toHaveLength(1);
    expect(
      JSON.parse(db.usageEvents[0]?.metadata || '{}').search
    ).toMatchObject({
      mode: 'text',
      query: 'A STILL LIFE of tropical fruit and flowers',
      cacheDisposition: 'MISS',
      quotaRemaining: 999,
    });
  });

  it('charges and provider-scopes the canonical NGA organization UUID', async () => {
    const db = new FakeSearchDb([makeNgaArtworkRow()]);
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      { query: 'mangrove shore', topK: 1 },
      'eabbf000-708e-4d4c-8ac8-966b59d4fcac'
    );

    expect(response.status).toBe(200);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(db.metadataSearchSql[0]).toContain(
      "json_extract(custom_metadata, '$.provider') = ?"
    );
    expect(db.metadataSearchParams[0]).toContain('nga');
  });

  it('charges authenticated NGA cache hits from the shared lifetime pool', async () => {
    const db = new FakeSearchDb();
    const cache = makeEmbeddingCache();
    const env = { ...makeEnv(db), CACHE: cache };
    const app = makeApp();
    const body = { query: 'mangrove shore', topK: 1 };

    const first = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      body,
      'nga'
    );
    const second = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-2' },
      body,
      'nga'
    );
    const secondPayload = (await second.json()) as any;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(second.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
    expect(secondPayload.data.quota).toEqual({
      limit: 1000,
      used: 2,
      remaining: 998,
    });
    expect(db.ngaPublicSearchQuota.used).toBe(2);
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.usageEvents).toHaveLength(2);
    expect(
      JSON.parse(db.usageEvents[1]?.metadata || '{}').search
    ).toMatchObject({
      cacheDisposition: 'KV-FRESH',
      quotaRemaining: 998,
    });
  });

  it('charges and provider-scopes an NGA image search through the open-access alias', async () => {
    const db = new FakeSearchDb();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const vectorize = { query: vi.fn().mockResolvedValue({ matches: [] }) };
    const env = {
      ...makeEnv(db),
      JINA_API_KEY: 'jina-test-key',
      JINA_EMBEDDING_DIMENSIONS: '2',
      VECTORIZE: vectorize as unknown as Vectorize,
    };

    const response = await imageSearch(
      makeApp(),
      env,
      { 'X-User-Id': 'user-1' },
      'open-access-art'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    expect(payload.data.quota).toEqual({
      limit: 1000,
      used: 1,
      remaining: 999,
    });
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vectorize.query).toHaveBeenCalledOnce();
    expect(vectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: expect.objectContaining({ provider: 'nga' }),
      })
    );
    expect(
      JSON.parse(db.usageEvents[0]?.metadata || '{}').search
    ).toMatchObject({
      mode: 'image',
      quotaRemaining: 999,
    });
  });

  it('uses the NGA lifetime pool instead of daily quota for a valid image request', async () => {
    const db = new FakeSearchDb();
    const response = await imageSearch(
      makeApp(),
      makeEnv(db, 0),
      { 'X-User-Id': 'user-1' },
      'nga'
    );

    expect(response.status).toBe(501);
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(db.daily.size).toBe(0);
    expect(db.usageEvents).toHaveLength(1);
  });

  it('does not reserve the NGA lifetime pool for invalid input', async () => {
    const db = new FakeSearchDb();
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      { query: '' },
      'nga'
    );

    expect(response.status).toBe(400);
    expect(db.ngaPublicSearchQuota.used).toBe(0);
    expect(db.usageEvents).toHaveLength(0);
  });

  it.each([
    { query: '   ' },
    {
      query: 'mangrove shore',
      constraints: { dateRange: { startYear: 2020, endYear: 1900 } },
    },
    {
      query: 'mangrove shore',
      constraints: { classifications: ['Not a public classification'] },
    },
  ])(
    'validates NGA text and constraints before reserving (%o)',
    async (body) => {
      const db = new FakeSearchDb();
      const response = await textSearch(
        makeApp(),
        makeEnv(db),
        { 'X-User-Id': 'user-1' },
        body,
        'nga'
      );

      expect(response.status).toBe(400);
      expect(db.ngaPublicSearchQuota.used).toBe(0);
      expect(db.usageEvents).toHaveLength(0);
      expect(db.metadataSearchSql).toHaveLength(0);
    }
  );

  it('bypasses spotlight for an exact Try term with unsupported constraints', async () => {
    const db = new FakeSearchDb();
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      {
        query: 'a still life of tropical fruit and flowers',
        topK: 1,
        constraints: { classifications: ['Painting'] },
      },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).not.toBe(
      'SPOTLIGHT'
    );
    expect(db.metadataSearchSql.length).toBeGreaterThan(0);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
  });

  it('bypasses spotlight for an exact Try term with visual refinement', async () => {
    const db = new FakeSearchDb();
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      {
        query: 'a still life of tropical fruit and flowers',
        topK: 1,
        visualRefinement: 'more dramatic lighting',
      },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).not.toBe(
      'SPOTLIGHT'
    );
    expect(db.metadataSearchSql.length).toBeGreaterThan(0);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
  });

  it('keeps an admitted NGA text search successful when telemetry annotation fails', async () => {
    const db = new FakeSearchDb();
    db.failUsageEventUpdates = true;
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      { query: 'a still life of tropical fruit and flowers', topK: 1 },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(db.usageEvents).toHaveLength(1);
  });

  it('keeps an admitted NGA image search successful when telemetry annotation fails', async () => {
    const db = new FakeSearchDb();
    db.failUsageEventUpdates = true;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await imageSearch(
      makeApp(),
      {
        ...makeEnv(db),
        JINA_API_KEY: 'jina-test-key',
        JINA_EMBEDDING_DIMENSIONS: '2',
        VECTORIZE: {
          query: vi.fn().mockResolvedValue({ matches: [] }),
        } as unknown as Vectorize,
      },
      { 'X-User-Id': 'user-1' },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(db.usageEvents).toHaveLength(1);
  });

  it('does not reserve the NGA lifetime pool for non-NGA searches', async () => {
    const db = new FakeSearchDb();
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      { query: 'mangrove shore', topK: 1 },
      'ngs'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-NGA-Search-Remaining')).toBeNull();
    expect(db.ngaPublicSearchQuota.used).toBe(0);
  });

  it('uses the NGA lifetime pool without creating daily usage', async () => {
    const db = new FakeSearchDb();
    const env = makeEnv(db, 1);
    const app = makeApp();

    const first = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'mangrove shore', topK: 1 },
      'nga'
    );
    const second = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'fishing boats', topK: 1 },
      NGS_ORG_ID
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.ngaPublicSearchQuota.used).toBe(1);
    expect(db.daily.size).toBe(1);
    expect(db.usageEvents).toHaveLength(2);
  });

  it('fails closed before retrieval when the NGA quota ledger is unavailable', async () => {
    const db = new FakeSearchDb();
    db.failNgaPublicSearchQuota = true;
    const response = await textSearch(
      makeApp(),
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      { query: 'mangrove shore', topK: 1 },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('NGA_PUBLIC_SEARCH_QUOTA_UNAVAILABLE');
    expect(db.metadataSearchSql).toHaveLength(0);
    expect(db.usageEvents).toHaveLength(0);
  });

  it('shares the final NGA slot across authenticated users and the public API key', async () => {
    const db = new FakeSearchDb();
    db.ngaPublicSearchQuota.used = 999;
    const cache = makeEmbeddingCache();
    const env = {
      ...makeEnv(db),
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      CACHE: cache,
    };
    const app = makeApp();
    const body = {
      query: 'a still life of tropical fruit and flowers',
      topK: 100,
      minScore: 0,
    };

    const responses = await Promise.all([
      textSearch(app, env, { 'X-User-Id': 'user-1' }, body, 'nga'),
      textSearch(
        app,
        env,
        { 'X-API-Key': 'public-search-secret' },
        body,
        'nga'
      ),
    ]);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([200, 429]);
    const exhausted = responses.find((response) => response.status === 429)!;
    const exhaustedPayload = (await exhausted.json()) as any;
    expect(db.ngaPublicSearchQuota.used).toBe(1000);
    expect(exhausted.headers.get('X-NGA-Search-Limit')).toBe('1000');
    expect(exhausted.headers.get('X-NGA-Search-Used')).toBe('1000');
    expect(exhausted.headers.get('X-NGA-Search-Remaining')).toBe('0');
    expect(exhaustedPayload.error).toMatchObject({
      code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
      details: { quota: { limit: 1000, used: 1000, remaining: 0 } },
    });
    expect(db.usageEvents).toHaveLength(1);
    // Exactly one contender acquired the final slot and performed retrieval;
    // the exhausted contender never reaches the cache or retrieval path.
    expect(db.metadataSearchSql).toHaveLength(1);
  });

  it('keeps an admitted public NGA search available when usage telemetry fails', async () => {
    const db = new FakeSearchDb();
    db.failUsageEventInserts = true;
    const env = {
      ...makeEnv(db),
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      CACHE: makeEmbeddingCache(),
    };

    const response = await textSearch(
      makeApp(),
      env,
      { 'X-API-Key': 'public-search-secret' },
      {
        query: 'a still life of tropical fruit and flowers',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-NGA-Search-Remaining')).toBe('999');
    expect(db.ngaPublicSearchQuota.used).toBe(1);
  });
});

const makeImageSearchForm = (
  file: File = new File([new Uint8Array([1, 2, 3, 4])], 'query.png', {
    type: 'image/png',
  })
) => {
  const formData = new FormData();
  formData.append('image', file);
  return formData;
};

describe('Search API auth and quota behavior', () => {
  let app: Hono<{ Bindings: Env }>;
  let db: FakeSearchDb;
  let env: Env;

  beforeEach(() => {
    resetPublicSearchColdMissRateLimitForTests();
    app = makeApp();
    db = new FakeSearchDb();
    env = makeEnv(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the configured query embedding endpoint without changing the model contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: new Array(1024).fill(0.01) }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const vector = await generateJinaQueryEmbedding(
      'vm-token',
      'blue ceramic bottle',
      'jina-clip-v2',
      1024,
      'https://embedding-vm.example/v1/embeddings'
    );

    expect(vector).toHaveLength(1024);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://embedding-vm.example/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer vm-token' }),
      })
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({
      model: 'jina-clip-v2',
      task: 'retrieval.query',
      dimensions: 1024,
    });
  });

  it('reuses both Jina query embeddings for normalized-equivalent hybrid searches', async () => {
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({ matches: [] }),
    };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({ matches: [] }),
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.6, 0.8] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const embeddingCache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: embeddingCache,
      VECTORIZE: imageVectorize as unknown as Vectorize,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      SEARCH_FUSION_MODE: 'hybrid',
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      QUERY_EMBEDDING_API_URL: 'https://embedding-vm.example/v1/embeddings',
      JINA_EMBEDDING_DIMENSIONS: '2',
      CAPTION_EMBEDDING_PROVIDER: 'jina',
      JINA_TEXT_EMBEDDING_DIMENSIONS: '2',
    };

    const first = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: '  quiet\n  shore  ', topK: 1 }
    );
    const second = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'quiet shore', topK: 1 }
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      meta: {
        search: { cacheable: true, degradedChannels: [] },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(imageVectorize.query).toHaveBeenCalledTimes(1);
    expect(captionVectorize.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embeddingCache.put)).toHaveBeenCalledTimes(3);
  });

  it('skips metadata search when the routed metadata weight is zero', async () => {
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'blue', topK: 1 }
    );

    expect(response.status).toBe(200);
    expect(db.metadataSearchSql).toEqual([]);
  });

  it('keeps search available when result telemetry cannot be recorded', async () => {
    db.failArtworkUsageInserts = true;

    const response = await textSearch(app, env);
    const payload = await response.json<{ success: boolean }>();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(db.artworkEvents).toHaveLength(0);
  });

  it('returns 401 for unauthenticated text search', async () => {
    const res = await textSearch(app, env, {});
    const body = (await res.json()) as any;

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(db.daily.size).toBe(0);
    expect(db.usageEvents).toHaveLength(0);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('adds no-store before image authentication can return 401', async () => {
    const response = await imageSearch(app, env, {});

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('adds no-store before image quota enforcement can return 429', async () => {
    env = makeEnv(db, 0);

    const response = await imageSearch(app, env, undefined, 'private-gallery');

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns results, rate limit headers, and one usage record for a registered user', async () => {
    const res = await textSearch(
      app,
      env,
      undefined,
      undefined,
      'private-gallery'
    );
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
      path: '/api/v1/orgs/private-gallery/search/text',
      query_type: 'vector_search',
      org_id: 'private-gallery',
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
      org_id: NGS_ORG_ID,
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

  it('returns Roots caption provenance instead of stripping it from NGA search results', async () => {
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
        filter: { galleryId: NGS_ORG_ID },
      })
    );
  });

  it('charges and isolates the open alias across NGA vector and D1 search channels', async () => {
    const ngaArtwork = makeArtworkRow({
      id: 'open-access-art:nga:1',
      org_id: 'open-access-art',
      title: 'NGA Annunciation',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    const articArtwork = makeArtworkRow({
      id: 'open-access-art:artic:1',
      org_id: 'open-access-art',
      title: 'ArtIC Annunciation',
      custom_metadata: JSON.stringify({ provider: 'artic' }),
    });
    db = new FakeSearchDb([ngaArtwork, articArtwork]);
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [
          { id: ngaArtwork.id, score: 0.9, metadata: { provider: 'nga' } },
          {
            id: articArtwork.id,
            score: 0.99,
            metadata: { provider: 'artic' },
          },
        ],
      }),
    };
    env = {
      ...makeEnv(db),
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
      { query: 'annunciation', topK: 10 },
      'open'
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results.map((result: any) => result.id)).toEqual([
      ngaArtwork.id,
    ]);
    expect(captionVectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { galleryId: 'open-access-art', provider: 'nga' },
      })
    );
    expect(db.metadataSearchSql[0]).toContain(
      "json_extract(custom_metadata, '$.provider') = ?"
    );
    expect(db.ngaPublicSearchQuota.used).toBe(1);
  });

  it('keeps bare keywords semantic while contributing the balanced metadata channel', async () => {
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
    expect(db.metadataSearchSql).toHaveLength(1);
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

  it('hard-filters an explicit artist facet by an independent NGA date constraint before top-K', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-rembrandt-date-violation-1750',
        artist: 'Rembrandt',
        year: 1750,
        date_text: '1750',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-rembrandt-date-match-1850',
        artist: 'Rembrandt',
        year: 1850,
        date_text: '1850',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Rembrandt',
        topK: 1,
        minScore: 0,
        facet: 'artist',
        constraints: { dateRange: { startYear: 1800, endYear: 1900 } },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-rembrandt-date-match-1850',
    ]);
  });

  it('falls back from blank visual classification in constrained artist facets', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-artist-blank-visual-classification',
        artist: 'Fallback Artist',
        classification: 'Painting',
        visual_classification: '',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      } as any),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Fallback Artist',
        topK: 1,
        minScore: 0,
        facet: 'artist',
        constraints: { classifications: ['Painting'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-artist-blank-visual-classification',
    ]);
  });

  it('fills canonical public artist facets from date-constrained rows beyond a 100-row violating prefix', async () => {
    db = new FakeSearchDb([
      ...Array.from({ length: 101 }, (_, index) =>
        makeArtworkRow({
          id: `nga-public-artist-date-violation-${index + 1}`,
          artist: 'Boundary Artist',
          year: 1700,
          date_text: '1700',
          custom_metadata: JSON.stringify({ provider: 'nga' }),
        })
      ),
      makeArtworkRow({
        id: 'nga-public-artist-date-match-1850',
        artist: 'Boundary Artist',
        year: 1850,
        date_text: '1850',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-public-artist-date-match-1851',
        artist: 'Boundary Artist',
        year: 1851,
        date_text: '1851',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = {
      ...makeEnv(db),
      CACHE: makeEmbeddingCache(),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      {
        query: 'Boundary Artist',
        topK: 100,
        minScore: 0,
        facet: 'artist',
        constraints: { dateRange: { startYear: 1800, endYear: 1900 } },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-public-artist-date-match-1850',
      'nga-public-artist-date-match-1851',
    ]);
  });

  it('paginates canonical public artist facets past 100 unparseable displayed dates', async () => {
    db = new FakeSearchDb([
      ...Array.from({ length: 101 }, (_, index) =>
        makeArtworkRow({
          id: `nga-public-artist-unparseable-date-${index + 1}`,
          artist: 'Displayed Date Artist',
          year: 1800,
          date_text: 'not dated',
          custom_metadata: JSON.stringify({ provider: 'nga' }),
        })
      ),
      makeArtworkRow({
        id: 'nga-public-artist-displayed-date-match-1850',
        artist: 'Displayed Date Artist',
        year: 1950,
        date_text: '1850',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-public-artist-displayed-date-match-1851',
        artist: 'Displayed Date Artist',
        year: 1951,
        date_text: '1851',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = {
      ...makeEnv(db),
      CACHE: makeEmbeddingCache(),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      {
        query: 'Displayed Date Artist',
        topK: 100,
        minScore: 0,
        facet: 'artist',
        constraints: { dateRange: { startYear: 1800, endYear: 1900 } },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-public-artist-displayed-date-match-1850',
      'nga-public-artist-displayed-date-match-1851',
    ]);
    expect(db.metadataSearchSql[0]).toContain(
      "trim(coalesce(date_text, '')) <> ''"
    );
    expect(db.metadataSearchSql[0]).not.toContain(
      'coalesce(year_end, year) >= ?'
    );
  });

  it('routes classification facets through an exact catalogue field filter', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'painting-1',
        title: 'A Painted Portrait',
        classification: 'Painting',
      }),
      makeArtworkRow({
        id: 'iad-1',
        title: 'Wall Painting',
        classification: 'Index of American Design',
      }),
    ]);
    env = makeEnv(db);

    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Painting',
        topK: 30,
        facet: 'classification',
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({
      id: 'painting-1',
      metadata: { classification: 'Painting' },
    });
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.metadataSearchSql[0]).toContain(
      'lower(trim(classification)) = ?'
    );
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        channel: 'metadata',
        label: 'Classification',
        source: 'artworks.classification',
      })
    );
    const usageMetadata = JSON.parse(db.usageEvents[0].metadata || '{}');
    expect(usageMetadata.search).toMatchObject({
      query: 'Painting',
      facet: 'classification',
      resultCount: 1,
    });
  });

  it('hard-filters an explicit classification facet by an independent NGA medium constraint before top-K', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-painting-medium-violation-watercolor',
        year: 1750,
        classification: 'Painting',
        medium: 'Watercolor on paper',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-painting-medium-match-oil',
        year: 1850,
        classification: 'Painting',
        medium: 'Oil on canvas',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Painting',
        topK: 1,
        minScore: 0,
        facet: 'classification',
        constraints: { mediumFamilies: ['oil'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-painting-medium-match-oil',
    ]);
  });

  it('allows raw-medium matches when constrained classification facets have a populated medium family', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-classification-populated-family-raw-oil-match',
        classification: 'Painting',
        medium: 'Oil on canvas',
        medium_family: 'watercolor',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      } as any),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Painting',
        topK: 1,
        minScore: 0,
        facet: 'classification',
        constraints: { mediumFamilies: ['oil'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-classification-populated-family-raw-oil-match',
    ]);
  });

  it('does not satisfy an ink constraint from the substring in pink during classification-facet retrieval', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-classification-pink-substring-violation',
        classification: 'Painting',
        medium: 'Pink paper',
        medium_family: null,
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-classification-ink-token-match',
        classification: 'Painting',
        medium: 'Pen and ink on paper',
        medium_family: null,
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Painting',
        topK: 1,
        minScore: 0,
        facet: 'classification',
        constraints: { mediumFamilies: ['ink'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-classification-ink-token-match',
    ]);
  });

  it('fills canonical public classification facets from medium-constrained rows beyond a 100-row violating prefix', async () => {
    db = new FakeSearchDb([
      ...Array.from({ length: 101 }, (_, index) =>
        makeArtworkRow({
          id: `nga-public-classification-medium-violation-${index + 1}`,
          year: 1700,
          classification: 'Painting',
          medium: 'Watercolor on paper',
          custom_metadata: JSON.stringify({ provider: 'nga' }),
        })
      ),
      makeArtworkRow({
        id: 'nga-public-classification-medium-match-oil-1850',
        year: 1850,
        classification: 'Painting',
        medium: 'Oil on canvas',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-public-classification-medium-match-oil-1851',
        year: 1851,
        classification: 'Painting',
        medium: 'Oil on panel',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = {
      ...makeEnv(db),
      CACHE: makeEmbeddingCache(),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      {
        query: 'Painting',
        topK: 100,
        minScore: 0,
        facet: 'classification',
        constraints: { mediumFamilies: ['oil'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-public-classification-medium-match-oil-1850',
      'nga-public-classification-medium-match-oil-1851',
    ]);
  });

  it('paginates canonical public classification facets past 100 unparseable displayed dates', async () => {
    db = new FakeSearchDb([
      ...Array.from({ length: 101 }, (_, index) =>
        makeArtworkRow({
          id: `nga-public-classification-unparseable-date-${index + 1}`,
          year: 1800,
          date_text: 'not dated',
          classification: 'Painting',
          custom_metadata: JSON.stringify({ provider: 'nga' }),
        })
      ),
      makeArtworkRow({
        id: 'nga-public-classification-displayed-date-match-1850',
        year: 1950,
        date_text: '1850',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-public-classification-displayed-date-match-1851',
        year: 1951,
        date_text: '1851',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = {
      ...makeEnv(db),
      CACHE: makeEmbeddingCache(),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      {
        query: 'Painting',
        topK: 100,
        minScore: 0,
        facet: 'classification',
        constraints: { dateRange: { startYear: 1800, endYear: 1900 } },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-public-classification-displayed-date-match-1850',
      'nga-public-classification-displayed-date-match-1851',
    ]);
  });

  it('applies visual refinement only within the original text candidates', async () => {
    const firstAngel = makeArtworkRow({
      id: 'angel-a',
      title: 'Angel in Red',
      artist: 'Artist A',
    });
    const navyAngel = makeArtworkRow({
      id: 'angel-b',
      title: 'Angel in Navy',
      artist: 'Artist B',
    });
    db = new FakeSearchDb([firstAngel, navyAngel]);
    const imageVectorize = {
      getByIds: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          values: id === navyAngel.id ? [0, 1] : [1, 0],
        }))
      ),
      query: vi.fn(),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0, 1] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      QUERY_EMBEDDING_API_URL: 'https://embedding-vm.example/v1/embeddings',
      JINA_EMBEDDING_DIMENSIONS: '2',
    };

    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'angels',
        visualRefinement: 'dark navy blue',
        topK: 10,
      }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(
      body.data.results.map((result: { id: string }) => result.id)
    ).toEqual([navyAngel.id, firstAngel.id]);
    expect(imageVectorize.getByIds).toHaveBeenCalledWith([
      firstAngel.id,
      navyAngel.id,
    ]);
    expect(imageVectorize.query).not.toHaveBeenCalled();
    expect(body.data.results[0].metadata.visual_refinement).toMatchObject({
      query: 'dark navy blue',
      rank: 1,
    });
    const usageMetadata = JSON.parse(db.usageEvents[0].metadata || '{}');
    expect(usageMetadata.search).toMatchObject({
      query: 'angels',
      visualRefinement: 'dark navy blue',
      resultCount: 2,
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
    expect(captionVectorize.query).toHaveBeenCalled();
    expect(env.AI.run).toHaveBeenCalled();
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        channel: 'metadata',
        label: 'Catalogue metadata',
        weight: 2.5,
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
      expect(captionVectorize.query).toHaveBeenCalled();
      expect(env.AI.run).toHaveBeenCalled();
      expect(db.metadataSearchSql).toHaveLength(1);
      expect(body.data.results[0].metadata.search_sources).toContainEqual(
        expect.objectContaining({
          channel: 'metadata',
          label: 'Catalogue metadata',
          weight: 2.5,
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

  it('recognizes dotted NGA accession numbers as exact metadata routes', async () => {
    const ngaArtwork = makeArtworkRow({
      id: 'open-access-art:nga:21352',
      accession_number: '1943.8.5569',
      source_record_id: '21352',
      source_institution: 'National Gallery of Art, Washington',
    });
    db = new FakeSearchDb([ngaArtwork]);
    const imageVectorize = { query: vi.fn() };
    const captionVectorize = { query: vi.fn() };
    env = {
      ...makeEnv(db),
      VECTORIZE_V2: imageVectorize as unknown as Vectorize,
      CAPTION_VECTORIZE_V2: captionVectorize as unknown as Vectorize,
      EMBEDDING_INDEX_VERSION: 'v2',
      SEARCH_FUSION_MODE: 'hybrid',
    };

    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: '1943.8.5569', topK: 10 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].id).toBe(ngaArtwork.id);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({ channel: 'metadata', weight: 8 })
    );
    expect(imageVectorize.query).not.toHaveBeenCalled();
    expect(captionVectorize.query).not.toHaveBeenCalled();
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

  it('uses the NGS exact-title RRF weights for a canonical title query', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: artworkRow.id, score: 0.91, metadata: {} }],
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
      { query: 'Mangrove Tree', topK: 1 }
    );
    const body = (await res.json()) as any;
    const sources = body.data.results[0].metadata.search_sources;

    expect(res.status).toBe(200);
    expect(sources).toContainEqual(
      expect.objectContaining({ channel: 'metadata', weight: 4 })
    );
    expect(sources).toContainEqual(
      expect.objectContaining({
        channel: 'generated_caption_embedding',
        weight: 1.2,
      })
    );
  });

  it('keeps an exact catalogue title ahead of a multi-channel semantic distractor', async () => {
    const exactArtwork = makeArtworkRow({
      id: 'open-access-art:nga:1138',
      title: 'The Feast of the Gods',
      artist: 'Giovanni Bellini and Titian',
      source_institution: 'National Gallery of Art, Washington',
    });
    const semanticDistractor = makeArtworkRow({
      id: 'open-access-art:nga:30212',
      title: 'Feast of the Gods',
      artist: 'Honore Daumier, with additions by later hands',
      source_institution: 'National Gallery of Art, Washington',
    });
    db = new FakeSearchDb([exactArtwork, semanticDistractor]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: semanticDistractor.id, score: 0.94, metadata: {} }],
      }),
    };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: semanticDistractor.id, score: 0.96, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
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
      { query: 'The Feast of the Gods', topK: 10 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].id).toBe(exactArtwork.id);
    expect(body.data.results[0].similarity).toBeGreaterThan(
      body.data.results[1].similarity
    );

    const artistQualifiedRes = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'Giovanni Bellini Titian The Feast of the Gods',
        topK: 10,
      }
    );
    const artistQualifiedBody = (await artistQualifiedRes.json()) as any;

    expect(artistQualifiedRes.status).toBe(200);
    expect(artistQualifiedBody.data.results[0].id).toBe(exactArtwork.id);
    expect(artistQualifiedBody.data.results[0].similarity).toBeGreaterThan(
      artistQualifiedBody.data.results[1].similarity
    );
  });

  it('normalizes punctuation and prioritizes an exact artist-title catalogue match', async () => {
    const exactArtwork = makeArtworkRow({
      id: 'open-access-art:nga:50724',
      title: "Ginevra de' Benci [obverse]",
      artist: 'Leonardo da Vinci',
      source_institution: 'National Gallery of Art, Washington',
    });
    const semanticDistractor = makeArtworkRow({
      id: 'open-access-art:nga:9292',
      title: 'Madame de Gillier',
      artist: 'Robert Nanteuil',
      source_institution: 'National Gallery of Art, Washington',
    });
    db = new FakeSearchDb([exactArtwork, semanticDistractor]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: semanticDistractor.id, score: 0.94, metadata: {} }],
      }),
    };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: semanticDistractor.id, score: 0.96, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
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
      { query: 'Leonardo da Vinci Ginevra de Benci', topK: 10 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].id).toBe(exactArtwork.id);
    expect(body.data.results[0].similarity).toBeGreaterThan(
      body.data.results[1].similarity
    );
    expect(db.metadataSearchSql[0]).toContain('char(39)');
    expect(db.metadataSearchSql[0]).toContain("'['");
    expect(db.metadataSearchSql[0]).toContain("']'");
  });

  it('keeps actual medium matches ahead of works that only depict the material', async () => {
    const depictedMaterial = makeArtworkRow({
      id: 'open-access-art:nga:iad-bronze-object',
      title: 'Centaur Weather Vane',
      medium: 'watercolor, graphite, and gouache on paper',
      classification: 'Index of American Design',
      description: 'A watercolor study depicting a bronze sculpture.',
      source_institution: 'National Gallery of Art, Washington',
    });
    const actualMedium = makeArtworkRow({
      id: 'open-access-art:nga:bronze-sculpture',
      title: 'Bacchus and a Faun',
      medium: 'bronze',
      classification: 'Sculpture',
      description: 'Two figures stand together.',
      source_institution: 'National Gallery of Art, Washington',
    });
    db = new FakeSearchDb([depictedMaterial, actualMedium]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: depictedMaterial.id, score: 0.95, metadata: {} }],
      }),
    };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: depictedMaterial.id, score: 0.96, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
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
      { query: 'bronze sculpture', topK: 10 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].id).toBe(actualMedium.id);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({ channel: 'metadata', weight: 3 })
    );
  });

  it('routes common printmaking media such as etching as exact medium queries', async () => {
    const etching = makeArtworkRow({
      id: 'open-access-art:nga:etching',
      title: 'A Man Showing Mercury the Eagle of Jupiter',
      medium: 'etching',
      classification: 'Print',
      source_institution: 'National Gallery of Art, Washington',
    });
    db = new FakeSearchDb([etching]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: etching.id, score: 0.9, metadata: {} }],
      }),
    };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: etching.id, score: 0.91, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
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
      { query: 'etching', topK: 10 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({ channel: 'metadata', weight: 3 })
    );
  });

  it('reports institution caption vectors with their actual provenance', async () => {
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [
          {
            id: artworkRow.id,
            score: 0.9,
            metadata: {
              sourceKind: 'institution_caption_embedding',
              sourceField: 'description',
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
      { query: 'quiet shore', topK: 1 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({
        channel: 'institution_caption_embedding',
        source: 'description',
        label: 'Institution caption embedding',
      })
    );
  });

  it('falls back to metadata when caption query embedding is unavailable', async () => {
    const captionVectorize = {
      query: vi.fn(),
    };
    env = {
      ...env,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      SEARCH_FUSION_MODE: 'hybrid',
      AI: {
        run: vi
          .fn()
          .mockRejectedValue(new Error('embedding provider unavailable')),
      } as unknown as Ai,
    };

    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'quiet shore', topK: 1 }
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.results[0].id).toBe(artworkRow.id);
    expect(body.data.results[0].metadata.search_sources).toContainEqual(
      expect.objectContaining({ channel: 'metadata' })
    );
    expect(captionVectorize.query).not.toHaveBeenCalled();
    expect(body.meta.search).toEqual({
      cacheable: false,
      degradedChannels: ['image_embedding', 'caption_embedding'],
    });
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

    const res = await textSearch(
      app,
      env,
      { 'X-API-Key': 'plt_stg_test' },
      undefined,
      'private-gallery'
    );
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
    db = new FakeSearchDb([makeNgaArtworkRow()]);
    env = {
      ...makeEnv(db),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const res = await textSearch(
      app,
      env,
      {
        'X-API-Key': 'public-search-secret',
      },
      {
        query: 'pineapple',
        topK: 100,
        minScore: 0,
      },
      NGA_ROUTE_ID
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(res.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(body.success).toBe(true);
    expect(body.data.results).toHaveLength(1);
    expect(db.daily.size).toBe(0);
    expect(db.usageEvents).toHaveLength(1);
    expect(db.artworkEvents).toHaveLength(1);
    expect(
      JSON.parse(db.usageEvents[0]?.metadata || '{}').search
    ).toMatchObject({
      mode: 'text',
      query: 'pineapple',
      cacheDisposition: 'MISS',
      quotaRemaining: 999,
    });
  });

  it.each([
    'open',
    'open-access-art',
    '11111111-1111-4111-8111-111111111111',
    'private-gallery',
  ])(
    'rejects public search access to disallowed route scope %s',
    async (scope) => {
      const cache = makeEmbeddingCache();
      env = {
        ...makeEnv(db),
        CACHE: cache,
        ENVIRONMENT: 'production',
        PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      };

      const response = await textSearch(
        app,
        env,
        { 'X-API-Key': 'public-search-secret' },
        { query: 'pineapple', topK: 100, minScore: 0 },
        scope
      );
      const payload = (await response.json()) as any;

      expect(response.status).toBe(403);
      expect(payload.error.code).toBe('FORBIDDEN');
      expect(db.metadataSearchSql).toHaveLength(0);
      expect(cache.get).not.toHaveBeenCalled();
    }
  );

  it('rejects noncanonical public search parameters before retrieval', async () => {
    const cache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: cache,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      { query: 'pineapple', topK: 99, minScore: 0 },
      NGA_ROUTE_ID
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_PUBLIC_SEARCH_REQUEST');
    expect(db.metadataSearchSql).toHaveLength(0);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('rejects visual refinement for the public search principal', async () => {
    const cache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: cache,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      {
        query: 'pineapple',
        topK: 100,
        minScore: 0,
        visualRefinement: 'blue',
      },
      NGA_ROUTE_ID
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_PUBLIC_SEARCH_REQUEST');
    expect(db.metadataSearchSql).toHaveLength(0);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('rejects public image search for arbitrary organization scopes', async () => {
    const cache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: cache,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await imageSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      'private-gallery'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe('FORBIDDEN');
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('canonicalizes NGA image constraints, pushes every hard facet to Vectorize, and backstops hydrated rows', async () => {
    const providerMetadata = JSON.stringify({
      ...JSON.parse(artworkRow.custom_metadata),
      provider: 'nga',
    });
    const compliant = makeArtworkRow({
      id: 'compliant',
      year: 1750,
      year_start: 1750,
      year_end: 1750,
      date_text: '1750',
      medium: 'Oil on canvas',
      medium_family: 'oil',
      classification: 'Painting',
      visual_classification: 'Painting',
      primary_artist_id: 'artist-1',
      custom_metadata: providerMetadata,
    });
    const distractors = [
      makeArtworkRow({
        ...compliant,
        id: 'wrong-date',
        year: 1900,
        year_start: 1900,
        year_end: 1900,
        date_text: '1900',
      }),
      makeArtworkRow({
        ...compliant,
        id: 'wrong-classification',
        classification: 'Sculpture',
        visual_classification: 'Sculpture',
      }),
      makeArtworkRow({
        ...compliant,
        id: 'wrong-medium',
        medium: 'Bronze',
        medium_family: 'bronze',
      }),
      makeArtworkRow({
        ...compliant,
        id: 'medium-substring-foil',
        medium: 'Gold foil on paper',
        medium_family: null,
      }),
      makeArtworkRow({
        ...compliant,
        id: 'wrong-artist',
        primary_artist_id: 'artist-2',
      }),
      makeArtworkRow({
        ...compliant,
        id: 'wrong-provider',
        custom_metadata: JSON.stringify({
          ...JSON.parse(artworkRow.custom_metadata),
          provider: 'artic',
        }),
      }),
    ];
    db = new FakeSearchDb([compliant, ...distractors]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [compliant, ...distractors].map((row, index) => ({
          id: row.id,
          score: index === 0 ? 0 : 0.9 - index / 10,
          metadata: {},
        })),
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.6, 0.8] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      QUERY_EMBEDDING_API_URL: 'https://embedding-vm.example/v1/embeddings',
      JINA_EMBEDDING_DIMENSIONS: '2',
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      CACHE: makeEmbeddingCache(),
    };
    const formData = makeImageSearchForm();
    formData.set('topK', '30');
    formData.set('minScore', '0');
    formData.set(
      'constraints',
      JSON.stringify({
        artistIds: ['artist-1', 'artist-1'],
        mediumFamilies: ['oil', 'oil'],
        classifications: ['Painting', 'Painting'],
        dateRange: { startYear: 1700, endYear: 1800 },
      })
    );

    const response = await imageSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      'nga',
      formData
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(imageVectorize.query).toHaveBeenCalledWith(
      [0.6, 0.8],
      expect.objectContaining({
        topK: 30,
        filter: {
          galleryId: 'open-access-art',
          provider: 'nga',
          yearStart: { $lte: 1800 },
          yearEnd: { $gte: 1700 },
          classification: { $in: ['Painting'] },
          mediumFamily: { $in: ['oil'] },
          primaryArtistId: { $in: ['artist-1'] },
        },
      })
    );
    expect(payload.data.results.map((result: any) => result.id)).toEqual([
      'compliant',
    ]);
    expect(payload.data.results[0].similarity).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves unconstrained NGA image-search filtering, ordering, and result shape', async () => {
    const providerMetadata = JSON.stringify({
      ...JSON.parse(artworkRow.custom_metadata),
      provider: 'nga',
    });
    const first = makeArtworkRow({
      id: 'first',
      title: 'First result',
      custom_metadata: providerMetadata,
    });
    const second = makeArtworkRow({
      id: 'second',
      title: 'Second result',
      custom_metadata: providerMetadata,
    });
    db = new FakeSearchDb([first, second]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [
          { id: second.id, score: 0.9, metadata: {} },
          { id: first.id, score: 0.8, metadata: {} },
        ],
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ data: [{ embedding: [0.6, 0.8] }] }))
    );
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      QUERY_EMBEDDING_API_URL: 'https://embedding-vm.example/v1/embeddings',
      JINA_EMBEDDING_DIMENSIONS: '2',
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      CACHE: makeEmbeddingCache(),
    };

    const response = await imageSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(imageVectorize.query).toHaveBeenCalledWith(
      [0.6, 0.8],
      expect.objectContaining({
        filter: { galleryId: 'open-access-art', provider: 'nga' },
      })
    );
    expect(payload.data.results.map((result: any) => result.id)).toEqual([
      'second',
      'first',
    ]);
    expect(payload.data.results[0]).toMatchObject({
      id: 'second',
      title: 'Second result',
      similarity: 0.9,
      metadata: expect.any(Object),
    });
  });

  it.each([
    ['missing image', () => new FormData()],
    [
      'multiple images',
      () => {
        const form = makeImageSearchForm();
        form.append(
          'image',
          new File([new Uint8Array([5])], 'second.webp', {
            type: 'image/webp',
          })
        );
        return form;
      },
    ],
    [
      'zero-byte image',
      () =>
        makeImageSearchForm(new File([], 'empty.png', { type: 'image/png' })),
    ],
    [
      'noncanonical MIME type',
      () =>
        makeImageSearchForm(
          new File([new Uint8Array([1])], 'query.jpg', { type: 'image/jpg' })
        ),
    ],
    [
      'oversized image',
      () =>
        makeImageSearchForm(
          new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.webp', {
            type: 'image/webp',
          })
        ),
    ],
    [
      'malformed constraints JSON',
      () => {
        const form = makeImageSearchForm();
        form.set('constraints', '{');
        return form;
      },
    ],
    [
      'array constraints',
      () => {
        const form = makeImageSearchForm();
        form.set('constraints', '[]');
        return form;
      },
    ],
    [
      'null constraints',
      () => {
        const form = makeImageSearchForm();
        form.set('constraints', 'null');
        return form;
      },
    ],
    [
      'unknown constraint field',
      () => {
        const form = makeImageSearchForm();
        form.set('constraints', JSON.stringify({ subject: 'flowers' }));
        return form;
      },
    ],
    [
      'invalid known constraint value',
      () => {
        const form = makeImageSearchForm();
        form.set(
          'constraints',
          JSON.stringify({ classifications: ['Tapestry'] })
        );
        return form;
      },
    ],
    [
      'out-of-order date range',
      () => {
        const form = makeImageSearchForm();
        form.set(
          'constraints',
          JSON.stringify({ dateRange: { startYear: 1900, endYear: 1800 } })
        );
        return form;
      },
    ],
    [
      'non-integer date range',
      () => {
        const form = makeImageSearchForm();
        form.set(
          'constraints',
          JSON.stringify({ dateRange: { startYear: 1700.5, endYear: 1800 } })
        );
        return form;
      },
    ],
    [
      'unknown nested date field',
      () => {
        const form = makeImageSearchForm();
        form.set(
          'constraints',
          JSON.stringify({
            dateRange: { startYear: 1700, endYear: 1800, era: 'CE' },
          })
        );
        return form;
      },
    ],
    [
      'blank artist ID',
      () => {
        const form = makeImageSearchForm();
        form.set('constraints', JSON.stringify({ artistIds: ['  '] }));
        return form;
      },
    ],
    [
      'duplicate topK controls',
      () => {
        const form = makeImageSearchForm();
        form.append('topK', '10');
        form.append('topK', '20');
        return form;
      },
    ],
    [
      'duplicate minScore controls',
      () => {
        const form = makeImageSearchForm();
        form.append('minScore', '0');
        form.append('minScore', '0.5');
        return form;
      },
    ],
  ])(
    'rejects %s before digest allowance, Jina, or Vectorize spend',
    async (_label, makeForm) => {
      const imageVectorize = { query: vi.fn() };
      const cache = makeEmbeddingCache();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      env = {
        ...makeEnv(db),
        VECTORIZE: imageVectorize as unknown as Vectorize,
        QUERY_EMBEDDING_API_TOKEN: 'vm-token',
        QUERY_EMBEDDING_API_URL: 'https://embedding-vm.example/v1/embeddings',
        ENVIRONMENT: 'production',
        PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
        CACHE: cache,
      };

      const response = await imageSearch(
        app,
        env,
        { 'X-API-Key': 'public-search-secret' },
        'nga',
        makeForm()
      );
      const payload = (await response.json()) as any;

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe('INVALID_INPUT');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(imageVectorize.query).not.toHaveBeenCalled();
      expect(cache.get).not.toHaveBeenCalled();
    }
  );

  it('rejects malformed multipart before digest allowance or embedding spend', async () => {
    const imageVectorize = { query: vi.fn() };
    const cache = makeEmbeddingCache();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    env = {
      ...makeEnv(db),
      VECTORIZE: imageVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      CACHE: cache,
    };

    const response = await app.request(
      '/api/v1/orgs/nga/search/image',
      {
        method: 'POST',
        headers: {
          'X-API-Key': 'public-search-secret',
          'CF-Connecting-IP': '203.0.113.42',
          'Content-Type': 'multipart/form-data; boundary=broken',
        },
        body: '--broken\r\nnot-a-valid-part',
      },
      env
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_INPUT');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(imageVectorize.query).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('canonicalizes and mutates every authoritative public image cold-miss identity dimension', () => {
    const buildIdentity = (searchRouteExports as Record<string, unknown>)
      .buildPublicImageSearchIdentity as
      | ((input: Record<string, unknown>) => string)
      | undefined;

    expect(typeof buildIdentity).toBe('function');
    if (!buildIdentity) return;

    const base = {
      version: 'public-image-search-v1',
      contractVersion: '28',
      mode: 'image',
      imageDigest: 'a'.repeat(64),
      orgId: 'open-access-art',
      provider: 'nga',
      index: { version: 'v1', binding: 'VECTORIZE' },
      embedding: {
        provider: 'jina',
        endpoint: 'https://embedding.example/v1/embeddings',
        model: 'jina-clip-v2',
        dimensions: 1024,
      },
      constraints: {
        dateRange: Object.fromEntries([
          ['endYear', 1799],
          ['startYear', 1700],
        ]),
        classifications: ['Painting', 'Painting'],
        mediumFamilies: ['oil'],
        artistIds: ['artist-1'],
      },
      topK: 30,
      minScore: 0,
    };
    const canonicalEquivalent = {
      ...base,
      constraints: {
        artistIds: ['artist-1', 'artist-1'],
        mediumFamilies: ['oil', 'oil'],
        classifications: ['Painting'],
        dateRange: { startYear: 1700, endYear: 1799 },
      },
    };
    const identity = buildIdentity(base);

    expect(buildIdentity(canonicalEquivalent)).toBe(identity);

    const mutations: Array<[string, Record<string, unknown>]> = [
      ['identity version', { ...base, version: 'public-image-search-v2' }],
      ['contract version', { ...base, contractVersion: '29' }],
      ['mode', { ...base, mode: 'image-alternate' }],
      ['image bytes digest', { ...base, imageDigest: 'b'.repeat(64) }],
      [
        'canonical constraints',
        {
          ...base,
          constraints: { ...base.constraints, classifications: ['Drawing'] },
        },
      ],
      [
        'embedding provider',
        {
          ...base,
          embedding: { ...base.embedding, provider: 'alternate' },
        },
      ],
      [
        'embedding endpoint',
        {
          ...base,
          embedding: {
            ...base.embedding,
            endpoint: 'https://embedding.example/v2/embeddings',
          },
        },
      ],
      [
        'embedding model',
        {
          ...base,
          embedding: { ...base.embedding, model: 'jina-clip-v3' },
        },
      ],
      [
        'embedding dimensions',
        {
          ...base,
          embedding: { ...base.embedding, dimensions: 768 },
        },
      ],
      ['index version', { ...base, index: { ...base.index, version: 'v2' } }],
      [
        'index binding',
        { ...base, index: { ...base.index, binding: 'VECTORIZE_V2' } },
      ],
      [
        'resolved org',
        { ...base, orgId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05' },
      ],
      ['provider scope', { ...base, provider: null }],
      ['topK', { ...base, topK: 31 }],
      ['minScore', { ...base, minScore: 0.1 }],
    ];

    expect(
      new Set(mutations.map(([, mutation]) => buildIdentity(mutation))).size
    ).toBe(mutations.length);
    for (const [label, mutation] of mutations) {
      expect.soft(buildIdentity(mutation), label).not.toBe(identity);
    }
  });

  it('rate limits repeated public image-search requests before Jina', async () => {
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({ matches: [] }),
    };
    const cache = makeEmbeddingCache();
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.6, 0.8] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    env = {
      ...makeEnv(db),
      CACHE: cache,
      VECTORIZE: imageVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      QUERY_EMBEDDING_API_URL: 'https://embedding-vm.example/v1/embeddings',
      JINA_EMBEDDING_DIMENSIONS: '2',
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };
    const headers = { 'X-API-Key': 'public-search-secret' };

    for (let index = 0; index < 10; index += 1) {
      expect((await imageSearch(app, env, headers, NGA_ROUTE_ID)).status).toBe(200);
    }
    const limited = await imageSearch(app, env, headers, NGA_ROUTE_ID);
    const payload = (await limited.json()) as any;

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(payload.error.code).toBe('PUBLIC_SEARCH_COLD_MISS_RATE_LIMITED');
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(imageVectorize.query).toHaveBeenCalledTimes(10);
  });

  it('reuses a canonical public search result from KV without rerunning retrieval', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        custom_metadata: JSON.stringify({
          ...JSON.parse(artworkRow.custom_metadata),
          provider: 'nga',
        }),
      }),
    ]);
    const cache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: cache,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };
    const headers = { 'X-API-Key': 'public-search-secret' };
    const body = { query: 'mangrove shore', topK: 100, minScore: 0 };

    const first = await textSearch(app, env, headers, body, 'nga');
    const second = await textSearch(app, env, headers, body, 'nga');
    const secondBody = (await second.json()) as any;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(second.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
    expect(secondBody.data.queryTime).toBe(0);
    expect(secondBody.meta.search).toEqual({
      cacheable: true,
      degradedChannels: [],
    });
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.exactArtistPreflightSql).toHaveLength(1);
    expect(
      vi
        .mocked(cache.get)
        .mock.calls.filter(([key]) =>
          String(key).startsWith('public-search-cold-miss:')
        )
    ).toHaveLength(1);
    expect(
      vi
        .mocked(cache.put)
        .mock.calls.filter(([key]) =>
          String(key).startsWith('public-search-result:')
        )
    ).toHaveLength(1);
  });

  it('rate limits the eleventh unique public cold miss without charging hits', async () => {
    const cache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: cache,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };
    const headers = { 'X-API-Key': 'public-search-secret' };

    for (let index = 0; index < 10; index += 1) {
      const response = await textSearch(app, env, headers, {
        query: `unique public query ${index}`,
        topK: 100,
        minScore: 0,
      }, NGA_ROUTE_ID);
      expect(response.status).toBe(200);
    }

    const cachedHit = await textSearch(app, env, headers, {
      query: 'unique public query 0',
      topK: 100,
      minScore: 0,
    }, NGA_ROUTE_ID);
    const limited = await textSearch(app, env, headers, {
      query: 'unique public query 10',
      topK: 100,
      minScore: 0,
    }, NGA_ROUTE_ID);
    const payload = (await limited.json()) as any;

    expect(cachedHit.status).toBe(200);
    expect(cachedHit.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(limited.headers.get('X-NGA-Search-Limit')).toBe('1000');
    // The 10 cold misses, one cached intentional search, and the rejected
    // eleventh cold miss each consume exactly one NGA lifetime slot.
    expect(limited.headers.get('X-NGA-Search-Used')).toBe('12');
    expect(limited.headers.get('X-NGA-Search-Remaining')).toBe('988');
    expect(payload.error.code).toBe('PUBLIC_SEARCH_COLD_MISS_RATE_LIMITED');
    expect(db.metadataSearchSql).toHaveLength(10);
    expect(db.ngaPublicSearchQuota.used).toBe(12);
  });

  it('caches authenticated NGS searches without drawing from the NGA pool', async () => {
    const cache = makeEmbeddingCache();
    env = { ...makeEnv(db), CACHE: cache };
    const body = { query: 'mangrove shore', topK: 100, minScore: 0 };

    const first = await textSearch(app, env, undefined, body, NGS_ORG_ID);
    const second = await textSearch(app, env, undefined, body, NGS_ORG_ID);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(second.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
    expect(db.metadataSearchSql).toHaveLength(1);
    expect(db.ngaPublicSearchQuota.used).toBe(0);
  });

  it('does not persist degraded canonical public search results', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        custom_metadata: JSON.stringify({
          ...JSON.parse(artworkRow.custom_metadata),
          provider: 'nga',
        }),
      }),
    ]);
    const captionVectorize = { query: vi.fn() };
    const cache = makeEmbeddingCache();
    const run = vi.fn().mockRejectedValue(new Error('embedding unavailable'));
    env = {
      ...makeEnv(db),
      CACHE: cache,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      SEARCH_FUSION_MODE: 'hybrid',
      AI: { run } as unknown as Ai,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };
    const headers = { 'X-API-Key': 'public-search-secret' };
    const body = { query: 'quiet shore', topK: 100, minScore: 0 };

    const first = await textSearch(app, env, headers, body, 'nga');
    const second = await textSearch(app, env, headers, body, 'nga');
    const secondBody = (await second.json()) as any;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(second.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(secondBody.meta.search).toEqual({
      cacheable: false,
      degradedChannels: ['image_embedding', 'caption_embedding'],
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(captionVectorize.query).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(cache.put)
        .mock.calls.filter(([key]) =>
          String(key).startsWith('public-search-result:')
        )
    ).toHaveLength(0);
  });

  it('charges repeated degraded text misses even when the query is identical', async () => {
    const captionVectorize = { query: vi.fn() };
    const cache = makeEmbeddingCache();
    const run = vi.fn().mockRejectedValue(new Error('embedding unavailable'));
    env = {
      ...makeEnv(db),
      CACHE: cache,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      SEARCH_FUSION_MODE: 'hybrid',
      AI: { run } as unknown as Ai,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE: '1',
    };
    const headers = { 'X-API-Key': 'public-search-secret' };
    const body = { query: 'same degraded query', topK: 100, minScore: 0 };

    const first = await textSearch(app, env, headers, body, NGA_ROUTE_ID);
    const second = await textSearch(app, env, headers, body, NGA_ROUTE_ID);
    const payload = (await second.json()) as any;

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(payload.error.code).toBe('PUBLIC_SEARCH_COLD_MISS_RATE_LIMITED');
    expect(run).toHaveBeenCalledOnce();
    expect(captionVectorize.query).not.toHaveBeenCalled();
  });

  it('marks a weighted image channel degraded when its API key is missing', async () => {
    const imageVectorize = { query: vi.fn() };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({ matches: [] }),
    };
    const cache = makeEmbeddingCache();
    env = {
      ...makeEnv(db),
      CACHE: cache,
      VECTORIZE: imageVectorize as unknown as Vectorize,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      SEARCH_FUSION_MODE: 'hybrid',
      AI: {
        run: vi.fn().mockResolvedValue({ data: [new Array(1024).fill(0.01)] }),
      } as unknown as Ai,
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      { query: 'quiet shore', topK: 100, minScore: 0 },
      NGA_ROUTE_ID
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.meta.search).toEqual({
      cacheable: false,
      degradedChannels: ['image_embedding'],
    });
    expect(imageVectorize.query).not.toHaveBeenCalled();
    expect(captionVectorize.query).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(cache.put)
        .mock.calls.filter(([key]) =>
          String(key).startsWith('public-search-result:')
        )
    ).toHaveLength(0);
  });

  it('does not consume quota or keep usage events for invalid requests', async () => {
    const res = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: '' },
      'private-gallery'
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
      const res = await textSearch(
        app,
        env,
        undefined,
        undefined,
        'private-gallery'
      );
      expect(res.status).toBe(200);
    }

    const res = await textSearch(
      app,
      env,
      undefined,
      undefined,
      'private-gallery'
    );
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
    const requests = Array.from({ length: 110 }, () =>
      textSearch(app, env, undefined, undefined, 'private-gallery')
    );
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

    expect(
      (await textSearch(app, env, undefined, undefined, 'private-gallery'))
        .status
    ).toBe(200);
    expect(
      (await textSearch(app, env, undefined, undefined, 'private-gallery'))
        .status
    ).toBe(429);

    vi.setSystemTime(new Date('2026-05-23T00:00:01.000Z'));
    expect(
      (await textSearch(app, env, undefined, undefined, 'private-gallery'))
        .status
    ).toBe(200);

    expect(db.daily.get(usageKey('user', 'user-1', '2026-05-22'))).toEqual({
      used: 1,
      quota: 1,
    });
    expect(db.daily.get(usageKey('user', 'user-1', '2026-05-23'))).toEqual({
      used: 1,
      quota: 1,
    });
  });

  it('interprets and hard-filters NGA century and classification constraints', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-painting-1750',
        year: 1750,
        date_text: '1750',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-drawing-1750',
        year: 1750,
        date_text: '1750',
        classification: 'Drawing',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-painting-1850',
        year: 1850,
        date_text: '1850',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'paintings from 18th century', topK: 100, minScore: 0 },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.interpretation.constraints).toEqual({
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
    });
    expect(payload.data.results.map((row: any) => row.id)).toEqual([
      'nga-painting-1750',
    ]);
  });

  it('hard-filters combined NGA date, classification, and medium constraints', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-valid-oil-painting-1750',
        year: 1750,
        date_text: '1750',
        classification: 'Painting',
        medium: 'Oil on canvas',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-date-violation-oil-painting-1800',
        year: 1800,
        date_text: '1800',
        classification: 'Painting',
        medium: 'Oil on canvas',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-classification-violation-oil-drawing-1750',
        year: 1750,
        date_text: '1750',
        classification: 'Drawing',
        medium: 'Oil on paper',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-medium-violation-watercolor-painting-1750',
        year: 1750,
        date_text: '1750',
        classification: 'Painting',
        medium: 'Watercolor on paper',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'oil paintings after 1700 before 1800',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.interpretation).toMatchObject({
      parserVersion: 'nga-v7',
      constraints: {
        dateRange: { startYear: 1701, endYear: 1799 },
        classifications: ['Painting'],
        mediumFamilies: ['oil'],
      },
    });
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-valid-oil-painting-1750',
    ]);
  });

  it('uses the displayed NGA date as the final temporal-filter backstop', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-broad-range-mismatch',
        year: 1610,
        date_text: 'c. 1630',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
        year_start: 1610,
        year_end: 1690,
      } as any),
      makeArtworkRow({
        id: 'nga-display-date-match',
        year: 1650,
        date_text: '1650',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
        year_start: 1650,
        year_end: 1650,
      } as any),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'paintings from 1650', topK: 100, minScore: 0 },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: any) => row.id)).toEqual([
      'nga-display-date-match',
    ]);
  });

  it('uses the residual semantic query for inferred NGA retrieval', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-landscape-1750',
        title: 'River Landscape',
        year: 1750,
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'landscape paintings from 18th century',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(db.metadataSearchParams[0])).toContain('landscape');
    expect(JSON.stringify(db.metadataSearchParams[0])).not.toContain('18th');
    expect(db.metadataSearchSql[0]).toContain('coalesce(year_end, year) >= ?');
    expect(db.metadataSearchSql[0]).toContain(
      'coalesce(year_start, year) <= ?'
    );
    expect(db.metadataSearchParams[0]).toEqual(
      expect.arrayContaining([1700, 1799])
    );
    expect(db.metadataSearchSql[0]).toContain(
      "nullif(trim(visual_classification), '')"
    );
  });

  it('keeps explicit constraints authoritative while removing stale structured retrieval words', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-explicit-drawing',
        title: 'Validation Study',
        year: 1900,
        classification: 'Drawing',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'validation a6ee6dd2f870 oil paintings after 1700 before 1800',
        topK: 100,
        minScore: 0,
        constraints: { classifications: ['Drawing'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;
    const metadataParams = JSON.stringify(db.metadataSearchParams[0]);

    expect(response.status).toBe(200);
    expect(payload.data.interpretation).toMatchObject({
      semanticQuery: 'validation a6ee6dd2f870',
      constraints: { classifications: ['Drawing'] },
    });
    expect(metadataParams).toContain('validation');
    expect(metadataParams).not.toMatch(/oil|paintings|1700|1800/);
    expect(db.metadataSearchParams[0]).toEqual(
      expect.arrayContaining(['drawing'])
    );
  });

  it('uses a lightweight classification fallback for the exact structured-only live query and caches it', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-live-second-half-painting',
        year: 1760,
        date_text: '1760',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = {
      ...makeEnv(db),
      CACHE: makeEmbeddingCache(),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };
    const request = {
      query: 'paintings from the second half of the 18th century before 1780',
      topK: 100,
      minScore: 0,
    };

    const first = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      request,
      'nga'
    );
    const second = await textSearch(
      app,
      env,
      { 'X-API-Key': 'public-search-secret' },
      request,
      'nga'
    );
    const payload = (await first.json()) as any;

    expect(first.status).toBe(200);
    expect(first.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(second.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
    expect(payload.data.interpretation).toMatchObject({
      semanticQuery: '',
      constraints: {
        dateRange: { startYear: 1750, endYear: 1779 },
        classifications: ['Painting'],
      },
    });
    expect(payload.meta.search).toEqual({
      cacheable: true,
      degradedChannels: [],
    });
    expect(db.metadataSearchParams).toHaveLength(1);
    expect(db.metadataSearchParams[0]?.[0]).toBe('painting');
    expect(JSON.stringify(db.metadataSearchParams[0])).not.toContain(
      'second half'
    );
  });

  it('uses art as the retrieval fallback for a date-only NGA query', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-date-only-fallback',
        year: 1770,
        date_text: '1770',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'before 1780', topK: 100, minScore: 0 },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(db.metadataSearchParams[0]?.[0]).toBe('art');
  });

  it('combines normalized classification and medium retrieval fallbacks without control words', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-marble-sculpture-fallback',
        year: 1720,
        date_text: '1720',
        classification: 'Sculpture',
        medium: 'Marble',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'marble sculptures from the first half of the 18th century',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(db.metadataSearchParams[0]?.[0]).toBe('sculpture marble');
    expect(JSON.stringify(db.metadataSearchParams[0])).not.toContain(
      'first half'
    );
  });

  it('applies NGA hard constraints to vector retrieval before top-K', async () => {
    const religiousPainting = makeArtworkRow({
      id: 'nga-religious-painting-1450',
      title: 'The Annunciation',
      year: 1450,
      classification: 'Painting',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    db = new FakeSearchDb([religiousPainting]);
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: religiousPainting.id, score: 0.92, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'religious paintings from 15th century',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );

    expect(response.status).toBe(200);
    expect(captionVectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: {
          galleryId: 'open-access-art',
          provider: 'nga',
          yearStart: { $lte: 1499 },
          yearEnd: { $gte: 1400 },
          classification: { $in: ['Painting'] },
        },
      })
    );
  });

  it.each([
    {
      label: 'active and passive depicts paraphrases',
      queries: [
        'painting showing a sculpture',
        'painting depicting sculpture',
        'sculpture shown in a painting',
        'sculpture depicted in painting',
      ],
      expectedId: 'nga-relation-painting',
      expectedConstraints: { classifications: ['Painting'] },
      expectedRelation: {
        kind: 'depicts',
        workClassification: 'Painting',
        subjectClassification: 'Sculpture',
      },
    },
    {
      label: 'active and passive features paraphrases',
      queries: [
        'painting featuring sculpture',
        'painting with sculpture',
        'sculpture featured in painting',
      ],
      expectedId: 'nga-relation-painting',
      expectedConstraints: { classifications: ['Painting'] },
      expectedRelation: {
        kind: 'features',
        workClassification: 'Painting',
        subjectClassification: 'Sculpture',
      },
    },
    {
      label: 'active and passive derived-from paraphrases',
      queries: [
        'drawing based on photograph',
        'photograph used as basis for drawing',
      ],
      expectedId: 'nga-relation-drawing',
      expectedConstraints: { classifications: ['Drawing'] },
      expectedRelation: {
        kind: 'derived_from',
        workClassification: 'Drawing',
        sourceClassification: 'Photograph',
      },
    },
    {
      label: 'opposite depicts direction',
      queries: ['sculpture depicting painting'],
      expectedId: 'nga-relation-sculpture',
      expectedConstraints: { classifications: ['Sculpture'] },
      expectedRelation: {
        kind: 'depicts',
        workClassification: 'Sculpture',
        subjectClassification: 'Painting',
      },
    },
  ])('routes $label through balanced relational retrieval', async (fixture) => {
    const relationRows = [
      makeArtworkRow({
        id: 'nga-relation-painting',
        title: 'Carrier Painting Depicting Sculpture',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-relation-sculpture',
        title: 'Sculpture Depicting Painting',
        classification: 'Sculpture',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-relation-drawing',
        title: 'Carrier Drawing Based on Photograph',
        classification: 'Drawing',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-relation-photograph',
        title: 'Photograph Distractor',
        classification: 'Photograph',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ];
    db = new FakeSearchDb(relationRows);
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: relationRows.map((row, index) => ({
          id: row.id,
          score: 0.99 - index * 0.01,
          metadata: {},
        })),
      }),
    };
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };
    const payloads: any[] = [];

    for (const query of fixture.queries) {
      const response = await textSearch(
        app,
        env,
        { 'X-User-Id': 'user-1' },
        { query, topK: 100, minScore: 0 },
        'nga'
      );
      const payload = (await response.json()) as any;
      expect(response.status).toBe(200);
      expect(payload.data.interpretation).toMatchObject({
        parserVersion: 'nga-v7',
        constraints: fixture.expectedConstraints,
        relation: fixture.expectedRelation,
      });
      expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual(
        [fixture.expectedId]
      );
      expect(payload.data.results[0].metadata.search_sources).toContainEqual(
        expect.objectContaining({ channel: 'metadata', weight: 1 })
      );
      payloads.push(payload);
    }

    if (payloads.length > 1) {
      const canonicalSemanticQuery =
        payloads[0].data.interpretation.semanticQuery;
      expect(
        payloads.map((payload) => payload.data.interpretation.semanticQuery)
      ).toEqual(new Array(payloads.length).fill(canonicalSemanticQuery));
    }
  });

  it('keeps combined carrier constraints in every relation channel and after enrichment', async () => {
    const rows = [
      makeArtworkRow({
        id: 'nga-valid-oil-painting-1750-relation',
        title: 'Oil Painting Showing Bronze Sculpture',
        year: 1750,
        date_text: '1750',
        classification: 'Painting',
        medium: 'Oil on canvas',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-sculpture-subject-distractor',
        year: 1750,
        date_text: '1750',
        classification: 'Sculpture',
        medium: 'Bronze',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-drawing-distractor',
        year: 1750,
        date_text: '1750',
        classification: 'Drawing',
        medium: 'Oil on paper',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-photograph-distractor',
        year: 1750,
        date_text: '1750',
        classification: 'Photograph',
        medium: 'Photograph',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-watercolor-painting-distractor',
        year: 1750,
        date_text: '1750',
        classification: 'Painting',
        medium: 'Watercolor on paper',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-late-oil-painting-distractor',
        year: 1850,
        date_text: '1850',
        classification: 'Painting',
        medium: 'Oil on canvas',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ];
    db = new FakeSearchDb(rows);
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: rows.map((row, index) => ({
          id: row.id,
          score: 0.99 - index * 0.01,
          metadata: {},
        })),
      }),
    };
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: '18th-century oil painting showing bronze sculpture',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.interpretation).toMatchObject({
      constraints: {
        dateRange: { startYear: 1700, endYear: 1799 },
        classifications: ['Painting'],
        mediumFamilies: ['oil'],
      },
      relation: {
        kind: 'depicts',
        workClassification: 'Painting',
        subjectClassification: 'Sculpture',
      },
    });
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      'nga-valid-oil-painting-1750-relation',
    ]);
    expect(captionVectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: {
          galleryId: 'open-access-art',
          provider: 'nga',
          yearStart: { $lte: 1799 },
          yearEnd: { $gte: 1700 },
          classification: { $in: ['Painting'] },
          mediumFamily: { $in: ['oil'] },
        },
      })
    );
  });

  it('keeps relation metadata while explicit empty constraints remove inferred carrier filters', async () => {
    const painting = makeArtworkRow({
      id: 'nga-explicit-empty-painting',
      title: 'Painting Showing a Sculpture',
      classification: 'Painting',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    const sculpture = makeArtworkRow({
      id: 'nga-explicit-empty-sculpture',
      classification: 'Sculpture',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    db = new FakeSearchDb([painting, sculpture]);
    env = makeEnv(db);

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'painting showing a sculpture',
        topK: 100,
        minScore: 0,
        constraints: {},
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.interpretation).toMatchObject({
      constraints: {},
      relation: {
        kind: 'depicts',
        workClassification: 'Painting',
        subjectClassification: 'Sculpture',
      },
    });
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      painting.id,
    ]);
    expect(payload.data.interpretation.relationEvidence).toEqual({
      policy: 'visible_subject',
      status: 'verified',
    });
  });

  it('shares canonical relational rows while overlaying each request interpretation', async () => {
    db = new FakeSearchDb([
      makeArtworkRow({
        id: 'nga-cached-relation-painting',
        title: 'Painting Depicting Sculpture',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-cached-relation-painting-2',
        title: 'Second Painting Depicting Sculpture',
        classification: 'Painting',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
      makeArtworkRow({
        id: 'nga-cached-relation-sculpture',
        classification: 'Sculpture',
        custom_metadata: JSON.stringify({ provider: 'nga' }),
      }),
    ]);
    env = {
      ...makeEnv(db),
      CACHE: makeEmbeddingCache(),
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
    };
    const headers = { 'X-API-Key': 'public-search-secret' };

    const active = await textSearch(
      app,
      env,
      headers,
      {
        query: 'painting showing a sculpture',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const passive = await textSearch(
      app,
      env,
      headers,
      {
        query: 'sculpture shown in a painting',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const activePayload = (await active.json()) as any;
    const passivePayload = (await passive.json()) as any;

    expect(active.status).toBe(200);
    expect(active.headers.get('X-Paillette-Search-Cache')).toBe('MISS');
    expect(passive.status).toBe(200);
    expect(passive.headers.get('X-Paillette-Search-Cache')).toBe('KV-FRESH');
    const expectedIds = [
      'nga-cached-relation-painting',
      'nga-cached-relation-painting-2',
    ];
    expect(
      activePayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual(expectedIds);
    expect(
      passivePayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual(expectedIds);
    expect(passivePayload.data.interpretation).toMatchObject({
      originalQuery: 'sculpture shown in a painting',
      relation: {
        kind: 'depicts',
        workClassification: 'Painting',
        subjectClassification: 'Sculpture',
      },
    });
    expect(db.metadataSearchSql).toHaveLength(1);
  });

  it('uses only official catalogue artist relationships as attribution proof', async () => {
    const official = makeArtworkRow({
      id: 'nga-official-after-rembrandt',
      artist: 'Paul Bril',
      classification: 'Painting',
      primary_artist_id: '23812',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: '23812',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist',
              prefix: null,
              suffix: null,
              preferredDisplayName: 'Bril, Paul',
              forwardDisplayName: 'Paul Bril',
              alternativeNames: [],
            },
            {
              constituentId: '1364',
              displayOrder: 2,
              roleType: 'artist',
              role: 'artist after',
              prefix: 'after',
              suffix: null,
              preferredDisplayName: 'Rembrandt, van Rijn',
              forwardDisplayName: 'Rembrandt van Rijn',
              alternativeNames: [],
            },
          ],
        },
      }),
    });
    const imageDistractor = makeArtworkRow({
      id: 'nga-image-rembrandt-distractor',
      artist: 'Frans Hals',
      classification: 'Painting',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    const captionDistractor = makeArtworkRow({
      id: 'nga-caption-rembrandt-distractor',
      artist: 'Anthony van Dyck',
      classification: 'Painting',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    db = new FakeSearchDb([official, imageDistractor, captionDistractor]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: imageDistractor.id, score: 0.99, metadata: {} }],
      }),
    };
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: captionDistractor.id, score: 0.98, metadata: {} }],
      }),
    };
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
      VECTORIZE: imageVectorize as unknown as Vectorize,
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'painting after Rembrandt', topK: 100, minScore: 0 },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      official.id,
    ]);
    expect(payload.data.results[0].metadata.relationEvidence).toEqual({
      source: 'catalogue_artist',
      verified: true,
    });
    expect(imageVectorize.query).not.toHaveBeenCalled();
    expect(captionVectorize.query).not.toHaveBeenCalled();
  });

  it('recalls accented official and alternative names without partial-token matches', async () => {
    const jose = makeArtworkRow({
      id: 'nga-accented-jose',
      artist: 'After José de Ribera',
      classification: 'Painting',
      primary_artist_id: '1364',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: '1364',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist after',
              prefix: 'after',
              suffix: null,
              preferredDisplayName: 'José de Ribera',
              forwardDisplayName: 'José de Ribera',
              alternativeNames: [],
            },
          ],
        },
      }),
    });
    const leBrun = makeArtworkRow({
      id: 'nga-accented-alternative',
      artist: 'After Elisabeth Louise Vigee Le Brun',
      classification: 'Painting',
      primary_artist_id: '2402',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: '2402',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist after',
              prefix: 'after',
              suffix: null,
              preferredDisplayName: 'Le Brun, Elisabeth Louise Vigee',
              forwardDisplayName: 'Elisabeth Louise Vigee Le Brun',
              alternativeNames: ['Élisabeth Louise Vigée Le Brun'],
            },
          ],
        },
      }),
    });
    db = new FakeSearchDb([jose, leBrun]);
    env = { ...makeEnv(db), SEARCH_FUSION_MODE: 'hybrid' };

    const partial = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'painting after Jos', topK: 100, minScore: 0 },
      'nga'
    );
    const joseResponse = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'painting after José de Ribera', topK: 100, minScore: 0 },
      'nga'
    );
    const leBrunResponse = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'painting after Élisabeth Louise Vigée Le Brun',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const partialPayload = (await partial.json()) as any;
    const josePayload = (await joseResponse.json()) as any;
    const leBrunPayload = (await leBrunResponse.json()) as any;

    expect(partial.status).toBe(200);
    expect(partialPayload.data.results).toEqual([]);
    expect(
      josePayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual([jose.id]);
    expect(
      leBrunPayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual([leBrun.id]);
  });

  it('uses the proof accent fold for bounded SQL candidates in both directions', async () => {
    const lowerAccented = makeArtworkRow({
      id: 'nga-lower-accented-official',
      title: 'After José de Ribera',
      artist: 'After josé de ribera',
      classification: 'Painting',
      primary_artist_id: '1364',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: '1364',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist after',
              prefix: 'after',
              suffix: null,
              preferredDisplayName: 'josé de ribera',
              forwardDisplayName: 'josé de ribera',
              alternativeNames: [],
            },
          ],
        },
      }),
    });
    const upperAccented = makeArtworkRow({
      id: 'nga-upper-accented-multiword',
      title: 'A: Accented official form',
      artist: 'After ÉLISABETH LOUISE VIGÉE LE BRUN',
      classification: 'Painting',
      primary_artist_id: '2402',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: '2402',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist after',
              prefix: 'after',
              suffix: null,
              preferredDisplayName: 'ÉLISABETH LOUISE VIGÉE LE BRUN',
              forwardDisplayName: 'ÉLISABETH LOUISE VIGÉE LE BRUN',
              alternativeNames: [],
            },
          ],
        },
      }),
    });
    const accentlessAlternative = makeArtworkRow({
      id: 'nga-accentless-official-alternative',
      title: 'B: Accentless official alternative',
      artist: 'After Louise Le Brun',
      classification: 'Painting',
      primary_artist_id: '579',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: '579',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist after',
              prefix: 'after',
              suffix: null,
              preferredDisplayName: 'Louise Le Brun',
              forwardDisplayName: 'Louise Le Brun',
              alternativeNames: ['Elisabeth Louise Vigee Le Brun'],
            },
          ],
        },
      }),
    });
    db = new FakeSearchDb([
      lowerAccented,
      upperAccented,
      accentlessAlternative,
    ]);
    env = { ...makeEnv(db), SEARCH_FUSION_MODE: 'hybrid' };

    const partial = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'painting after Jos', topK: 100, minScore: 0 },
      'nga'
    );
    const accentlessJose = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'painting after Jose de Ribera', topK: 100, minScore: 0 },
      'nga'
    );
    const accentlessMultiword = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'painting after Elisabeth Louise Vigee Le Brun',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const accentedAlternative = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'painting after Élisabeth Louise Vigée Le Brun',
        topK: 100,
        minScore: 0,
      },
      'nga'
    );
    const partialPayload = (await partial.json()) as any;
    const josePayload = (await accentlessJose.json()) as any;
    const multiwordPayload = (await accentlessMultiword.json()) as any;
    const alternativePayload = (await accentedAlternative.json()) as any;

    expect(partialPayload.data.results).toEqual([]);
    expect(
      josePayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual([lowerAccented.id]);
    expect(
      multiwordPayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual([upperAccented.id, accentlessAlternative.id]);
    expect(
      alternativePayload.data.results.map((row: { id: string }) => row.id)
    ).toEqual([upperAccented.id, accentlessAlternative.id]);
  });

  it('keeps explicit NGA artist IDs primary-only and skips caption retrieval', async () => {
    const primary = makeArtworkRow({
      id: 'nga-primary-artist',
      artist: 'Paul Bril',
      classification: 'Painting',
      primary_artist_id: 'primary',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    const secondaryOnly = makeArtworkRow({
      id: 'nga-secondary-artist',
      artist: 'Paul Bril and Rembrandt van Rijn',
      classification: 'Painting',
      primary_artist_id: 'someone-else',
      custom_metadata: JSON.stringify({
        provider: 'nga',
        ngaArtists: {
          relationships: [
            {
              constituentId: 'someone-else',
              displayOrder: 1,
              roleType: 'artist',
              role: 'artist',
              preferredDisplayName: 'Someone Else',
              forwardDisplayName: 'Someone Else',
              alternativeNames: [],
            },
            {
              constituentId: 'primary',
              displayOrder: 2,
              roleType: 'artist',
              role: 'artist after',
              preferredDisplayName: 'Paul Bril',
              forwardDisplayName: 'Paul Bril',
              alternativeNames: [],
            },
          ],
        },
      }),
    });
    db = new FakeSearchDb([primary, secondaryOnly]);
    const captionVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [
          { id: primary.id, score: 0.9, metadata: {} },
          { id: secondaryOnly.id, score: 0.99, metadata: {} },
        ],
      }),
    };
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
      CAPTION_VECTORIZE: captionVectorize as unknown as Vectorize,
      AI: {
        run: vi.fn().mockResolvedValue({
          data: [new Array(1024).fill(0.01)],
        }),
      } as unknown as Ai,
    };

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      {
        query: 'painting',
        topK: 100,
        minScore: 0,
        constraints: {
          classifications: ['Painting'],
          artistIds: ['primary'],
        },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
      primary.id,
    ]);
    expect(captionVectorize.query).not.toHaveBeenCalled();
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('returns no relational rows and marks unverified when proof is weak', async () => {
    const imageOnly = makeArtworkRow({
      id: 'nga-image-only-relation',
      title: 'Untitled Painting',
      classification: 'Painting',
      custom_metadata: JSON.stringify({ provider: 'nga' }),
    });
    db = new FakeSearchDb([imageOnly]);
    const imageVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: imageOnly.id, score: 0.99, metadata: {} }],
      }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ embedding: [0.6, 0.8] }] }));
    vi.stubGlobal('fetch', fetchMock);
    env = {
      ...makeEnv(db),
      SEARCH_FUSION_MODE: 'hybrid',
      VECTORIZE: imageVectorize as unknown as Vectorize,
      QUERY_EMBEDDING_API_TOKEN: 'vm-token',
      JINA_EMBEDDING_DIMENSIONS: '2',
    };

    const response = await textSearch(
      app,
      env,
      { 'X-User-Id': 'user-1' },
      { query: 'painting depicting sculpture', topK: 100, minScore: 0 },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.results).toEqual([]);
    expect(payload.data.interpretation.relationEvidence).toEqual({
      policy: 'visible_subject',
      status: 'unverified',
    });
  });

  it('rejects unknown explicit NGA constraints', async () => {
    const response = await textSearch(
      app,
      makeEnv(db),
      { 'X-User-Id': 'user-1' },
      {
        query: 'landscape',
        topK: 100,
        minScore: 0,
        constraints: { classifications: ['Definitely Not An NGA Class'] },
      },
      'nga'
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_SEARCH_CONSTRAINTS');
  });
});
