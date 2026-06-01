#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import {
  DEFAULT_NGS_ORG_ID,
  DEFAULT_STAGING_ASSET_API_BASE,
  safeFilename,
} from './lib/ngs-missing-image-backfill.mjs';
import { stripUrlQuery } from './lib/ngs-reviewed-crop-backfill.mjs';

const DEFAULT_OUT_DIR = 'tmp/ngs-crop-resolution-repair/review-action';
const DEFAULT_ARTWORKS = 'tmp/ngs-crop-resolution-repair/live-artworks.json';
const DEFAULT_ASSETS = 'tmp/ngs-crop-resolution-repair/live-assets.json';
const LOW_MP = 0.5;
const VERY_LOW_MP = 0.3;
const LOW_MAX_DIM = 1000;
const VERY_LOW_MAX_DIM = 768;

const args = parseArgs(process.argv.slice(2));
const options = {
  outDir: resolve(args.values.get('out-dir') || DEFAULT_OUT_DIR),
  artworks: resolve(args.values.get('artworks') || DEFAULT_ARTWORKS),
  assets: resolve(args.values.get('assets') || DEFAULT_ASSETS),
  assetVersion: args.values.get('asset-version') || 'ngs-reviewed-crops-v4',
  objectKeyPrefix: args.values.get('object-key-prefix') || 'ngs-reviewed-crops',
  orgId: args.values.get('org-id') || DEFAULT_NGS_ORG_ID,
  apiBase: args.values.get('api-base') || DEFAULT_STAGING_ASSET_API_BASE,
  runPrepare: !args.flags.has('skip-prepare'),
};

const reviewExports = [
  {
    label: 'ngs-remaining-sam3-review',
    priority: 1,
    decisionsPath: resolve('/Users/erniesg/Downloads/ngs-remaining-sam3-review.json'),
    rowsPath: resolve('tmp/ngs-remaining-sam3-rerun/review/rows.json'),
    reviewDir: resolve('tmp/ngs-remaining-sam3-rerun/review'),
  },
  {
    label: 'ngs-remaining-sam3-review (1)',
    priority: 2,
    decisionsPath: resolve(
      '/Users/erniesg/Downloads/ngs-remaining-sam3-review (1).json'
    ),
    rowsPath: resolve('tmp/ngs-requested-crop-review/rows.json'),
    reviewDir: resolve('tmp/ngs-requested-crop-review'),
  },
];

mkdirSync(options.outDir, { recursive: true });

const liveArtworks = readD1Rows(options.artworks);
const liveAssets = readD1Rows(options.assets);
const assetsByArtwork = groupBy(liveAssets, (row) => row.artwork_id);
const artworkById = new Map(liveArtworks.map((row) => [String(row.id), row]));
const merged = mergeReviewExports(reviewExports);
const combinedReviewDir = resolve(options.outDir, 'combined-review');
const sourceRowsPath = resolve(options.outDir, 'source-rows.json');
const backfillDir = resolve(options.outDir, 'backfill');

writeCombinedReview({ merged, combinedReviewDir });
writeSourceRows({ liveArtworks, assetsByArtwork, sourceRowsPath });

if (options.runPrepare) {
  execFileSync(
    'node',
    [
      'scripts/backfill-ngs-reviewed-crops.mjs',
      '--review-dir',
      combinedReviewDir,
      '--decisions',
      resolve(combinedReviewDir, 'review-decisions.json'),
      '--rows',
      resolve(combinedReviewDir, 'rows.json'),
      '--source-rows',
      sourceRowsPath,
      '--out-dir',
      backfillDir,
      '--asset-version',
      options.assetVersion,
      '--object-key-prefix',
      options.objectKeyPrefix,
      '--api-base',
      options.apiBase,
      '--org-id',
      options.orgId,
      '--prepare-only',
      '--concurrency',
      '4',
    ],
    { stdio: 'inherit', maxBuffer: 16 * 1024 * 1024 }
  );
}

