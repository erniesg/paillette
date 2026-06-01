#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
  isLargerSameAspectSource,
  reviewCropArtworkStatement,
  reviewCropBackfillPayload,
  reviewSourceCropSpec,
  selectReviewedCropsForBackfill,
  sourceImageCandidateUrls,
  stripUrlQuery,
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
  sourceRows: args.values.get('source-rows')
    ? resolve(args.values.get('source-rows'))
    : null,
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
  maxImageDim: Number(args.values.get('max-image-dim') || '4096'),
  thumbnailDim: Number(args.values.get('thumbnail-dim') || '768'),
  jpegQuality: Number(args.values.get('jpeg-quality') || '94'),
  thumbnailQuality: Number(args.values.get('thumbnail-quality') || '90'),
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
const sourceRowsById = new Map(
  (options.sourceRows ? readJson(options.sourceRows) : []).map((row) => [
    String(row.id),
    row,
  ])
);
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
  sourceRowsPath: options.sourceRows,
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
      width: options.maxImageDim,
      height: options.maxImageDim,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: options.jpegQuality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  writeFileSync(imageOut, normalized.data);

  const thumb = await sharp(normalized.data, { limitInputPixels: false })
    .resize({
      width: options.thumbnailDim,
      height: options.thumbnailDim,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .sharpen({ sigma: 0.45, m1: 0.4, m2: 0.4 })
    .jpeg({ quality: options.thumbnailQuality, mozjpeg: true })
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
    preparedSourceUrl: sourceInput.url || null,
    preparedSourceWidth: sourceInput.width || null,
    preparedSourceHeight: sourceInput.height || null,
    localReviewSourceWidth: sourceInput.localWidth || null,
    localReviewSourceHeight: sourceInput.localHeight || null,
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
    const localMetadata = await sharp(source.path, {
      limitInputPixels: false,
    }).metadata();
    const preferredSource = await preferredSourceForRow(
      row,
      source,
      localMetadata
    );
    const cropSpec = reviewSourceCropSpec(row.selectedImage, {
      width: preferredSource.metadata.width,
      height: preferredSource.metadata.height,
    });

    if (!cropSpec) {
      return {
        input: row.selectedImage.path,
        kind: 'selected_review_crop',
        path: row.selectedImage.path,
        extract: null,
      };
    }

    const cropBuffer = await sharp(preferredSource.input, {
      limitInputPixels: false,
    })
      .extract(cropSpec.extract)
      .toBuffer();

    return {
      input: cropBuffer,
      kind: preferredSource.kind,
      path: preferredSource.path,
      url: preferredSource.url,
      width: preferredSource.metadata.width,
      height: preferredSource.metadata.height,
      localWidth: localMetadata.width || null,
      localHeight: localMetadata.height || null,
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

async function preferredSourceForRow(row, source, localMetadata) {
  const localSource = {
    input: source.path,
    kind: 'review_source_crop',
    path: source.path,
    url: source.sourceUrl || null,
    metadata: localMetadata,
  };

  const sourceRow = sourceRowsById.get(row.id);
  if (!sourceRow) return localSource;

  const comparisonMetadata = await nativeSourceComparisonMetadata(
    row,
    localMetadata
  );
  const candidates = sourceImageCandidateUrls(sourceRow, row);
  let best = null;
  for (const candidate of candidates) {
    const downloaded = await downloadCandidateSource(candidate, row.id);
    if (!downloaded) continue;

    if (
      !isLargerSameAspectSource(
        {
          width: comparisonMetadata.width,
          height: comparisonMetadata.height,
        },
        {
          width: downloaded.metadata.width,
          height: downloaded.metadata.height,
        }
      )
    ) {
      continue;
    }

    const candidatePixels =
      Number(downloaded.metadata.width || 0) *
      Number(downloaded.metadata.height || 0);
    const bestPixels = best
      ? Number(best.metadata.width || 0) * Number(best.metadata.height || 0)
      : 0;
    if (!best || candidatePixels > bestPixels) {
      best = downloaded;
    }
  }

  if (!best) return localSource;
  const transformed = await applyReviewSourceTransformToNativeCandidate(
    row,
    best
  );
  const prepared = transformed || best;
  return {
    input: prepared.path,
    kind: `native_${prepared.kind}_review_source_crop`,
    path: prepared.path,
    url: best.url,
    metadata: prepared.metadata,
  };
}

async function nativeSourceComparisonMetadata(row, fallbackMetadata) {
  const sourceTransform = row.selectedImage?.sourceTransform;
  const sourceOriginalUrl = sourceTransform?.sourceOriginalUrl;
  if (!sourceOriginalUrl) return fallbackMetadata;

  const sourceOriginalPath = resolve(
    options.reviewDir,
    stripUrlQuery(sourceOriginalUrl)
  );
  if (!existsSync(sourceOriginalPath)) return fallbackMetadata;

  try {
    const metadata = await sharp(sourceOriginalPath, {
      limitInputPixels: false,
    }).metadata();
    return metadata.width && metadata.height ? metadata : fallbackMetadata;
  } catch {
    return fallbackMetadata;
  }
}

async function applyReviewSourceTransformToNativeCandidate(row, candidate) {
  const sourceTransform = row.selectedImage?.sourceTransform;
  if (!sourceTransform) return null;

  const angle = Number(sourceTransform.angleDegrees || 0);
  if (!Number.isFinite(angle) || Math.abs(angle) <= 0.05) {
    return null;
  }

  const fill = sourceTransform.diagnostics?.fill;
  const background = {
    r: clampColor(fill?.[0], 255),
    g: clampColor(fill?.[1], 255),
    b: clampColor(fill?.[2], 255),
    alpha: 1,
  };
  const sourceDir = resolve(options.outDir, 'source-cache');
  mkdirSync(sourceDir, { recursive: true });
  const transformKey = createHash('sha256')
    .update(
      JSON.stringify({
        candidate: candidate.url || candidate.path,
        angle,
        background,
      })
    )
    .digest('hex');
  const path = resolve(
    sourceDir,
    `${safeFilename(row.id)}-${transformKey}-source-transform.jpg`
  );

  if (!existsSync(path)) {
    await sharp(candidate.path, { limitInputPixels: false })
      .rotate(angle, { background })
      .flatten({ background })
      .jpeg({ quality: 98, mozjpeg: true })
      .toFile(path);
  }

  try {
    const metadata = await sharp(path, { limitInputPixels: false }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return {
      kind: `${candidate.kind}_source_transform`,
      url: candidate.url,
      path,
      metadata,
    };
  } catch {
    return null;
  }
}

function clampColor(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(255, Math.round(number)));
}

async function downloadCandidateSource(candidate, id) {
  const sourceDir = resolve(options.outDir, 'source-cache');
  mkdirSync(sourceDir, { recursive: true });
  const cacheKey = createHash('sha256').update(candidate.url).digest('hex');
  const path = resolve(sourceDir, `${safeFilename(id)}-${cacheKey}.img`);

  if (!existsSync(path)) {
    let response;
    try {
      response = await fetch(candidate.url, {
        headers: {
          'User-Agent': 'paillette-ngs-reviewed-crop-backfill/1.0',
        },
        redirect: 'follow',
      });
    } catch {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.startsWith('image/')) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(path, buffer);
  }

  try {
    const metadata = await sharp(path, { limitInputPixels: false }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return {
      kind: candidate.kind,
      url: candidate.url,
      path,
      metadata,
    };
  } catch {
    return null;
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
        preparedSourceUrl: row.preparedSourceUrl || null,
        preparedSourceWidth: row.preparedSourceWidth || null,
        preparedSourceHeight: row.preparedSourceHeight || null,
        localReviewSourceWidth: row.localReviewSourceWidth || null,
        localReviewSourceHeight: row.localReviewSourceHeight || null,
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
  const existingIds = readExistingVectorIds(out);
  if (!existsSync(out)) writeFileSync(out, '');
  const pendingRows = planRows.filter((row) => !existingIds.has(row.id));
  let completed = planRows.length - pendingRows.length;

  for (
    let index = 0;
    index < pendingRows.length;
    index += options.vectorBatchSize
  ) {
    const batch = pendingRows.slice(index, index + options.vectorBatchSize);
    const inputs = batch.map((row) => ({
      image: readFileSync(row.preparedImagePath).toString('base64'),
    }));
    const vectors = await requestJinaEmbeddings({
      apiKey,
      model: 'jina-clip-v2',
      inputs,
      dimensions: 1024,
    });
    const lines = [];
    batch.forEach((row, rowIndex) => {
      lines.push(vectorLine(row, vectors[rowIndex]));
    });
    appendFileSync(out, `${lines.join('\n')}\n`);
    completed += batch.length;
    console.error(
      `embedded images ${completed}/${planRows.length}`
    );
  }
  return out;
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
  --source-rows <path>       Optional DB rows with ngs_image_url/roots_listing_url for native source upgrades.
  --out-dir <path>           Output directory. Default: tmp/ngs-reviewed-crops-backfill
  --max-image-dim <n>        Max display image edge. Default 4096.
  --thumbnail-dim <n>        Max thumbnail edge. Default 768.
  --jpeg-quality <n>         Display JPEG quality. Default 94.
  --thumbnail-quality <n>    Thumbnail JPEG quality. Default 90.
  --limit <n>                Limit accepted rows for smoke tests.
  --prepare-only             Prepare images and SQL without uploading/applying/embedding.
  --upload                   Upload prepared images to R2.
  --apply-d1                 Apply generated SQL to remote D1.
  --embed-images             Generate image-vectors.ndjson with Jina.
  --upsert-vectors           Upsert generated vectors to Vectorize.
  --apply                    Upload, apply D1, generate image embeddings, and upsert vectors.
`);
}
