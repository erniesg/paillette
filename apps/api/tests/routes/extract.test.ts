import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import extractRoutes from '../../src/routes/extract';
import type { Env } from '../../src/index';

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeExtractDb,
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

class FakeExtractDb {
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

    if (sql.includes('INSERT INTO extract_usage_lifetime')) {
      const [userId, quota] = params as [string, number];
      const current = this.usage.get(userId) ?? { used: 0, quota };
      current.quota = quota;
      this.usage.set(userId, current);
      return { success: true, meta: { changes: 1 } };
    }

    if (
      sql.includes('UPDATE extract_usage_lifetime') &&
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
      sql.includes('UPDATE extract_usage_lifetime') &&
      sql.includes('used = CASE')
    ) {
      const [cost, , userId] = params as [number, number, string];
      const current = this.usage.get(userId);
      if (current) {
        current.used = Math.max(current.used - cost, 0);
      }
      return { success: true, meta: { changes: current ? 1 : 0 } };
    }

    if (sql.includes('INSERT INTO extract_jobs')) {
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

    if (sql.includes('INSERT INTO extract_items')) {
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

    if (
      sql.includes('UPDATE extract_items') &&
      sql.includes('output_key')
    ) {
      const [status, outputKey, previewKey, warning, errorMessage, id] = params;
      const item = this.items.find((candidate) => candidate.id === id);
      if (item) {
        item.status = status;
        item.output_key = outputKey;
        item.preview_key = previewKey;
        item.warning = warning;
        item.error_message = errorMessage;
      }
      return { success: true, meta: { changes: item ? 1 : 0 } };
    }

    if (
      sql.includes('UPDATE extract_jobs') &&
      sql.includes('processed_count')
    ) {
      const [status, processedCount, warningsJson, errorMessage, id] = params;
      const job = this.jobs.get(String(id));
      if (job) {
        job.status = status;
        job.processed_count = processedCount;
        job.warnings_json = warningsJson;
        job.error_message = errorMessage;
        job.completed_at = '2026-05-28 11:01:00';
      }
      return { success: true, meta: { changes: job ? 1 : 0 } };
    }

    if (sql.includes('UPDATE extract_jobs')) {
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
    if (sql.includes('FROM extract_usage_lifetime')) {
      return (this.usage.get(String(params[0])) ?? null) as T | null;
    }

    if (sql.includes('FROM extract_jobs')) {
      return (this.jobs.get(String(params[0])) ?? null) as T | null;
    }
    return null;
  }

  async all<T>(sql: string, params: unknown[]) {
    if (sql.includes('FROM extract_items')) {
      return {
        results: this.items.filter((item) => item.job_id === params[0]),
      } as { results: T[] };
    }
    return { results: [] as T[] };
  }
}

class FakeR2Bucket {
  objects = new Map<
    string,
    { body: Uint8Array; httpMetadata?: { contentType?: string } }
  >();

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | Blob,
    options?: { httpMetadata?: { contentType?: string } }
  ) {
    let body: Uint8Array;
    if (typeof value === 'string') {
      body = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      body = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      body = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      body = new Uint8Array(await value.arrayBuffer());
    }

    this.objects.set(key, {
      body,
      httpMetadata: options?.httpMetadata,
    });
    return null;
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      size: object.body.byteLength,
      httpMetadata: object.httpMetadata,
      arrayBuffer: async () =>
        object.body.buffer.slice(
          object.body.byteOffset,
          object.body.byteOffset + object.body.byteLength
        ),
    };
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/extract', extractRoutes as any);
  return app;
};

const makeEnv = (
  db: FakeExtractDb,
  overrides: Partial<Env> = {}
): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: new FakeR2Bucket() as unknown as R2Bucket,
    VECTORIZE: undefined as unknown as Vectorize,
    CACHE: {} as KVNamespace,
    AI: { run: vi.fn() } as unknown as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    EXTRACT_FREE_LIFETIME_LIMIT: '10',
    ...overrides,
  }) as Env;

