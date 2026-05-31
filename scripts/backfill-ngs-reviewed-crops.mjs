#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_NGS_ORG_ID,
  DEFAULT_STAGING_ASSET_API_BASE,
  buildAssetUrls,
  safeFilename,
  sqlString,
  stableAssetId,
} from './lib/ngs-missing-image-backfill.mjs';
import {
  reviewCropArtworkStatement,
  reviewCropBackfillPayload,
  reviewSourceCropSpec,
  selectReviewedCropsForBackfill,
} from './lib/ngs-reviewed-crop-backfill.mjs';

const imageRequire = createRequire(
  new URL('../packages/image-processing/package.json', import.meta.url)
);
const sharpModule = await import(imageRequire.resolve('sharp'));
const sharp = sharpModule.default || sharpModule;

const vibrantRequire = createRequire(
  new URL('../packages/color-extraction/package.json', import.meta.url)
);
const vibrantModule = await import(vibrantRequire.resolve('node-vibrant/node'));
const Vibrant = vibrantModule.Vibrant || vibrantModule.default?.Vibrant;

const JINA_EMBEDDINGS_URL = 'https://api.jina.ai/v1/embeddings';
const DEFAULT_REVIEW_DIR = 'tmp/ngs-remaining-sam3-rerun/review';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

const options = {
  reviewDir: resolve(args.values.get('review-dir') || DEFAULT_REVIEW_DIR),
  decisions: args.values.get('decisions')
    ? resolve(args.values.get('decisions'))
    : null,
  rows: args.values.get('rows') ? resolve(args.values.get('rows')) : null,
  outDir: resolve(
    args.values.get('out-dir') || 'tmp/ngs-reviewed-crops-backfill'
  ),
  database: args.values.get('database') || 'paillette-db-stg',
  bucket: args.values.get('bucket') || 'paillette-assets-stg',
  imageIndex: args.values.get('image-index') || 'paillette-embeddings-v2-stg',
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  orgId: args.values.get('org-id') || DEFAULT_NGS_ORG_ID,
  assetVersion: args.values.get('asset-version') || 'ngs-reviewed-crops-v1',
  objectKeyPrefix: args.values.get('object-key-prefix') || 'ngs-reviewed-crops',
  limit: Number(args.values.get('limit') || '0'),
  concurrency: Number(args.values.get('concurrency') || '4'),
  uploadConcurrency: Number(args.values.get('upload-concurrency') || '4'),
  vectorBatchSize: Number(args.values.get('vector-batch-size') || '8'),
  d1BatchSize: Number(args.values.get('d1-batch-size') || '20'),
  envFile: resolve(args.values.get('env-file') || 'eval/.env'),
  apply: args.flags.has('apply'),
  upload: args.flags.has('upload') || args.flags.has('apply'),
  applyD1: args.flags.has('apply-d1') || args.flags.has('apply'),
  embedImages: args.flags.has('embed-images') || args.flags.has('apply'),
  upsertVectors: args.flags.has('upsert-vectors') || args.flags.has('apply'),
  prepareOnly: args.flags.has('prepare-only'),
  skipPrepare: args.flags.has('skip-prepare'),
};

mkdirSync(options.outDir, { recursive: true });

const decisionsPath =
  options.decisions || resolve(options.reviewDir, 'review-decisions.json');
const rowsPath = options.rows || resolve(options.reviewDir, 'rows.json');
const decisionsPayload = readJson(decisionsPath);
const reviewRows = readJson(rowsPath);
const selected = selectReviewedCropsForBackfill({
  reviewDir: options.reviewDir,
  decisionsPayload,
  rows: reviewRows,
}).slice(0, options.limit > 0 ? options.limit : undefined);

const plan = options.skipPrepare
  ? selected.map(planRowWithoutPrepare)
  : await mapLimit(selected, options.concurrency, prepareRow);

writeJson(resolve(options.outDir, 'backfill-plan.json'), {
  generatedAt: new Date().toISOString(),
  reviewDir: options.reviewDir,
  decisionsPath,
  rowsPath,
  orgId: options.orgId,
  database: options.database,
  bucket: options.bucket,
  apiBase: options.apiBase,
  count: plan.length,
  rows: plan,
});
writeJsonl(resolve(options.outDir, 'backfill-plan.jsonl'), plan);
writeJson(resolve(options.outDir, 'backfill-summary.json'), summarize(plan));
const sqlFiles = writeD1Sql(plan);

