import { beforeEach, describe, expect, it, vi } from 'vitest';
import app, { type Env } from '../../src/index';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeManagementDb,
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

  run() {
    return this.db.run(this.sql, this.params);
  }
}

class FakeManagementDb {
  users: Row[] = [];
  orgs: Row[] = [
    {
      id: ORG_ID,
      slug: 'test-org',
      name: 'Test Org',
      settings: '{}',
    },
    {
      id: OTHER_ORG_ID,
      slug: 'other-org',
      name: 'Other Org',
      settings: '{}',
    },
  ];
  artworks: Row[] = [
    this.artwork({
      id: 'shared-artwork-id',
      org_id: OTHER_ORG_ID,
      title: 'Other org artwork',
      source_institution: 'Other Museum',
      source_record_id: 'other-1',
    }),
    this.artwork({
      id: 'existing-source-record',
      org_id: ORG_ID,
      title: 'Old title',
      artist: 'Old artist',
      source_institution: 'National Gallery Singapore',
      source_record_id: 'SRC-1',
      accession_number: 'ACC-1',
    }),
    this.artwork({
      id: 'membership-artwork',
      org_id: ORG_ID,
      title: 'Membership artwork',
    }),
  ];
  collections: Row[] = [];
  collectionArtworks: Row[] = [];
  preparedSql: string[] = [];

  artwork(overrides: Row = {}) {
    return {
      id: 'artwork-id',
      org_id: ORG_ID,
      collection_id: null,
      image_url: null,
      thumbnail_url: null,
      original_filename: null,
      image_hash: null,
      image_url_processed: null,
      processing_status: null,
      frame_removal_confidence: null,
      processed_at: null,
      processing_error: null,
      embedding_id: null,
      title: 'Untitled',
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
      accession_number: null,
      source_url: null,
      source_institution: null,
      source_collection: null,
      source_record_id: null,
      field_sources: '{}',
      translations: '{}',
      dominant_colors: null,
      color_palette: null,
      color_extracted_at: null,
      color_extraction_version: 'v1',
      custom_metadata: '{}',
      citation: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
      uploaded_by: USER_ID,
      deleted_at: null,
      ...overrides,
    };
  }

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  batch(statements: FakeStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes('SELECT id FROM orgs WHERE lower(slug)')) {
      const [slug] = params as [string];
      return (
        this.orgs.find((org) => org.slug === slug)?.id
          ? { id: this.orgs.find((org) => org.slug === slug)!.id }
          : null
      ) as T | null;
    }

    if (sql.includes('SELECT id FROM orgs WHERE id IN')) {
      return (this.orgs.find((org) => org.id === ORG_ID) ?? null) as T | null;
    }

    if (sql.includes('SELECT * FROM artworks WHERE id = ? AND org_id = ?')) {
      const [id, orgId] = params as [string, string];
      return (this.artworks.find(
        (artwork) =>
          artwork.id === id &&
          artwork.org_id === orgId &&
          artwork.deleted_at == null
      ) ?? null) as T | null;
    }

    if (sql.includes('SELECT * FROM artworks WHERE id = ?')) {
      const [id] = params as [string];
      return (this.artworks.find((artwork) => artwork.id === id) ??
        null) as T | null;
    }

    if (sql.includes('FROM artworks') && sql.includes('source_record_id')) {
      const [orgId, sourceRecordId, sourceInstitution] = params as [
        string,
        string,
        string | null,
      ];
      return (this.artworks.find(
        (artwork) =>
          artwork.org_id === orgId &&
          artwork.source_record_id === sourceRecordId &&
          (!sourceInstitution ||
            artwork.source_institution === sourceInstitution) &&
          artwork.deleted_at == null
      ) ?? null) as T | null;
    }

    if (sql.includes('SELECT * FROM collections WHERE id = ? AND org_id = ?')) {
      const [id, orgId] = params as [string, string];
      return (this.collections.find(
        (collection) => collection.id === id && collection.org_id === orgId
      ) ?? null) as T | null;
    }

    if (
      sql.includes('SELECT id FROM collections WHERE id = ? AND org_id = ?')
    ) {
      const [id, orgId] = params as [string, string];
      const collection = this.collections.find(
        (candidate) => candidate.id === id && candidate.org_id === orgId
      );
      return (collection ? { id: collection.id } : null) as T | null;
    }

