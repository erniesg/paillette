/**
 * WebMCP indexing routes — `index_zip` / `index_folder` / `get_index_status`.
 *
 * A WebMCP tool's `execute` must return quickly with JSON, and a Worker cannot
 * hold a large archive in memory or exceed its subrequest budget. So indexing
 * is modelled as a job the browser drives:
 *
 *   1. POST /public-index/jobs            create job + collection, plan caps
 *   2. POST /public-index/jobs/:id/items  push a small batch of images
 *   3. POST /public-index/jobs/:id/complete
 *   4. GET  /public-index/jobs/:id        pollable status
 *   5. POST /public-index/jobs/:id/search search the collection just built
 *
 * The zip itself is parsed in the browser (see apps/web/app/lib/indexing-client.ts);
 * this Worker only ever sees a handful of already-extracted images per request.
 *
 * AUTHENTICATION: these routes are deliberately anonymous. The demo runs in
 * ChatGPT's in-app browser with no account, mirroring the existing anonymous
 * NGA artwork reads. Every write is confined to one sandbox organisation and
 * bounded by the caps below; nothing here can read or mutate NGA/NGS data.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { uploadImage } from '../utils/r2';
import { generateJinaQueryEmbedding } from './search';

// ---------------------------------------------------------------------------
// Sandbox scope + caps
// ---------------------------------------------------------------------------

/** Seeded by migration 0021. Anonymous indexing may write nowhere else. */
export const WEBMCP_INDEX_ORG_ID = 'f2b7c1a4-9d3e-4b8c-a1f6-2e5d7c9b4a30';
export const WEBMCP_INDEX_ORG_SLUG = 'webmcp-index';
const WEBMCP_INDEX_USER_ID = '1f5d3b90-6c42-4a17-9e08-3d7b5c214e6a';

export const INDEXING_CAPS = {
  /** Images accepted per job. Anything beyond this is reported, not silent. */
  maxFilesPerJob: 40,
  /** Per-image byte ceiling. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Whole-job byte ceiling. */
  maxTotalBytes: 120 * 1024 * 1024,
  /** Images the client should send per /items call. */
  batchSize: 4,
  /** Hard server-side ceiling per /items call (subrequest budget). */
  maxBatchSize: 6,
  /** Jobs one edge address may create per hour. */
  maxJobsPerClientPerHour: 6,
  /** Backstop on total sandbox size before new jobs are refused. */
  maxSandboxArtworks: 5000,
} as const;

export const INDEXABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const JINA_INDEX_MODEL_DEFAULT = 'jina-clip-v2';
const JINA_INDEX_DIMENSIONS_DEFAULT = 1024;
const JINA_EMBEDDINGS_ENDPOINT = 'https://api.jina.ai/v1/embeddings';

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export type PlannedFile = { name: string; size: number };

export type IndexPlanEntry = {
  name: string;
  accepted: boolean;
  reason?: string;
};

export type IndexPlan = {
  entries: IndexPlanEntry[];
  accepted: string[];
  notices: string[];
};

export const inferMimeType = (name: string, declared?: string | null) => {
  const normalized = (declared || '').trim().toLowerCase();
  if (INDEXABLE_MIME_TYPES.has(normalized)) {
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  }
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME[extension] || null;
};

/**
 * Decide what a job will actually contain. Over-cap files are dropped with a
 * stated reason rather than failing the whole request — the status payload
 * surfaces both, so the agent can tell the human the truth.
 */
