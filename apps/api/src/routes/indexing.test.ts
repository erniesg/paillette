import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../index';
import {
  INDEXING_CAPS,
  WEBMCP_INDEX_ORG_ID,
  buildCaptionText,
  buildJobStatus,
  deriveCollectionSuggestions,
  inferMimeType,
  planIndexJob,
  sanitizeItemMetadata,
  titleFromFilename,
  type JobStatusRow,
  type SuggestionSourceRow,
} from './indexing';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

// ---------------------------------------------------------------------------
// Test doubles. The database is real SQLite loaded from the shipped schema, so
// constraints, triggers and foreign keys behave as they do in D1.
// ---------------------------------------------------------------------------

const SCHEMA = readFileSync(
  new URL('../../../../packages/database/src/schema.sql', import.meta.url),
  'utf8'
);

type BindValue = string | number | null;

const createD1 = (sqlite: NodeDatabaseSync) => {
  const prepare = (sql: string) => {
    let bound: BindValue[] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        bound = args.map((value) => {
          if (value === undefined || value === null) return null;
          if (typeof value === 'boolean') return value ? 1 : 0;
          if (typeof value === 'number' || typeof value === 'string') return value;
          return String(value);
        });
        return statement;
      },
      first: async <T>() => (sqlite.prepare(sql).get(...bound) as T) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...bound) as T[] }),
      run: async () => {
        const info = sqlite.prepare(sql).run(...bound);
        return { meta: { changes: Number(info.changes) } };
      },
    };
    return statement;
  };

  return {
    prepare,
    batch: async (statements: Array<ReturnType<typeof prepare>>) => {
      const output = [];
      for (const statement of statements) output.push(await statement.run());
      return output;
    },
  };
};

const createR2 = () => {
  const objects = new Map<string, ArrayBuffer>();
  return {
    objects,
    put: async (key: string, value: ArrayBuffer) => {
      objects.set(key, value);
      return { key };
    },
    get: async (key: string) => {
      const value = objects.get(key);
      if (!value) return null;
      return {
        body: value,
        httpEtag: `"${key}"`,
        writeHttpMetadata: () => undefined,
      };
    },
  };
};

const createVectorize = () => {
  const vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, unknown>;
  }> = [];
  return {
    vectors,
    upsert: async (incoming: typeof vectors) => {
      vectors.push(...incoming);
      return { count: incoming.length };
    },
    query: async (
      _values: number[],
      options: { topK?: number; filter?: Record<string, unknown> }
    ) => ({
      matches: vectors
        .filter((vector) =>
          Object.entries(options.filter || {}).every(
            ([key, value]) => vector.metadata[key] === value
          )
        )
        .slice(0, options.topK ?? 10)
        .map((vector, index) => ({
          id: vector.id,
          score: 0.9 - index * 0.01,
          metadata: vector.metadata,
        })),
    }),
  };
};

const createKv = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
};

const jinaEmbedding = () =>
  Array.from({ length: 1024 }, (_, index) => (index % 7) / 10);

const createEnv = (sqlite: NodeDatabaseSync) => ({
  ENVIRONMENT: 'test',
  API_VERSION: 'v1',
  EMBEDDING_INDEX_VERSION: 'v2',
  JINA_API_KEY: 'test-jina-key',
  JINA_MULTIMODAL_MODEL: 'jina-clip-v2',
  JINA_EMBEDDING_DIMENSIONS: '1024',
  JINA_TEXT_MODEL: 'jina-embeddings-v5-text-small',
  JINA_TEXT_EMBEDDING_DIMENSIONS: '1024',
  DB: createD1(sqlite),
  IMAGES: createR2(),
  VECTORIZE_V2: createVectorize(),
  CAPTION_VECTORIZE_V2: createVectorize(),
  CACHE: createKv(),
});

const BASE = 'https://api.test/api/v1/public-index';

const pngBytes = () =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