    if (sql.includes('SELECT id FROM artworks WHERE id = ? AND org_id = ?')) {
      const [id, orgId] = params as [string, string];
      const artwork = this.artworks.find(
        (candidate) => candidate.id === id && candidate.org_id === orgId
      );
      return (artwork ? { id: artwork.id } : null) as T | null;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes('FROM collections') && sql.includes('WHERE org_id = ?')) {
      const [orgId] = params as [string];
      return {
        results: this.collections.filter(
          (collection) => collection.org_id === orgId
        ) as T[],
      };
    }

    if (sql.includes('FROM artworks') && sql.includes('WHERE 1=1')) {
      const orgId = params[0] as string;
      return {
        results: this.artworks.filter(
          (artwork) => artwork.org_id === orgId && artwork.deleted_at == null
        ) as T[],
      };
    }

    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO users')) {
      const [id, email, passwordHash, name, role] = params as string[];
      const existing = this.users.find((user) => user.id === id);
      if (existing) {
        existing.email = email;
        existing.name = name;
      } else {
        this.users.push({
          id,
          email,
          password_hash: passwordHash,
          name,
          role,
        });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('INSERT INTO collections')) {
      const [id, orgId, name, description, thumbnailArtworkId, createdBy] =
        params as [
          string,
          string,
          string,
          string | null,
          string | null,
          string,
        ];
      this.collections.push({
        id,
        org_id: orgId,
        name,
        description,
        artwork_count: 0,
        thumbnail_artwork_id: thumbnailArtworkId,
        created_at: '2026-06-03T00:00:00.000Z',
        created_by: createdBy,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('UPDATE collections')) {
      const id = params.at(-2) as string;
      const orgId = params.at(-1) as string;
      const collection = this.collections.find(
        (candidate) => candidate.id === id && candidate.org_id === orgId
      );
      if (!collection) return { success: true, meta: { changes: 0 } };
      if (sql.includes('name = ?')) collection.name = params[0];
      if (sql.includes('description = ?')) collection.description = params[1];
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('DELETE FROM collections')) {
      const [id, orgId] = params as [string, string];
      const before = this.collections.length;
      this.collections = this.collections.filter(
        (collection) => !(collection.id === id && collection.org_id === orgId)
      );
      return {
        success: true,
        meta: { changes: before - this.collections.length },
      };
    }

    if (sql.includes('INSERT INTO collection_artworks')) {
      const [collectionId, artworkId, position] = params as [
        string,
        string,
        number,
      ];
      const existing = this.collectionArtworks.find(
        (row) =>
          row.collection_id === collectionId && row.artwork_id === artworkId
      );
      if (existing) {
        existing.position = position;
      } else {
        this.collectionArtworks.push({
          collection_id: collectionId,
          artwork_id: artworkId,
          position,
        });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('DELETE FROM collection_artworks')) {
      const [collectionId, artworkId] = params as [string, string];
      const before = this.collectionArtworks.length;
      this.collectionArtworks = this.collectionArtworks.filter(
        (row) =>
          !(row.collection_id === collectionId && row.artwork_id === artworkId)
      );
      return {
        success: true,
        meta: { changes: before - this.collectionArtworks.length },
      };
    }

    if (sql.includes('UPDATE artworks')) {
      const scoped = sql.includes('WHERE id = ? AND org_id = ?');
      const id = scoped ? (params.at(-2) as string) : (params.at(-1) as string);
      const orgId = scoped ? (params.at(-1) as string) : undefined;
      const artwork = this.artworks.find(
        (candidate) =>
          candidate.id === id && (!orgId || candidate.org_id === orgId)
      );
      if (!artwork) return { success: true, meta: { changes: 0 } };
      if (sql.includes('title = ?')) artwork.title = params[0];
      if (sql.includes('artist = ?')) artwork.artist = params[1];
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('INSERT INTO artworks')) {
      const [
        id,
        orgId,
        collectionId,
        imageUrl,
        thumbnailUrl,
        originalFilename,
        imageHash,
        imageUrlProcessed,
        processingStatus,
        frameRemovalConfidence,
        processedAt,
        processingError,
        embeddingId,
        title,
        artist,
        year,
        dateText,
        medium,
        classification,
        culture,
        origin,
        dimensionsHeight,
        dimensionsWidth,
        dimensionsDepth,
        dimensionsUnit,
        description,
        provenance,
        creditLine,
        rights,
        accessionNumber,
        sourceUrl,
        sourceInstitution,
        sourceCollection,
        sourceRecordId,
        fieldSources,
        translations,
        dominantColors,
        colorPalette,
        colorExtractedAt,
        colorExtractionVersion,
        customMetadata,
        citation,
        createdAt,
        updatedAt,
        uploadedBy,
        deletedAt,
      ] = params as unknown[];
      this.artworks.push(
        this.artwork({
          id,
          org_id: orgId,
          collection_id: collectionId,
          image_url: imageUrl,
          thumbnail_url: thumbnailUrl,
          original_filename: originalFilename,
          image_hash: imageHash,
          image_url_processed: imageUrlProcessed,
          processing_status: processingStatus,
          frame_removal_confidence: frameRemovalConfidence,
          processed_at: processedAt,
          processing_error: processingError,
          embedding_id: embeddingId,
          title,
          artist,
          year,
          date_text: dateText,
          medium,
          classification,
          culture,
          origin,
          dimensions_height: dimensionsHeight,
          dimensions_width: dimensionsWidth,
          dimensions_depth: dimensionsDepth,
          dimensions_unit: dimensionsUnit,
          description,
          provenance,
          credit_line: creditLine,
          rights,
          accession_number: accessionNumber,
          source_url: sourceUrl,
          source_institution: sourceInstitution,
          source_collection: sourceCollection,
          source_record_id: sourceRecordId,
          field_sources: fieldSources,
          translations,
          dominant_colors: dominantColors,
          color_palette: colorPalette,
          color_extracted_at: colorExtractedAt,
          color_extraction_version: colorExtractionVersion,
          custom_metadata: customMetadata,
          citation,
          created_at: createdAt,
          updated_at: updatedAt,
          uploaded_by: uploadedBy,
          deleted_at: deletedAt,
        })
      );
      return { success: true, meta: { changes: 1 } };
    }

    return { success: true, meta: { changes: 1 } };
  }
}

const createEnv = (db: FakeManagementDb): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: { delete: vi.fn() } as unknown as R2Bucket,
    VECTORIZE: {} as Vectorize,
    CACHE: {} as KVNamespace,
    AI: {} as Ai,
    EMBEDDING_QUEUE: { send: vi.fn() } as unknown as Queue,
    FRAME_REMOVAL_QUEUE: { send: vi.fn() } as unknown as Queue,
    BUCKET: {} as R2Bucket,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
  }) as Env;