export const planIndexJob = (
  files: PlannedFile[],
  caps: typeof INDEXING_CAPS = INDEXING_CAPS
): IndexPlan => {
  const entries: IndexPlanEntry[] = [];
  const notices: string[] = [];
  const seen = new Set<string>();
  let acceptedBytes = 0;
  let overCapCount = 0;
  let tooLargeCount = 0;
  let nonImageCount = 0;
  let budgetCount = 0;

  for (const file of files) {
    const name = String(file?.name ?? '').trim();
    if (!name) continue;

    if (seen.has(name)) {
      entries.push({
        name,
        accepted: false,
        reason: 'Duplicate filename within the archive',
      });
      continue;
    }
    seen.add(name);

    const size = Number.isFinite(file.size) ? Number(file.size) : 0;

    if (!inferMimeType(name)) {
      nonImageCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: 'Not a supported image (jpeg, png, webp, gif, avif)',
      });
      continue;
    }
    if (size > caps.maxFileBytes) {
      tooLargeCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: `Larger than the ${Math.round(caps.maxFileBytes / (1024 * 1024))}MB per-image limit`,
      });
      continue;
    }
    if (entries.filter((entry) => entry.accepted).length >= caps.maxFilesPerJob) {
      overCapCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: `Beyond the ${caps.maxFilesPerJob}-image limit for one job`,
      });
      continue;
    }
    if (acceptedBytes + size > caps.maxTotalBytes) {
      budgetCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: `Beyond the ${Math.round(caps.maxTotalBytes / (1024 * 1024))}MB total limit for one job`,
      });
      continue;
    }

    acceptedBytes += size;
    entries.push({ name, accepted: true });
  }

  if (nonImageCount) {
    notices.push(`${nonImageCount} non-image file(s) skipped.`);
  }
  if (tooLargeCount) {
    notices.push(
      `${tooLargeCount} image(s) skipped for exceeding ${Math.round(caps.maxFileBytes / (1024 * 1024))}MB.`
    );
  }
  if (overCapCount) {
    notices.push(
      `Only the first ${caps.maxFilesPerJob} images are indexed; ${overCapCount} were skipped.`
    );
  }
  if (budgetCount) {
    notices.push(
      `${budgetCount} image(s) skipped after the ${Math.round(caps.maxTotalBytes / (1024 * 1024))}MB job budget was reached.`
    );
  }

  return {
    entries,
    accepted: entries.filter((entry) => entry.accepted).map((entry) => entry.name),
    notices,
  };
};

export type ItemMetadata = {
  title?: string | null;
  artist?: string | null;
  year?: number | null;
  date_text?: string | null;
  medium?: string | null;
  classification?: string | null;
  description?: string | null;
  credit_line?: string | null;
  accession_number?: string | null;
};

const trimmedOrNull = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

/** Filenames are the only metadata most piles of images carry. */
export const titleFromFilename = (name: string) => {
  const base = name.split('/').pop() || name;
  const withoutExtension = base.replace(/\.[^.]+$/, '');
  const spaced = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced || base;
};

export const sanitizeItemMetadata = (input: unknown): ItemMetadata => {
  const source = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const rawYear = source.year;
  const year =
    typeof rawYear === 'number' && Number.isInteger(rawYear)
      ? rawYear
      : typeof rawYear === 'string' && /^\d{3,4}$/.test(rawYear.trim())
        ? Number(rawYear.trim())
        : null;

  return {
    title: trimmedOrNull(source.title, 500),
    artist: trimmedOrNull(source.artist, 255),
    year: year !== null && year >= 0 && year <= 9999 ? year : null,
    date_text: trimmedOrNull(source.date_text, 255),
    medium: trimmedOrNull(source.medium, 255),
    classification: trimmedOrNull(source.classification, 255),
    description: trimmedOrNull(source.description, 5000),
    credit_line: trimmedOrNull(source.credit_line, 5000),
    accession_number: trimmedOrNull(source.accession_number, 255),
  };
};

