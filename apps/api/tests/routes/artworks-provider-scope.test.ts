import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import artworkRoutes from '../../src/routes/artworks';
import type { Env } from '../../src/index';

const OPEN_ACCESS_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const makeArtwork = (provider: 'nga' | 'artic') => ({
  id: `open-access-art:${provider}:1`,
  org_id: OPEN_ACCESS_ORG_ID,
  gallery_id: OPEN_ACCESS_ORG_ID,
  collection_id: null,
  image_url: `https://example.com/${provider}.jpg`,
  thumbnail_url: `https://example.com/${provider}-thumb.jpg`,
  original_filename: null,
  title: `${provider.toUpperCase()} artwork`,
  artist: null,
  year: null,
  date_text: null,
  medium: null,
  classification: null,
  culture: null,
  origin: null,
  dimensions_height: null,
  dimensions_width: null,
  dimensions_depth: null,
  dimensions_unit: null,
  description: null,
  provenance: null,
  credit_line: null,
  rights: null,
  accession_number: `${provider}-1`,
  source_url: `https://example.com/${provider}/1`,
  source_institution: provider === 'nga' ? 'National Gallery of Art' : 'ArtIC',
  source_collection: null,
  source_record_id: '1',
  field_sources: '{}',
  translations: '{}',
  dominant_colors: null,
  color_palette: null,
  custom_metadata: JSON.stringify({ provider }),
  citation: null,
  created_at: '2026-07-11T00:00:00.000Z',
  updated_at: '2026-07-11T00:00:00.000Z',
  uploaded_by: 'ingest',
  deleted_at: null,
});

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  first<T>() {
    return this.db.first<T>(this.sql, this.params);
  }

  all<T>() {
    return this.db.all<T>(this.sql, this.params);
  }
}

class FakeDb {
  readonly sql: string[] = [];
  private readonly rows = [makeArtwork('nga'), makeArtwork('artic')];

  prepare(sql: string) {
    this.sql.push(sql);
    return new FakeStatement(this, sql);
  }

  private scopedRows(sql: string, params: unknown[]) {
    const provider = sql.includes("json_extract(custom_metadata, '$.provider')")
      ? params.find((param) => param === 'nga')
      : undefined;
    return this.rows.filter((row) => {
      const metadata = JSON.parse(row.custom_metadata);
      return !provider || metadata.provider === provider;
    });
  }

  async first<T>(sql: string, params: unknown[]) {
    if (sql.includes('FROM orgs')) {
      return { id: OPEN_ACCESS_ORG_ID } as T;
    }

    if (sql.includes('COUNT(*)')) {
      return { count: this.scopedRows(sql, params).length } as T;
    }

    if (sql.includes('FROM artworks')) {
      const id = params[0];
      return (this.scopedRows(sql, params).find((row) => row.id === id) ||
        null) as T | null;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]) {
    return {
      success: true,
      results: this.scopedRows(sql, params),
    } as unknown as { success: boolean; results: T[] };
  }
}

describe('NGA artwork provider scope', () => {
  let app: Hono<{ Bindings: Env }>;
  let db: FakeDb;
  let env: Env;

  beforeEach(() => {
    db = new FakeDb();
    env = { DB: db as unknown as D1Database } as Env;
    app = new Hono<{ Bindings: Env }>();
    app.route('/api/v1/orgs/:orgId/artworks', artworkRoutes);
  });

  it('keeps browse results inside the NGA provider', async () => {
    const response = await app.request(
      '/api/v1/orgs/nga/artworks?public_only=true',
      {},
      env
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.data.map((artwork: any) => artwork.id)).toEqual([
      'open-access-art:nga:1',
    ]);
    expect(body.pagination.total).toBe(1);
    expect(
      db.sql
        .filter((sql) => sql.includes('FROM artworks'))
        .every((sql) =>
          sql.includes("json_extract(custom_metadata, '$.provider') = ?")
        )
    ).toBe(true);
  });

  it('rejects a public browse request for a non-public route scope', async () => {
    const response = await app.request(
      '/api/v1/orgs/private-org/artworks?public_only=true',
      {},
      env
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'PUBLIC_SCOPE_FORBIDDEN' },
    });
  });

  it('rejects a query org override that differs from the route org', async () => {
    const response = await app.request(
      '/api/v1/orgs/nga/artworks?public_only=true&org_id=00000000-0000-4000-8000-000000000999',
      {},
      env
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'ORG_SCOPE_MISMATCH' },
    });
  });

  it('rejects detail records owned by a different provider', async () => {
    const response = await app.request(
      '/api/v1/orgs/nga/artworks/open-access-art:artic:1',
      {},
      env
    );

    expect(response.status).toBe(404);
  });

  it('requires authentication for an NGS artwork browse', async () => {
    const response = await app.request(
      '/api/v1/orgs/ngs/artworks?public_only=true',
      {},
      env
    );

    expect(response.status).toBe(401);
  });

  it('requires authentication for a private artwork browse', async () => {
    const response = await app.request(
      '/api/v1/orgs/private-org/artworks',
      {},
      env
    );

    expect(response.status).toBe(401);
  });
});