describe('extract routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a URL-backed extract job and dispatches it to the worker', async () => {
    const db = new FakeExtractDb();
    const dispatch = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', dispatch);

    const res = await makeApp().request(
      '/api/v1/extract',
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
        EXTRACT_WORKER_URL: 'https://worker.example/jobs',
        EXTRACT_WORKER_TOKEN: 'worker-token',
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
    expect(res.headers.get('X-Extract-Remaining')).toBe('9');
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
      outputZipKey: `extract/${data.data.id}/output.zip`,
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
    const db = new FakeExtractDb();

    const res = await makeApp().request(
      '/api/v1/extract',
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
    expect(data.data.warnings[0]).toContain('fal provider are not configured');
  });

  it('processes URL-backed jobs directly through fal when configured', async () => {
    const db = new FakeExtractDb();
    const bucket = new FakeR2Bucket();
    const pngBytes = new TextEncoder().encode('fake-png');
    const falFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://queue.fal.run/fal-ai/sam-3/image') {
        return new Response(
          JSON.stringify({
            request_id: 'fal-request-1',
            status_url: 'https://queue.fal.run/status/fal-request-1',
            response_url: 'https://queue.fal.run/result/fal-request-1',
          }),
          { status: 200 }
        );
      }
      if (url === 'https://queue.fal.run/status/fal-request-1') {
        return new Response(
          JSON.stringify({
            status: 'COMPLETED',
            response_url: 'https://queue.fal.run/result/fal-request-1',
          }),
          { status: 200 }
        );
      }
      if (url === 'https://queue.fal.run/result/fal-request-1') {
        return new Response(
          JSON.stringify({
            image: {
              url: 'https://fal.media/output.png',
              content_type: 'image/png',
            },
            masks: [{ url: 'https://fal.media/mask.png' }],
            metadata: [{ score: 0.91 }],
          }),
          { status: 200 }
        );
      }
      if (url === 'https://fal.media/output.png') {
        return new Response(pngBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', falFetch);

    const res = await makeApp().request(
      '/api/v1/extract',
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
      makeEnv(db, {
        FAL_KEY: 'test-fal-key',
        IMAGES: bucket as unknown as R2Bucket,
      })
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(202);
    expect(data.data).toMatchObject({
      status: 'completed',
      counts: { inputs: 1, processed: 1, items: 1 },
      downloadUrl: `/api/v1/extract/${data.data.id}/download`,
      usage: { used: 1, quota: 10, remaining: 9 },
    });
    expect(data.data.items[0]).toMatchObject({
      status: 'completed',
      hasOutput: true,
    });
    expect([...bucket.objects.keys()]).toEqual(
      expect.arrayContaining([
        `extract/${data.data.id}/output.zip`,
      ])
    );

    const zip = bucket.objects.get(
      `extract/${data.data.id}/output.zip`
    );
    expect(new TextDecoder().decode(zip?.body.slice(0, 2))).toBe('PK');

    const [falUrl, falInit] = falFetch.mock.calls[0]!;
    expect(String(falUrl)).toBe('https://queue.fal.run/fal-ai/sam-3/image');
    expect((falInit as RequestInit).body).toContain(
      'https://example.com/artwork.jpg'
    );
    expect(
      new Headers((falInit as RequestInit).headers).get('Authorization')
    ).toBe('Key test-fal-key');
  });

  it('processes URL-backed jobs through the local SAM3 provider when configured', async () => {
    const db = new FakeExtractDb();
    const bucket = new FakeR2Bucket();
    const pngBytes = new TextEncoder().encode('local-png');
    const localFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:4189/api/local-sam3-extract') {
        return new Response(
          JSON.stringify({
            image: {
              url: 'https://local.sam3/output.png',
              content_type: 'image/png',
            },
            metadata: [{ score: 0.88, box: [1, 2, 30, 40] }],
          }),
          { status: 200 }
        );
      }
      if (url === 'https://local.sam3/output.png') {
        return new Response(pngBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', localFetch);

    const res = await makeApp().request(
      '/api/v1/extract',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: ['https://example.com/artwork.tif'],
          target: 'content',
        }),
      },
      makeEnv(db, {
        LOCAL_SAM3_EXTRACT_URL: 'http://127.0.0.1:4189/api/local-sam3-extract',
        IMAGES: bucket as unknown as R2Bucket,
      })
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(202);
    expect(data.data).toMatchObject({
      status: 'completed',
      target: 'content',
      counts: { inputs: 1, processed: 1, items: 1 },
    });
    expect(data.data.items[0]).toMatchObject({
      status: 'completed',
      hasOutput: true,
    });

    const [localUrl, localInit] = localFetch.mock.calls[0]!;
    expect(String(localUrl)).toBe('http://127.0.0.1:4189/api/local-sam3-extract');
    expect(JSON.parse(String((localInit as RequestInit).body))).toMatchObject({
      imageUrl: 'https://example.com/artwork.tif',
      target: 'content',
      points: [],
    });
  });

  it('does not send TIFF inputs directly to fal', async () => {
    const db = new FakeExtractDb();
    const falFetch = vi.fn();
    vi.stubGlobal('fetch', falFetch);

    const res = await makeApp().request(
      '/api/v1/extract',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          imageUrls: ['https://example.com/artwork.tif'],
        }),
      },
      makeEnv(db, {
        FAL_KEY: 'test-fal-key',
      })
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(502);
    expect(data.data).toMatchObject({
      status: 'failed',
      counts: { inputs: 1, processed: 0, items: 1 },
      usage: { used: 0, quota: 10, remaining: 10 },
    });
    expect(data.data.items[0].error).toContain('TIFF inputs require conversion');
    expect(falFetch).not.toHaveBeenCalled();
  });

  it('returns lifetime extract usage', async () => {
    const db = new FakeExtractDb();
    db.usage.set('user-1', { used: 4, quota: 10 });

    const res = await makeApp().request(
      '/api/v1/extract/usage',
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
    expect(res.headers.get('X-Extract-Limit')).toBe('10');
  });

  it('rejects extract jobs after the lifetime input quota is exhausted', async () => {
    const db = new FakeExtractDb();
    db.usage.set('user-1', { used: 10, quota: 10 });

    const res = await makeApp().request(
      '/api/v1/extract',
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
    expect(data.error.code).toBe('EXTRACT_QUOTA_EXCEEDED');
    expect(data.error.details).toEqual({ used: 10, quota: 10, remaining: 0 });
    expect(db.jobs.size).toBe(0);
  });

  it('counts each submitted URL input against the lifetime quota', async () => {
    const db = new FakeExtractDb();

    const res = await makeApp().request(
      '/api/v1/extract',
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
    const db = new FakeExtractDb();
    const createRes = await makeApp().request(
      '/api/v1/extract',
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
      `/api/v1/extract/${created.data.id}`,
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