/** The text an image's caption vector is built from. */
export const buildCaptionText = (
  metadata: ItemMetadata,
  filename: string
): string =>
  [
    metadata.title || titleFromFilename(filename),
    metadata.artist,
    metadata.date_text || (metadata.year ? String(metadata.year) : null),
    metadata.medium,
    metadata.classification,
    metadata.description,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join('. ')
    .slice(0, 2000);

export type JobStatusRow = {
  id: string;
  org_id: string;
  collection_id: string;
  collection_name: string;
  state: 'queued' | 'running' | 'complete' | 'failed';
  total: number;
  processed: number;
  failed: number;
  notice: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type JobStatusPayload = {
  jobId: string;
  state: JobStatusRow['state'];
  processed: number;
  total: number;
  collectionId: string;
  errors: Array<{ file: string; message: string }>;
  // Additive fields — the agent gets an honest account, not just a number.
  collectionName: string;
  orgId: string;
  failed: number;
  searchable: boolean;
  notice: string | null;
  caps: typeof INDEXING_CAPS;
};

export const buildJobStatus = (
  row: JobStatusRow,
  errors: Array<{ file: string; message: string }>
): JobStatusPayload => ({
  jobId: row.id,
  state: row.state,
  processed: row.processed,
  total: row.total,
  collectionId: row.collection_id,
  errors,
  collectionName: row.collection_name,
  orgId: row.org_id,
  failed: row.failed,
  // Vectors land per image, so partial results are already searchable.
  searchable: row.processed > 0,
  notice: row.error_message
    ? [row.notice, row.error_message].filter(Boolean).join(' ')
    : row.notice,
  caps: INDEXING_CAPS,
});

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );

const sha256Hex = async (value: string | ArrayBuffer) =>
  toHex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    )
  );

/**
 * Only Cloudflare's injected connecting address can separate anonymous
 * visitors. A client-supplied header must never be substituted here.
 */
const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  return sha256Hex(`webmcp-index:${candidate}`);
};

const getJinaIndexConfig = (env: Env) => ({
  apiKey: env.JINA_API_KEY || env.QUERY_EMBEDDING_API_TOKEN,
  model: env.JINA_MULTIMODAL_MODEL || JINA_INDEX_MODEL_DEFAULT,
  dimensions: Number(env.JINA_EMBEDDING_DIMENSIONS) || JINA_INDEX_DIMENSIONS_DEFAULT,
});

const getIndexVectorize = (env: Env): Vectorize | undefined =>
  env.EMBEDDING_INDEX_VERSION?.trim().toLowerCase() === 'v2'
    ? env.VECTORIZE_V2 || env.VECTORIZE
    : env.VECTORIZE;

const l2Normalize = (values: number[]) => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return !Number.isFinite(norm) || norm === 0
    ? values
    : values.map((value) => value / norm);
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

/**
 * Index-time vectors must live in the same space the NGA corpus was built in:
 * jina-clip-v2 / retrieval.passage / 1024 dims, L2-normalised.
 */
const generateIndexEmbedding = async (
  apiKey: string,
  input: string | { image: string },
  model: string,
  dimensions: number,
  signal?: AbortSignal
): Promise<number[]> => {
  const response = await fetch(JINA_EMBEDDINGS_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [input],
      normalized: true,
      embedding_type: 'float',
      task: 'retrieval.passage',
      dimensions,
      truncate: true,
    }),
    signal,
  });

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
    detail?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.detail || payload.code || `Jina request failed with ${response.status}`
    );
  }

  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw new Error('Jina embedding was empty or had the wrong dimensions');
  }
  return l2Normalize(embedding);
};

const readJob = (db: D1Database, jobId: string) =>
  db
    .prepare('SELECT * FROM index_jobs WHERE id = ? AND org_id = ?')
    .bind(jobId, WEBMCP_INDEX_ORG_ID)
    .first<JobStatusRow>();

const readJobErrors = async (db: D1Database, jobId: string) => {
  const { results } = await db
    .prepare(
      `SELECT filename, message FROM index_job_items
       WHERE job_id = ? AND state IN ('failed', 'skipped')
       ORDER BY created_at LIMIT 100`
    )
    .bind(jobId)
    .all<{ filename: string; message: string | null }>();

  return results.map((row) => ({
    file: row.filename,
    message: row.message || 'Indexing failed',
  }));
};

