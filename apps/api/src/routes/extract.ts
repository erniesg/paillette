import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import {
  getAuth,
  requireAuthOrApiKey,
  type AuthPrincipal,
} from '../middleware/auth';
import { generateId } from '../utils/crypto';

type Variables = {
  auth: AuthPrincipal;
};

type AppBindings = {
  Bindings: Env;
  Variables: Variables;
};

type ExtractTarget = 'object' | 'content';
type ExtractSourceType = 'r2' | 'url';

type PointPrompt = {
  x: number;
  y: number;
  label: 0 | 1;
};

type NormalizedExtractInput = {
  itemId: string;
  sourceType: ExtractSourceType;
  originalFilename: string;
  inputKey: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  points: PointPrompt[];
};

type ExtractUsage = {
  used: number;
  quota: number;
  remaining: number;
};

type FalImage = {
  url?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
};

type FalSam3Result = {
  image?: FalImage;
  masks?: FalImage[];
  metadata?: Array<{
    index?: number;
    score?: number;
    box?: number[];
  }>;
  scores?: number[];
  boxes?: number[][];
};

type ZipEntry = {
  name: string;
  bytes: Uint8Array;
};

const TARGETS = ['object', 'content'] as const;
const DEFAULT_TARGET: ExtractTarget = 'object';
const DEFAULT_FREE_EXTRACT_LIMIT = 10;
const MAX_INPUTS = 50;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_DIRECT_FAL_INPUT_BYTES = 25 * 1024 * 1024;
const FAL_SAM3_ENDPOINT = 'fal-ai/sam-3/image';
const FAL_QUEUE_BASE = `https://queue.fal.run/${FAL_SAM3_ENDPOINT}`;
const FAL_POLL_ATTEMPTS = 45;
const FAL_POLL_INTERVAL_MS = 1000;
const EXTRACT_PREFIX = 'extract';

const PointPromptSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  label: z.union([z.literal(0), z.literal(1)]),
});

const CreateExtractItemSchema = z.object({
  imageUrl: z.string().url(),
  originalFilename: z.string().trim().max(180).optional(),
  points: z.array(PointPromptSchema).max(32).optional().default([]),
});

const CreateExtractJsonSchema = z
  .object({
    imageUrls: z.array(z.string().url()).min(1).max(MAX_INPUTS).optional(),
    items: z.array(CreateExtractItemSchema).min(1).max(MAX_INPUTS).optional(),
    target: z.enum(TARGETS).optional().default(DEFAULT_TARGET),
    preserveFilenames: z.boolean().optional().default(true),
    filenamePrefix: z.string().trim().max(80).optional().default(''),
    filenameSuffix: z.string().trim().max(80).optional().default(''),
    preview: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (!data.imageUrls?.length && !data.items?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide imageUrls or items.',
        path: ['imageUrls'],
      });
    }
  });

type ExtractJsonInputItem = z.infer<typeof CreateExtractItemSchema>;

const supportedUploadTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/zip',
  'application/x-zip-compressed',
]);

const supportedExtensions = new Set([
  'avif',
  'gif',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'tif',
  'tiff',
  'zip',
]);

const extractRoutes = new Hono<AppBindings>();