if (options.prepareOnly) {
  console.log(
    JSON.stringify(
      {
        summary: summarize(plan),
        outputs: {
          outDir: options.outDir,
          plan: resolve(options.outDir, 'backfill-plan.json'),
          sqlFiles,
        },
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (options.upload) {
  await uploadAssets(plan);
}

if (options.applyD1) {
  applySqlFiles(sqlFiles);
}

let imageVectors = null;
if (options.embedImages) {
  loadEnvFile(options.envFile);
  imageVectors = await writeImageVectorNdjson(plan);
  if (options.upsertVectors) {
    upsertVectorFile(options.imageIndex, imageVectors);
  }
}

console.log(
  JSON.stringify(
    {
      summary: summarize(plan),
      outputs: {
        outDir: options.outDir,
        plan: resolve(options.outDir, 'backfill-plan.json'),
        sqlFiles,
        imageVectors,
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
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
    } else {
      values.set(key, next);
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
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

async function prepareRow(row) {
  const asset = assetIdentity(row.id);
  const imageOut = resolve(
    options.outDir,
    'prepared',
    `${safeFilename(row.id)}.jpg`
  );
  const thumbOut = resolve(
    options.outDir,
    'prepared',
    `${safeFilename(row.id)}.thumb.jpg`
  );
  mkdirSync(dirname(imageOut), { recursive: true });

  const sourceInput = await prepareReviewedCropInput(row);
  const normalized = await sharp(sourceInput.input, {
    limitInputPixels: false,
  })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  writeFileSync(imageOut, normalized.data);

  const thumb = await sharp(normalized.data, { limitInputPixels: false })
    .resize({
      width: 480,
      height: 480,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  writeFileSync(thumbOut, thumb.data);

  const colors = await extractColors(normalized.data, asset.imageUrl);
  const checksum = createHash('sha256').update(normalized.data).digest('hex');
  const now = new Date().toISOString();

  return {
    ...row,
    ...asset,
    preparedImagePath: imageOut,
    preparedThumbnailPath: thumbOut,
    width: normalized.info.width,
    height: normalized.info.height,
    preparedSourceKind: sourceInput.kind,
    preparedSourcePath: sourceInput.path,
    preparedSourceExtract: sourceInput.extract,
    thumbWidth: thumb.info.width,
    thumbHeight: thumb.info.height,
    sizeBytes: normalized.data.byteLength,
    thumbSizeBytes: thumb.data.byteLength,
    checksum,
    mimeType: 'image/jpeg',
    colors,
    colorExtractedAt: now,
  };
}

async function prepareReviewedCropInput(row) {
  const source = row.selectedImage?.reviewSource;
  if (!source?.path || !existsSync(source.path)) {
    return {
      input: row.selectedImage.path,
      kind: 'selected_review_crop',
      path: row.selectedImage.path,
      extract: null,
    };
  }

  try {
    const metadata = await sharp(source.path, {
      limitInputPixels: false,
    }).metadata();
    const cropSpec = reviewSourceCropSpec(row.selectedImage, {
      width: metadata.width,
      height: metadata.height,
    });

    if (!cropSpec) {
      return {
        input: row.selectedImage.path,
        kind: 'selected_review_crop',
        path: row.selectedImage.path,
        extract: null,
      };
    }

    const cropBuffer = await sharp(cropSpec.inputPath, {
      limitInputPixels: false,
    })
      .extract(cropSpec.extract)
      .toBuffer();

    return {
      input: cropBuffer,
      kind: 'review_source_crop',
      path: cropSpec.inputPath,
      extract: cropSpec.extract,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `could not prepare source crop for ${row.id}; using selected review crop: ${message}`
    );
    return {
      input: row.selectedImage.path,
      kind: 'selected_review_crop',
      path: row.selectedImage.path,
      extract: null,
    };
  }
}

function planRowWithoutPrepare(row) {
  return {
    ...row,
    ...assetIdentity(row.id),
    preparedImagePath: null,
    preparedThumbnailPath: null,
    colors: { dominantColors: [], palette: [] },
    colorExtractedAt: new Date().toISOString(),
  };
}

function assetIdentity(id) {
  const baseName = safeFilename(id);
  const originalAssetId = stableAssetId({
    artworkId: id,
    role: 'original',
    version: options.assetVersion,
  });
  const thumbnailAssetId = stableAssetId({
    artworkId: id,
    role: 'thumb',
    version: options.assetVersion,
  });
  const { imageUrl, thumbnailUrl } = buildAssetUrls({
    apiBase: options.apiBase,
    originalAssetId,
    thumbnailAssetId,
  });
  const prefix = options.objectKeyPrefix.replace(/^\/+|\/+$/g, '');

  return {
    originalAssetId,
    thumbnailAssetId,
    imageUrl,
    thumbnailUrl,
    originalObjectKey: `${prefix}/${options.orgId}/${baseName}/original.jpg`,
    thumbnailObjectKey: `${prefix}/${options.orgId}/${baseName}/thumb.jpg`,
  };
}

async function extractColors(buffer, imageUrl) {
  const palette = await Vibrant.from(buffer)
    .maxColorCount(10)
    .quality(1)
    .getPalette();
  const swatches = Object.values(palette)
    .filter(Boolean)
    .map((swatch) => ({
      rgb:
        typeof swatch.getRgb === 'function'
          ? swatch.getRgb()
          : swatch.rgb || swatch._rgb,
      population:
        typeof swatch.getPopulation === 'function'
          ? swatch.getPopulation()
          : swatch.population || swatch._population || 0,
    }))
    .filter((swatch) => Array.isArray(swatch.rgb) && swatch.rgb.length >= 3)
    .sort((a, b) => b.population - a.population)
    .slice(0, 5);
  const total = swatches.reduce((sum, swatch) => sum + swatch.population, 0);
  const dominantColors = swatches.map((swatch) => {
    const rgb = {
      r: Math.round(swatch.rgb[0] || 0),
      g: Math.round(swatch.rgb[1] || 0),
      b: Math.round(swatch.rgb[2] || 0),
    };
    return {
      color: rgbToHex(rgb),
      rgb,
      percentage:
        total > 0 ? (swatch.population / total) * 100 : 100 / swatches.length,
    };
  });
  return {
    dominantColors,
    palette: dominantColors,
    extractedAt: new Date().toISOString(),
    imageUrl,
  };
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => Math.round(value).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function writeD1Sql(planRows) {
  const sqlDir = resolve(options.outDir, 'sql');
  mkdirSync(sqlDir, { recursive: true });
  const statements = [];
  const appliedAt = new Date().toISOString();
  for (const row of planRows) {
    statements.push(...assetStatements(row, appliedAt));
    statements.push(
      reviewCropArtworkStatement(row, {
        orgId: options.orgId,
        appliedAt,
        version: options.assetVersion,
      })
    );
  }

  const files = [];
  for (let index = 0; index < statements.length; index += options.d1BatchSize) {
    const chunk = statements.slice(index, index + options.d1BatchSize);
    const path = resolve(
      sqlDir,
      `backfill-${String(files.length + 1).padStart(3, '0')}.sql`
    );
    writeFileSync(path, `${chunk.join('\n')}\n`);
    files.push(path);
  }
  return files;
}

function assetStatements(row, now) {
  return [
    assetStatement({
      id: row.originalAssetId,
      artworkId: row.id,
      role: 'original',
      objectKey: row.originalObjectKey,
      url: row.imageUrl,
      width: row.width,
      height: row.height,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum,
      metadata: {
        ...reviewCropBackfillPayload(row, {
          originalAssetId: row.originalAssetId,
          thumbnailAssetId: row.thumbnailAssetId,
          appliedAt: now,
          version: options.assetVersion,
        }),
        originalReviewSourcePath: row.selectedImage.originalPath,
        preparedSourceKind: row.preparedSourceKind || null,
        preparedSourcePath: row.preparedSourcePath || null,
        preparedSourceExtract: row.preparedSourceExtract || null,
      },
      now,
    }),
    assetStatement({
      id: row.thumbnailAssetId,
      artworkId: row.id,
      role: 'thumb',
      objectKey: row.thumbnailObjectKey,
      url: row.thumbnailUrl,
      width: row.thumbWidth,
      height: row.thumbHeight,
      sizeBytes: row.thumbSizeBytes,
      checksum: null,
      metadata: {
        source: 'ngs_reviewed_crop_backfill',
        derivedFrom: row.originalAssetId,
      },
      now,
    }),
  ];
}

function assetStatement({
  id,
  artworkId,
  role,
  objectKey,
  url,
  width,
  height,
  sizeBytes,
  checksum,
  metadata,
  now,
}) {
  return `
INSERT INTO assets (
  id, artwork_id, org_id, role, storage_provider, bucket, object_key, url,
  mime_type, width, height, size_bytes, checksum, metadata, created_at, updated_at
) VALUES (
  '${sqlString(id)}', '${sqlString(artworkId)}', '${sqlString(options.orgId)}',
  '${sqlString(role)}', 'r2', '${sqlString(options.bucket)}',
  '${sqlString(objectKey)}', '${sqlString(url)}', 'image/jpeg',
  ${Number(width) || 'NULL'}, ${Number(height) || 'NULL'},
  ${Number(sizeBytes) || 'NULL'},
  ${checksum ? `'${sqlString(checksum)}'` : 'NULL'},
  json('${sqlString(JSON.stringify(metadata))}'),
  '${sqlString(now)}', '${sqlString(now)}'
)
ON CONFLICT(artwork_id, role, object_key) DO UPDATE SET
  url = excluded.url,
  bucket = excluded.bucket,
  mime_type = excluded.mime_type,
  width = excluded.width,
  height = excluded.height,
  size_bytes = excluded.size_bytes,
  checksum = excluded.checksum,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at;`.trim();
}

async function uploadAssets(planRows) {
  const uploads = [];
  for (const row of planRows) {
    uploads.push({
      path: row.preparedImagePath,
      key: row.originalObjectKey,
      contentType: 'image/jpeg',
    });
    uploads.push({
      path: row.preparedThumbnailPath,
      key: row.thumbnailObjectKey,
      contentType: 'image/jpeg',
    });
  }

  await mapLimit(uploads, options.uploadConcurrency, async (upload, index) => {
    if (!upload.path || !existsSync(upload.path)) {
      throw new Error(
        `missing prepared file for upload: ${JSON.stringify(upload)}`
      );
    }
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
        upload.path,
        '--content-type',
        upload.contentType,
      ],
      { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }
    );
    if ((index + 1) % 10 === 0 || index + 1 === uploads.length) {
      console.error(`uploaded ${index + 1}/${uploads.length}`);
    }
  });
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
        file,
      ],
      { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }
    );
    console.error(`applied sql ${index + 1}/${files.length}`);
  });
}

async function writeImageVectorNdjson(planRows) {
  const out = resolve(options.outDir, 'image-vectors.ndjson');
  const apiKey = requireJinaApiKey();
  const lines = [];
  for (
    let index = 0;
    index < planRows.length;
    index += options.vectorBatchSize
  ) {
    const batch = planRows.slice(index, index + options.vectorBatchSize);
    const inputs = batch.map((row) => ({
      image: readFileSync(row.preparedImagePath).toString('base64'),
    }));
    const vectors = await requestJinaEmbeddings({
      apiKey,
      model: 'jina-clip-v2',
      inputs,
      dimensions: 1024,
    });
    batch.forEach((row, rowIndex) => {
      lines.push(vectorLine(row, vectors[rowIndex]));
    });
    console.error(
      `embedded images ${Math.min(index + options.vectorBatchSize, planRows.length)}/${planRows.length}`
    );
  }
  writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

function vectorLine(row, values) {
  return JSON.stringify({
    id: row.id,
    values,
    metadata: {
      orgId: options.orgId,
      galleryId: options.orgId,
      artworkId: row.id,
      channel: 'image',
      sourceKind: 'image_embedding',
      sourceField: 'image_url',
      model: 'jina-clip-v2',
      embeddingVersion: 'v2',
      title: row.title || '',
      artist: row.artist || '',
      medium: row.medium || '',
      classification: '',
      year: yearFromDateText(row.dateText) || 0,
      dateText: row.dateText || '',
      accessionNumber: row.id,
      sourceInstitution: 'National Gallery Singapore',
      sourceCollection: 'National Collection',
      sourceUrl: row.selectedImage.reviewCropUrl || '',
      createdAt: new Date().toISOString(),
    },
  });
}

async function requestJinaEmbeddings({ apiKey, model, inputs, dimensions }) {
  const body = {
    model,
    input: inputs,
    normalized: true,
    embedding_type: 'float',
    truncate: true,
    dimensions,
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
    console.error(
      `Jina ${response.status}; retrying in ${Math.round(waitMs / 1000)}s`
    );
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

function l2Normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return values;
  return values.map((value) => value / norm);
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
    { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }
  );
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function requireJinaApiKey() {
  const key = process.env.JINA_API_KEY;
  if (!key) {
    throw new Error('JINA_API_KEY is required to generate image embeddings');
  }
  return key;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length || 1) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        output[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return output;
}

function summarize(planRows) {
  const byChoice = {};
  for (const row of planRows) {
    const choice = row.selectedImage.reviewChoice || 'unknown';
    byChoice[choice] = (byChoice[choice] || 0) + 1;
  }
  return {
    total: planRows.length,
    prepared: planRows.filter((row) => row.preparedImagePath).length,
    byChoice,
  };
}

function yearFromDateText(value) {
  const match = String(value || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/backfill-ngs-reviewed-crops.mjs --prepare-only
  node scripts/backfill-ngs-reviewed-crops.mjs --apply

Options:
  --review-dir <path>        Review directory. Default: ${DEFAULT_REVIEW_DIR}
  --decisions <path>         Decisions JSON. Default: <review-dir>/review-decisions.json
  --rows <path>              Review rows JSON. Default: <review-dir>/rows.json
  --out-dir <path>           Output directory. Default: tmp/ngs-reviewed-crops-backfill
  --limit <n>                Limit accepted rows for smoke tests.
  --prepare-only             Prepare images and SQL without uploading/applying/embedding.
  --upload                   Upload prepared images to R2.
  --apply-d1                 Apply generated SQL to remote D1.
  --embed-images             Generate image-vectors.ndjson with Jina.
  --upsert-vectors           Upsert generated vectors to Vectorize.
  --apply                    Upload, apply D1, generate image embeddings, and upsert vectors.
`);
}
