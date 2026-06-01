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
import { basename, dirname, resolve } from 'node:path';

import {
  DEFAULT_NGS_ORG_ID,
  DEFAULT_STAGING_ASSET_API_BASE,
  buildAssetUrls,
  captionRecordForRow,
  decisionsMap,
  mapByName,
  safeFilename,
  selectImageForBackfill,
  sqlString,
  stableAssetId,
} from './lib/ngs-missing-image-backfill.mjs';

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
const DEFAULT_MANIFEST =
  'tmp/ngs-missing-images-downloads/paillette-db-stg-missing-display-images.json';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

const options = {
  manifest: resolve(args.values.get('manifest') || DEFAULT_MANIFEST),
  sam3Report: args.values.get('sam3-report')
    ? resolve(args.values.get('sam3-report'))
    : null,
  cropDecisions: args.values.get('crop-decisions')
    ? resolve(args.values.get('crop-decisions'))
    : null,
  captionJsonl: args.values.get('caption-jsonl')
    ? resolve(args.values.get('caption-jsonl'))
    : null,
  outDir: resolve(args.values.get('out-dir') || 'tmp/ngs-missing-images-backfill'),
  database: args.values.get('database') || 'paillette-db-stg',
  bucket: args.values.get('bucket') || 'paillette-assets-stg',
  imageIndex: args.values.get('image-index') || 'paillette-embeddings-v2-stg',
  captionIndex:
    args.values.get('caption-index') || 'paillette-caption-embeddings-v2-stg',
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  orgId: args.values.get('org-id') || DEFAULT_NGS_ORG_ID,
  assetVersion: args.values.get('asset-version') || 'ngs-missing-v1',
  objectKeyPrefix: args.values.get('object-key-prefix') || 'ngs-missing',
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
  embedCaptions: args.flags.has('embed-captions'),
  upsertVectors: args.flags.has('upsert-vectors') || args.flags.has('apply'),
  prepareOnly: args.flags.has('prepare-only'),
  skipPrepare: args.flags.has('skip-prepare'),
};

mkdirSync(options.outDir, { recursive: true });

const rows = loadRows(options.manifest)
  .filter((row) => row.download?.ok)
  .slice(0, options.limit > 0 ? options.limit : undefined);
const sam3ByName = options.sam3Report
  ? mapByName(loadRows(options.sam3Report))
  : new Map();
const cropDecisionsByName = options.cropDecisions
  ? decisionsMap(readJson(options.cropDecisions))
  : new Map();
const captionById = options.captionJsonl
  ? loadCaptionJsonl(options.captionJsonl)
  : new Map();

const selected = rows.map((row) => {
  const image = selectImageForBackfill(row, {
    sam3ByName,
    cropDecisionsByName,
  });
  return { ...row, selectedImage: image };
});

const plan = options.skipPrepare
  ? selected.map(planRowWithoutPrepare)
  : await mapLimit(selected, options.concurrency, prepareRow);

writeJson(resolve(options.outDir, 'backfill-plan.json'), {
  generatedAt: new Date().toISOString(),
  orgId: options.orgId,
  database: options.database,
  bucket: options.bucket,
  apiBase: options.apiBase,
  count: plan.length,
  rows: plan,
});

writeJsonl(resolve(options.outDir, 'backfill-plan.jsonl'), plan);
writeFileSync(resolve(options.outDir, 'backfill-summary.json'), `${JSON.stringify(summarize(plan), null, 2)}\n`);

if (options.prepareOnly) {
  console.log(JSON.stringify({ summary: summarize(plan), outDir: options.outDir }, null, 2));
  process.exit(0);
}

if (options.upload) {
  await uploadAssets(plan);
}

const sqlFiles = writeD1Sql(plan, captionById);
if (options.applyD1) {
  applySqlFiles(sqlFiles);
}

if (options.embedImages) {
  loadEnvFile(options.envFile);
  const imageNdjson = await writeImageVectorNdjson(plan);
  if (options.upsertVectors) {
    upsertVectorFile(options.imageIndex, imageNdjson);
  }
}

