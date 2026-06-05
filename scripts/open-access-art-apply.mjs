#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_STAGING_ASSET_API_BASE,
  buildOpenAccessApplyPlan,
  buildOpenAccessVectorLine,
  l2Normalize,
  writeOpenAccessD1Sql,
} from './lib/open-access-art-apply.mjs';

const JINA_EMBEDDINGS_URL = 'https://api.jina.ai/v1/embeddings';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

const options = {
  manifest: args.values.get('manifest')
    ? resolve(args.values.get('manifest'))
    : null,
  outDir: resolve(args.values.get('out-dir') || 'tmp/open-access-art-apply'),
  database: args.values.get('database') || 'paillette-db-stg',
  bucket: args.values.get('bucket') || 'paillette-assets-stg',
  imageIndex: args.values.get('image-index') || 'paillette-embeddings-v2-stg',
  captionIndex:
    args.values.get('caption-index') || 'paillette-caption-embeddings-v2-stg',
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  assetMode: args.values.get('asset-mode') || 'r2',
  limit: Number(args.values.get('limit') || '0'),
  d1BatchSize: Number(args.values.get('d1-batch-size') || '50'),
  uploadConcurrency: Number(args.values.get('upload-concurrency') || '4'),
  vectorBatchSize: Number(args.values.get('vector-batch-size') || '8'),
  envFile: resolve(args.values.get('env-file') || 'eval/.env'),
  captionJsonl: args.values.get('caption-jsonl')
    ? resolve(args.values.get('caption-jsonl'))
    : null,
  planOnly: args.flags.has('plan-only'),
  seedOnly: args.flags.has('seed-only'),
  apply: args.flags.has('apply'),
  upload: args.flags.has('upload') || args.flags.has('apply'),
  applyD1: args.flags.has('apply-d1') || args.flags.has('apply'),
  embedImages: args.flags.has('embed-images') || args.flags.has('apply'),
  embedCaptions: args.flags.has('embed-captions'),
  upsertVectors: args.flags.has('upsert-vectors') || args.flags.has('apply'),
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

mkdirSync(options.outDir, { recursive: true });

const manifest = options.seedOnly ? null : readJson(options.manifest);
const plan = buildOpenAccessApplyPlan({
  manifest,
  bucket: options.bucket,
  apiBase: options.apiBase,
  assetMode: options.assetMode,
  limit: options.limit,
});
if (options.seedOnly) {
  plan.records = [];
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

if (options.upload && plan.records.length) {
  await uploadAssets(plan.records);
}

if (options.applyD1) {
  applySqlFiles(sqlFiles);
}

let imageVectorFile = null;
if (options.embedImages && plan.records.length) {
  loadEnvFile(options.envFile);
  imageVectorFile = await writeImageVectorNdjson(plan.records);
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

async function uploadAssets(records) {
  const uploads = records.flatMap((row) => [
    {
      url: row.sourceImageUrl,
      key: row.imageObjectKey,
      assetId: row.imageAssetId,
    },
    {
      url: row.sourceThumbnailUrl,
      key: row.thumbnailObjectKey,
      assetId: row.thumbnailAssetId,
    },
  ]);

  await mapLimit(uploads, options.uploadConcurrency, async (upload, index) => {
    const downloaded = await downloadAsset(upload);
    execFileSync(
      'pnpm',
      [
        '--dir',
        'apps/api',
        'exec',
        'wrangler',
        'r2',
        'object',
        'put',
        `${options.bucket}/${upload.key}`,
        '--file',
        downloaded.path,
        '--content-type',
        downloaded.contentType,
      ],
      wranglerExecOptions
    );
    if ((index + 1) % 25 === 0 || index + 1 === uploads.length) {
      console.error(`uploaded ${index + 1}/${uploads.length}`);
    }
  });
}

async function downloadAsset(upload) {
  if (!upload.url) throw new Error(`missing source URL for ${upload.key}`);
  const extension = upload.key.split('.').pop() || 'jpg';
  const path = resolve(options.outDir, 'assets', `${upload.assetId}.${extension}`);
  if (existsSync(path)) {
    return { path, contentType: contentTypeForExtension(extension) };
  }

  const response = await fetch(upload.url, {
    headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
  });
  if (!response.ok) {
    throw new Error(`image fetch failed with ${response.status}: ${upload.url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return {
    path,
    contentType:
      response.headers.get('content-type') || contentTypeForExtension(extension),
  };
}

function contentTypeForExtension(extension) {
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
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
  pnpm open:apply -- --manifest tmp/open-access-art-dry-run.json --limit 20 --upload --apply-d1 --embed-images --upsert-vectors

Options:
  --manifest PATH          Dry-run manifest from pnpm open:dry-run -- --out PATH.
  --out-dir PATH           Output directory. Default: tmp/open-access-art-apply.
  --limit N                Apply only the first N normalized sample records.
  --seed-only              Write/apply only org and collection seed SQL.
  --asset-mode r2|external D1 image URL mode. Default: r2.
  --upload                 Fetch source images and upload web/thumb objects to R2.
  --apply-d1               Apply generated SQL to D1.
  --embed-images           Generate image vector NDJSON with Jina CLIP.
  --caption-jsonl PATH     Generated captions, one JSON object per line.
  --embed-captions         Generate caption vector NDJSON from --caption-jsonl.
  --upsert-vectors         Upsert generated vector NDJSON to Vectorize.
  --apply                  Upload, apply D1, embed images, and upsert image vectors.
  --plan-only              Only write plan, summary, and SQL files.
`);
}
