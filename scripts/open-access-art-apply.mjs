#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  buildR2ReadinessReport,
  putR2Object,
  putR2ObjectWithWrangler,
  R2_BUCKET_ENV,
} from './lib/open-access-art.mjs';
import {
  DEFAULT_STAGING_ASSET_API_BASE,
  buildOpenAccessAssetDownloads,
  buildOpenAccessApplyPlan,
  buildOpenAccessVectorLine,
  l2Normalize,
  writeOpenAccessD1Sql,
} from './lib/open-access-art-apply.mjs';
import {
  requireApprovedR2Bucket,
  resolveR2Bucket,
} from './lib/rucksack-storage-policy.mjs';

const JINA_EMBEDDINGS_URL = 'https://api.jina.ai/v1/embeddings';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}
const r2Bucket = resolveR2Bucket({
  cliBucket: args.values.get('bucket'),
  defaultBucket: 'paillette-assets-stg',
});

const options = {
  manifest: args.values.get('manifest')
    ? resolve(args.values.get('manifest'))
    : null,
  outDir: resolve(args.values.get('out-dir') || 'tmp/open-access-art-apply'),
  database: args.values.get('database') || 'paillette-db-stg',
  bucket: r2Bucket.bucket,
  imageIndex: args.values.get('image-index') || 'paillette-embeddings-v2-stg',
  captionIndex:
    args.values.get('caption-index') || 'paillette-caption-embeddings-v2-stg',
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  assetMode: args.values.get('asset-mode') || 'r2',
  externalProviders: providerList(args.values.get('external-providers')),
  limit: Number(args.values.get('limit') || '0'),
  d1BatchSize: Number(args.values.get('d1-batch-size') || '50'),
  uploadConcurrency: Number(args.values.get('upload-concurrency') || '4'),
  uploadAuth: args.values.get('upload-auth') || 's3',
  readinessOut: resolve(
    args.values.get('readiness-out') || 'tmp/nga-r2-readiness.json'
  ),
  vectorBatchSize: Number(args.values.get('vector-batch-size') || '8'),
  envFile: resolve(args.values.get('env-file') || 'eval/.env'),
  captionJsonl: args.values.get('caption-jsonl')
    ? resolve(args.values.get('caption-jsonl'))
    : null,
  planOnly: args.flags.has('plan-only'),
  seedOnly: args.flags.has('seed-only'),
  apply: args.flags.has('apply'),
  download:
    args.flags.has('download') ||
    args.flags.has('download-only') ||
    args.flags.has('upload') ||
    args.flags.has('apply'),
  downloadOnly: args.flags.has('download-only'),
  refreshAssets: args.flags.has('refresh-assets'),
  upload: args.flags.has('upload') || args.flags.has('apply'),
  applyD1: args.flags.has('apply-d1') || args.flags.has('apply'),
  embedImages: args.flags.has('embed-images'),
  embedExternalImages: args.flags.has('embed-external-images'),
  embedCaptions: args.flags.has('embed-captions'),
  upsertVectors: args.flags.has('upsert-vectors'),
};

const wranglerExecOptions = {
  stdio: 'inherit',
  maxBuffer: 16 * 1024 * 1024,
  env: {
    ...process.env,
    CI: '1',
    WRANGLER_SEND_METRICS: 'false',
  },
};

if (!options.manifest && !options.seedOnly) {
  throw new Error('--manifest is required unless --seed-only is used');
}
if (options.assetMode !== 'r2' && options.assetMode !== 'external') {
  throw new Error('--asset-mode must be r2 or external');
}
if (options.assetMode !== 'r2' && options.upload) {
  throw new Error('--upload requires --asset-mode=r2');
}
if (options.assetMode === 'r2' && options.upload) {
  requireApprovedR2Bucket({
    approved: r2Bucket.approved,
    operation: 'live upload',
  });
}

mkdirSync(options.outDir, { recursive: true });

const manifest = options.seedOnly ? null : readJson(options.manifest);
const plan = buildOpenAccessApplyPlan({
  manifest,
  bucket: options.bucket,
  apiBase: options.apiBase,
  assetMode: options.assetMode,
  externalProviders: options.externalProviders,
  limit: options.limit,
});
if (options.seedOnly) {
  plan.records = [];
}
if (options.upload && plan.records.length > 2) {
  const error = new Error(
    'live R2 upload is capped at two records for issue #18'
  );
  error.exitCode = 4;
  throw error;
}

writeJson(resolve(options.outDir, 'apply-plan.json'), plan);
writeJsonl(resolve(options.outDir, 'apply-plan.jsonl'), plan.records);
writeJson(resolve(options.outDir, 'apply-summary.json'), summarizePlan(plan));