if (options.embedCaptions) {
  loadEnvFile(options.envFile);
  if (!captionById.size) {
    throw new Error('--caption-jsonl is required with --embed-captions');
  }
  const captionNdjson = await writeCaptionVectorNdjson(plan, captionById);
  if (options.upsertVectors) {
    upsertVectorFile(options.captionIndex, captionNdjson);
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
        imageVectors: existsSync(resolve(options.outDir, 'image-vectors.ndjson'))
          ? resolve(options.outDir, 'image-vectors.ndjson')
          : null,
        captionVectors: existsSync(resolve(options.outDir, 'caption-vectors.ndjson'))
          ? resolve(options.outDir, 'caption-vectors.ndjson')
          : null,
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

function loadRows(path) {
  const raw = readJson(path);
  return Array.isArray(raw) ? raw : raw.rows || [];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(path, rowsToWrite) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rowsToWrite.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function loadCaptionJsonl(path) {
  const rowsById = new Map();
  const contents = readFileSync(path, 'utf8');
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const caption = String(row.caption || row.text || '').trim();
    if (!row.id || !caption) continue;
    rowsById.set(String(row.id), {
      ...row,
      caption,
      captionModel: row.model || row.captionModel || null,
      captionPromptVersion: row.prompt_version || row.captionPromptVersion || null,
      captionGeneratedAt: row.generated_at || row.captionGeneratedAt || null,
    });
  }
  return rowsById;
}

async function prepareRow(row) {
  if (!row.selectedImage.ok) {
    return { ...planRowWithoutPrepare(row), skipped: true };
  }

  const baseName = safeFilename(row.id);
  const originalAssetId = stableAssetId({
    artworkId: row.id,
    role: 'original',
    version: options.assetVersion,
  });
  const thumbnailAssetId = stableAssetId({
    artworkId: row.id,
    role: 'thumb',
    version: options.assetVersion,
  });
  const { imageUrl, thumbnailUrl } = buildAssetUrls({
    apiBase: options.apiBase,
    originalAssetId,
    thumbnailAssetId,
  });
  const objectKeyPrefix = options.objectKeyPrefix.replace(/^\/+|\/+$/g, '');
  const originalObjectKey = `${objectKeyPrefix}/${options.orgId}/${baseName}/original.jpg`;
  const thumbnailObjectKey = `${objectKeyPrefix}/${options.orgId}/${baseName}/thumb.jpg`;
  const imageOut = resolve(options.outDir, 'prepared', `${baseName}.jpg`);
  const thumbOut = resolve(options.outDir, 'prepared', `${baseName}.thumb.jpg`);
  mkdirSync(dirname(imageOut), { recursive: true });

  const normalized = await sharp(row.selectedImage.path, { limitInputPixels: false })
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

  const colors = await extractColors(normalized.data, imageUrl);
  const checksum = createHash('sha256').update(normalized.data).digest('hex');
  const now = new Date().toISOString();

  return {
    id: row.id,
    title: row.title || null,
    artist: row.artist || null,
    dateText: row.dateText || null,
    medium: row.medium || null,
    accessLevel: row.accessLevel || null,
    ngsPageUrl: row.ngsPageUrl || null,
    ngsImageUrl: row.ngsImageUrl || null,
    rootsListingUrl: row.rootsListingUrl || null,
    sourceKind: row.sourceKind || null,
    selected: row.selectedImage,
    preparedImagePath: imageOut,
    preparedThumbnailPath: thumbOut,
    originalAssetId,
    thumbnailAssetId,
    originalObjectKey,
    thumbnailObjectKey,
    imageUrl,
    thumbnailUrl,
    width: normalized.info.width,
    height: normalized.info.height,
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

function planRowWithoutPrepare(row) {
  return {
    id: row.id,
    title: row.title || null,
    artist: row.artist || null,
    dateText: row.dateText || null,
    medium: row.medium || null,
    accessLevel: row.accessLevel || null,
    ngsPageUrl: row.ngsPageUrl || null,
    ngsImageUrl: row.ngsImageUrl || null,
    rootsListingUrl: row.rootsListingUrl || null,
    sourceKind: row.sourceKind || null,
    selected: row.selectedImage,
    preparedImagePath: null,
    preparedThumbnailPath: null,
    colors: null,
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
      percentage: total > 0 ? (swatch.population / total) * 100 : 100 / swatches.length,
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
      throw new Error(`missing prepared file for upload: ${JSON.stringify(upload)}`);
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
    if ((index + 1) % 50 === 0 || index + 1 === uploads.length) {
      console.error(`uploaded ${index + 1}/${uploads.length}`);
    }
  });
}

function writeD1Sql(planRows, captionRowsById) {
  const sqlDir = resolve(options.outDir, 'sql');
  mkdirSync(sqlDir, { recursive: true });
  const statements = [];
  for (const row of planRows) {
    statements.push(...assetStatements(row));
    statements.push(artworkStatement(row, captionRowsById.get(row.id)));
  }

  const files = [];
  for (let index = 0; index < statements.length; index += options.d1BatchSize) {
    const chunk = statements.slice(index, index + options.d1BatchSize);
    const path = resolve(sqlDir, `backfill-${String(files.length + 1).padStart(3, '0')}.sql`);
    writeFileSync(path, `${chunk.join('\n')}\n`);
    files.push(path);
  }
  return files;
}

function assetStatements(row) {
  const now = new Date().toISOString();
  const provenance = sourceProvenance(row);
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
        source: provenance.source,
        sourceUrl: row.selected.sourceUrl,
        ngsImageUrl: row.ngsImageUrl,
        rootsListingUrl: row.rootsListingUrl || null,
        selectedKind: row.selected.kind,
        selectedSource: provenance.selectedSource,
        sam3Reason: row.selected.sam3Reason || null,
        sam3Box: row.selected.sam3Box || null,
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
        source: 'ngs_missing_image_backfill',
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

function artworkStatement(row, captionRow) {
  const captionPayload = captionRow
    ? captionRecordForRow(captionRow, captionRow.caption)
    : null;
  const provenance = sourceProvenance(row);
  const backfillPayload = {
    version: options.assetVersion,
    applied_at: new Date().toISOString(),
    source: provenance.source,
    ngs_image_url: row.ngsImageUrl,
    roots_listing_url: row.rootsListingUrl || null,
    selected_kind: row.selected.kind,
    selected_source: provenance.selectedSource,
    original_asset_id: row.originalAssetId,
    thumbnail_asset_id: row.thumbnailAssetId,
  };
  const customMetadataExpression = captionPayload
    ? `json_set(json_set(COALESCE(NULLIF(custom_metadata, ''), '{}'), '$.image_backfill', json('${sqlString(JSON.stringify(backfillPayload))}')), '$.generated_caption', json('${sqlString(JSON.stringify(captionPayload))}'))`
    : `json_set(COALESCE(NULLIF(custom_metadata, ''), '{}'), '$.image_backfill', json('${sqlString(JSON.stringify(backfillPayload))}'))`;

  return `
UPDATE artworks
SET
  image_url = '${sqlString(row.imageUrl)}',
  thumbnail_url = '${sqlString(row.thumbnailUrl)}',
  embedding_id = '${sqlString(row.id)}',
  dominant_colors = json('${sqlString(JSON.stringify(row.colors.dominantColors))}'),
  color_palette = json('${sqlString(JSON.stringify(row.colors.palette))}'),
  color_extracted_at = '${sqlString(row.colorExtractedAt)}',
  color_extraction_version = '${sqlString(options.assetVersion)}',
  custom_metadata = ${customMetadataExpression},
  updated_at = CURRENT_TIMESTAMP
WHERE id = '${sqlString(row.id)}'
  AND org_id = '${sqlString(options.orgId)}'
  AND deleted_at IS NULL;`.trim();
}

function sourceProvenance(row) {
  const sourceKind = String(row.sourceKind || row.selected?.kind || '').toLowerCase();
  if (sourceKind.includes('roots')) {
    return {
      source: 'roots_collection_image',
      selectedSource:
        row.selected?.kind === 'extracted'
          ? 'accepted_sam3_crop'
          : 'roots_collection_image',
    };
  }
  return {
    source: 'ngs_dam_rendition',
    selectedSource:
      row.selected?.kind === 'extracted'
        ? 'accepted_sam3_crop'
        : 'original_ngs_rendition',
  };
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

  for (let index = 0; index < pendingRows.length; index += options.vectorBatchSize) {
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
      lines.push(vectorLine(row, vectors[rowIndex], {
        channel: 'image',
        model: 'jina-clip-v2',
        sourceKind: 'image_embedding',
        sourceField: 'image_url',
      }));
    });
    appendFileSync(out, `${lines.join('\n')}\n`);
    completed += batch.length;
    console.error(`embedded images ${completed}/${planRows.length}`);
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

async function writeCaptionVectorNdjson(planRows, captionRowsById) {
  const rowsWithCaptions = planRows
    .map((row) => ({ row, caption: captionRowsById.get(row.id)?.caption }))
    .filter((item) => item.caption);
  const out = resolve(options.outDir, 'caption-vectors.ndjson');
  const apiKey = requireJinaApiKey();
  const lines = [];
  for (let index = 0; index < rowsWithCaptions.length; index += options.vectorBatchSize) {
    const batch = rowsWithCaptions.slice(index, index + options.vectorBatchSize);
    const vectors = await requestJinaEmbeddings({
      apiKey,
      model: 'jina-embeddings-v5-text-small',
      inputs: batch.map((item) => item.caption),
      task: 'retrieval.passage',
      dimensions: 1024,
    });
    batch.forEach((item, rowIndex) => {
      lines.push(vectorLine(item.row, vectors[rowIndex], {
        channel: 'caption',
        model: 'jina-embeddings-v5-text-small',
        sourceKind: 'generated_caption_embedding',
        sourceField: 'custom_metadata.generated_caption.text',
      }));
    });
    console.error(`embedded captions ${Math.min(index + options.vectorBatchSize, rowsWithCaptions.length)}/${rowsWithCaptions.length}`);
  }
  writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

function vectorLine(row, values, metadata) {
  return JSON.stringify(
    {
      id: row.id,
      values,
      metadata: {
        orgId: options.orgId,
        galleryId: options.orgId,
        artworkId: row.id,
        channel: metadata.channel,
        sourceKind: metadata.sourceKind,
        sourceField: metadata.sourceField,
        model: metadata.model,
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
        sourceUrl: row.ngsPageUrl || '',
        createdAt: new Date().toISOString(),
      },
    },
    null,
    0
  );
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
    const waitMs = retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : (response.status === 429 ? 65000 : Math.min(2 ** attempt, 30) * 1000);
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
    { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }
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

function l2Normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / Math.max(norm, 1e-8));
}

function yearFromDateText(value) {
  if (!value) return null;
  const match = String(value).match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
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

function summarize(planRows) {
  const bySelectedKind = {};
  for (const row of planRows) {
    const key = row.selected?.kind || 'none';
    bySelectedKind[key] = (bySelectedKind[key] || 0) + 1;
  }
  return {
    rows: planRows.length,
    selected: bySelectedKind,
    colors: planRows.filter((row) => row.colors?.dominantColors?.length).length,
    captionsInput: captionById.size,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/backfill-ngs-missing-image-assets.mjs [options]

Core options:
  --manifest PATH        Download manifest. Default: ${DEFAULT_MANIFEST}
  --out-dir PATH         Output directory. Default: tmp/ngs-missing-images-backfill
  --sam3-report PATH     Optional SAM3 report. Crops are ignored unless accepted.
  --crop-decisions PATH  Optional decisions JSON from review UI.
  --caption-jsonl PATH   Captions JSONL with id + caption/text.
  --asset-version NAME   Stable asset-id version. Default: ngs-missing-v1.
  --object-key-prefix P  R2 object key prefix. Default: ngs-missing.
  --limit N              Process first N valid downloaded rows.

Actions:
  --prepare-only         Prepare images/thumbs/colors/SQL, then exit.
  --upload               Upload prepared original/thumb assets to R2.
  --apply-d1             Apply generated D1 SQL to staging.
  --embed-images         Generate image vectors with Jina.
  --embed-captions       Generate caption vectors with Jina from --caption-jsonl.
  --upsert-vectors       Upsert generated vector NDJSON to Vectorize.
  --apply                Upload, apply D1, embed images, and upsert image vectors.

Defaults target staging resources. Extracted SAM3 images are used only when
--crop-decisions explicitly accepts that row's crop.`);
}
