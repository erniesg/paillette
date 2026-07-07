import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  buildOpenAccessAssetDownloads,
  sqlString,
} from './open-access-art-apply.mjs';

export const DEFAULT_OPEN_ACCESS_QUEUE_BATCH_SIZE = 100;

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  return `'${sqlString(value)}'`;
}

export function buildOpenAccessAssetQueueMessages(records) {
  const recordById = new Map(records.map((record) => [record.id, record]));
  return buildOpenAccessAssetDownloads(records, {
    outDir: '/tmp/open-access-art-queue',
  }).map((asset) => {
    const record = recordById.get(asset.artworkId) || {};
    return {
      assetId: asset.assetId,
      artworkId: asset.artworkId,
      orgId: record.orgId || record.org_id,
      provider: asset.provider,
      role: asset.role,
      sourceUrl: asset.sourceUrl,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
    };
  });
}

export function buildOpenAccessAssetIngestSeedSql(
  messages,
  { generatedAt = new Date().toISOString() } = {}
) {
  if (!messages.length) return '';

  return messages
    .map(
      (message) => `INSERT INTO open_access_asset_ingest (
  asset_id, artwork_id, org_id, provider, role, source_url, object_key,
  content_type, status, attempts, queued_at, created_at, updated_at
) VALUES (
  ${sqlValue(message.assetId)},
  ${sqlValue(message.artworkId)},
  ${sqlValue(message.orgId)},
  ${sqlValue(message.provider)},
  ${sqlValue(message.role)},
  ${sqlValue(message.sourceUrl)},
  ${sqlValue(message.objectKey)},
  ${sqlValue(message.contentType || 'image/jpeg')},
  'queued',
  0,
  ${sqlValue(generatedAt)},
  ${sqlValue(generatedAt)},
  ${sqlValue(generatedAt)}
)
ON CONFLICT(asset_id) DO UPDATE SET
  artwork_id = excluded.artwork_id,
  org_id = excluded.org_id,
  provider = excluded.provider,
  role = excluded.role,
  source_url = excluded.source_url,
  object_key = excluded.object_key,
  content_type = excluded.content_type,
  status = CASE
    WHEN open_access_asset_ingest.status = 'uploaded'
      AND open_access_asset_ingest.source_url IS excluded.source_url
      AND open_access_asset_ingest.object_key IS excluded.object_key
    THEN 'uploaded'
    ELSE 'queued'
  END,
  attempts = CASE
    WHEN open_access_asset_ingest.source_url IS excluded.source_url
      AND open_access_asset_ingest.object_key IS excluded.object_key
    THEN open_access_asset_ingest.attempts
    ELSE 0
  END,
  last_error = CASE
    WHEN open_access_asset_ingest.status = 'uploaded'
      AND open_access_asset_ingest.source_url IS excluded.source_url
      AND open_access_asset_ingest.object_key IS excluded.object_key
    THEN open_access_asset_ingest.last_error
    ELSE NULL
  END,
  size_bytes = CASE
    WHEN open_access_asset_ingest.status = 'uploaded'
      AND open_access_asset_ingest.source_url IS excluded.source_url
      AND open_access_asset_ingest.object_key IS excluded.object_key
    THEN open_access_asset_ingest.size_bytes
    ELSE NULL
  END,
  sha256 = CASE
    WHEN open_access_asset_ingest.status = 'uploaded'
      AND open_access_asset_ingest.source_url IS excluded.source_url
      AND open_access_asset_ingest.object_key IS excluded.object_key
    THEN open_access_asset_ingest.sha256
    ELSE NULL
  END,
  uploaded_at = CASE
    WHEN open_access_asset_ingest.status = 'uploaded'
      AND open_access_asset_ingest.source_url IS excluded.source_url
      AND open_access_asset_ingest.object_key IS excluded.object_key
    THEN open_access_asset_ingest.uploaded_at
    ELSE NULL
  END,
  queued_at = excluded.queued_at,
  updated_at = excluded.updated_at;`
    )
    .join('\n\n');
}

export function buildCloudflareQueueBatchPayload(messages) {
  return {
    messages: messages.map((message) => ({
      body: message,
      content_type: 'json',
    })),
  };
}

export function chunkOpenAccessQueueMessages(
  messages,
  { batchSize = DEFAULT_OPEN_ACCESS_QUEUE_BATCH_SIZE } = {}
) {
  const normalizedBatchSize = Math.max(
    1,
    Math.min(Number(batchSize) || DEFAULT_OPEN_ACCESS_QUEUE_BATCH_SIZE, 100)
  );
  const batches = [];
  for (let index = 0; index < messages.length; index += normalizedBatchSize) {
    batches.push(messages.slice(index, index + normalizedBatchSize));
  }
  return batches;
}

export function writeOpenAccessQueueFiles(
  messages,
  {
    outDir,
    batchSize = DEFAULT_OPEN_ACCESS_QUEUE_BATCH_SIZE,
    generatedAt = new Date().toISOString(),
  }
) {
  if (!outDir) {
    throw new Error('outDir is required for open access queue files');
  }

  mkdirSync(outDir, { recursive: true });
  const messagesFile = resolve(outDir, 'queue-messages.jsonl');
  const sqlFile = resolve(outDir, 'open-access-asset-ingest-seed.sql');
  const batchesDir = resolve(outDir, 'queue-batches');
  mkdirSync(batchesDir, { recursive: true });

  writeFileSync(
    messagesFile,
    messages.length
      ? `${messages.map((row) => JSON.stringify(row)).join('\n')}\n`
      : '',
    'utf8'
  );
  writeFileSync(
    sqlFile,
    `${buildOpenAccessAssetIngestSeedSql(messages, { generatedAt })}\n`,
    'utf8'
  );

  const batchFiles = chunkOpenAccessQueueMessages(messages, { batchSize }).map(
    (batch, index) => {
      const file = resolve(
        batchesDir,
        `open-access-assets-${String(index + 1).padStart(5, '0')}.json`
      );
      writeJson(file, buildCloudflareQueueBatchPayload(batch));
      return file;
    }
  );

  return {
    messagesFile,
    sqlFile,
    batchFiles,
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