const respondWithStatus = async (db: D1Database, row: JobStatusRow) =>
  buildJobStatus(row, await readJobErrors(db, row.id));

/**
 * Anonymous writes need a ceiling. KV is best-effort: when the binding is
 * absent (unit tests, local dev) or errors, indexing stays available and the
 * per-job caps remain the binding constraint.
 */
const withinJobRateLimit = async (
  env: Env,
  clientHash: string | null
): Promise<boolean> => {
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `webmcp-index-jobs:v1:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= INDEXING_CAPS.maxJobsPerClientPerHour) {
      return false;
    }
    await env.CACHE.put(key, String((Number.isFinite(used) ? used : 0) + 1), {
      expirationTtl: 7200,
    });
    return true;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const indexing = new Hono<{ Bindings: Env }>();

indexing.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

/**
 * POST /public-index/jobs
 * Create a job and its collection. Returns immediately so a WebMCP tool can.
 */
indexing.post('/jobs', async (c) => {
  let body: {
    collectionName?: unknown;
    orgId?: unknown;
    source?: unknown;
    files?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const collectionName =
    trimmedOrNull(body.collectionName, 200) ||
    `Agent collection ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const source = body.source === 'files' ? 'files' : 'zip';
  const files = Array.isArray(body.files) ? (body.files as PlannedFile[]) : [];

  if (files.length === 0) {
    return c.json(
      jsonError('INVALID_INPUT', 'At least one file is required to create a job.'),
      400
    );
  }
  if (files.length > 5000) {
    return c.json(
      jsonError('INVALID_INPUT', 'Too many file entries in one request.'),
      400
    );
  }

  const clientHash = await getClientHash(c.req.header('CF-Connecting-IP'));
  if (!(await withinJobRateLimit(c.env, clientHash))) {
    c.header('Retry-After', '600');
    return c.json(
      jsonError(
        'INDEXING_RATE_LIMITED',
        `Only ${INDEXING_CAPS.maxJobsPerClientPerHour} indexing jobs may be created per hour. Try again later.`
      ),
      429
    );
  }

  const sandboxSize = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM artworks WHERE org_id = ? AND deleted_at IS NULL'
  )
    .bind(WEBMCP_INDEX_ORG_ID)
    .first<{ count: number }>();
  if ((sandboxSize?.count ?? 0) >= INDEXING_CAPS.maxSandboxArtworks) {
    return c.json(
      jsonError(
        'INDEXING_SANDBOX_FULL',
        'The shared indexing sandbox is full. Ask an operator to clear it.'
      ),
      503
    );
  }

  const plan = planIndexJob(files);
  if (plan.accepted.length === 0) {
    return c.json(
      jsonError(
        'NO_INDEXABLE_FILES',
        plan.notices.join(' ') || 'No supported images were found.'
      ),
      400
    );
  }

  const requestedOrgId = trimmedOrNull(body.orgId, 200);
  const notices = [...plan.notices];
  if (
    requestedOrgId &&
    requestedOrgId.toLowerCase() !== WEBMCP_INDEX_ORG_ID &&
    requestedOrgId.toLowerCase() !== WEBMCP_INDEX_ORG_SLUG
  ) {
    // Never silently write somewhere the caller did not expect.
    notices.unshift(
      `Anonymous indexing writes to the shared "${WEBMCP_INDEX_ORG_SLUG}" sandbox, not "${requestedOrgId}".`
    );
  }

  const jobId = crypto.randomUUID();
  const collectionId = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO collections (id, org_id, name, description, created_by)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      collectionId,
      WEBMCP_INDEX_ORG_ID,
      collectionName,
      `Indexed by a browser agent through WebMCP (${source}).`,
      WEBMCP_INDEX_USER_ID
    )
    .run();

  await c.env.DB.prepare(
    `INSERT INTO index_jobs (
       id, org_id, collection_id, collection_name, source, state, total, client_hash, notice
     ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
  )
    .bind(
      jobId,
      WEBMCP_INDEX_ORG_ID,
      collectionId,
      collectionName,
      source,
      plan.accepted.length,
      clientHash,
      notices.join(' ') || null
    )
    .run();

  // Record the rejects up front so the very first status poll is already honest.
  const rejected = plan.entries.filter((entry) => !entry.accepted).slice(0, 100);
  if (rejected.length) {
    await c.env.DB.batch(
      rejected.map((entry) =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO index_job_items (id, job_id, filename, state, message)
           VALUES (?, ?, ?, 'skipped', ?)`
        ).bind(crypto.randomUUID(), jobId, entry.name, entry.reason || 'Skipped')
      )
    );
  }

  return c.json(
    {
      success: true,
      data: {
        jobId,
        collectionId,
        orgId: WEBMCP_INDEX_ORG_ID,
        collectionName,
        accepted: plan.accepted,
        skipped: rejected.map((entry) => ({
          file: entry.name,
          message: entry.reason || 'Skipped',
        })),
        notice: notices.join(' ') || null,
        batchSize: INDEXING_CAPS.batchSize,
        caps: INDEXING_CAPS,
      },
    },
    201
  );
});