const sqlFiles = writeOpenAccessD1Sql(plan, {
  outDir: options.outDir,
  batchSize: options.d1BatchSize,
});

if (options.planOnly) {
  console.log(
    JSON.stringify(
      { summary: summarizePlan(plan), outputs: outputs(sqlFiles) },
      null,
      2
    )
  );
  process.exit(0);
}

let assetManifestFile = null;
if (options.upload) {
  const readiness = buildR2ReadinessReport({
    uploadAuth: options.uploadAuth,
  });
  writeJson(options.readinessOut, readiness);
  if (readiness.exit_code !== 0) {
    assetManifestFile = writeBlockedAssetManifest(readiness);
    console.error(
      `R2 readiness blocked upload with exit code ${readiness.exit_code}`
    );
    process.exit(readiness.exit_code);
  }
}

let assetDownloads = [];
if (options.download && plan.records.length) {
  assetDownloads = await downloadAssets(plan.records);
  assetManifestFile = writeAssetManifest(assetDownloads);
}

if (options.downloadOnly) {
  console.log(
    JSON.stringify(
      {
        summary: summarizePlan(plan),
        outputs: {
          ...outputs(sqlFiles),
          assetManifest: assetManifestFile,
        },
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (options.upload && plan.records.length) {
  await uploadAssets(
    assetDownloads.length ? assetDownloads : await downloadAssets(plan.records)
  );
}

if (options.applyD1) {
  applySqlFiles(sqlFiles);
}

let imageVectorFile = null;
if (options.embedImages && plan.records.length) {
  loadEnvFile(options.envFile);
  const imageRows = options.embedExternalImages
    ? plan.records
    : plan.records.filter((row) => row.assetMode === 'r2');
  imageVectorFile = await writeImageVectorNdjson(imageRows);
  if (options.upsertVectors) {
    upsertVectorFile(options.imageIndex, imageVectorFile);
  }
}

let captionVectorFile = null;
if (options.embedCaptions) {
  if (!options.captionJsonl) {
    throw new Error('--caption-jsonl is required with --embed-captions');
  }
  loadEnvFile(options.envFile);
  captionVectorFile = await writeCaptionVectorNdjson(
    plan.records,
    loadCaptionJsonl(options.captionJsonl)
  );
  if (options.upsertVectors) {
    upsertVectorFile(options.captionIndex, captionVectorFile);
  }
}

console.log(
  JSON.stringify(
    {
      summary: summarizePlan(plan),
      outputs: {
        ...outputs(sqlFiles),
        assetManifest: assetManifestFile,
        imageVectors: imageVectorFile,
        captionVectors: captionVectorFile,
      },
    },
    null,
    2
  )
);

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      values.set(key, rest.join('='));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(raw);
    } else {
      values.set(raw, next);
      index += 1;
    }
  }
  return { values, flags };
}

function providerList(value) {
  return String(value || '')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function summarizePlan(plan) {
  const providers = {};
  for (const row of plan.records) {
    providers[row.provider] = (providers[row.provider] || 0) + 1;
  }
  return {
    generatedAt: plan.generatedAt,
    orgId: plan.orgId,
    collectionId: plan.collectionId,
    assetMode: plan.assetMode,
    recordCount: plan.records.length,
    cachedRecordCount: plan.records.filter((row) => row.assetMode === 'r2')
      .length,
    externalRecordCount: plan.records.filter(
      (row) => row.assetMode === 'external'
    ).length,
    providers,
  };
}

function outputs(sqlFiles) {
  return {
    outDir: options.outDir,
    plan: resolve(options.outDir, 'apply-plan.json'),
    summary: resolve(options.outDir, 'apply-summary.json'),
    sqlFiles: sqlFiles.map((file) => file.file),
  };
}

async function uploadAssets(downloads) {
  if (!downloads.length) return;

  await mapLimit(downloads, options.uploadConcurrency, async (download, index) => {
    const result =
      options.uploadAuth === 'wrangler'
        ? putR2ObjectWithWrangler({
            file: download.localPath,
            key: download.objectKey,
            contentType: download.contentType,
          })
        : await putR2Object({
            body: readFileSync(download.localPath),
            key: download.objectKey,
            contentType: download.contentType,
            env: { ...process.env, [R2_BUCKET_ENV]: options.bucket },
          });
    download.upload = {
      status: 'uploaded',
      uploadAuth: options.uploadAuth,
      etag: result.etag || null,
    };
    if ((index + 1) % 25 === 0 || index + 1 === downloads.length) {
      console.error(`uploaded ${index + 1}/${downloads.length}`);
    }
  });
}

async function downloadAssets(records) {
  const downloads = buildOpenAccessAssetDownloads(records, {
    outDir: options.outDir,
  });
  if (!downloads.length) return [];

  await mapLimit(downloads, options.uploadConcurrency, async (download, index) => {
    await downloadAsset(download);
    if ((index + 1) % 25 === 0 || index + 1 === downloads.length) {
      console.error(`downloaded ${index + 1}/${downloads.length}`);
    }
  });

  return downloads.map((download) => ({
    ...download,
    sizeBytes: statSync(download.localPath).size,
    sha256: fileSha256(download.localPath),
  }));
}

async function downloadAsset(download) {
  if (!download.sourceUrl) {
    throw new Error(`missing source URL for ${download.objectKey}`);
  }
  if (existsSync(download.localPath) && !options.refreshAssets) {
    return download;
  }

  const response = await fetch(download.sourceUrl, {
    headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
  });
  if (!response.ok) {
    throw new Error(
      `image fetch failed with ${response.status}: ${download.sourceUrl}`
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(download.localPath), { recursive: true });
  writeFileSync(download.localPath, bytes);
  download.contentType = response.headers.get('content-type') || download.contentType;
  return download;
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeAssetManifest(downloads) {
  const file = resolve(options.outDir, 'asset-manifest.json');
  writeJson(file, {
    generatedAt: new Date().toISOString(),
    bucket: options.bucket,
    count: downloads.length,
    uploadAuth: options.uploadAuth,
    uploadRequested: options.upload,
    readinessReport: options.upload ? options.readinessOut : null,
    assets: downloads,
  });
  return file;
}

function writeBlockedAssetManifest(readiness) {
  const file = resolve(options.outDir, 'asset-manifest.json');
  writeJson(file, {
    generatedAt: new Date().toISOString(),
    bucket: options.bucket,
    count: 0,
    uploadAuth: options.uploadAuth,
    uploadRequested: options.upload,
    uploadPerformed: false,
    readinessReport: options.readinessOut,
    blockedReason: readiness.blocked_reason,
    assets: [],
  });
  return file;
}

function applySqlFiles(files) {
  files.forEach((file, index) => {
    execFileSync(
      'pnpm',
      [
        '--dir',
        'apps/api',
        'exec',
        'wrangler',
        'd1',
        'execute',
        options.database,
        '--remote',
        '--file',
        file.file,
      ],
      wranglerExecOptions
    );
    console.error(`applied sql ${index + 1}/${files.length}`);
  });
}

async function writeImageVectorNdjson(records) {
  const out = resolve(options.outDir, 'image-vectors.ndjson');
  const apiKey = requireJinaApiKey();
  const existingIds = readExistingVectorIds(out);
  if (!existsSync(out)) writeFileSync(out, '');
  const pendingRows = records.filter((row) => !existingIds.has(row.id));
  let completed = records.length - pendingRows.length;

  for (let index = 0; index < pendingRows.length; index += options.vectorBatchSize) {
    const batch = pendingRows.slice(index, index + options.vectorBatchSize);
    const inputs = await Promise.all(
      batch.map(async (row) => ({
        image: (await fetchImageBuffer(row.sourceImageUrl)).toString('base64'),
      }))
    );
    const vectors = await requestJinaEmbeddings({
      apiKey,
      model: 'jina-clip-v2',
      inputs,
      dimensions: 1024,
    });
    const lines = batch.map((row, rowIndex) =>
      buildOpenAccessVectorLine(row, vectors[rowIndex], {
        channel: 'image',
        model: 'jina-clip-v2',
        sourceKind: 'image_embedding',
        sourceField: 'image_url',
        generatedAt: new Date().toISOString(),
      })
    );
    appendFileSync(out, `${lines.join('\n')}\n`);
    completed += batch.length;
    console.error(`embedded images ${completed}/${records.length}`);
  }
  return out;
}

async function writeCaptionVectorNdjson(records, captionsById) {
  const out = resolve(options.outDir, 'caption-vectors.ndjson');
  const apiKey = requireJinaApiKey();
  const existingIds = readExistingVectorIds(out);
  if (!existsSync(out)) writeFileSync(out, '');
  const pendingRows = records.filter(
    (row) => captionsById.has(row.id) && !existingIds.has(row.id)
  );
  let completed = records.length - pendingRows.length;

  for (let index = 0; index < pendingRows.length; index += options.vectorBatchSize) {
    const batch = pendingRows.slice(index, index + options.vectorBatchSize);
    const vectors = await requestJinaEmbeddings({
      apiKey,
      model: 'jina-embeddings-v5-text-small',
      inputs: batch.map((row) => captionsById.get(row.id).caption),
      task: 'retrieval.passage',
      dimensions: 1024,
    });
    const lines = batch.map((row, rowIndex) =>
      buildOpenAccessVectorLine(row, vectors[rowIndex], {
        channel: 'caption',
        model: 'jina-embeddings-v5-text-small',
        sourceKind: 'generated_caption_embedding',
        sourceField: 'custom_metadata.generated_caption.text',
        generatedAt: new Date().toISOString(),
      })
    );
    appendFileSync(out, `${lines.join('\n')}\n`);
    completed += batch.length;
    console.error(`embedded captions ${completed}/${records.length}`);
  }
  return out;
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image fetch failed with ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function loadCaptionJsonl(path) {
  const rowsById = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const caption = String(row.caption || row.text || '').trim();
    if (!row.id || !caption) continue;
    rowsById.set(String(row.id), { ...row, caption });
  }
  return rowsById;
}

function readExistingVectorIds(path) {
  if (!existsSync(path)) return new Set();
  const ids = new Set();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?.id) ids.add(String(row.id));
    } catch {
      continue;
    }
  }
  return ids;
}

async function requestJinaEmbeddings({
  apiKey,
  model,
  inputs,
  task,
  dimensions,
}) {
  const body = {
    model,
    input: inputs,
    normalized: true,
    embedding_type: 'float',
    truncate: true,
    dimensions,
    ...(task ? { task } : {}),
  };
  const retryable = new Set([429, 500, 502, 503, 504]);
  let payload = null;
  let response = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetch(JINA_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    payload = await response.json();
    if (response.ok) break;
    if (!retryable.has(response.status) || attempt === 5) {
      throw new Error(
        payload.detail ||
          payload.code ||
          `Jina request failed with ${response.status}`
      );
    }
    const retryAfter = response.headers.get('retry-after');
    const waitMs =
      retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : response.status === 429
          ? 65000
          : Math.min(2 ** attempt, 30) * 1000;
    console.error(`Jina ${response.status}; retrying in ${Math.round(waitMs / 1000)}s`);
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
  }

  const vectors = payload.data?.map((row) => row.embedding) || [];
  if (vectors.length !== inputs.length) {
    throw new Error(`expected ${inputs.length} vectors, got ${vectors.length}`);
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      throw new Error(`unexpected vector dimensions for ${model}`);
    }
  }
  return vectors.map(l2Normalize);
}