const jsonError = (
  message: string,
  code = 'EXTRACT_ERROR',
  status: 400 | 401 | 404 | 409 | 413 | 415 | 500 | 502 = 400,
  details?: unknown
) =>
  ({
    body: {
      success: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  }) as const;

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseTarget = (value: unknown): ExtractTarget =>
  value === 'content' ? 'content' : DEFAULT_TARGET;

const sanitizeFilename = (filename: string) => {
  const basename = filename.split(/[\\/]/).filter(Boolean).pop() || 'input';
  const safe = basename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || 'input';
};

const filenameFromUrl = (url: string, index: number) => {
  try {
    const parsed = new URL(url);
    const basename = sanitizeFilename(
      decodeURIComponent(parsed.pathname.split('/').pop() || '')
    );
    return basename === 'input' ? `image-${index + 1}` : basename;
  } catch {
    return `image-${index + 1}`;
  }
};

const getExtension = (filename: string) =>
  filename.split('.').pop()?.toLowerCase() || '';

const getBaseFilename = (filename: string) => {
  const safe = sanitizeFilename(filename);
  const extension = getExtension(safe);
  if (!extension) return safe;
  return safe.slice(0, -(extension.length + 1)) || 'image';
};

const isZipInput = (input: NormalizedExtractInput) => {
  const extension = getExtension(input.originalFilename);
  return (
    extension === 'zip' ||
    input.mimeType === 'application/zip' ||
    input.mimeType === 'application/x-zip-compressed'
  );
};

const assertFalCompatibleInput = (input: NormalizedExtractInput) => {
  const extension = getExtension(input.originalFilename);
  if (isZipInput(input)) {
    throw new Error(
      'Zip inputs require an external extract worker; upload individual images for direct fal processing.'
    );
  }

  if (extension === 'tif' || extension === 'tiff' || input.mimeType === 'image/tiff') {
    throw new Error(
      'TIFF inputs require conversion before fal SAM3. Use JPEG, PNG, WebP, GIF, or AVIF for direct fal processing.'
    );
  }
};

const isUploadFile = (entry: unknown): entry is File =>
  typeof File !== 'undefined' && entry instanceof File && entry.size > 0;

const isSupportedUpload = (file: File) => {
  const extension = getExtension(file.name);
  return (
    supportedUploadTypes.has(file.type) || supportedExtensions.has(extension)
  );
};

const getBucket = (env: Env) => env.IMAGES || env.BUCKET;

const getPrincipalRef = (auth: AuthPrincipal) => ({
  principalType: auth.kind === 'api_key' ? 'api_key' : 'user',
  principalId: auth.apiKeyId || auth.userId,
});

const getExtractQuota = (env: Env) => {
  const parsed = Number(
    env.EXTRACT_FREE_LIFETIME_LIMIT ||
      DEFAULT_FREE_EXTRACT_LIMIT
  );

  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : DEFAULT_FREE_EXTRACT_LIMIT;
};

const normalizeUsage = (
  used: number,
  quota: number
): ExtractUsage => ({
  used,
  quota,
  remaining: Math.max(quota - used, 0),
});

const ensureExtractUsage = async (env: Env, userId: string) => {
  const quota = getExtractQuota(env);

  await env.DB.prepare(
    `
    INSERT INTO extract_usage_lifetime (user_id, used, quota)
    VALUES (?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      quota = excluded.quota,
      updated_at = datetime('now')
    `
  )
    .bind(userId, quota)
    .run();
};

const getExtractUsage = async (
  env: Env,
  userId: string
): Promise<ExtractUsage> => {
  await ensureExtractUsage(env, userId);

  const row = await env.DB.prepare(
    `
    SELECT used, quota
    FROM extract_usage_lifetime
    WHERE user_id = ?
    `
  )
    .bind(userId)
    .first<{ used: number; quota: number }>();

  return normalizeUsage(
    row?.used ?? 0,
    row?.quota ?? getExtractQuota(env)
  );
};

const reserveExtractUse = async (
  env: Env,
  userId: string,
  cost: number
): Promise<ExtractUsage | null> => {
  await ensureExtractUsage(env, userId);

  const update = await env.DB.prepare(
    `
    UPDATE extract_usage_lifetime
    SET used = used + ?,
        updated_at = datetime('now')
    WHERE user_id = ?
      AND used + ? <= quota
    `
  )
    .bind(cost, userId, cost)
    .run();

  if (!update.meta.changes) {
    return null;
  }

  return getExtractUsage(env, userId);
};

const rollbackExtractUse = async (
  env: Env,
  userId: string,
  cost: number
) => {
  await env.DB.prepare(
    `
    UPDATE extract_usage_lifetime
    SET used = CASE WHEN used >= ? THEN used - ? ELSE 0 END,
        updated_at = datetime('now')
    WHERE user_id = ?
    `
  )
    .bind(cost, cost, userId)
    .run();
};

const setExtractQuotaHeaders = (
  c: Context<AppBindings>,
  usage: ExtractUsage
) => {
  c.header('X-Extract-Limit', String(usage.quota));
  c.header('X-Extract-Remaining', String(usage.remaining));
};

const canAccessJob = (
  auth: AuthPrincipal,
  job: { principal_type: string; principal_id: string }
) => {
  const principal = getPrincipalRef(auth);
  return (
    job.principal_type === principal.principalType &&
    job.principal_id === principal.principalId
  );
};

const getJobById = async (env: Env, jobId: string) =>
  env.DB.prepare(
    `
    SELECT
      id,
      principal_type,
      principal_id,
      target,
      preserve_filenames,
      filename_prefix,
      filename_suffix,
      preview_requested,
      status,
      input_count,
      processed_count,
      output_zip_key,
      warnings_json,
      error_message,
      created_at,
      updated_at,
      completed_at
    FROM extract_jobs
    WHERE id = ?
      AND deleted_at IS NULL
    `
  )
    .bind(jobId)
    .first<{
      id: string;
      principal_type: string;
      principal_id: string;
      target: ExtractTarget;
      preserve_filenames: number;
      filename_prefix: string | null;
      filename_suffix: string | null;
      preview_requested: number;
      status: string;
      input_count: number;
      processed_count: number;
      output_zip_key: string | null;
      warnings_json: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    }>();

const getJobItems = async (env: Env, jobId: string) =>
  env.DB.prepare(
    `
    SELECT
      id,
      source_type,
      original_filename,
      input_key,
      source_url,
      output_key,
      preview_key,
      mime_type,
      size_bytes,
      status,
      warning,
      error_message
    FROM extract_items
    WHERE job_id = ?
    ORDER BY created_at ASC
    `
  )
    .bind(jobId)
    .all<{
      id: string;
      source_type: ExtractSourceType;
      original_filename: string;
      input_key: string | null;
      source_url: string | null;
      output_key: string | null;
      preview_key: string | null;
      mime_type: string | null;
      size_bytes: number | null;
      status: string;
      warning: string | null;
      error_message: string | null;
    }>();

const parseWarnings = (warningsJson: string | null) => {
  if (!warningsJson) return [];
  try {
    const parsed = JSON.parse(warningsJson);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const serializeJob = async (env: Env, jobId: string) => {
  const job = await getJobById(env, jobId);
  if (!job) return null;

  const items = await getJobItems(env, jobId);

  return {
    id: job.id,
    status: job.status,
    target: job.target,
    preserveFilenames: Boolean(job.preserve_filenames),
    filenamePrefix: job.filename_prefix || '',
    filenameSuffix: job.filename_suffix || '',
    preview: Boolean(job.preview_requested),
    counts: {
      inputs: job.input_count,
      processed: job.processed_count,
      items: items.results?.length ?? 0,
    },
    warnings: parseWarnings(job.warnings_json),
    error: job.error_message,
    downloadUrl:
      job.status === 'completed' && job.output_zip_key
        ? `/api/v1/extract/${job.id}/download`
        : null,
    items:
      items.results?.map((item) => ({
        id: item.id,
        sourceType: item.source_type,
        originalFilename: item.original_filename,
        status: item.status,
        mimeType: item.mime_type,
        sizeBytes: item.size_bytes,
        warning: item.warning,
        error: item.error_message,
        hasOutput: Boolean(item.output_key),
        hasPreview: Boolean(item.preview_key),
      })) ?? [],
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  };
};

const insertJob = async ({
  env,
  jobId,
  auth,
  target,
  preserveFilenames,
  filenamePrefix,
  filenameSuffix,
  preview,
  inputCount,
  status,
  outputZipKey,
  warnings,
}: {
  env: Env;
  jobId: string;
  auth: AuthPrincipal;
  target: ExtractTarget;
  preserveFilenames: boolean;
  filenamePrefix: string;
  filenameSuffix: string;
  preview: boolean;
  inputCount: number;
  status: 'pending' | 'queued' | 'failed';
  outputZipKey: string;
  warnings: string[];
}) => {
  const principal = getPrincipalRef(auth);

  await env.DB.prepare(
    `
    INSERT INTO extract_jobs (
      id,
      principal_type,
      principal_id,
      target,
      preserve_filenames,
      filename_prefix,
      filename_suffix,
      preview_requested,
      status,
      input_count,
      output_zip_key,
      warnings_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      jobId,
      principal.principalType,
      principal.principalId,
      target,
      preserveFilenames ? 1 : 0,
      filenamePrefix,
      filenameSuffix,
      preview ? 1 : 0,
      status,
      inputCount,
      outputZipKey,
      JSON.stringify(warnings)
    )
    .run();
};

const insertItems = async (
  env: Env,
  jobId: string,
  inputs: NormalizedExtractInput[]
) => {
  for (const input of inputs) {
    await env.DB.prepare(
      `
      INSERT INTO extract_items (
        id,
        job_id,
        source_type,
        original_filename,
        input_key,
        source_url,
        mime_type,
        size_bytes,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `
    )
      .bind(
        input.itemId,
        jobId,
        input.sourceType,
        input.originalFilename,
        input.inputKey,
        input.sourceUrl,
        input.mimeType,
        input.sizeBytes
      )
      .run();
  }
};

const updateJobStatus = async (
  env: Env,
  jobId: string,
  status: 'queued' | 'processing' | 'failed',
  errorMessage?: string
) => {
  await env.DB.prepare(
    `
    UPDATE extract_jobs
    SET status = ?,
        error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  )
    .bind(status, errorMessage || null, jobId)
    .run();
};

const completeJob = async ({
  env,
  jobId,
  status,
  processedCount,
  warnings,
  errorMessage,
}: {
  env: Env;
  jobId: string;
  status: 'completed' | 'failed';
  processedCount: number;
  warnings: string[];
  errorMessage?: string | null;
}) => {
  await env.DB.prepare(
    `
    UPDATE extract_jobs
    SET status = ?,
        processed_count = ?,
        warnings_json = ?,
        error_message = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
    `
  )
    .bind(
      status,
      processedCount,
      JSON.stringify(warnings),
      errorMessage || null,
      jobId
    )
    .run();
};

const updateItemStatus = async ({
  env,
  itemId,
  status,
  outputKey = null,
  previewKey = null,
  warning = null,
  errorMessage = null,
}: {
  env: Env;
  itemId: string;
  status: 'processing' | 'completed' | 'failed' | 'skipped';
  outputKey?: string | null;
  previewKey?: string | null;
  warning?: string | null;
  errorMessage?: string | null;
}) => {
  await env.DB.prepare(
    `
    UPDATE extract_items
    SET status = ?,
        output_key = ?,
        preview_key = ?,
        warning = ?,
        error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  )
    .bind(status, outputKey, previewKey, warning, errorMessage, itemId)
    .run();
};

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const getFalPrompt = (target: ExtractTarget) =>
  target === 'content'
    ? 'artwork image content, painting surface, print, drawing, photograph; exclude frame, mat, mount, wall, label'
    : 'visible artwork object, painting, framed artwork, mounted artwork, scroll, print, photograph';

const falFetchJson = async <T>(
  url: string,
  key: string,
  init: RequestInit = {}
) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Key ${key}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `fal request failed (${response.status})${detail ? `: ${detail}` : ''}`
    );
  }

  return (await response.json()) as T;
};

const unwrapFalPayload = (payload: unknown): FalSam3Result => {
  const record = payload as Record<string, unknown>;
  if (record.payload && typeof record.payload === 'object') {
    return record.payload as FalSam3Result;
  }
  if (record.data && typeof record.data === 'object') {
    return record.data as FalSam3Result;
  }
  return record as FalSam3Result;
};

const runFalSam3 = async ({
  key,
  imageUrl,
  target,
  points,
}: {
  key: string;
  imageUrl: string;
  target: ExtractTarget;
  points?: PointPrompt[];
}) => {
  const input: Record<string, unknown> = {
    image_url: imageUrl,
    apply_mask: true,
    output_format: 'png',
    return_multiple_masks: true,
    max_masks: 3,
    include_scores: true,
    include_boxes: true,
  };

  if (points?.length) {
    input.prompts = points.map((point) => ({
      x: point.x,
      y: point.y,
      label: point.label,
    }));
  } else {
    input.prompt = getFalPrompt(target);
  }

  const submission = await falFetchJson<{
    request_id?: string;
    response_url?: string;
    status_url?: string;
  }>(FAL_QUEUE_BASE, key, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!submission.request_id && !submission.response_url) {
    return unwrapFalPayload(submission);
  }

  const statusUrl =
    submission.status_url ??
    `${FAL_QUEUE_BASE}/requests/${submission.request_id}/status`;
  const responseUrl =
    submission.response_url ??
    `${FAL_QUEUE_BASE}/requests/${submission.request_id}`;

  for (let attempt = 0; attempt < FAL_POLL_ATTEMPTS; attempt += 1) {
    const status = await falFetchJson<{
      status?: string;
      error?: string;
      response_url?: string;
    }>(statusUrl, key);

    if (status.status === 'COMPLETED') {
      if (status.error) throw new Error(status.error);
      const result = await falFetchJson<unknown>(
        status.response_url ?? responseUrl,
        key
      );
      return unwrapFalPayload(result);
    }

    if (status.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) {
      throw new Error(`fal request ended with status ${status.status}`);
    }

    await delay(FAL_POLL_INTERVAL_MS);
  }

  throw new Error('fal request timed out before completion');
};

const runLocalSam3 = async ({
  endpoint,
  imageUrl,
  target,
  points,
}: {
  endpoint: string;
  imageUrl: string;
  target: ExtractTarget;
  points?: PointPrompt[];
}) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl,
      target,
      points: points ?? [],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `local SAM3 request failed (${response.status})${detail ? `: ${detail}` : ''}`
    );
  }

  return unwrapFalPayload(await response.json());
};

const resolveFalInputUrl = async (
  env: Env,
  input: NormalizedExtractInput
) => {
  if (input.sourceType === 'url') {
    if (!input.sourceUrl) throw new Error('Missing source URL.');
    return input.sourceUrl;
  }

  if (!input.inputKey) throw new Error('Missing uploaded image key.');
  const bucket = getBucket(env);
  if (!bucket) throw new Error('Extract storage is not configured.');

  const object = await bucket.get(input.inputKey);
  if (!object) throw new Error('Uploaded image could not be read from storage.');

  if (object.size > MAX_DIRECT_FAL_INPUT_BYTES) {
    throw new Error(
      `Uploaded image is too large for direct fal processing (${MAX_DIRECT_FAL_INPUT_BYTES} byte limit).`
    );
  }

  const buffer = await object.arrayBuffer();
  const contentType =
    input.mimeType ||
    object.httpMetadata?.contentType ||
    'application/octet-stream';

  return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
};

const selectFalOutput = (result: FalSam3Result) => {
  const mask = result.masks?.find((candidate) => candidate.url);
  const output = result.image?.url ? result.image : mask;
  if (!output?.url) throw new Error('fal did not return an output image.');

  return {
    output,
    mask,
    confidence:
      result.metadata?.[0]?.score ?? result.scores?.[0] ?? undefined,
    usedMaskAsOutput: output === mask && !result.image?.url,
  };
};

const fetchFalImage = async (image: FalImage) => {
  if (!image.url) throw new Error('fal output image URL is missing.');

  const response = await fetch(image.url);
  if (!response.ok) {
    throw new Error(`Could not download fal output (${response.status}).`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType:
      image.content_type || response.headers.get('content-type') || 'image/png',
  };
};

const buildOutputFilename = ({
  input,
  index,
  preserveFilenames,
  filenamePrefix,
  filenameSuffix,
}: {
  input: NormalizedExtractInput;
  index: number;
  preserveFilenames: boolean;
  filenamePrefix: string;
  filenameSuffix: string;
}) => {
  const base = preserveFilenames
    ? getBaseFilename(input.originalFilename)
    : `image-${index + 1}`;
  return `${filenamePrefix}${base}${filenameSuffix}.png`;
};

const getUniqueName = (name: string, usedNames: Set<string>) => {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  const extension = getExtension(name);
  const base = extension ? name.slice(0, -(extension.length + 1)) : name;
  let suffix = 2;
  let candidate = extension ? `${base}-${suffix}.${extension}` : `${base}-${suffix}`;

  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = extension ? `${base}-${suffix}.${extension}` : `${base}-${suffix}`;
  }

  usedNames.add(candidate);
  return candidate;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = () => {
  const now = new Date();
  const year = Math.max(now.getFullYear(), 1980);
  const date =
    ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  return { date, time };
};

const writeUint16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const writeUint32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, true);
};

const concatBytes = (parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const createZip = (entries: ZipEntry[]) => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  const { date, time } = dosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    const localOffset = offset;

    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, entry.bytes.length);
    writeUint32(localView, 22, entry.bytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    parts.push(localHeader, entry.bytes);
    offset += localHeader.length + entry.bytes.length;

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, entry.bytes.length);
    writeUint32(centralView, 24, entry.bytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralDirectory.push(centralHeader);
  }

  const centralStart = offset;
  const centralBytes = concatBytes(centralDirectory);
  parts.push(centralBytes);
  offset += centralBytes.length;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralBytes.length);
  writeUint32(endView, 16, centralStart);
  writeUint16(endView, 20, 0);
  parts.push(end);

  return concatBytes(parts);
};

const processWithFal = async ({
  env,
  jobId,
  target,
  preserveFilenames,
  filenamePrefix,
  filenameSuffix,
  preview,
  inputs,
  outputZipKey,
  warnings,
}: {
  env: Env;
  jobId: string;
  target: ExtractTarget;
  preserveFilenames: boolean;
  filenamePrefix: string;
  filenameSuffix: string;
  preview: boolean;
  inputs: NormalizedExtractInput[];
  outputZipKey: string;
  warnings: string[];
}) => {
  const localSam3Endpoint = env.LOCAL_SAM3_EXTRACT_URL?.trim();
  const falKey = env.FAL_KEY?.trim();
  if (!localSam3Endpoint && !falKey) {
    throw new Error('Direct extract provider is not configured.');
  }

  const bucket = getBucket(env);
  if (!bucket) throw new Error('Extract storage is not configured.');

  await updateJobStatus(env, jobId, 'processing');

  const zipEntries: ZipEntry[] = [];
  const usedNames = new Set<string>();
  let processedCount = 0;
  let failedCount = 0;

  for (const [index, input] of inputs.entries()) {
    await updateItemStatus({ env, itemId: input.itemId, status: 'processing' });

    try {
      if (!localSam3Endpoint) {
        assertFalCompatibleInput(input);
      }
      const imageUrl = await resolveFalInputUrl(env, input);
      const result = localSam3Endpoint
        ? await runLocalSam3({
            endpoint: localSam3Endpoint,
            imageUrl,
            target,
            points: input.points,
          })
        : await runFalSam3({
            key: falKey!,
            imageUrl,
            target,
            points: input.points,
          });
      const selected = selectFalOutput(result);
      const outputImage = await fetchFalImage(selected.output);
      const outputName = getUniqueName(
        buildOutputFilename({
          input,
          index,
          preserveFilenames,
          filenamePrefix,
          filenameSuffix,
        }),
        usedNames
      );
      const outputKey = `${EXTRACT_PREFIX}/${jobId}/output/${input.itemId}/${outputName}`;
      const itemWarnings: string[] = [];

      if (selected.usedMaskAsOutput) {
        itemWarnings.push('fal returned a mask but no masked output image.');
      }
      if (typeof selected.confidence === 'number') {
        itemWarnings.push(
          `${localSam3Endpoint ? 'local SAM3' : 'fal'} confidence ${selected.confidence.toFixed(3)}`
        );
      }

      await bucket.put(outputKey, outputImage.bytes, {
        httpMetadata: { contentType: outputImage.contentType },
      });

      let previewKey: string | null = null;
      if (preview && selected.mask?.url && selected.mask.url !== selected.output.url) {
        const previewImage = await fetchFalImage(selected.mask);
        previewKey = `${EXTRACT_PREFIX}/${jobId}/preview/${input.itemId}/${outputName}`;
        await bucket.put(previewKey, previewImage.bytes, {
          httpMetadata: { contentType: previewImage.contentType },
        });
      }

      zipEntries.push({ name: outputName, bytes: outputImage.bytes });
      processedCount += 1;
      await updateItemStatus({
        env,
        itemId: input.itemId,
        status: 'completed',
        outputKey,
        previewKey,
        warning: itemWarnings.length ? itemWarnings.join('; ') : null,
      });
    } catch (error) {
      failedCount += 1;
      const message =
        error instanceof Error
          ? error.message
          : `${localSam3Endpoint ? 'local SAM3' : 'fal'} extract failed`;
      warnings.push(`${input.originalFilename}: ${message}`);
      await updateItemStatus({
        env,
        itemId: input.itemId,
        status: 'failed',
        errorMessage: message,
      });
    }
  }

  if (zipEntries.length) {
    await bucket.put(outputZipKey, createZip(zipEntries), {
      httpMetadata: { contentType: 'application/zip' },
    });
  }

  const status = processedCount > 0 ? 'completed' : 'failed';
  const errorMessage =
    status === 'failed'
      ? 'No extract outputs were generated.'
      : failedCount
        ? `${failedCount} input(s) failed.`
        : null;

  await completeJob({
    env,
    jobId,
    status,
    processedCount,
    warnings,
    errorMessage,
  });

  return status;
};

const dispatchToWorker = async ({
  env,
  jobId,
  target,
  preserveFilenames,
  filenamePrefix,
  filenameSuffix,
  preview,
  inputs,
  outputZipKey,
}: {
  env: Env;
  jobId: string;
  target: ExtractTarget;
  preserveFilenames: boolean;
  filenamePrefix: string;
  filenameSuffix: string;
  preview: boolean;
  inputs: NormalizedExtractInput[];
  outputZipKey: string;
}) => {
  const workerUrl = env.EXTRACT_WORKER_URL?.trim();
  if (!workerUrl) return 'not-configured' as const;

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (env.EXTRACT_WORKER_TOKEN) {
    headers.set('Authorization', `Bearer ${env.EXTRACT_WORKER_TOKEN}`);
  }

  const response = await fetch(workerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jobId,
      target,
      preserveFilenames,
      filenamePrefix,
      filenameSuffix,
      preview,
      outputPrefix: `${EXTRACT_PREFIX}/${jobId}/output/`,
      outputZipKey,
      inputs: inputs.map((input) => ({
        itemId: input.itemId,
        sourceType: input.sourceType,
        inputKey: input.inputKey,
        sourceUrl: input.sourceUrl,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        points: input.points,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Extract worker returned ${response.status}`);
  }

  return 'queued' as const;
};

const normalizeJsonInputs = (
  body: z.infer<typeof CreateExtractJsonSchema>
): NormalizedExtractInput[] => {
  const items: ExtractJsonInputItem[] =
    body.items ??
    body.imageUrls?.map((imageUrl) => ({
      imageUrl,
      points: [] as PointPrompt[],
    })) ??
    [];

  return items.map((item, index) => ({
    itemId: generateId(),
    sourceType: 'url',
    originalFilename: item.originalFilename
      ? sanitizeFilename(item.originalFilename)
      : filenameFromUrl(item.imageUrl, index),
    inputKey: null,
    sourceUrl: item.imageUrl,
    mimeType: null,
    sizeBytes: null,
    points: item.points ?? [],
  }));
};

const normalizeMultipartInputs = async (
  env: Env,
  jobId: string,
  files: File[]
): Promise<NormalizedExtractInput[] | ReturnType<typeof jsonError>> => {
  const bucket = getBucket(env);
  if (!bucket) {
    return jsonError(
      'Extract storage is not configured.',
      'STORAGE_NOT_CONFIGURED',
      500
    );
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    return jsonError(
      'Uploaded files exceed the 500 MB job limit.',
      'UPLOAD_TOO_LARGE',
      413
    );
  }

  const inputs: NormalizedExtractInput[] = [];

  for (const [index, file] of files.entries()) {
    if (!isSupportedUpload(file)) {
      return jsonError(
        `Unsupported file type for ${file.name || `file ${index + 1}`}.`,
        'UNSUPPORTED_FILE_TYPE',
        415
      );
    }

    const itemId = generateId();
    const originalFilename = sanitizeFilename(
      file.name || `input-${index + 1}`
    );
    const inputKey = `${EXTRACT_PREFIX}/${jobId}/input/${String(
      index + 1
    ).padStart(3, '0')}-${originalFilename}`;

    await bucket.put(inputKey, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
      },
      customMetadata: {
        jobId,
        itemId,
        originalFilename,
        uploadedAt: new Date().toISOString(),
      },
    });

    inputs.push({
      itemId,
      sourceType: 'r2',
      originalFilename,
      inputKey,
      sourceUrl: null,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      points: [],
    });
  }

  return inputs;
};

const readMultipartRequest = async (c: Context<AppBindings>) => {
  const form = await c.req.formData();
  const files = [
    ...(form.getAll('files') as unknown[]),
    ...(form.getAll('file') as unknown[]),
    ...(form.getAll('images') as unknown[]),
    ...(form.getAll('image') as unknown[]),
  ].filter(isUploadFile);

  return {
    files,
    target: parseTarget(form.get('target')),
    preserveFilenames: parseBoolean(form.get('preserveFilenames'), true),
    filenamePrefix: String(form.get('filenamePrefix') ?? '').trim(),
    filenameSuffix: String(form.get('filenameSuffix') ?? '').trim(),
    preview: parseBoolean(form.get('preview'), false),
  };
};

extractRoutes.use('*', requireAuthOrApiKey as any);

extractRoutes.get('/usage', async (c) => {
  const auth = getAuth(c as any);
  const usage = await getExtractUsage(c.env, auth.userId);
  setExtractQuotaHeaders(c as any, usage);

  return c.json({
    success: true,
    data: usage,
  });
});

extractRoutes.post('/', async (c) => {
  const auth = getAuth(c as any);
  const contentType = c.req.header('content-type') ?? '';
  const jobId = generateId();
  const outputZipKey = `${EXTRACT_PREFIX}/${jobId}/output.zip`;
  let target: ExtractTarget;
  let preserveFilenames: boolean;
  let filenamePrefix: string;
  let filenameSuffix: string;
  let preview: boolean;
  let inputs: NormalizedExtractInput[] | ReturnType<typeof jsonError>;

  if (contentType.includes('multipart/form-data')) {
    const multipart = await readMultipartRequest(c as any);
    if (!multipart.files.length) {
      const error = jsonError('At least one image or zip file is required.');
      return c.json(error.body, error.status);
    }
    if (multipart.files.length > MAX_INPUTS) {
      const error = jsonError(
        `A single extract job supports up to ${MAX_INPUTS} inputs.`,
        'TOO_MANY_INPUTS'
      );
      return c.json(error.body, error.status);
    }

    target = multipart.target;
    preserveFilenames = multipart.preserveFilenames;
    filenamePrefix = multipart.filenamePrefix;
    filenameSuffix = multipart.filenameSuffix;
    preview = multipart.preview;
    inputs = await normalizeMultipartInputs(c.env, jobId, multipart.files);
  } else {
    const jsonBody = await c.req.json().catch(() => null);
    const parsed = CreateExtractJsonSchema.safeParse(jsonBody);
    if (!parsed.success) {
      const error = jsonError(
        'Invalid extract request.',
        'VALIDATION_ERROR',
        400,
        parsed.error.flatten()
      );
      return c.json(error.body, error.status);
    }

    target = parsed.data.target;
    preserveFilenames = parsed.data.preserveFilenames;
    filenamePrefix = parsed.data.filenamePrefix;
    filenameSuffix = parsed.data.filenameSuffix;
    preview = parsed.data.preview;
    inputs = normalizeJsonInputs(parsed.data);
  }

  if (!Array.isArray(inputs)) {
    return c.json(inputs.body, inputs.status);
  }

  const usageCost = inputs.length;
  const usage = await reserveExtractUse(
    c.env,
    auth.userId,
    usageCost
  );

  if (!usage) {
    const currentUsage = await getExtractUsage(c.env, auth.userId);
    setExtractQuotaHeaders(c as any, currentUsage);

    return c.json(
      {
        success: false,
        error: {
          code: 'EXTRACT_QUOTA_EXCEEDED',
          message: `Free lifetime extract limit reached (${currentUsage.quota} inputs total).`,
          details: currentUsage,
        },
      },
      429
    );
  }

  setExtractQuotaHeaders(c as any, usage);

  const warnings: string[] = [];
  let status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' =
    'pending';
  let jobRecorded = false;
  let failureMessage: string | null = null;
  const hasExternalWorker = Boolean(c.env.EXTRACT_WORKER_URL?.trim());
  const hasLocalSam3Provider = Boolean(c.env.LOCAL_SAM3_EXTRACT_URL?.trim());
  const hasFalProvider = Boolean(c.env.FAL_KEY?.trim());

  if (!hasExternalWorker && !hasLocalSam3Provider && !hasFalProvider) {
    warnings.push(
      'Extract worker, local SAM3 provider, and fal provider are not configured; job is recorded but not dispatched.'
    );
  }

  try {
    await insertJob({
      env: c.env,
      jobId,
      auth,
      target,
      preserveFilenames,
      filenamePrefix,
      filenameSuffix,
      preview,
      inputCount: inputs.length,
      status,
      outputZipKey,
      warnings,
    });
    jobRecorded = true;
    await insertItems(c.env, jobId, inputs);

    if (hasExternalWorker) {
      const dispatchResult = await dispatchToWorker({
        env: c.env,
        jobId,
        target,
        preserveFilenames,
        filenamePrefix,
        filenameSuffix,
        preview,
        inputs,
        outputZipKey,
      });

      if (dispatchResult === 'queued') {
        status = 'queued';
        await updateJobStatus(c.env, jobId, status);
      }
    } else if (hasLocalSam3Provider || hasFalProvider) {
      status = await processWithFal({
        env: c.env,
        jobId,
        target,
        preserveFilenames,
        filenamePrefix,
        filenameSuffix,
        preview,
        inputs,
        outputZipKey,
        warnings,
      });
    }
  } catch (error) {
    status = 'failed';
    failureMessage =
      error instanceof Error
        ? error.message
        : 'Extract dispatch failed';

    if (jobRecorded) {
      await updateJobStatus(c.env, jobId, status, failureMessage).catch(
        () => undefined
      );
    }
  }

  let currentUsage = usage;

  if (status === 'failed') {
    await rollbackExtractUse(c.env, auth.userId, usageCost);
    currentUsage = await getExtractUsage(c.env, auth.userId);
    setExtractQuotaHeaders(c as any, currentUsage);

    if (!jobRecorded) {
      return c.json(
        {
          success: false,
          error: {
            code: 'EXTRACT_CREATE_FAILED',
            message: failureMessage ?? 'Extract job could not be created.',
            details: { usage: currentUsage },
          },
        },
        500
      );
    }
  }

  const data = await serializeJob(c.env, jobId);

  return c.json(
    {
      success: true,
      data: data ? { ...data, usage: currentUsage } : data,
    },
    status === 'failed' ? 502 : 202
  );
});

extractRoutes.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const auth = getAuth(c as any);
  const job = await getJobById(c.env, jobId);

  if (!job || !canAccessJob(auth, job)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Extract job not found.',
        },
      },
      404
    );
  }

  const data = await serializeJob(c.env, jobId);

  return c.json({ success: true, data });
});