const createJob = async (
  env: ReturnType<typeof createEnv>,
  files: Array<{ name: string; size: number }>,
  collectionName = 'Studio scans'
) => {
  const response = await app.fetch(
    new Request(`${BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionName, orgId: 'nga', files }),
    }),
    env as never
  );
  return { response, payload: (await response.json()) as any };
};

const postBatch = async (
  env: ReturnType<typeof createEnv>,
  jobId: string,
  entries: Array<{ name: string; type?: string; bytes?: Uint8Array }>,
  metadata?: Record<string, unknown>
) => {
  const form = new FormData();
  for (const entry of entries) {
    form.append(
      'files',
      new File([entry.bytes ?? pngBytes()], entry.name, {
        type: entry.type ?? 'image/png',
      })
    );
  }
  if (metadata) form.append('metadata', JSON.stringify(metadata));

  const response = await app.fetch(
    new Request(`${BASE}/jobs/${jobId}/items`, { method: 'POST', body: form }),
    env as never
  );
  return { response, payload: (await response.json()) as any };
};

// ---------------------------------------------------------------------------

describe('indexing job planning', () => {
  it('accepts supported images and reports every rejection with a reason', () => {
    const plan = planIndexJob([
      { name: 'one.jpg', size: 1000 },
      { name: 'notes.txt', size: 10 },
      { name: 'two.PNG', size: 1000 },
      { name: 'huge.jpg', size: INDEXING_CAPS.maxFileBytes + 1 },
      { name: 'one.jpg', size: 1000 },
    ]);

    expect(plan.accepted).toEqual(['one.jpg', 'two.PNG']);
    const byName = new Map(plan.entries.map((entry) => [entry.name, entry]));
    expect(byName.get('notes.txt')?.reason).toMatch(/not a supported image/i);
    expect(byName.get('huge.jpg')?.reason).toMatch(/per-image limit/i);
    expect(plan.notices.join(' ')).toMatch(/1 non-image file/);
  });

  it('caps the file count and says so rather than truncating silently', () => {
    const files = Array.from(
      { length: INDEXING_CAPS.maxFilesPerJob + 5 },
      (_, index) => ({ name: `image-${index}.jpg`, size: 1000 })
    );

    const plan = planIndexJob(files);

    expect(plan.accepted).toHaveLength(INDEXING_CAPS.maxFilesPerJob);
    expect(plan.notices.join(' ')).toContain(
      `Only the first ${INDEXING_CAPS.maxFilesPerJob} images are indexed; 5 were skipped.`
    );
  });

  it('stops at the total byte budget before the file-count cap bites', () => {
    // Each file is under the per-image limit, so only the job budget can stop it.
    const size = INDEXING_CAPS.maxFileBytes - 1;
    const count = Math.ceil(INDEXING_CAPS.maxTotalBytes / size) + 3;
    expect(count).toBeLessThanOrEqual(INDEXING_CAPS.maxFilesPerJob);

    const plan = planIndexJob(
      Array.from({ length: count }, (_, index) => ({
        name: `image-${index}.jpg`,
        size,
      }))
    );

    expect(plan.accepted.length).toBe(
      Math.floor(INDEXING_CAPS.maxTotalBytes / size)
    );
    expect(plan.notices.join(" ")).toMatch(/120MB job budget was reached/i);
  });

  it('recognises image types from extension when the browser sends none', () => {
    expect(inferMimeType('a.JPG')).toBe('image/jpeg');
    expect(inferMimeType('a.bin', 'image/webp')).toBe('image/webp');
    expect(inferMimeType('a.bin', 'application/octet-stream')).toBeNull();
    expect(inferMimeType('scan.tiff')).toBeNull();
  });
});

describe('item metadata', () => {
  it('derives a readable title from a filename', () => {
    expect(titleFromFilename('folder/red_barn-1954.jpg')).toBe('red barn 1954');
  });

  it('drops values it cannot trust rather than guessing', () => {
    const metadata = sanitizeItemMetadata({
      title: '  Sunrise  ',
      artist: 42,
      year: '1954',
      medium: '',
      description: null,
    });

    expect(metadata.title).toBe('Sunrise');
    expect(metadata.artist).toBeNull();
    expect(metadata.year).toBe(1954);
    expect(metadata.medium).toBeNull();
  });

  it('builds caption text from whatever metadata exists', () => {
    expect(
      buildCaptionText(
        sanitizeItemMetadata({ title: 'Sunrise', artist: 'A. Painter', year: 1954 }),
        'sunrise.jpg'
      )
    ).toBe('Sunrise. A. Painter. 1954');

    expect(buildCaptionText(sanitizeItemMetadata({}), 'red_barn.jpg')).toBe(
      'red barn'
    );
  });
});

describe('job status payload', () => {
  const row: JobStatusRow = {
    id: 'job-1',
    org_id: WEBMCP_INDEX_ORG_ID,
    collection_id: 'collection-1',
    collection_name: 'Studio scans',
    state: 'running',
    total: 4,
    processed: 2,
    failed: 1,
    notice: '1 non-image file(s) skipped.',
    error_message: null,
    created_at: 'now',
    updated_at: 'now',
    completed_at: null,
  };

  it('matches the contract the WebMCP tool depends on', () => {
    const status = buildJobStatus(row, [{ file: 'a.txt', message: 'skipped' }]);

    expect(status).toMatchObject({
      jobId: 'job-1',
      state: 'running',
      processed: 2,
      total: 4,
      collectionId: 'collection-1',
      errors: [{ file: 'a.txt', message: 'skipped' }],
    });
    expect(status.searchable).toBe(true);
    expect(status.notice).toContain('non-image');
  });

  it('reports nothing searchable before the first image lands', () => {
    expect(buildJobStatus({ ...row, processed: 0 }, []).searchable).toBe(false);
  });
});

describe('collection suggestions', () => {
  const metadataRows: SuggestionSourceRow[] = [
    {
      title: 'Sunrise',
      artist: 'A. Painter',
      year: 1954,
      medium: 'Oil on canvas',
      classification: 'Painting',
    },
    {
      title: 'Harbor at Dusk',
      artist: 'A. Painter',
      year: 1961,
      medium: 'Oil on canvas',
      classification: 'Painting',
    },
    {
      title: 'Study in Grey',
      artist: 'B. Sculptor',
      year: 1972,
      medium: 'Bronze',
      classification: 'Sculpture',
    },
  ];

  it('grounds suggestions in real catalogue metadata when it exists', () => {
    const bundle = deriveCollectionSuggestions(metadataRows, () => new Date(0));

    expect(bundle.source).toBe('metadata');
    expect(bundle.generatedAt).toBe(new Date(0).toISOString());
    // The most frequent artist is included, even though era leads.
    expect(bundle.suggestions).toContainEqual(
      expect.objectContaining({ type: 'artist', query: 'A. Painter' })
    );
    expect(bundle.suggestions.map((s) => s.type)).toContain('classification');
    expect(bundle.suggestions.map((s) => s.type)).toContain('medium');
    expect(bundle.suggestions.map((s) => s.type)).toContain('era');
    const era = bundle.suggestions.find((s) => s.type === 'era');
    expect(era?.query).toBe('1954 to 1972');
    // Every suggested query should be something the search box can run as-is.
    for (const suggestion of bundle.suggestions) {
      expect(suggestion.query.trim()).not.toBe('');
      expect(suggestion.id).toMatch(/^[a-z]+:/);
    }
  });

  it('falls back to filename-derived keywords and says so when there is no CSV', () => {
    const filenameRows: SuggestionSourceRow[] = [
      { title: 'red barn field', artist: null, year: null, medium: null, classification: null },
      { title: 'red barn field', artist: null, year: null, medium: null, classification: null },
      { title: 'sunset over harbor', artist: null, year: null, medium: null, classification: null },
      { title: 'img 0042', artist: null, year: null, medium: null, classification: null },
    ];

    const bundle = deriveCollectionSuggestions(filenameRows);

    expect(bundle.source).toBe('filenames');
    expect(bundle.suggestions.every((s) => s.type === 'keyword')).toBe(true);
    // A camera-default name carries no signal and must not become a suggestion.
    expect(bundle.suggestions.some((s) => s.query === 'img 0042')).toBe(false);
    expect(bundle.suggestions.some((s) => s.query === 'red barn field')).toBe(
      true
    );
  });

  it('offers broad subject queries when filenames are accession numbers', () => {
    // The archive the demo picker ships is exactly this shape: no CSV, and
    // filenames like `nga-140010.jpg`. "Nga 140010" clears a length check but
    // embeds to noise, so it must never reach a visitor as a suggestion.
    const opaqueRows: SuggestionSourceRow[] = [
      'nga 140010',
      'nga 54131',
      'nga 167057',
      'nga 214115',
    ].map((title) => ({
      title,
      artist: null,
      year: null,
      medium: null,
      classification: null,
    }));

    const bundle = deriveCollectionSuggestions(opaqueRows);

    expect(bundle.source).toBe('generic');
    expect(bundle.suggestions.every((s) => s.type === 'subject')).toBe(true);
    expect(bundle.suggestions.map((s) => s.query)).toContain('a landscape');
    for (const suggestion of bundle.suggestions) {
      expect(suggestion.query).not.toMatch(/\d/);
      expect(suggestion.query).not.toMatch(/nga/i);
    }
  });

  it('is honest about having nothing to suggest rather than inventing queries', () => {
    const bundle = deriveCollectionSuggestions([]);
    expect(bundle.source).toBe('filenames');
    expect(bundle.suggestions).toEqual([]);
  });
});

describe('collection suggestions, real-catalogue edge cases', () => {
  // Every case here came off a live run against a real museum export.
  const row = (over: Partial<SuggestionSourceRow>): SuggestionSourceRow => ({
    title: 'A work',
    artist: 'A. Painter',
    year: 1954,
    medium: 'Oil on canvas',
    classification: 'Painting',
    ...over,
  });

  it('does not offer an anonymous artist as a search', () => {
    const rows = [
      row({ artist: 'Unknown' }),
      row({ artist: 'Unknown' }),
      row({ artist: 'Unknown' }),
      row({ artist: 'Rosa Bonheur' }),
    ];
    const { suggestions } = deriveCollectionSuggestions(rows, () => new Date(0));
    expect(suggestions.some((s) => /unknown/i.test(s.query))).toBe(false);
  });

  it('ignores an implausible year rather than letting it define the era', () => {
    // "12" is an accession number that landed in the year column.
    const rows = [
      row({ year: 12 }),
      row({ year: 1892 }),
      row({ year: 1904 }),
      row({ year: 1911 }),
      row({ year: 1923 }),
    ];
    const era = deriveCollectionSuggestions(rows, () => new Date(0)).suggestions.find(
      (s) => s.type === 'era'
    );
    expect(era?.label).not.toMatch(/\b12\b/);
  });

  it('skips a medium too long to read on a chip', () => {
    const verbose =
      'Black chalk, stumped, and white chalk; framing lines in black chalk';
    const rows = [row({ medium: verbose }), row({ medium: verbose })];
    const { suggestions } = deriveCollectionSuggestions(rows, () => new Date(0));
    expect(suggestions.some((s) => s.query === verbose)).toBe(false);
  });
});

describe('indexing job lifecycle', () => {
  let sqlite: NodeDatabaseSync;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(SCHEMA);
    env = createEnv(sqlite);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ data: [{ embedding: jinaEmbedding() }] })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sqlite.close();
  });

  it('creates a job and collection without authentication', async () => {
    const { response, payload } = await createJob(env, [
      { name: 'a.jpg', size: 1000 },
      { name: 'readme.txt', size: 10 },
    ]);

    expect(response.status).toBe(201);
    expect(payload.data.jobId).toBeTruthy();
    expect(payload.data.collectionId).toBeTruthy();
    expect(payload.data.orgId).toBe(WEBMCP_INDEX_ORG_ID);
    expect(payload.data.accepted).toEqual(['a.jpg']);
    expect(payload.data.skipped).toEqual([
      { file: 'readme.txt', message: expect.stringMatching(/not a supported image/i) },
    ]);

    const collection = sqlite
      .prepare('SELECT name, org_id FROM collections WHERE id = ?')
      .get(payload.data.collectionId) as { name: string; org_id: string };
    expect(collection).toMatchObject({
      name: 'Studio scans',
      org_id: WEBMCP_INDEX_ORG_ID,
    });
  });

  it('says plainly that anonymous indexing writes to the sandbox, not the requested org', async () => {
    const { payload } = await createJob(env, [{ name: 'a.jpg', size: 10 }]);
    expect(payload.data.notice).toContain('webmcp-index');
    expect(payload.data.notice).toContain('nga');
  });

  it('indexes a batch into D1, R2 and both vector indexes', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'red_barn.jpg', size: 1000 },
    ]);

    const { response, payload } = await postBatch(
      env,
      created.data.jobId,
      [{ name: 'red_barn.jpg', type: 'image/jpeg' }],
      { 'red_barn.jpg': { title: 'Red Barn', artist: 'A. Painter', year: 1954 } }
    );

    expect(response.status).toBe(200);
    expect(payload.data.processed).toBe(1);
    expect(payload.data.total).toBe(1);
    expect(payload.data.batch[0]).toMatchObject({ file: 'red_barn.jpg', ok: true });

    const artwork = sqlite
      .prepare('SELECT title, artist, year, org_id, collection_id FROM artworks')
      .get() as Record<string, unknown>;
    expect(artwork).toMatchObject({
      title: 'Red Barn',
      artist: 'A. Painter',
      year: 1954,
      org_id: WEBMCP_INDEX_ORG_ID,
      collection_id: created.data.collectionId,
    });

    expect(env.IMAGES.objects.size).toBe(1);
    expect(env.VECTORIZE_V2.vectors).toHaveLength(1);
    expect(env.VECTORIZE_V2.vectors[0]!.metadata).toMatchObject({
      galleryId: WEBMCP_INDEX_ORG_ID,
      indexJobId: created.data.jobId,
      channel: 'image',
    });
    expect(env.CAPTION_VECTORIZE_V2.vectors).toHaveLength(1);

    // The collection trigger keeps the visible count honest.
    const collection = sqlite
      .prepare('SELECT artwork_count FROM collections WHERE id = ?')
      .get(created.data.collectionId) as { artwork_count: number };
    expect(collection.artwork_count).toBe(1);
  });

  it('ignores a re-sent batch instead of indexing the same image twice', async () => {
    // The client retries a batch when the response is lost, not only when the
    // server rejected it. Re-indexing would mint a second artwork, a second R2
    // object and a second vector for one image, and push processed past total.
    const { payload: created } = await createJob(env, [
      { name: 'red_barn.jpg', size: 1000 },
    ]);
    const files = [{ name: 'red_barn.jpg', type: 'image/jpeg' }];

    await postBatch(env, created.data.jobId, files);
    const { response, payload } = await postBatch(env, created.data.jobId, files);

    expect(response.status).toBe(200);
    expect(payload.data.batch[0]).toMatchObject({
      file: 'red_barn.jpg',
      ok: true,
    });
    // Counted once, so the progress bar can never read more than 100%.
    expect(payload.data.processed).toBe(1);
    expect(payload.data.total).toBe(1);

    const artworkCount = sqlite
      .prepare('SELECT COUNT(*) AS n FROM artworks')
      .get() as { n: number };
    expect(artworkCount.n).toBe(1);
    expect(env.IMAGES.objects.size).toBe(1);
    expect(env.VECTORIZE_V2.vectors).toHaveLength(1);
    expect(env.CAPTION_VECTORIZE_V2.vectors).toHaveLength(1);
  });

  it('falls back to a filename title when no sidecar metadata is supplied', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'winter_light.jpg', size: 1000 },
    ]);
    await postBatch(env, created.data.jobId, [
      { name: 'winter_light.jpg', type: 'image/jpeg' },
    ]);

    const artwork = sqlite.prepare('SELECT title FROM artworks').get() as {
      title: string;
    };
    expect(artwork.title).toBe('winter light');
  });

  it('keeps partial failure non-fatal and reports it per file', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'good.jpg', size: 1000 },
      { name: 'bad.jpg', size: 1000 },
    ]);

    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        // Fail the image embedding for the second file only.
        return call === 3
          ? Response.json({ detail: 'rate limited' }, { status: 429 })
          : Response.json({ data: [{ embedding: jinaEmbedding() }] });
      })
    );

    const { payload } = await postBatch(env, created.data.jobId, [
      { name: 'good.jpg', type: 'image/jpeg' },
      { name: 'bad.jpg', type: 'image/jpeg' },
    ]);

    expect(payload.data.processed).toBe(1);
    expect(payload.data.failed).toBe(1);
    expect(payload.data.errors).toEqual([
      { file: 'bad.jpg', message: expect.stringContaining('rate limited') },
    ]);
    expect(payload.data.batch).toEqual([
      expect.objectContaining({ file: 'good.jpg', ok: true }),
      expect.objectContaining({ file: 'bad.jpg', ok: false }),
    ]);
  });

  it('rejects a non-image that slips past the client plan', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'a.jpg', size: 1000 },
    ]);

    const { payload } = await postBatch(env, created.data.jobId, [
      { name: 'payload.bin', type: 'application/octet-stream' },
    ]);

    expect(payload.data.batch[0]).toMatchObject({
      file: 'payload.bin',
      ok: false,
      message: 'Unsupported image type',
    });
    expect(env.IMAGES.objects.size).toBe(0);
  });

  it('refuses an oversized batch', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'a.jpg', size: 1000 },
    ]);

    const { response } = await postBatch(
      env,
      created.data.jobId,
      Array.from({ length: INDEXING_CAPS.maxBatchSize + 1 }, (_, index) => ({
        name: `image-${index}.jpg`,
        type: 'image/jpeg',
      }))
    );

    expect(response.status).toBe(400);
  });

  it('moves queued -> running -> complete and refuses writes after completion', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'a.jpg', size: 1000 },
    ]);
    const jobId = created.data.jobId;

    const queued = await app.fetch(
      new Request(`${BASE}/jobs/${jobId}`),
      env as never
    );
    expect(((await queued.json()) as any).data.state).toBe('queued');

    await postBatch(env, jobId, [{ name: 'a.jpg', type: 'image/jpeg' }]);
    const running = (await (
      await app.fetch(new Request(`${BASE}/jobs/${jobId}`), env as never)
    ).json()) as any;
    expect(running.data.state).toBe('running');
    expect(running.data.searchable).toBe(true);

    const completed = (await (
      await app.fetch(
        new Request(`${BASE}/jobs/${jobId}/complete`, { method: 'POST' }),
        env as never
      )
    ).json()) as any;
    expect(completed.data.state).toBe('complete');
    expect(completed.data.processed).toBe(1);

    const { response: afterComplete } = await postBatch(env, jobId, [
      { name: 'b.jpg', type: 'image/jpeg' },
    ]);
    expect(afterComplete.status).toBe(409);
  });

  it('adds suggested searches to the status payload only once the job completes, and caches them', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'sunrise.jpg', size: 1000 },
    ]);
    const jobId = created.data.jobId;

    await postBatch(
      env,
      jobId,
      [{ name: 'sunrise.jpg', type: 'image/jpeg' }],
      { 'sunrise.jpg': { artist: 'A. Painter', medium: 'Oil on canvas' } }
    );

    const running = (await (
      await app.fetch(new Request(`${BASE}/jobs/${jobId}`), env as never)
    ).json()) as any;
    expect(running.data.suggestions).toBeNull();

    const completed = (await (
      await app.fetch(
        new Request(`${BASE}/jobs/${jobId}/complete`, { method: 'POST' }),
        env as never
      )
    ).json()) as any;
    expect(completed.data.suggestions.source).toBe('metadata');
    expect(
      completed.data.suggestions.suggestions.some(
        (s: { query: string }) => s.query === 'A. Painter'
      )
    ).toBe(true);

    // Second read must return the same bundle from cache, not a fresh compute.
    const polledAgain = (await (
      await app.fetch(new Request(`${BASE}/jobs/${jobId}`), env as never)
    ).json()) as any;
    expect(polledAgain.data.suggestions).toEqual(completed.data.suggestions);
  });

  it('marks a job failed only when nothing at all was indexed', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'a.jpg', size: 1000 },
    ]);

    const payload = (await (
      await app.fetch(
        new Request(`${BASE}/jobs/${created.data.jobId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'The browser tab was closed.' }),
        }),
        env as never
      )
    ).json()) as any;

    expect(payload.data.state).toBe('failed');
    expect(payload.data.notice).toContain('browser tab was closed');
  });

  it('returns 404 for an unknown job instead of leaking whether it existed', async () => {
    const response = await app.fetch(
      new Request(`${BASE}/jobs/${crypto.randomUUID()}`),
      env as never
    );
    expect(response.status).toBe(404);
  });

  it('makes the indexed collection immediately searchable', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'red_barn.jpg', size: 1000 },
    ]);
    await postBatch(
      env,
      created.data.jobId,
      [{ name: 'red_barn.jpg', type: 'image/jpeg' }],
      { 'red_barn.jpg': { title: 'Red Barn' } }
    );

    const payload = (await (
      await app.fetch(
        new Request(`${BASE}/jobs/${created.data.jobId}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'a red farm building', topK: 5 }),
        }),
        env as never
      )
    ).json()) as any;

    expect(payload.data.results).toHaveLength(1);
    expect(payload.data.results[0]).toMatchObject({ title: 'Red Barn' });
    expect(payload.data.results[0].imageUrl).toMatch(
      /^\/api\/public-index\/assets\//
    );
  });

  it('serves an indexed image only from the sandbox org', async () => {
    const { payload: created } = await createJob(env, [
      { name: 'a.jpg', size: 1000 },
    ]);
    await postBatch(env, created.data.jobId, [
      { name: 'a.jpg', type: 'image/jpeg' },
    ]);

    const assetId = (
      sqlite.prepare('SELECT id FROM assets').get() as { id: string }
    ).id;

    const found = await app.fetch(
      new Request(`${BASE}/assets/${assetId}`),
      env as never
    );
    expect(found.status).toBe(200);

    // An asset belonging to any other org must not be reachable here.
    sqlite
      .prepare(
        `INSERT INTO orgs (id, name, slug, api_key, api_key_hash, owner_id)
         VALUES ('other-org', 'Other', 'other', 'k', 'h',
                 '1f5d3b90-6c42-4a17-9e08-3d7b5c214e6a')`
      )
      .run();
    sqlite
      .prepare('UPDATE assets SET org_id = ? WHERE id = ?')
      .run('other-org', assetId);
    const foreign = await app.fetch(
      new Request(`${BASE}/assets/${assetId}`),
      env as never
    );
    expect(foreign.status).toBe(404);
  });

  it('rate limits job creation per client address', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.7',
    };
    const body = JSON.stringify({
      collectionName: 'Spam',
      files: [{ name: 'a.jpg', size: 10 }],
    });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < INDEXING_CAPS.maxJobsPerClientPerHour + 1; attempt += 1) {
      const response = await app.fetch(
        new Request(`${BASE}/jobs`, { method: 'POST', headers, body }),
        env as never
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, INDEXING_CAPS.maxJobsPerClientPerHour)).toEqual(
      Array(INDEXING_CAPS.maxJobsPerClientPerHour).fill(201)
    );
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('indexing auth boundary', () => {
  let sqlite: NodeDatabaseSync;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(SCHEMA);
  });

  afterEach(() => sqlite.close());

  it('leaves the rest of the API authenticated', async () => {
    const env = createEnv(sqlite);
    const response = await app.fetch(
      new Request('https://api.test/api/v1/orgs/nga/collections'),
      { ...env, ENVIRONMENT: 'staging' } as never
    );
    expect(response.status).toBe(401);
  });

  it('does not let the exemption reach any other path', async () => {
    const env = createEnv(sqlite);
    for (const path of [
      '/api/v1/public-index/../orgs/nga/collections',
      '/api/v1/public-indexed/jobs',
    ]) {
      const response = await app.fetch(
        new Request(`https://api.test${path}`),
        { ...env, ENVIRONMENT: 'staging' } as never
      );
      expect([401, 404]).toContain(response.status);
    }
  });
});