function upsertVectorFile(index, file) {
  execFileSync(
    'pnpm',
    [
      '--dir',
      'apps/api',
      'exec',
      'wrangler',
      'vectorize',
      'upsert',
      index,
      '--file',
      file,
      '--batch-size',
      '500',
    ],
    wranglerExecOptions
  );
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (process.env[key]) continue;
    process.env[key] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

function requireJinaApiKey() {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error('JINA_API_KEY is required');
  return apiKey;
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function printHelp() {
  console.log(`Usage:
  pnpm open:apply -- --manifest tmp/open-access-art-dry-run.json --plan-only
  pnpm open:apply -- --seed-only --apply-d1
  pnpm open:apply -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-r2-upload-proof --limit=2 --asset-mode=r2 --download --upload --upload-auth=s3 --upload-concurrency=1

Options:
  --manifest PATH          Dry-run manifest from pnpm open:dry-run -- --out PATH.
  --out-dir PATH           Output directory. Default: tmp/open-access-art-apply.
  --limit N                Apply only the first N normalized sample records.
  --seed-only              Write/apply only org and collection seed SQL.
  --asset-mode r2|external D1 image URL mode. Default: r2.
  --bucket NAME            Approved R2 bucket for live upload. Falls back to object_storage.bucket in .agent/storage.yaml.
  --external-providers CSV Provider keys to leave as hotlinked external assets.
  --download               Download R2-cached source images into out-dir/assets.
  --download-only          Download assets, write asset-manifest.json, then stop.
  --refresh-assets         Re-fetch existing local asset files.
  --upload                 Upload downloaded web/thumb objects to R2 after readiness passes. Capped at two records.
  --upload-auth s3|wrangler R2 upload auth mode. Default: s3.
  --readiness-out PATH     R2 readiness report path. Default: tmp/nga-r2-readiness.json.
  --apply-d1               Apply generated SQL to D1.
  --embed-images           Generate image vector NDJSON with Jina CLIP.
  --embed-external-images  Also embed providers left in external asset mode.
  --caption-jsonl PATH     Generated captions, one JSON object per line.
  --embed-captions         Generate caption vector NDJSON from --caption-jsonl.
  --upsert-vectors         Upsert generated vector NDJSON to Vectorize.
  --apply                  Download assets, upload to R2, and apply D1.
  --plan-only              Only write plan, summary, and SQL files.

Live upload is blocked unless the R2 readiness report exits 0. Use
--upload-auth=wrangler only from a trusted machine with Wrangler already logged
in. Do not combine issue #18 proof runs with --apply-d1, queue enqueue,
caption generation, vector upsert, or deploy.
`);
}