const plan = readJson(resolve(backfillDir, 'backfill-plan.json')).rows || [];
const planById = new Map(plan.map((row) => [String(row.id), row]));
const actions = buildActions({
  merged,
  planById,
  artworkById,
  assetsByArtwork,
  outDir: options.outDir,
});
const report = {
  generatedAt: new Date().toISOString(),
  sourceExports: reviewExports.map((item) => ({
    label: item.label,
    decisionsPath: item.decisionsPath,
    rowsPath: item.rowsPath,
  })),
  summary: summarizeActions(actions),
  actions,
};

const dataPath = resolve(options.outDir, 'review-action-data.json');
const htmlPath = resolve(options.outDir, 'index.html');
writeJson(dataPath, report);
writeFileSync(htmlPath, renderHtml(report));

console.log(
  JSON.stringify(
    {
      summary: report.summary,
      outputs: {
        outDir: options.outDir,
        html: htmlPath,
        data: dataPath,
        combinedReviewDir,
        sourceRows: sourceRowsPath,
        backfillPlan: resolve(backfillDir, 'backfill-plan.json'),
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

function readD1Rows(path) {
  const payload = readJson(path);
  return payload?.[0]?.results || payload?.results || [];
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(keyFn(row));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function mergeReviewExports(exports) {
  const records = new Map();
  for (const spec of exports.sort((a, b) => a.priority - b.priority)) {
    const payload = readJson(spec.decisionsPath);
    const rows = readJson(spec.rowsPath);
    const rowsById = new Map(rows.map((row) => [String(row.id), row]));
    for (const [id, decision] of Object.entries(payload.decisions || {})) {
      const existing = records.get(id);
      records.set(id, {
        id,
        decision: normalizeDecision(decision),
        selected: payload.selected?.[id] || null,
        row: rowsById.get(id) || existing?.row || { id },
        sourceExport: spec.label,
        sourcePriority: spec.priority,
        reviewDir: spec.reviewDir,
        previousDecision: existing?.decision || null,
        conflict:
          Boolean(existing) && normalizeDecision(existing.decision) !== normalizeDecision(decision),
      });
    }
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeDecision(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value.decision === 'string') return value.decision.toLowerCase();
  if (value.accepted === true) return 'accept';
  return null;
}

function writeCombinedReview({ merged, combinedReviewDir }) {
  const assetsDir = resolve(combinedReviewDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const rows = [];
  const decisions = {};
  const selected = {};

  for (const record of merged) {
    const row = { ...record.row };
    rows.push(row);
    decisions[record.id] = record.decision;
    selected[record.id] = record.selected;
    copyReferencedAssets(record, row, combinedReviewDir);
  }

  writeJson(resolve(combinedReviewDir, 'rows.json'), rows);
  writeJson(resolve(combinedReviewDir, 'review-decisions.json'), {
    generatedAt: new Date().toISOString(),
    source: 'merged_ngs_remaining_sam3_review_exports',
    decisions,
    selected,
  });
}

function copyReferencedAssets(record, row, combinedReviewDir) {
  const paths = new Set();
  const selected = record.selected || {};
  const active = selected.activeResult || {};
  for (const value of [
    row.original,
    row.overlay,
    row.selectedCrop,
    row.finalCrop,
    active.cropUrl,
    active.overlayUrl,
    selected.sourceTransform?.sourceUrl,
    selected.sourceTransform?.sourceOriginalUrl,
  ]) {
    if (value) paths.add(stripUrlQuery(value));
  }
  for (const result of Object.values(selected.generatedResults || {})) {
    if (result?.cropUrl) paths.add(stripUrlQuery(result.cropUrl));
    if (result?.overlayUrl) paths.add(stripUrlQuery(result.overlayUrl));
  }

  for (const path of paths) {
    const from = resolve(record.reviewDir, path);
    const to = resolve(combinedReviewDir, path);
    if (!existsSync(from) || existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

function writeSourceRows({ liveArtworks, assetsByArtwork, sourceRowsPath }) {
  const rows = liveArtworks.map((artwork) => {
    const custom = parseJsonObject(artwork.custom_metadata);
    const assets = (assetsByArtwork.get(String(artwork.id)) || [])
      .filter((asset) => asset.url && ['original', 'web'].includes(asset.role))
      .map((asset) => {
        const metadata = parseJsonObject(asset.metadata);
        return {
          kind:
            metadata.source_type ||
            metadata.source ||
            asset.role ||
            'db-asset',
          url: asset.url,
          width: Number(asset.width) || null,
          height: Number(asset.height) || null,
          objectKey: asset.object_key || null,
        };
      })
      .sort((a, b) => pixelCount(b) - pixelCount(a));

    return {
      id: artwork.id,
      image_url: artwork.image_url,
      thumbnail_url: artwork.thumbnail_url,
      source_url: artwork.source_url,
      ngs_image_url: artwork.ngs_image_url || custom.ngs_image_url || null,
      roots_listing_url:
        artwork.roots_listing_url ||
        custom.roots_listing_url ||
        custom.source_records?.roots_listing_url ||
        null,
      asset_candidates: assets,
    };
  });
  writeJson(sourceRowsPath, rows);
}

function buildActions({
  merged,
  planById,
  artworkById,
  assetsByArtwork,
  outDir,
}) {
  const actions = [];
  const coveredIds = new Set();

  for (const record of merged) {
    coveredIds.add(record.id);
    const artwork = artworkById.get(record.id) || {};
    const assets = assetsByArtwork.get(record.id) || [];
    const currentAsset = assetForUrl(assets, artwork.image_url);
    const bestAsset = bestImageAsset(assets, { excludeUrl: artwork.image_url });
    const current = imageRef({
      url: artwork.image_url,
      width: currentAsset?.width,
      height: currentAsset?.height,
      assetId: currentAsset?.id,
    });
    const best = bestAsset
      ? imageRef({
          url: bestAsset.url,
          width: bestAsset.width,
          height: bestAsset.height,
          assetId: bestAsset.id,
        })
      : null;

    if (record.decision === 'accept') {
      const plan = planById.get(record.id);
      const proposed = plan
        ? imageRef({
            url: pathToRelativeUrl(outDir, plan.preparedImagePath),
            width: plan.width,
            height: plan.height,
            assetId: plan.originalAssetId,
          })
        : null;
      actions.push({
        id: record.id,
        title: artwork.title || record.row.title || null,
        artist: artwork.artist || record.row.artist || null,
        sourceExport: record.sourceExport,
        decision: record.decision,
        conflict: record.conflict,
        actionType: 'rerender_reviewed_crop',
        defaultAction:
          proposed && qualityStatus(proposed) === 'ok'
            ? 'approve_proposed'
            : 'needs_manual',
        current,
        proposed,
        bestAlternative: best,
        review: reviewSummary(record),
        provenance: plan
          ? {
              preparedSourceKind: plan.preparedSourceKind || null,
              preparedSourceWidth: plan.preparedSourceWidth || null,
              preparedSourceHeight: plan.preparedSourceHeight || null,
              localReviewSourceWidth: plan.localReviewSourceWidth || null,
              localReviewSourceHeight: plan.localReviewSourceHeight || null,
              preparedSourceExtract: plan.preparedSourceExtract || null,
            }
          : null,
        alerts: actionAlerts({ current, proposed, best, record }),
      });
      continue;
    }

    actions.push({
      id: record.id,
      title: artwork.title || record.row.title || null,
      artist: artwork.artist || record.row.artist || null,
      sourceExport: record.sourceExport,
      decision: record.decision,
      conflict: record.conflict,
      actionType: 'rejected_or_keep_source',
      defaultAction:
        current.status !== 'ok' && best && pixelCount(best) > pixelCount(current)
          ? 'restore_best_existing'
          : 'keep_current',
      current,
      proposed: null,
      bestAlternative: best,
      review: reviewSummary(record),
      provenance: null,
      alerts: actionAlerts({ current, proposed: null, best, record }),
    });
  }

  for (const artwork of artworkById.values()) {
    if (coveredIds.has(String(artwork.id))) continue;
    const assets = assetsByArtwork.get(String(artwork.id)) || [];
    const currentAsset = assetForUrl(assets, artwork.image_url);
    const current = imageRef({
      url: artwork.image_url,
      width: currentAsset?.width,
      height: currentAsset?.height,
      assetId: currentAsset?.id,
    });
    if (current.status === 'ok') continue;
    const bestAsset = bestImageAsset(assets, { excludeUrl: artwork.image_url });
    const best = bestAsset
      ? imageRef({
          url: bestAsset.url,
          width: bestAsset.width,
          height: bestAsset.height,
          assetId: bestAsset.id,
        })
      : null;
    actions.push({
      id: String(artwork.id),
      title: artwork.title || null,
      artist: artwork.artist || null,
      sourceExport: 'outside-review-exports',
      decision: null,
      conflict: false,
      actionType: 'outside_review_low_res',
      defaultAction: best ? 'review_candidate' : 'needs_source',
      current,
      proposed: null,
      bestAlternative: best,
      review: null,
      provenance: null,
      alerts: actionAlerts({ current, proposed: null, best, record: null }),
    });
  }

  return actions.sort((a, b) => {
    const groupA = actionSortGroup(a);
    const groupB = actionSortGroup(b);
    if (groupA !== groupB) return groupA - groupB;
    return a.id.localeCompare(b.id);
  });
}

function reviewSummary(record) {
  const selected = record.selected || {};
  return {
    choice: selected.choice || null,
    choiceLabel: selected.choiceLabel || null,
    box: selected.box || null,
    method: selected.activeResult?.method || null,
    sourceTransform: selected.sourceTransform || null,
    points: selected.points || [],
    previousDecision: record.previousDecision,
  };
}

function imageRef({ url, width, height, assetId }) {
  const image = {
    url: url || null,
    width: Number(width) || null,
    height: Number(height) || null,
    assetId: assetId || null,
  };
  image.pixels = pixelCount(image);
  image.megapixels = image.pixels ? image.pixels / 1_000_000 : null;
  image.status = qualityStatus(image);
  return image;
}

function qualityStatus(image) {
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  if (!width || !height) return 'unknown';
  const mp = (width * height) / 1_000_000;
  const maxDim = Math.max(width, height);
  if (mp < VERY_LOW_MP || maxDim < VERY_LOW_MAX_DIM) return 'very_low';
  if (mp < LOW_MP || maxDim < LOW_MAX_DIM) return 'low';
  return 'ok';
}

function pixelCount(image) {
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  return width * height;
}

function assetForUrl(assets, url) {
  if (!url) return null;
  return (assets || []).find((asset) => asset.url === url) || null;
}

function bestImageAsset(assets, { excludeUrl } = {}) {
  return (assets || [])
    .filter(
      (asset) =>
        asset.url &&
        asset.url !== excludeUrl &&
        ['original', 'web'].includes(asset.role) &&
        Number(asset.width) > 0 &&
        Number(asset.height) > 0
    )
    .sort((a, b) => pixelCount(b) - pixelCount(a))[0] || null;
}

function actionAlerts({ current, proposed, best, record }) {
  const alerts = [];
  if (current?.status === 'very_low') alerts.push('current very low');
  if (current?.status === 'low') alerts.push('current low');
  if (proposed?.status === 'very_low') alerts.push('proposed still very low');
  if (proposed?.status === 'low') alerts.push('proposed still low');
  if (proposed && current?.pixels && proposed.pixels > current.pixels) {
    alerts.push(`${formatRatio(proposed.pixels / current.pixels)}x pixels`);
  }
  if (!proposed && best && current?.pixels && best.pixels > current.pixels) {
    alerts.push(`${formatRatio(best.pixels / current.pixels)}x alt pixels`);
  }
  if (record?.conflict) alerts.push('decision conflict resolved by latest export');
  return alerts;
}

function actionSortGroup(action) {
  if (action.actionType === 'rerender_reviewed_crop') return 0;
  if (action.actionType === 'rejected_or_keep_source') return 1;
  return 2;
}

function summarizeActions(actions) {
  const summary = {
    total: actions.length,
    rerenderReviewedCrops: 0,
    rejectedOrKeepSource: 0,
    outsideReviewLowRes: 0,
    currentVeryLow: 0,
    currentLow: 0,
    proposedOk: 0,
    proposedLowOrVeryLow: 0,
  };
  for (const action of actions) {
    if (action.actionType === 'rerender_reviewed_crop') {
      summary.rerenderReviewedCrops += 1;
    } else if (action.actionType === 'rejected_or_keep_source') {
      summary.rejectedOrKeepSource += 1;
    } else {
      summary.outsideReviewLowRes += 1;
    }
    if (action.current.status === 'very_low') summary.currentVeryLow += 1;
    if (action.current.status === 'low') summary.currentLow += 1;
    if (action.proposed?.status === 'ok') summary.proposedOk += 1;
    if (['low', 'very_low'].includes(action.proposed?.status)) {
      summary.proposedLowOrVeryLow += 1;
    }
  }
  return summary;
}

function pathToRelativeUrl(root, path) {
  return relative(root, path).split('/').map(encodeURIComponent).join('/');
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function formatRatio(value) {
  return Number(value).toFixed(value >= 10 ? 0 : 1);
}

function renderHtml(report) {
  const json = JSON.stringify(report).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NGS Crop Resolution Review Actions</title>
  <style>
    :root { color-scheme: light; --ink:#171717; --muted:#666; --line:#d9d9d9; --soft:#f5f5f4; --ok:#12663a; --warn:#975a16; --bad:#a31d1d; --blue:#174ea6; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fbfbfa; }
    header { position: sticky; top: 0; z-index: 10; background: rgba(251,251,250,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(10px); }
    .wrap { max-width: 1680px; margin: 0 auto; padding: 18px 20px; }
    h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    .meta { color: var(--muted); font-size: 13px; }
    .stats { display: grid; grid-template-columns: repeat(8, minmax(110px, 1fr)); gap: 8px; margin-top: 14px; }
    .stat { border: 1px solid var(--line); background: white; padding: 10px; border-radius: 6px; }
    .stat b { display: block; font-size: 20px; line-height: 1; }
    .stat span { color: var(--muted); font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
    button, select, input { border: 1px solid var(--line); background: white; border-radius: 6px; min-height: 34px; padding: 0 10px; font: inherit; font-size: 13px; }
    button { cursor: pointer; }
    button.primary { background: var(--blue); color: white; border-color: var(--blue); }
    input[type="search"] { min-width: 260px; }
    main.wrap { padding-top: 18px; }
    .count { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
    .card { border: 1px solid var(--line); background: white; border-radius: 8px; margin: 0 0 14px; overflow: hidden; }
    .card-head { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); align-items: start; }
    .title { font-weight: 700; font-size: 16px; line-height: 1.25; }
    .sub { color: var(--muted); font-size: 13px; margin-top: 3px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .badge { border-radius: 999px; padding: 4px 8px; font-size: 12px; border: 1px solid var(--line); background: var(--soft); white-space: nowrap; }
    .badge.ok { color: var(--ok); border-color: #b8d9c7; background: #eff8f2; }
    .badge.low { color: var(--warn); border-color: #e5c28a; background: #fff6e6; }
    .badge.very_low { color: var(--bad); border-color: #e5aaaa; background: #fff0f0; }
    .body { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr) 290px; gap: 12px; padding: 14px; }
    .panel { min-width: 0; }
    .label { font-size: 12px; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .04em; }
    .imagebox { border: 1px solid var(--line); background: #f0f0ef; height: 360px; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 6px; }
    .imagebox img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    .missing { color: var(--muted); font-size: 13px; padding: 14px; text-align: center; }
    .dims { margin-top: 7px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .actions { border-left: 1px solid var(--line); padding-left: 12px; }
    .radio { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; font-size: 13px; }
    .radio input { min-height: auto; margin-top: 2px; }
    textarea { width: 100%; min-height: 64px; resize: vertical; border: 1px solid var(--line); border-radius: 6px; padding: 8px; font: inherit; font-size: 13px; }
    details { margin-top: 10px; font-size: 12px; color: var(--muted); }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--soft); padding: 8px; border-radius: 6px; border: 1px solid var(--line); max-height: 180px; overflow: auto; }
    .hidden { display: none; }
    @media (max-width: 1180px) { .stats { grid-template-columns: repeat(4, 1fr); } .body { grid-template-columns: 1fr 1fr; } .actions { border-left: 0; padding-left: 0; grid-column: 1 / -1; } }
    @media (max-width: 760px) { .stats { grid-template-columns: repeat(2, 1fr); } .body { grid-template-columns: 1fr; } .imagebox { height: 300px; } .card-head { grid-template-columns: 1fr; } .badges { justify-content: flex-start; } input[type="search"] { min-width: 0; width: 100%; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>NGS Crop Resolution Review Actions</h1>
      <div class="meta">Merged review exports, proposed high-resolution crop rerenders, rejected-row restores, and other low-resolution NGS display images.</div>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="groupFilter">
          <option value="all">All groups</option>
          <option value="rerender_reviewed_crop">Reviewed crops</option>
          <option value="rejected_or_keep_source">Rejected / restore</option>
          <option value="outside_review_low_res">Outside export low-res</option>
        </select>
        <select id="statusFilter">
          <option value="all">All status</option>
          <option value="very_low">Current very low</option>
          <option value="low">Current low</option>
          <option value="proposed_low">Proposed still low</option>
          <option value="conflict">Decision conflicts</option>
        </select>
        <input id="query" type="search" placeholder="Filter accession, title, artist">
        <button id="approveVisible">Approve visible proposed</button>
        <button id="manualVisible">Mark visible manual</button>
        <button id="export" class="primary">Export decisions JSON</button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <p class="count" id="count"></p>
    <div id="cards"></div>
  </main>
  <script>
    const report = ${json};
    const stateKey = 'ngs-crop-resolution-review-actions-v1';
    const state = JSON.parse(localStorage.getItem(stateKey) || '{}');
    for (const action of report.actions) {
      if (!state[action.id]) state[action.id] = { action: action.defaultAction, note: '' };
    }

    const stats = [
      ['total', report.summary.total],
      ['reviewed crops', report.summary.rerenderReviewedCrops],
      ['rejected/restore', report.summary.rejectedOrKeepSource],
      ['outside low-res', report.summary.outsideReviewLowRes],
      ['current very low', report.summary.currentVeryLow],
      ['current low', report.summary.currentLow],
      ['proposed ok', report.summary.proposedOk],
      ['proposed low', report.summary.proposedLowOrVeryLow],
    ];
    document.getElementById('stats').innerHTML = stats.map(([label, value]) => '<div class="stat"><b>' + value + '</b><span>' + label + '</span></div>').join('');

    function dims(image) {
      if (!image || !image.width || !image.height) return 'unknown';
      return image.width + 'x' + image.height + ' · ' + (image.megapixels || 0).toFixed(3) + 'MP';
    }
    function imagePanel(label, image) {
      if (!image || !image.url) {
        return '<section class="panel"><div class="label">' + label + '</div><div class="imagebox"><div class="missing">No image</div></div></section>';
      }
      return '<section class="panel"><div class="label">' + label + '</div><a href="' + image.url + '" target="_blank" rel="noreferrer"><div class="imagebox"><img loading="lazy" src="' + image.url + '"></div></a><div class="dims"><span class="badge ' + image.status + '">' + image.status + '</span><span>' + dims(image) + '</span><a href="' + image.url + '" target="_blank" rel="noreferrer">full size</a></div></section>';
    }
    function option(id, value, label) {
      const checked = state[id]?.action === value ? ' checked' : '';
      return '<label class="radio"><input type="radio" name="act-' + id + '" value="' + value + '"' + checked + '><span>' + label + '</span></label>';
    }
    function card(action) {
      const badges = [
        '<span class="badge">' + action.actionType.replaceAll('_', ' ') + '</span>',
        '<span class="badge ' + action.current.status + '">current ' + action.current.status + '</span>',
        action.proposed ? '<span class="badge ' + action.proposed.status + '">proposed ' + action.proposed.status + '</span>' : '',
        action.conflict ? '<span class="badge very_low">conflict</span>' : '',
        ...action.alerts.map(a => '<span class="badge low">' + a + '</span>'),
      ].filter(Boolean).join('');
      const choices = [
        option(action.id, 'approve_proposed', 'Approve proposed crop/render'),
        option(action.id, 'restore_best_existing', 'Restore best existing high-res asset'),
        option(action.id, 'keep_current', 'Keep current image'),
        option(action.id, 'needs_manual', 'Needs manual review'),
        option(action.id, 'reject_action', 'Reject this action'),
      ].join('');
      return '<article class="card" data-id="' + action.id + '" data-group="' + action.actionType + '" data-current="' + action.current.status + '" data-proposed="' + (action.proposed?.status || '') + '" data-conflict="' + action.conflict + '" data-search="' + [action.id, action.title, action.artist].join(' ').toLowerCase().replaceAll('"','&quot;') + '">' +
        '<div class="card-head"><div><div class="title">' + action.id + ' · ' + (action.title || '') + '</div><div class="sub">' + (action.artist || '') + ' · ' + action.sourceExport + '</div></div><div class="badges">' + badges + '</div></div>' +
        '<div class="body">' +
        imagePanel('current final image_url', action.current) +
        imagePanel('proposed final', action.proposed) +
        imagePanel('best existing alternative', action.bestAlternative) +
        '<section class="actions"><div class="label">Action</div>' + choices + '<textarea placeholder="Notes">' + (state[action.id]?.note || '') + '</textarea>' +
        '<details><summary>Crop/source metadata</summary><pre>' + escapeHtml(JSON.stringify({ review: action.review, provenance: action.provenance }, null, 2)) + '</pre></details></section>' +
        '</div></article>';
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    const cards = document.getElementById('cards');
    cards.innerHTML = report.actions.map(card).join('');

    function persistFromDom() {
      document.querySelectorAll('.card').forEach(card => {
        const id = card.dataset.id;
        const checked = card.querySelector('input[type=radio]:checked');
        const note = card.querySelector('textarea').value;
        state[id] = { action: checked?.value || 'needs_manual', note };
      });
      localStorage.setItem(stateKey, JSON.stringify(state));
    }
    function applyFilters() {
      persistFromDom();
      const group = document.getElementById('groupFilter').value;
      const status = document.getElementById('statusFilter').value;
      const q = document.getElementById('query').value.trim().toLowerCase();
      let visible = 0;
      document.querySelectorAll('.card').forEach(card => {
        const matchGroup = group === 'all' || card.dataset.group === group;
        const matchStatus =
          status === 'all' ||
          card.dataset.current === status ||
          (status === 'proposed_low' && ['low', 'very_low'].includes(card.dataset.proposed)) ||
          (status === 'conflict' && card.dataset.conflict === 'true');
        const matchQuery = !q || card.dataset.search.includes(q);
        const show = matchGroup && matchStatus && matchQuery;
        card.classList.toggle('hidden', !show);
        if (show) visible += 1;
      });
      document.getElementById('count').textContent = visible + ' visible of ' + report.actions.length + ' actions';
    }
    document.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('input', applyFilters));
    document.getElementById('approveVisible').addEventListener('click', () => {
      document.querySelectorAll('.card:not(.hidden)').forEach(card => {
        const input = card.querySelector('input[value=approve_proposed]');
        if (input) input.checked = true;
      });
      applyFilters();
    });
    document.getElementById('manualVisible').addEventListener('click', () => {
      document.querySelectorAll('.card:not(.hidden)').forEach(card => {
        const input = card.querySelector('input[value=needs_manual]');
        if (input) input.checked = true;
      });
      applyFilters();
    });
    document.getElementById('export').addEventListener('click', () => {
      persistFromDom();
      const output = {
        exportedAt: new Date().toISOString(),
        source: 'ngs-crop-resolution-review-actions',
        actions: report.actions.map(action => ({
          id: action.id,
          actionType: action.actionType,
          decision: state[action.id]?.action || action.defaultAction,
          note: state[action.id]?.note || '',
          current: action.current,
          proposed: action.proposed,
          bestAlternative: action.bestAlternative,
        })),
      };
      const blob = new Blob([JSON.stringify(output, null, 2) + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ngs-crop-resolution-review-actions.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    applyFilters();
  </script>
</body>
</html>
`;
}
