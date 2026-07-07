import type { Env } from '../index';

export interface OpenAccessAssetMessage {
  assetId: string;
  artworkId: string;
  orgId: string;
  provider: string;
  role:
    | 'web'
    | 'thumb'
    | 'original'
    | 'processed'
    | 'mask'
    | 'metadata'
    | 'other';
  sourceUrl: string;
  objectKey: string;
  contentType?: string;
}

const IMAGE_ACCEPT_HEADER = 'image/avif,image/webp,image/*,*/*;q=0.8';
const MAX_RETRY_DELAY_SECONDS = 30 * 60;

class AssetFetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'AssetFetchError';
  }
}

export async function processOpenAccessAssetBatch(
  batch: MessageBatch<OpenAccessAssetMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    await processOpenAccessAssetMessage(message, env);
  }
}

export async function processOpenAccessAssetMessage(
  message: Message<OpenAccessAssetMessage>,
  env: Env
): Promise<void> {
  const job = message.body;

  try {
    validateJob(job);
    await markUploading(env, job);

    const response = await fetch(job.sourceUrl, {
      headers: { accept: IMAGE_ACCEPT_HEADER },
    });
    if (!response.ok) {
      throw new AssetFetchError(
        `source image fetch failed with ${response.status}: ${job.sourceUrl}`,
        isRetryableStatus(response.status)
      );
    }

    const responseContentType = response.headers.get('content-type');
    const contentType = imageContentType(responseContentType, job.contentType);
    const bytes = await response.arrayBuffer();
    const checksum = await sha256Hex(bytes);
    const uploadedAt = new Date().toISOString();

    await env.IMAGES.put(job.objectKey, bytes, {
      httpMetadata: {
        contentType,
      },
      customMetadata: {
        assetId: job.assetId,
        artworkId: job.artworkId,
        orgId: job.orgId,
        provider: job.provider,
        role: job.role,
        sourceUrl: job.sourceUrl,
        uploadedAt,
      },
    });

    await markAssetStored(env, job, {
      contentType,
      checksum,
      sizeBytes: bytes.byteLength,
    });
    await markUploaded(env, job, {
      contentType,
      checksum,
      sizeBytes: bytes.byteLength,
    });
    message.ack();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(
      `Open Access asset ingest failed for ${job?.assetId}:`,
      error
    );

    try {
      if (job?.assetId) {
        await markFailed(env, job, errorMessage);
      }
    } catch (markError) {
      console.error(
        `Failed to record Open Access asset ingest error for ${job?.assetId}:`,
        markError
      );
    }

    if (shouldRetry(error)) {
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts || 1) });
      return;
    }

    message.ack();
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validateJob(job: OpenAccessAssetMessage): void {
  const requiredFields: Array<keyof OpenAccessAssetMessage> = [
    'assetId',
    'artworkId',
    'orgId',
    'provider',
    'role',
    'sourceUrl',
    'objectKey',
  ];

  for (const field of requiredFields) {
    if (!job?.[field]) {
      throw new AssetFetchError(
        `missing Open Access asset field: ${field}`,
        false
      );
    }
  }
}

function imageContentType(
  responseContentType: string | null,
  fallbackContentType = 'image/jpeg'
): string {
  const normalized = ((responseContentType || '').split(';')[0] ?? '')
    .trim()
    .toLowerCase();
  if (normalized.startsWith('image/')) return normalized;
  return fallbackContentType || 'image/jpeg';
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof AssetFetchError) return error.retryable;
  return true;
}

function retryDelaySeconds(attempts: number): number {
  const boundedAttempts = Math.max(1, Math.min(attempts, 8));
  return Math.min(2 ** boundedAttempts * 5, MAX_RETRY_DELAY_SECONDS);
}

async function markUploading(
  env: Env,
  job: OpenAccessAssetMessage
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO open_access_asset_ingest (
      asset_id, artwork_id, org_id, provider, role, source_url, object_key,
      content_type, status, attempts, queued_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 1, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(asset_id) DO UPDATE SET
      artwork_id = excluded.artwork_id,
      org_id = excluded.org_id,
      provider = excluded.provider,
      role = excluded.role,
      source_url = excluded.source_url,
      object_key = excluded.object_key,
      content_type = excluded.content_type,
      status = 'uploading',
      attempts = open_access_asset_ingest.attempts + 1,
      last_error = NULL,
      updated_at = datetime('now')
    `
  )
    .bind(
      job.assetId,
      job.artworkId,
      job.orgId,
      job.provider,
      job.role,
      job.sourceUrl,
      job.objectKey,
      job.contentType || 'image/jpeg'
    )
    .run();
}

async function markAssetStored(
  env: Env,
  job: OpenAccessAssetMessage,
  result: { contentType: string; checksum: string; sizeBytes: number }
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE assets
    SET
      storage_provider = 'r2',
      object_key = ?,
      mime_type = ?,
      size_bytes = ?,
      checksum = ?,
      updated_at = datetime('now')
    WHERE id = ?
    `
  )
    .bind(
      job.objectKey,
      result.contentType,
      result.sizeBytes,
      result.checksum,
      job.assetId
    )
    .run();
}

async function markUploaded(
  env: Env,
  job: OpenAccessAssetMessage,
  result: { contentType: string; checksum: string; sizeBytes: number }
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE open_access_asset_ingest
    SET
      status = 'uploaded',
      content_type = ?,
      size_bytes = ?,
      sha256 = ?,
      last_error = NULL,
      uploaded_at = datetime('now'),
      updated_at = datetime('now')
    WHERE asset_id = ?
    `
  )
    .bind(result.contentType, result.sizeBytes, result.checksum, job.assetId)
    .run();
}

async function markFailed(
  env: Env,
  job: OpenAccessAssetMessage,
  errorMessage: string
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO open_access_asset_ingest (
      asset_id, artwork_id, org_id, provider, role, source_url, object_key,
      content_type, status, attempts, last_error, queued_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', 1, ?, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(asset_id) DO UPDATE SET
      status = 'failed',
      attempts = open_access_asset_ingest.attempts + 1,
      last_error = excluded.last_error,
      updated_at = datetime('now')
    `
  )
    .bind(
      job.assetId,
      job.artworkId,
      job.orgId,
      job.provider,
      job.role,
      job.sourceUrl,
      job.objectKey,
      job.contentType || 'image/jpeg',
      errorMessage.slice(0, 1000)
    )
    .run();
}
