#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_NGS_ORG_ID,
  DEFAULT_STAGING_ASSET_API_BASE,
  safeFilename,
} from './lib/ngs-missing-image-backfill.mjs';

const imageRequire = createRequire(
  new URL('../packages/image-processing/package.json', import.meta.url)
);
const sharpModule = await import(imageRequire.resolve('sharp'));
const sharp = sharpModule.default || sharpModule;

const DEFAULT_REVIEW_ACTION_DATA =
  'tmp/ngs-crop-resolution-repair/review-action/review-action-data.json';
const DEFAULT_COMBINED_REVIEW_DIR =
  'tmp/ngs-crop-resolution-repair/review-action/combined-review';
const DEFAULT_SOURCE_ROWS =
  'tmp/ngs-crop-resolution-repair/review-action/source-rows.json';
const DEFAULT_LIVE_ARTWORKS = 'tmp/ngs-crop-resolution-repair/live-artworks.json';

const args = parseArgs(process.argv.slice(2));
if (args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

const options = {
  reviewActionData: resolve(
    args.values.get('review-action-data') || DEFAULT_REVIEW_ACTION_DATA
  ),
  combinedReviewDir: resolve(
    args.values.get('combined-review-dir') || DEFAULT_COMBINED_REVIEW_DIR
  ),
  sourceRows: resolve(args.values.get('source-rows') || DEFAULT_SOURCE_ROWS),
  liveArtworks: resolve(args.values.get('live-artworks') || DEFAULT_LIVE_ARTWORKS),
  outDir: resolve(
    args.values.get('out-dir') || 'tmp/ngs-crop-resolution-repair/apply-actions'
  ),
  database: args.values.get('database') || 'paillette-db-stg',
  bucket: args.values.get('bucket') || 'paillette-assets-stg',
  imageIndex: args.values.get('image-index') || 'paillette-embeddings-v2-stg',
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  orgId: args.values.get('org-id') || DEFAULT_NGS_ORG_ID,
  envFile: resolve(args.values.get('env-file') || 'eval/.env'),
  cropAssetVersion:
    args.values.get('crop-asset-version') || 'ngs-reviewed-crops-v4',
  cropObjectKeyPrefix:
    args.values.get('crop-object-key-prefix') || 'ngs-reviewed-crops',
  sourceAssetVersion:
    args.values.get('source-asset-version') || 'ngs-resolution-source-v1',
  sourceObjectKeyPrefix:
    args.values.get('source-object-key-prefix') || 'ngs-resolution-source',
  concurrency: Number(args.values.get('concurrency') || '4'),
  vectorBatchSize: Number(args.values.get('vector-batch-size') || '8'),
  apply: args.flags.has('apply'),
  prepareOnly: args.flags.has('prepare-only') || !args.flags.has('apply'),
};

mkdirSync(options.outDir, { recursive: true });

const reviewData = readJson(options.reviewActionData);
const actions = reviewData.actions || [];
const cropActions = actions.filter(
  (action) => action.defaultAction === 'approve_proposed'
);
const sourceActions = actions.filter((action) =>
  ['ingest_source_candidate', 'restore_best_existing'].includes(
    action.defaultAction
  )
);

const outputs = {};
if (cropActions.length) {
  outputs.crop = runCropActions(cropActions);
}
if (sourceActions.length) {
  outputs.source = await runSourceActions(sourceActions);
}

writeJson(resolve(options.outDir, 'apply-summary.json'), {
  generatedAt: new Date().toISOString(),
  apply: options.apply,
  counts: {
    cropActions: cropActions.length,
    sourceActions: sourceActions.length,
    totalActions: cropActions.length + sourceActions.length,
  },
  outputs,
});

console.log(
  JSON.stringify(
    {
      apply: options.apply,
      counts: {
        cropActions: cropActions.length,
        sourceActions: sourceActions.length,
        totalActions: cropActions.length + sourceActions.length,
      },
      outputs,
    },
    null,
    2
  )
);

function runCropActions(cropActionsToRun) {
  const cropOut = resolve(options.outDir, 'reviewed-crops');
  mkdirSync(cropOut, { recursive: true });
  const allRows = readJson(resolve(options.combinedReviewDir, 'rows.json'));
  const allDecisions = readJson(
    resolve(options.combinedReviewDir, 'review-decisions.json')
  );
  const cropIds = new Set(cropActionsToRun.map((action) => action.id));
  const rows = allRows.filter((row) => cropIds.has(String(row.id)));
  const decisions = {};
  const selected = {};
  for (const id of cropIds) {
    decisions[id] = 'accept';
    selected[id] = allDecisions.selected?.[id];
  }

  const decisionsPath = resolve(cropOut, 'review-decisions.apply.json');
  const rowsPath = resolve(cropOut, 'rows.apply.json');
  writeJson(decisionsPath, {
    generatedAt: new Date().toISOString(),
    source: 'ngs_crop_resolution_action_defaults',
    decisions,
    selected,
  });
  writeJson(rowsPath, rows);

  const command = [
    'scripts/backfill-ngs-reviewed-crops.mjs',
    '--review-dir',
    options.combinedReviewDir,
    '--decisions',
    decisionsPath,
    '--rows',
    rowsPath,
    '--source-rows',
    options.sourceRows,
    '--out-dir',
    cropOut,
    '--database',
    options.database,
    '--bucket',
    options.bucket,
    '--image-index',
    options.imageIndex,
    '--api-base',
    options.apiBase,
    '--org-id',
    options.orgId,
    '--asset-version',
    options.cropAssetVersion,
    '--object-key-prefix',
    options.cropObjectKeyPrefix,
    '--env-file',
    options.envFile,
    '--concurrency',
    String(options.concurrency),
    '--vector-batch-size',
    String(options.vectorBatchSize),
    ...(options.apply ? ['--apply'] : ['--prepare-only']),
  ];
  execFileSync('node', command, {
    stdio: 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    outDir: cropOut,
    decisionsPath,
    rowsPath,
    count: cropActionsToRun.length,
  };
}

async function runSourceActions(sourceActionsToRun) {
  const sourceOut = resolve(options.outDir, 'source-candidates');
  const downloadsDir = resolve(sourceOut, 'downloads');
  mkdirSync(downloadsDir, { recursive: true });

  const artworkById = new Map(
    readD1Rows(options.liveArtworks).map((row) => [String(row.id), row])
  );
  const manifestRows = await mapLimit(
    sourceActionsToRun,
    options.concurrency,
    async (action, index) => {
      const candidate = action.bestAlternative;
      if (!candidate?.url) {
        throw new Error(`missing source candidate URL for ${action.id}`);
      }
      const artwork = artworkById.get(action.id) || {};
      const downloadPath = resolve(
        downloadsDir,
        `${safeFilename(action.id)}-${safeFilename(candidate.sourceKind || candidate.kind || 'source')}.img`
      );
      const download = await downloadImage(candidate.url, downloadPath);
      const metadata = await sharp(downloadPath, {
        limitInputPixels: false,
      }).metadata();
      if ((index + 1) % 50 === 0 || index + 1 === sourceActionsToRun.length) {
        console.error(`downloaded source actions ${index + 1}/${sourceActionsToRun.length}`);
      }
      return {
        id: action.id,
        title: artwork.title || action.title || null,
        artist: artwork.artist || action.artist || null,
        dateText: artwork.date_text || null,
        medium: artwork.medium || null,
        ngsPageUrl: artwork.source_url || null,
        ngsImageUrl: candidate.url,
        download: {
          ok: true,
          path: downloadPath,
          url: candidate.url,
          contentType: download.contentType,
          width: metadata.width || null,
          height: metadata.height || null,
        },
        actionType: action.actionType,
        actionDecision: action.defaultAction,
        sourceKind: candidate.sourceKind || candidate.kind || null,
        previousImageUrl: action.current?.url || null,
        previousImageWidth: action.current?.width || null,
        previousImageHeight: action.current?.height || null,
      };
    }
  );

  const manifestPath = resolve(sourceOut, 'manifest.json');
  writeJson(manifestPath, manifestRows);

  const command = [
    'scripts/backfill-ngs-missing-image-assets.mjs',
    '--manifest',
    manifestPath,
    '--out-dir',
    sourceOut,
    '--database',
    options.database,
    '--bucket',
    options.bucket,
    '--image-index',
    options.imageIndex,
    '--api-base',
    options.apiBase,
    '--org-id',
    options.orgId,
    '--asset-version',
    options.sourceAssetVersion,
    '--object-key-prefix',
    options.sourceObjectKeyPrefix,
    '--env-file',
    options.envFile,
    '--concurrency',
    String(options.concurrency),
    '--vector-batch-size',
    String(options.vectorBatchSize),
    ...(options.apply ? ['--apply'] : ['--prepare-only']),
  ];
  execFileSync('node', command, {
    stdio: 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    outDir: sourceOut,
    manifestPath,
    count: sourceActionsToRun.length,
  };
}

async function downloadImage(url, path) {
  if (existsSync(path)) {
    return { contentType: 'application/octet-stream' };
  }
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'paillette-ngs-crop-resolution-apply/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.startsWith('image/')) {
    throw new Error(
      `could not download ${url}: ${response.status} ${contentType}`
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  return { contentType };
}

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

function readD1Rows(path) {
  const payload = readJson(path);
  return payload?.[0]?.results || payload?.results || [];
}

async function mapLimit(items, concurrency, mapper) {
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length || 1) },
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

function printHelp() {
  console.log(`Usage:
  node scripts/apply-ngs-crop-resolution-actions.mjs --apply

Applies automatic defaults from the crop resolution review page:
- approve_proposed: rerender reviewed crop assets, thumbnails, D1, image embeddings
- ingest_source_candidate / restore_best_existing: ingest best source, thumbnails, D1, image embeddings

Without --apply, only prepares local outputs.`);
}