extractRoutes.get('/:jobId/download', async (c) => {
  const jobId = c.req.param('jobId');
  const auth = getAuth(c as any);
  const job = await getJobById(c.env, jobId);

  if (!job || !canAccessJob(auth, job)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Extract job not found.',
        },
      },
      404
    );
  }

  if (job.status !== 'completed') {
    return c.json(
      {
        success: false,
        error: {
          code: 'JOB_NOT_READY',
          message: 'Extract output is not ready yet.',
        },
      },
      409
    );
  }

  if (!job.output_zip_key) {
    return c.json(
      {
        success: false,
        error: {
          code: 'OUTPUT_NOT_FOUND',
          message: 'Extract job has no zip output.',
        },
      },
      404
    );
  }

  const bucket = getBucket(c.env);
  if (!bucket) {
    return c.json(
      {
        success: false,
        error: {
          code: 'STORAGE_NOT_CONFIGURED',
          message: 'Extract storage is not configured.',
        },
      },
      500
    );
  }

  const object = await bucket.get(job.output_zip_key);

  if (!object) {
    return c.json(
      {
        success: false,
        error: {
          code: 'OUTPUT_NOT_FOUND',
          message: 'Extract zip was not found in storage.',
        },
      },
      404
    );
  }

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="extract-${job.id}.zip"`,
    'Cache-Control': 'private, max-age=300',
  });
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default extractRoutes;
