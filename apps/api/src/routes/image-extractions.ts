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

type ExtractionTarget = 'object' | 'content';
type ExtractionSourceType = 'r2' | 'url';

type NormalizedExtractionInput = {
  itemId: string;
  sourceType: ExtractionSourceType;
  originalFilename: string;
  inputKey: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

const TARGETS = ['object', 'content'] as const;
const DEFAULT_TARGET: ExtractionTarget = 'object';
const MAX_INPUTS = 50;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const IMAGE_EXTRACTION_PREFIX = 'image-extractions';

const CreateImageExtractionJsonSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(MAX_INPUTS),
  target: z.enum(TARGETS).optional().default(DEFAULT_TARGET),
  preserveFilenames: z.boolean().optional().default(true),
  filenamePrefix: z.string().trim().max(80).optional().default(''),
  filenameSuffix: z.string().trim().max(80).optional().default(''),
  preview: z.boolean().optional().default(false),
});

const supportedUploadTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/zip',
  'application/x-zip-compressed',
]);

const supportedExtensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'tif',
  'tiff',
  'zip',
]);

const imageExtractions = new Hono<AppBindings>();

const jsonError = (
  message: string,
  code = 'IMAGE_EXTRACTION_ERROR',
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

const parseTarget = (value: unknown): ExtractionTarget =>
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
    FROM image_extraction_jobs
    WHERE id = ?
      AND deleted_at IS NULL
    `
  )
    .bind(jobId)
    .first<{
      id: string;
      principal_type: string;
      principal_id: string;
      target: ExtractionTarget;
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
    FROM image_extraction_items
    WHERE job_id = ?
    ORDER BY created_at ASC
    `
  )
    .bind(jobId)
    .all<{
      id: string;
      source_type: ExtractionSourceType;
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
        ? `/api/v1/image-extractions/${job.id}/download`
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
  target: ExtractionTarget;
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
    INSERT INTO image_extraction_jobs (
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
  inputs: NormalizedExtractionInput[]
) => {
  for (const input of inputs) {
    await env.DB.prepare(
      `
      INSERT INTO image_extraction_items (
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
  status: 'queued' | 'failed',
  errorMessage?: string
) => {
  await env.DB.prepare(
    `
    UPDATE image_extraction_jobs
    SET status = ?,
        error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  )
    .bind(status, errorMessage || null, jobId)
    .run();
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
  target: ExtractionTarget;
  preserveFilenames: boolean;
  filenamePrefix: string;
  filenameSuffix: string;
  preview: boolean;
  inputs: NormalizedExtractionInput[];
  outputZipKey: string;
}) => {
  const workerUrl = env.IMAGE_EXTRACTION_WORKER_URL?.trim();
  if (!workerUrl) return 'not-configured' as const;

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (env.IMAGE_EXTRACTION_WORKER_TOKEN) {
    headers.set('Authorization', `Bearer ${env.IMAGE_EXTRACTION_WORKER_TOKEN}`);
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
      outputPrefix: `${IMAGE_EXTRACTION_PREFIX}/${jobId}/output/`,
      outputZipKey,
      inputs: inputs.map((input) => ({
        itemId: input.itemId,
        sourceType: input.sourceType,
        inputKey: input.inputKey,
        sourceUrl: input.sourceUrl,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Image extraction worker returned ${response.status}`);
  }

  return 'queued' as const;
};

const normalizeJsonInputs = (
  imageUrls: string[]
): NormalizedExtractionInput[] =>
  imageUrls.map((url, index) => ({
    itemId: generateId(),
    sourceType: 'url',
    originalFilename: filenameFromUrl(url, index),
    inputKey: null,
    sourceUrl: url,
    mimeType: null,
    sizeBytes: null,
  }));

const normalizeMultipartInputs = async (
  env: Env,
  jobId: string,
  files: File[]
): Promise<NormalizedExtractionInput[] | ReturnType<typeof jsonError>> => {
  const bucket = getBucket(env);
  if (!bucket) {
    return jsonError(
      'Image extraction storage is not configured.',
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

  const inputs: NormalizedExtractionInput[] = [];

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
    const inputKey = `${IMAGE_EXTRACTION_PREFIX}/${jobId}/input/${String(
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

imageExtractions.use('*', requireAuthOrApiKey as any);

imageExtractions.post('/', async (c) => {
  const auth = getAuth(c as any);
  const contentType = c.req.header('content-type') ?? '';
  const jobId = generateId();
  const outputZipKey = `${IMAGE_EXTRACTION_PREFIX}/${jobId}/output.zip`;
  let target: ExtractionTarget;
  let preserveFilenames: boolean;
  let filenamePrefix: string;
  let filenameSuffix: string;
  let preview: boolean;
  let inputs: NormalizedExtractionInput[] | ReturnType<typeof jsonError>;

  if (contentType.includes('multipart/form-data')) {
    const multipart = await readMultipartRequest(c as any);
    if (!multipart.files.length) {
      const error = jsonError('At least one image or zip file is required.');
      return c.json(error.body, error.status);
    }
    if (multipart.files.length > MAX_INPUTS) {
      const error = jsonError(
        `A single image extraction job supports up to ${MAX_INPUTS} inputs.`,
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
    const parsed = CreateImageExtractionJsonSchema.safeParse(jsonBody);
    if (!parsed.success) {
      const error = jsonError(
        'Invalid image extraction request.',
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
    inputs = normalizeJsonInputs(parsed.data.imageUrls);
  }

  if (!Array.isArray(inputs)) {
    return c.json(inputs.body, inputs.status);
  }

  const warnings: string[] = [];
  let status: 'pending' | 'queued' | 'failed' = 'pending';

  if (!c.env.IMAGE_EXTRACTION_WORKER_URL?.trim()) {
    warnings.push(
      'Image extraction worker is not configured; job is recorded but not dispatched.'
    );
  }

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
  await insertItems(c.env, jobId, inputs);

  try {
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
  } catch (error) {
    status = 'failed';
    await updateJobStatus(
      c.env,
      jobId,
      status,
      error instanceof Error
        ? error.message
        : 'Image extraction dispatch failed'
    );
  }

  const data = await serializeJob(c.env, jobId);

  return c.json(
    {
      success: true,
      data,
    },
    status === 'failed' ? 502 : 202
  );
});

imageExtractions.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const auth = getAuth(c as any);
  const job = await getJobById(c.env, jobId);

  if (!job || !canAccessJob(auth, job)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Image extraction job not found.',
        },
      },
      404
    );
  }

  const data = await serializeJob(c.env, jobId);

  return c.json({ success: true, data });
});

imageExtractions.get('/:jobId/download', async (c) => {
  const jobId = c.req.param('jobId');
  const auth = getAuth(c as any);
  const job = await getJobById(c.env, jobId);

  if (!job || !canAccessJob(auth, job)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Image extraction job not found.',
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
          message: 'Image extraction output is not ready yet.',
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
          message: 'Image extraction job has no zip output.',
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
          message: 'Image extraction storage is not configured.',
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
          message: 'Image extraction zip was not found in storage.',
        },
      },
      404
    );
  }

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="image-extraction-${job.id}.zip"`,
    'Cache-Control': 'private, max-age=300',
  });
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default imageExtractions;
