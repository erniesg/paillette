import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import imageExtractionRoutes from '../../src/routes/image-extractions';
import type { Env } from '../../src/index';

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeImageExtractionDb,
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

class FakeImageExtractionDb {
  jobs = new Map<string, any>();
  items: any[] = [];
  usage = new Map<string, { used: number; quota: number }>();

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO users')) {
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('INSERT INTO image_extraction_usage_lifetime')) {
      const [userId, quota] = params as [string, number];
      const current = this.usage.get(userId) ?? { used: 0, quota };
      current.quota = quota;
      this.usage.set(userId, current);
      return { success: true, meta: { changes: 1 } };
    }

    if (
      sql.includes('UPDATE image_extraction_usage_lifetime') &&
      sql.includes('used = used +')
    ) {
      const [cost, userId] = params as [number, string, number];
      const current = this.usage.get(userId);
      if (!current || current.used + cost > current.quota) {
        return { success: true, meta: { changes: 0 } };
      }
      current.used += cost;
      return { success: true, meta: { changes: 1 } };
    }

    if (
      sql.includes('UPDATE image_extraction_usage_lifetime') &&
      sql.includes('used = CASE')
    ) {
      const [cost, , userId] = params as [number, number, string];
      const current = this.usage.get(userId);
      if (current) {
        current.used = Math.max(current.used - cost, 0);
      }
      return { success: true, meta: { changes: current ? 1 : 0 } };
    }

    if (sql.includes('INSERT INTO image_extraction_jobs')) {
      const [
        id,
        principalType,
        principalId,
        target,
        preserveFilenames,
        filenamePrefix,
        filenameSuffix,
        previewRequested,
        status,
        inputCount,
        outputZipKey,
        warningsJson,
      ] = params;
      this.jobs.set(String(id), {
        id,
        principal_type: principalType,
        principal_id: principalId,
        target,
        preserve_filenames: preserveFilenames,
        filename_prefix: filenamePrefix,
        filename_suffix: filenameSuffix,
        preview_requested: previewRequested,
        status,
        input_count: inputCount,
        processed_count: 0,
        output_zip_key: outputZipKey,
        warnings_json: warningsJson,
        error_message: null,
        created_at: '2026-05-28 11:00:00',
        updated_at: '2026-05-28 11:00:00',
        completed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('INSERT INTO image_extraction_items')) {
      const [
        id,
        jobId,
        sourceType,
        originalFilename,
        inputKey,
        sourceUrl,
        mimeType,
        sizeBytes,
      ] = params;
      this.items.push({
        id,
        job_id: jobId,
        source_type: sourceType,
        original_filename: originalFilename,
        input_key: inputKey,
        source_url: sourceUrl,
        output_key: null,
        preview_key: null,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        status: 'pending',
        warning: null,
        error_message: null,
        created_at: '2026-05-28 11:00:00',
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.includes('UPDATE image_extraction_jobs')) {
      const [status, errorMessage, id] = params;
      const job = this.jobs.get(String(id));
      if (job) {
        job.status = status;
        job.error_message = errorMessage;
      }
      return { success: true, meta: { changes: job ? 1 : 0 } };
    }

    return { success: true, meta: { changes: 1 } };
  }

  async first<T>(sql: string, params: unknown[]) {
    if (sql.includes('FROM image_extraction_usage_lifetime')) {
      return (this.usage.get(String(params[0])) ?? null) as T | null;
    }

    if (sql.includes('FROM image_extraction_jobs')) {
      return (this.jobs.get(String(params[0])) ?? null) as T | null;
    }
    return null;
  }

  async all<T>(sql: string, params: unknown[]) {
    if (sql.includes('FROM image_extraction_items')) {
      return {
        results: this.items.filter((item) => item.job_id === params[0]),
      } as { results: T[] };
    }
    return { results: [] as T[] };
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/image-extractions', imageExtractionRoutes as any);
  return app;
};

const makeEnv = (
  db: FakeImageExtractionDb,
  overrides: Partial<Env> = {}
): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    VECTORIZE: undefined as unknown as Vectorize,
    CACHE: {} as KVNamespace,
    AI: { run: vi.fn() } as unknown as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    IMAGE_EXTRACTION_FREE_LIFETIME_LIMIT: '10',
    ...overrides,
  }) as Env;

describe('image extraction routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a URL-backed extraction job and dispatches it to the worker', async () => {
    const db = new FakeImageExtractionDb();
    const dispatch = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', dispatch);

    const res = await makeApp().request(
      '/api/v1/image-extractions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: ['https://example.com/source/artwork.tif'],
        }),
      },
      makeEnv(db, {
        IMAGE_EXTRACTION_WORKER_URL: 'https://worker.example/jobs',
        IMAGE_EXTRACTION_WORKER_TOKEN: 'worker-token',
      })
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(202);
    expect(data.data).toMatchObject({
      status: 'queued',
      target: 'object',
      preserveFilenames: true,
      counts: { inputs: 1, processed: 0, items: 1 },
      warnings: [],
      usage: { used: 1, quota: 10, remaining: 9 },
    });
    expect(res.headers.get('X-Image-Extraction-Remaining')).toBe('9');
    expect(data.data.items[0]).toMatchObject({
      sourceType: 'url',
      originalFilename: 'artwork.tif',
      status: 'pending',
    });
    expect(dispatch).toHaveBeenCalledWith(
      'https://worker.example/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
      })
    );

    const [, init] = dispatch.mock.calls[0]!;
    expect((init?.headers as Headers).get('Authorization')).toBe(
      'Bearer worker-token'
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      jobId: data.data.id,
      target: 'object',
      preserveFilenames: true,
      outputZipKey: `image-extractions/${data.data.id}/output.zip`,
      inputs: [
        expect.objectContaining({
          sourceType: 'url',
          sourceUrl: 'https://example.com/source/artwork.tif',
          originalFilename: 'artwork.tif',
        }),
      ],
    });
  });

  it('records jobs without dispatch when no worker is configured', async () => {
    const db = new FakeImageExtractionDb();

    const res = await makeApp().request(
      '/api/v1/image-extractions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: ['https://example.com/artwork.jpg'],
          target: 'content',
          preserveFilenames: false,
          filenamePrefix: 'crop-',
        }),
      },
      makeEnv(db)
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(202);
    expect(data.data).toMatchObject({
      status: 'pending',
      target: 'content',
      preserveFilenames: false,
      filenamePrefix: 'crop-',
      usage: { used: 1, quota: 10, remaining: 9 },
    });
    expect(data.data.warnings[0]).toContain('worker is not configured');
  });

  it('returns lifetime image extraction usage', async () => {
    const db = new FakeImageExtractionDb();
    db.usage.set('user-1', { used: 4, quota: 10 });

    const res = await makeApp().request(
      '/api/v1/image-extractions/usage',
      {
        headers: {
          'X-User-Id': 'user-1',
        },
      },
      makeEnv(db)
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(data.data).toEqual({ used: 4, quota: 10, remaining: 6 });
    expect(res.headers.get('X-Image-Extraction-Limit')).toBe('10');
  });

  it('rejects image extraction jobs after the lifetime input quota is exhausted', async () => {
    const db = new FakeImageExtractionDb();
    db.usage.set('user-1', { used: 10, quota: 10 });

    const res = await makeApp().request(
      '/api/v1/image-extractions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: ['https://example.com/artwork.jpg'],
        }),
      },
      makeEnv(db)
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(429);
    expect(data.error.code).toBe('IMAGE_EXTRACTION_QUOTA_EXCEEDED');
    expect(data.error.details).toEqual({ used: 10, quota: 10, remaining: 0 });
    expect(db.jobs.size).toBe(0);
  });

  it('counts each submitted URL input against the lifetime quota', async () => {
    const db = new FakeImageExtractionDb();

    const res = await makeApp().request(
      '/api/v1/image-extractions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: [
            'https://example.com/artwork-1.jpg',
            'https://example.com/artwork-2.jpg',
          ],
        }),
      },
      makeEnv(db)
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(202);
    expect(data.data.usage).toEqual({ used: 2, quota: 10, remaining: 8 });
    expect(db.usage.get('user-1')?.used).toBe(2);
  });

  it('does not expose job status across principals', async () => {
    const db = new FakeImageExtractionDb();
    const createRes = await makeApp().request(
      '/api/v1/image-extractions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: ['https://example.com/artwork.jpg'],
        }),
      },
      makeEnv(db)
    );
    const created = (await createRes.json()) as any;

    const lookupRes = await makeApp().request(
      `/api/v1/image-extractions/${created.data.id}`,
      {
        headers: {
          'X-User-Id': 'user-2',
        },
      },
      makeEnv(db)
    );
    const data = (await lookupRes.json()) as any;

    expect(lookupRes.status).toBe(404);
    expect(data.error.code).toBe('JOB_NOT_FOUND');
  });
});