/**
 * POST /public-index/jobs/:jobId/items
 * Ingest one small batch: R2 -> D1 -> image vector -> caption vector.
 * Partial failure is per-file and never fails the batch.
 */
indexing.post('/jobs/:jobId/items', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await readJob(c.env.DB, jobId);
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }
  if (job.state === 'complete' || job.state === 'failed') {
    return c.json(
      jsonError('JOB_CLOSED', `Indexing job is already ${job.state}.`),
      409
    );
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Expected multipart form data.'), 400);
  }

  // workers-types declares FormData values as strings; at runtime uploaded
  // parts are File objects, so identify them structurally.
  const files = (formData.getAll('files') as unknown[]).filter(
    (value): value is File =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as File).arrayBuffer === 'function'
  );
  if (files.length === 0) {
    return c.json(jsonError('INVALID_INPUT', 'No files in this batch.'), 400);
  }
  if (files.length > INDEXING_CAPS.maxBatchSize) {
    return c.json(
      jsonError(
        'BATCH_TOO_LARGE',
        `At most ${INDEXING_CAPS.maxBatchSize} images may be sent per batch.`
      ),
      400
    );
  }

  let metadataByFile: Record<string, unknown> = {};
  const rawMetadata = formData.get('metadata');
  if (typeof rawMetadata === 'string' && rawMetadata.trim()) {
    try {
      const parsed = JSON.parse(rawMetadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadataByFile = parsed as Record<string, unknown>;
      }
    } catch {
      // Bad sidecar metadata degrades to filename-derived titles; it is never
      // a reason to drop the images the human actually asked to index.
    }
  }

  if (job.state === 'queued') {
    await c.env.DB.prepare("UPDATE index_jobs SET state = 'running' WHERE id = ?")
      .bind(jobId)
      .run();
  }

  const jina = getJinaIndexConfig(c.env);
  const vectorize = getIndexVectorize(c.env);
  const captionVectorize =
    c.env.EMBEDDING_INDEX_VERSION?.trim().toLowerCase() === 'v2'
      ? c.env.CAPTION_VECTORIZE_V2 || c.env.CAPTION_VECTORIZE
      : c.env.CAPTION_VECTORIZE;

  const results: Array<{
    file: string;
    ok: boolean;
    artworkId?: string;
    message?: string;
  }> = [];

  for (const file of files) {
    const filename = file.name || 'untitled';
    try {
      const mimeType = inferMimeType(filename, file.type);
      if (!mimeType) {
        throw new Error('Unsupported image type');
      }
      if (file.size > INDEXING_CAPS.maxFileBytes) {
        throw new Error('Image exceeds the per-image size limit');
      }
      if (!jina.apiKey) {
        throw new Error('Embedding provider is not configured');
      }
      if (!vectorize) {
        throw new Error('Vector index is not configured');
      }

      const buffer = await file.arrayBuffer();
      if (buffer.byteLength === 0) {
        throw new Error('File is empty');
      }

      const metadata = sanitizeItemMetadata(metadataByFile[filename]);
      const artworkId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const imageHash = await sha256Hex(buffer);

      const upload = await uploadImage(c.env.IMAGES, buffer, {
        originalFilename: filename,
        uploadedBy: WEBMCP_INDEX_USER_ID,
        galleryId: WEBMCP_INDEX_ORG_ID,
        hash: imageHash,
      });

      const imageUrl = `${new URL(c.req.url).origin}/api/v1/public-index/assets/${assetId}`;
      const title = metadata.title || titleFromFilename(filename);

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO artworks (
             id, org_id, collection_id, image_url, thumbnail_url,
             original_filename, image_hash, embedding_id,
             title, artist, year, date_text, medium, classification,
             description, credit_line, accession_number,
             field_sources, translations, custom_metadata, uploaded_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`
        ).bind(
          artworkId,
          WEBMCP_INDEX_ORG_ID,
          job.collection_id,
          imageUrl,
          imageUrl,
          filename,
          imageHash,
          artworkId,
          title,
          metadata.artist,
          metadata.year,
          metadata.date_text,
          metadata.medium,
          metadata.classification,
          metadata.description,
          metadata.credit_line,
          metadata.accession_number,
          JSON.stringify({
            provider: 'webmcp-index',
            indexJobId: jobId,
            assetId,
          }),
          WEBMCP_INDEX_USER_ID
        ),
        c.env.DB.prepare(
          `INSERT INTO assets (
             id, artwork_id, org_id, role, storage_provider, object_key, url,
             mime_type, size_bytes, metadata
           ) VALUES (?, ?, ?, 'original', 'r2', ?, ?, ?, ?, ?)`
        ).bind(
          assetId,
          artworkId,
          WEBMCP_INDEX_ORG_ID,
          upload.key,
          imageUrl,
          mimeType,
          upload.size,
          JSON.stringify({ originalFilename: filename, indexJobId: jobId })
        ),
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO collection_artworks (collection_id, artwork_id, position)
           VALUES (?, ?, 0)`
        ).bind(job.collection_id, artworkId),
      ]);

      const vectorMetadata = {
        orgId: WEBMCP_INDEX_ORG_ID,
        galleryId: WEBMCP_INDEX_ORG_ID,
        artworkId,
        collectionId: job.collection_id,
        indexJobId: jobId,
        provider: 'webmcp-index',
        embeddingVersion: 'v2',
        title,
        artist: metadata.artist || '',
        medium: metadata.medium || '',
        classification: metadata.classification || '',
        year: metadata.year || 0,
        yearStart: metadata.year || 0,
        yearEnd: metadata.year || 0,
      };

      const imageEmbedding = await generateIndexEmbedding(
        jina.apiKey,
        { image: arrayBufferToBase64(buffer) },
        jina.model,
        jina.dimensions
      );
      await vectorize.upsert([
        { id: artworkId, values: imageEmbedding, metadata: { ...vectorMetadata, channel: 'image' } },
      ]);

      // The caption channel is a bonus lane: text search already works from
      // the image vector alone, so a caption failure must not fail the file.
      if (captionVectorize) {
        try {
          const captionEmbedding = await generateIndexEmbedding(
            jina.apiKey,
            buildCaptionText(metadata, filename),
            c.env.JINA_TEXT_MODEL || 'jina-embeddings-v5-text-small',
            Number(c.env.JINA_TEXT_EMBEDDING_DIMENSIONS) || 1024
          );
          await captionVectorize.upsert([
            {
              id: artworkId,
              values: captionEmbedding,
              metadata: { ...vectorMetadata, channel: 'caption' },
            },
          ]);
        } catch (error) {
          console.warn('Caption embedding failed for indexed image', error);
        }
      }

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO index_job_items (id, job_id, filename, artwork_id, state, size_bytes)
           VALUES (?, ?, ?, ?, 'complete', ?)
           ON CONFLICT(job_id, filename) DO UPDATE SET
             artwork_id = excluded.artwork_id, state = 'complete', message = NULL`
        ).bind(crypto.randomUUID(), jobId, filename, artworkId, upload.size),
        c.env.DB.prepare(
          'UPDATE index_jobs SET processed = processed + 1 WHERE id = ?'
        ).bind(jobId),
      ]);

      results.push({ file: filename, ok: true, artworkId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to index this file';
      console.warn(`Indexing failed for ${filename}:`, error);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO index_job_items (id, job_id, filename, state, message)
           VALUES (?, ?, ?, 'failed', ?)
           ON CONFLICT(job_id, filename) DO UPDATE SET
             state = 'failed', message = excluded.message`
        ).bind(crypto.randomUUID(), jobId, filename, message.slice(0, 500)),
        c.env.DB.prepare(
          'UPDATE index_jobs SET failed = failed + 1 WHERE id = ?'
        ).bind(jobId),
      ]);
      results.push({ file: filename, ok: false, message });
    }
  }

  const refreshed = await readJob(c.env.DB, jobId);
  return c.json({
    success: true,
    data: {
      ...(refreshed ? await respondWithStatus(c.env.DB, refreshed) : {}),
      batch: results,
    },
  });
});