const authHeaders = {
  'Content-Type': 'application/json',
  'X-User-Id': USER_ID,
  'X-User-Email': 'curator@example.com',
};

describe('management API', () => {
  let db: FakeManagementDb;
  let env: Env;

  beforeEach(() => {
    db = new FakeManagementDb();
    env = createEnv(db);
  });

  it('requires authentication for artwork record upserts', async () => {
    const response = await app.fetch(
      new Request(`http://localhost/api/v1/orgs/${ORG_ID}/artworks/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New artwork' }),
      }),
      env
    );

    expect(response.status).toBe(401);
  });

  it('requires authentication for org creation', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/v1/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Unauthenticated Org',
          slug: 'unauthenticated-org',
          ownerId: USER_ID,
          settings: {
            allowPublicAccess: true,
            enableEmbeddingProjector: true,
            defaultLanguage: 'en',
            supportedLanguages: ['en'],
          },
        }),
      }),
      env
    );

    expect(response.status).toBe(401);
  });

  it('creates orgs from the authenticated principal without ownerId in the body', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/v1/orgs', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Authenticated Org',
          slug: 'authenticated-org',
          settings: {
            allowPublicAccess: true,
            enableEmbeddingProjector: true,
            defaultLanguage: 'en',
            supportedLanguages: ['en'],
          },
        }),
      }),
      env
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.data.owner_id).toBe(USER_ID);
  });

  it('does not update an artwork outside the route org', async () => {
    const response = await app.fetch(
      new Request(
        `http://localhost/api/v1/orgs/${ORG_ID}/artworks/shared-artwork-id`,
        {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ title: 'Should not update' }),
        }
      ),
      env
    );

    expect(response.status).toBe(404);
    expect(
      db.artworks.find((artwork) => artwork.id === 'shared-artwork-id')?.title
    ).toBe('Other org artwork');
  });

  it('upserts artwork records by source identity within the route org', async () => {
    const response = await app.fetch(
      new Request(`http://localhost/api/v1/orgs/${ORG_ID}/artworks/upsert`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          source_institution: 'National Gallery Singapore',
          source_record_id: 'SRC-1',
          title: 'Updated title',
          artist: 'Updated artist',
          field_sources: { title: 'ngs' },
          custom_metadata: { catalogue: 'ngs' },
        }),
      }),
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(false);
    expect(body.data.artwork.title).toBe('Updated title');
    expect(
      db.artworks.find((artwork) => artwork.id === 'existing-source-record')
        ?.artist
    ).toBe('Updated artist');
  });

  it('creates an artwork record when upsert finds no existing record', async () => {
    const response = await app.fetch(
      new Request(`http://localhost/api/v1/orgs/${ORG_ID}/artworks/upsert`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 'created-record',
          source_institution: 'National Gallery Singapore',
          source_record_id: 'SRC-2',
          title: 'Created title',
          artist: 'Created artist',
          medium: 'Ink on paper',
          description: 'Created description',
          accession_number: 'ACC-2',
          field_sources: { title: 'ngs' },
          custom_metadata: { catalogue: 'ngs' },
        }),
      }),
      env
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(true);
    expect(body.data.artwork).toMatchObject({
      id: 'created-record',
      org_id: ORG_ID,
      title: 'Created title',
      artist: 'Created artist',
      medium: 'Ink on paper',
      description: 'Created description',
      accession_number: 'ACC-2',
    });
  });

  it('creates and updates collections through org-scoped routes', async () => {
    const createResponse = await app.fetch(
      new Request(`http://localhost/api/v1/orgs/${ORG_ID}/collections`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 'national-collection',
          name: 'National Collection',
          description: 'Original description',
        }),
      }),
      env
    );

    expect(createResponse.status).toBe(201);
    expect(db.collections).toHaveLength(1);
    expect(db.collections[0]).toMatchObject({
      id: 'national-collection',
      org_id: ORG_ID,
      created_by: USER_ID,
    });

    const updateResponse = await app.fetch(
      new Request(
        `http://localhost/api/v1/orgs/${ORG_ID}/collections/national-collection`,
        {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({
            name: 'National Collection Updated',
            description: 'Updated description',
          }),
        }
      ),
      env
    );

    expect(updateResponse.status).toBe(200);
    expect(db.collections[0].name).toBe('National Collection Updated');
  });

  it('adds and removes artworks from collections with org checks', async () => {
    db.collections.push({
      id: 'national-collection',
      org_id: ORG_ID,
      name: 'National Collection',
      description: null,
      artwork_count: 0,
      thumbnail_artwork_id: null,
      created_at: '2026-06-03T00:00:00.000Z',
      created_by: USER_ID,
    });

    const addResponse = await app.fetch(
      new Request(
        `http://localhost/api/v1/orgs/${ORG_ID}/collections/national-collection/artworks`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            artwork_id: 'membership-artwork',
            position: 3,
          }),
        }
      ),
      env
    );

    expect(addResponse.status).toBe(200);
    expect(db.collectionArtworks).toContainEqual({
      collection_id: 'national-collection',
      artwork_id: 'membership-artwork',
      position: 3,
    });

    const removeResponse = await app.fetch(
      new Request(
        `http://localhost/api/v1/orgs/${ORG_ID}/collections/national-collection/artworks/membership-artwork`,
        {
          method: 'DELETE',
          headers: authHeaders,
        }
      ),
      env
    );

    expect(removeResponse.status).toBe(200);
    expect(db.collectionArtworks).toHaveLength(0);
  });

  it('lists collection and record management tools over MCP', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      }),
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    const toolNames = body.result.tools.map(
      (tool: { name: string }) => tool.name
    );
    expect(toolNames).toContain('upsert_artwork_record');
    expect(toolNames).toContain('list_collections');
    expect(toolNames).toContain('upsert_collection');
    expect(toolNames).toContain('add_artwork_to_collection');
    expect(toolNames).toContain('remove_artwork_from_collection');
  });
});