/** POST /public-index/jobs/:jobId/complete — close the job out. */
indexing.post('/jobs/:jobId/complete', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await readJob(c.env.DB, jobId);
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }

  let reason: string | null = null;
  try {
    const body = (await c.req.json()) as { error?: unknown };
    reason = trimmedOrNull(body?.error, 500);
  } catch {
    reason = null;
  }

  // A job that indexed nothing at all is a failure; anything else is a
  // completion whose per-file errors the status payload already carries.
  const state = reason && job.processed === 0 ? 'failed' : 'complete';
  await c.env.DB.prepare(
    `UPDATE index_jobs
     SET state = ?, error_message = ?, completed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(state, reason, jobId)
    .run();

  const refreshed = await readJob(c.env.DB, jobId);
  return c.json({
    success: true,
    data: refreshed ? await respondWithStatus(c.env.DB, refreshed) : null,
  });
});

/** GET /public-index/jobs/:jobId — the pollable status a WebMCP tool reads. */
indexing.get('/jobs/:jobId', async (c) => {
  const job = await readJob(c.env.DB, c.req.param('jobId'));
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }
  return c.json({ success: true, data: await respondWithStatus(c.env.DB, job) });
});

/**
 * POST /public-index/jobs/:jobId/search
 * Semantic search scoped to the collection this job just built. This is the
 * proof that a zip became searchable: same Vectorize index, same embedding
 * space as the rest of Paillette, filtered to the new collection.
 */
indexing.post('/jobs/:jobId/search', async (c) => {
  const job = await readJob(c.env.DB, c.req.param('jobId'));
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }

  let query = '';
  let topK = 20;
  try {
    const body = (await c.req.json()) as { query?: unknown; topK?: unknown };
    query = trimmedOrNull(body.query, 500) || '';
    const requestedTopK = Number(body.topK);
    if (Number.isFinite(requestedTopK)) {
      topK = Math.min(Math.max(Math.trunc(requestedTopK), 1), 50);
    }
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }
  if (!query) {
    return c.json(jsonError('INVALID_INPUT', 'A search query is required.'), 400);
  }

  const jina = getJinaIndexConfig(c.env);
  const vectorize = getIndexVectorize(c.env);
  if (!jina.apiKey || !vectorize) {
    return c.json(
      jsonError('INDEX_SEARCH_UNAVAILABLE', 'Vector search is not configured.'),
      503
    );
  }

  let matches: Array<{ id: string; score: number }>;
  try {
    // The query side reuses the shared search helper so indexed collections
    // are queried exactly the way the rest of Paillette is.
    const queryEmbedding = await generateJinaQueryEmbedding(
      jina.apiKey,
      query,
      jina.model,
      jina.dimensions
    );
    const result = await vectorize.query(queryEmbedding, {
      topK,
      filter: { galleryId: WEBMCP_INDEX_ORG_ID, indexJobId: job.id },
      returnValues: false,
      returnMetadata: 'indexed',
    });
    matches = result.matches.map((match) => ({ id: match.id, score: match.score }));
  } catch (error) {
    console.warn('Indexed collection search failed:', error);
    return c.json(
      jsonError('INDEX_SEARCH_FAILED', 'Search over the indexed collection failed.'),
      502
    );
  }

  if (matches.length === 0) {
    return c.json({
      success: true,
      data: { jobId: job.id, collectionId: job.collection_id, query, results: [] },
    });
  }

  const placeholders = matches.map(() => '?').join(',');
  const { results: rows } = await c.env.DB.prepare(
    `SELECT id, title, artist, year, date_text, medium, classification,
            description, original_filename, image_url, custom_metadata
     FROM artworks
     WHERE org_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`
  )
    .bind(WEBMCP_INDEX_ORG_ID, ...matches.map((match) => match.id))
    .all<{
      id: string;
      title: string;
      artist: string | null;
      year: number | null;
      date_text: string | null;
      medium: string | null;
      classification: string | null;
      description: string | null;
      original_filename: string | null;
      image_url: string | null;
      custom_metadata: string | null;
    }>();

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const results = matches
    .map((match) => {
      const row = rowsById.get(match.id);
      if (!row) return null;
      let assetId: string | null = null;
      try {
        assetId = JSON.parse(row.custom_metadata || '{}')?.assetId ?? null;
      } catch {
        assetId = null;
      }
      return {
        id: row.id,
        similarity: match.score,
        title: row.title,
        artist: row.artist,
        year: row.year,
        date_text: row.date_text,
        medium: row.medium,
        classification: row.classification,
        description: row.description,
        original_filename: row.original_filename,
        // Same-origin path the browser can render without credentials.
        imageUrl: assetId ? `/api/public-index/assets/${assetId}` : row.image_url,
      };
    })
    .filter((result): result is NonNullable<typeof result> => result !== null);

  return c.json({
    success: true,
    data: { jobId: job.id, collectionId: job.collection_id, query, results },
  });
});

/**
 * GET /public-index/assets/:assetId
 * Serve an indexed image. Scoped to the sandbox org, so it can never become a
 * read path for NGA/NGS assets.
 */
indexing.get('/assets/:assetId', async (c) => {
  const assetId = c.req.param('assetId');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) {
    return c.json(jsonError('INVALID_INPUT', 'Invalid asset ID.'), 400);
  }

  const asset = await c.env.DB.prepare(
    'SELECT object_key, mime_type FROM assets WHERE id = ? AND org_id = ?'
  )
    .bind(assetId, WEBMCP_INDEX_ORG_ID)
    .first<{ object_key: string; mime_type: string | null }>();
  if (!asset) {
    return c.json(jsonError('NOT_FOUND', 'Asset not found.'), 404);
  }

  const object = await c.env.IMAGES.get(asset.object_key);
  if (!object) {
    return c.json(jsonError('NOT_FOUND', 'Asset not found.'), 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=3600');
  if (asset.mime_type) headers.set('Content-Type', asset.mime_type);
  return new Response(object.body, { headers });
});

export default indexing;
