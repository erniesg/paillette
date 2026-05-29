#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

import {
  detectColorCheckerTargets,
  normalizeCrop,
  proposeCropExcludingTargets,
} from './lib/ngs-colour-card-review.mjs';

const imageRequire = createRequire(
  new URL('../packages/image-processing/package.json', import.meta.url)
);
const sharpModule = await import(imageRequire.resolve('sharp'));
const sharp = sharpModule.default || sharpModule;

const MANUAL_SOURCE_OVERRIDES = {
  '2009-01799':
    'tmp/ngs-colour-card-audit-current/aku-extraction-v3/2009-01799-full-asset.img',
};

const MANUAL_CROP_OVERRIDES = {
  '2009-01799': {
    box: { left: 134, top: 410, width: 544, height: 737 },
    reason: 'manual_inner_painted_surface_no_straighten',
  },
};

const args = parseArgs(process.argv.slice(2));
const options = {
  artworksJson:
    args.get('artworks-json') ||
    'tmp/ngs-colour-card-audit-current/d1-artworks.json',
  imageDir:
    args.get('image-dir') ||
    'tmp/ngs-colour-card-audit-current/full-thumb-scan/fetched',
  legacyCandidates:
    args.get('legacy-candidates') ||
    'tmp/ngs-colour-card-audit-current/full-thumb-scan/colour-card-candidates.json',
  acceptedCropBoxes:
    args.get('accepted-crop-boxes') ||
    'tmp/ngs-colour-card-update/final-crops/crop-boxes.json',
  acceptedOriginalDir:
    args.get('accepted-original-dir') || 'tmp/ngs-colour-card-update/originals',
  sam3Report: args.get('sam3-report') || '',
  outDir: args.get('out-dir') || 'tmp/ngs-colour-card-review',
  maxScanDim: toInt(args.get('max-scan-dim'), 512),
  limit: toInt(args.get('limit'), Infinity),
  minScore: toFloat(args.get('min-score'), 0.58),
  skipAssets: args.has('skip-assets'),
};

if (args.has('help')) {
  printHelp();
  process.exit(0);
}

const outDir = resolve(options.outDir);
const assetsDir = join(outDir, 'assets');
mkdirSync(assetsDir, { recursive: true });

const artworksById = loadArtworkRows(options.artworksJson);
const legacyById = loadLegacyCandidates(options.legacyCandidates);
const acceptedById = loadAcceptedCrops(options.acceptedCropBoxes);
const sam3ByName = loadSam3(options.sam3Report);
const imageFiles = listImageFiles(options.imageDir).slice(0, options.limit);

const startedAt = new Date().toISOString();
console.log(
  [
    'Building NGS colour-card review',
    `images=${imageFiles.length}`,
    `legacy=${legacyById.size}`,
    `sam3=${sam3ByName.size}`,
    `out=${outDir}`,
  ].join(' ')
);

const reviewRows = [];
for (let index = 0; index < imageFiles.length; index += 1) {
  const id = idFromPath(imageFiles[index]);
  const sourcePath = selectSourcePath(id, imageFiles[index], options);
  const row = await analyzeImage({
    id,
    sourcePath,
    metadata: artworksById.get(id),
    legacy: legacyById.get(id),
    accepted: acceptedById.get(id),
    sam3: sam3ByName.get(basename(sourcePath)) || sam3ByName.get(`${id}.img`),
  });

  if (row) {
    reviewRows.push(row);
  }
  if ((index + 1) % 500 === 0) {
    console.log(`scanned=${index + 1}/${imageFiles.length} review=${reviewRows.length}`);
  }
}

reviewRows.sort((left, right) => {
  const priorityDiff = priorityRank(left) - priorityRank(right);
  if (priorityDiff) return priorityDiff;
  return right.detectorScore - left.detectorScore || left.id.localeCompare(right.id);
});

if (!options.skipAssets) {
  await writeReviewAssets(reviewRows, assetsDir);
}
writeJson(join(outDir, 'review-candidates.json'), reviewRows);
writeTsv(join(outDir, 'review-candidates.tsv'), reviewRows);
writeJson(join(outDir, 'sam3-input-mapping.json'), reviewRows.map(toSam3Input));
if (!options.skipAssets) {
  writeFileSync(join(outDir, 'index.html'), renderHtml(reviewRows, startedAt));
}
writeJson(join(outDir, 'summary.json'), summarize(reviewRows, startedAt));

console.log(
  [
    'Done.',
    `candidates=${reviewRows.length}`,
    `html=${join(outDir, 'index.html')}`,
    `mapping=${join(outDir, 'sam3-input-mapping.json')}`,
  ].join(' ')
);

async function analyzeImage({ id, sourcePath, metadata, legacy, accepted, sam3 }) {
  const normalized = await sharp(sourcePath, { limitInputPixels: false })
    .rotate()
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = sharpRaw(normalized);
  const meta = normalized.info;
  if (!meta.width || !meta.height) return null;

  const scan = await image
    .clone()
    .resize({
      width: options.maxScanDim,
      height: options.maxScanDim,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scaleX = meta.width / scan.info.width;
  const scaleY = meta.height / scan.info.height;
  const detectedTargets = detectColorCheckerTargets(
    {
      data: scan.data,
      width: scan.info.width,
      height: scan.info.height,
    },
    { minScore: options.minScore }
  ).map((target) => scaleTarget(target, scaleX, scaleY));

  const hasLegacySignal = Boolean(legacy);
  const hasManualOverride = Boolean(MANUAL_CROP_OVERRIDES[id]);
  if (!detectedTargets.length && !hasLegacySignal && !hasManualOverride) {
    return null;
  }

  const cropProposal = proposeCrop({
    id,
    width: meta.width,
    height: meta.height,
    checkerTargets: detectedTargets,
    legacy,
    accepted,
    sam3,
  });

  const detectorScore = detectedTargets[0]?.score || legacy?.colorCardSignal?.score || 0;
  const metadataJson = parseJson(metadata?.custom_metadata) || {};

  return {
    id,
    accessionNumber: metadata?.accession_number || legacy?.accessionNumber || id,
    title: metadata?.title || legacy?.title || '',
    artist: metadata?.artist || legacy?.artist || '',
    classification: metadata?.classification || legacy?.classification || '',
    medium: metadata?.medium || legacy?.medium || '',
    dateText: metadata?.date_text || legacy?.dateText || '',
    sourceUrl: metadata?.source_url || legacy?.sourceUrl || '',
    imageUrl: metadata?.image_url || null,
    thumbnailUrl: metadata?.thumbnail_url || null,
    ngsImageUrl: metadataJson.ngs_image_url || null,
    sourcePath,
    sourceName: basename(sourcePath),
    width: meta.width,
    height: meta.height,
    format: meta.format || '',
    checkerTargets: detectedTargets,
    detectorScore,
    legacyReasons: legacy?.reasons || [],
    legacyConfidence: legacy?.confidence ?? null,
    legacyCandidateBox: legacy?.candidateBox || null,
    acceptedCrop: accepted || null,
    sam3: summarizeSam3(sam3),
    proposedCrop: cropProposal,
    reviewStatus: 'needs_human_acceptance',
  };
}

function proposeCrop({ id, width, height, checkerTargets, legacy, accepted, sam3 }) {
  const manual = MANUAL_CROP_OVERRIDES[id];
  if (manual) {
    return {
      source: 'manual_override',
      box: normalizeCrop(manual.box, width, height),
      reason: manual.reason,
    };
  }

  if (sam3?.ok && sam3.action === 'crop' && (sam3.source_box || sam3.final_box)) {
    return {
      source: 'sam3',
      box: normalizeCrop(sam3.source_box || sam3.final_box, width, height),
      reason: sam3.reason || 'sam3_crop',
    };
  }

  if (accepted?.left != null) {
    return {
      source: 'previously_accepted_crop',
      box: normalizeCrop(accepted, width, height),
      reason: accepted.basis || 'previously_accepted_crop',
    };
  }

  const candidate = legacy?.candidateBox || null;
  if (!candidate) {
    return {
      source: 'detector_only_needs_sam3',
      box: { left: 0, top: 0, width, height },
      reason: 'detected_checker_candidate_needs_sam3_crop',
    };
  }

  const proposal = proposeCropExcludingTargets({
    width,
    height,
    candidateBox: candidate,
    checkerTargets,
    margin: Math.max(4, Math.round(Math.min(width, height) * 0.008)),
  });

  return {
    source: candidate ? 'legacy_candidate_box' : 'full_image_detector_only',
    ...proposal,
  };
}

function selectSourcePath(id, fallback, opts) {
  const manual = MANUAL_SOURCE_OVERRIDES[id];
  if (manual) return manual;
  const acceptedOriginal = join(opts.acceptedOriginalDir, `${id}.jpg`);
  try {
    readFileSync(acceptedOriginal);
    return acceptedOriginal;
  } catch {
    return fallback;
  }
}

async function writeReviewAssets(rows, dir) {
  for (const row of rows) {
    const safe = safeFilename(row.id);
    const originalName = `${safe}-original.jpg`;
    const overlayName = `${safe}-overlay.jpg`;
    const cropName = `${safe}-proposed-crop.jpg`;
    const normalized = await sharp(row.sourcePath, { limitInputPixels: false })
      .rotate()
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    await sharpRaw(normalized)
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toFile(join(dir, originalName));

    const preview = await sharpRaw(normalized)
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    const overlay = overlaySvg(
      row,
      preview.info.width,
      preview.info.height,
      preview.info.width / (normalized.info.width || row.width),
      preview.info.height / (normalized.info.height || row.height)
    );
    const overlayBuffer = await sharp(Buffer.from(overlay), {
      limitInputPixels: false,
    })
      .png()
      .toBuffer();
    try {
      await sharp(preview.data, { limitInputPixels: false })
        .composite([{ input: overlayBuffer, left: 0, top: 0 }])
        .jpeg({ quality: 88 })
        .toFile(join(dir, overlayName));
    } catch (error) {
      const overlayMeta = await sharp(overlayBuffer).metadata();
      throw new Error(
        `Failed writing overlay for ${row.id}: base=${preview.info.width}x${preview.info.height} overlay=${overlayMeta.width}x${overlayMeta.height}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const crop = row.proposedCrop.box;
    await sharpRaw(normalized)
      .extract({
        left: crop.left,
        top: crop.top,
        width: crop.width,
        height: crop.height,
      })
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(join(dir, cropName));

    row.assets = {
      original: `assets/${originalName}`,
      overlay: `assets/${overlayName}`,
      proposedCrop: `assets/${cropName}`,
    };
  }
}

function sharpRaw(normalized) {
  return sharp(normalized.data, {
    limitInputPixels: false,
    raw: {
      width: normalized.info.width,
      height: normalized.info.height,
      channels: normalized.info.channels,
    },
  });
}

function overlaySvg(row, width, height, scaleX = 1, scaleY = 1) {
  const crop = row.proposedCrop.box;
  const targetRects = row.checkerTargets
    .map(
      (target) =>
        `<rect x="${Math.round(target.box.left * scaleX)}" y="${Math.round(target.box.top * scaleY)}" width="${Math.round(target.box.width * scaleX)}" height="${Math.round(target.box.height * scaleY)}" fill="none" stroke="#00d1ff" stroke-width="${Math.max(3, Math.round(width / 280))}"/><text x="${Math.round(target.box.left * scaleX)}" y="${Math.max(16, Math.round((target.box.top - 6) * scaleY))}" font-size="${Math.max(14, Math.round(width / 55))}" fill="#00d1ff">checker ${target.score}</text>`
    )
    .join('');
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${targetRects}
    <rect x="${Math.round(crop.left * scaleX)}" y="${Math.round(crop.top * scaleY)}" width="${Math.round(crop.width * scaleX)}" height="${Math.round(crop.height * scaleY)}" fill="none" stroke="#ffcc00" stroke-width="${Math.max(4, Math.round(width / 220))}"/>
  </svg>`;
}

function renderHtml(rows, generatedAt) {
  const cards = rows.map(renderCard).join('\n');
  const summary = summarize(rows, generatedAt);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NGS Colour Card Review</title>
  <style>
    body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f6f8;color:#171b22;letter-spacing:0}
    header{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #d9dee7;padding:14px 18px}
    h1{font-size:19px;margin:0 0 6px;font-weight:650}
    .summary{font-size:13px;color:#596273;display:flex;gap:12px;flex-wrap:wrap}
    main{padding:16px 18px 40px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:14px}
    .card{background:#fff;border:1px solid #d9dee7;border-radius:8px;overflow:hidden}
    .head{padding:11px 12px;border-bottom:1px solid #e3e7ee}
    .title{font-size:14px;font-weight:650;overflow-wrap:anywhere}
    .meta,.reason{font-size:12px;color:#667085;line-height:1.4;overflow-wrap:anywhere}
    .media{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 12px}
    figure{margin:0;display:grid;gap:6px;align-content:start}
    img{max-width:100%;border:1px solid #edf0f4;background:#f2f4f7}
    figcaption{font-size:12px;color:#596273}
    .footer{padding:0 12px 12px;display:grid;gap:5px}
    .tag{display:inline-block;border:1px solid #d0d5dd;border-radius:999px;padding:1px 7px;margin:2px 4px 2px 0;font-size:12px;color:#475467;background:#fff}
    .tag.hot{border-color:#f2c94c;background:#fff8db;color:#7a5600}
    @media(max-width:760px){main,header{padding-left:10px;padding-right:10px}.grid{grid-template-columns:1fr}.media{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header>
    <h1>NGS Colour Card Review</h1>
    <div class="summary">
      <span>${summary.total} review candidates</span>
      <span>${summary.withDetectedChecker} with detected checker boxes</span>
      <span>${summary.manualOverrides} manual crop override</span>
      <span>Generated ${escapeHtml(generatedAt)}</span>
    </div>
  </header>
  <main><div class="grid">${cards}</div></main>
</body>
</html>
`;
}

function renderCard(row) {
  const checkerTags = row.checkerTargets
    .map(
      (target) =>
        `<span class="tag hot">${escapeHtml(target.edge)} checker ${target.score} (${target.swatchCount}/${target.hueBins})</span>`
    )
    .join('');
  const reasonTags = row.legacyReasons
    .map((reason) => `<span class="tag">${escapeHtml(reason)}</span>`)
    .join('');
  return `<article class="card">
  <div class="head">
    <div class="title">${escapeHtml(row.id)} · ${escapeHtml(row.title || 'Untitled')}</div>
    <div class="meta">${escapeHtml([row.artist, row.dateText, row.medium].filter(Boolean).join(' · '))}</div>
    <div class="reason">Crop source: ${escapeHtml(row.proposedCrop.source)} · ${escapeHtml(row.proposedCrop.reason)}</div>
  </div>
  <div class="media">
    <figure>
      <img src="${escapeHtml(row.assets.overlay)}" alt="${escapeHtml(row.id)} overlay">
      <figcaption>Overlay: cyan checker, yellow proposed crop</figcaption>
    </figure>
    <figure>
      <img src="${escapeHtml(row.assets.proposedCrop)}" alt="${escapeHtml(row.id)} proposed crop">
      <figcaption>Proposed crop for human acceptance</figcaption>
    </figure>
  </div>
  <div class="footer">
    <div>${checkerTags || '<span class="tag">no detector box</span>'}${reasonTags}</div>
    <div class="meta">Source: ${row.sourceUrl ? `<a href="${escapeHtml(row.sourceUrl)}">${escapeHtml(row.sourceUrl)}</a>` : 'n/a'}</div>
  </div>
</article>`;
}

function summarize(rows, generatedAt) {
  return {
    generatedAt,
    completedAt: new Date().toISOString(),
    total: rows.length,
    withDetectedChecker: rows.filter((row) => row.checkerTargets.length).length,
    legacyOnly: rows.filter((row) => !row.checkerTargets.length && row.legacyReasons.length).length,
    manualOverrides: rows.filter((row) => row.proposedCrop.source === 'manual_override').length,
    sam3Crops: rows.filter((row) => row.proposedCrop.source === 'sam3').length,
    previousAccepted: rows.filter(
      (row) => row.proposedCrop.source === 'previously_accepted_crop'
    ).length,
    outputs: {
      html: options.skipAssets ? null : join(outDir, 'index.html'),
      candidatesJson: join(outDir, 'review-candidates.json'),
      candidatesTsv: join(outDir, 'review-candidates.tsv'),
      sam3InputMapping: join(outDir, 'sam3-input-mapping.json'),
    },
    notes: [
      'This review bundle is read-only and does not update assets, D1, captions, colors, embeddings, or Vectorize.',
      'Only rows accepted by human review should be materialized into derived assets.',
      'Aku uses a no-straighten manual inner painted-surface crop that excludes the wooden frame.',
    ],
  };
}

function writeTsv(filePath, rows) {
  const header = [
    'id',
    'title',
    'artist',
    'detector_score',
    'checker_count',
    'legacy_reasons',
    'crop_source',
    'crop_reason',
    'crop_left',
    'crop_top',
    'crop_width',
    'crop_height',
    'source_path',
    'source_url',
  ];
  const lines = [
    header.join('\t'),
    ...rows.map((row) =>
      [
        row.id,
        row.title,
        row.artist,
        row.detectorScore,
        row.checkerTargets.length,
        row.legacyReasons.join(', '),
        row.proposedCrop.source,
        row.proposedCrop.reason,
        row.proposedCrop.box.left,
        row.proposedCrop.box.top,
        row.proposedCrop.box.width,
        row.proposedCrop.box.height,
        row.sourcePath,
        row.sourceUrl,
      ]
        .map((value) => String(value ?? '').replaceAll('\t', ' '))
        .join('\t')
    ),
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function toSam3Input(row) {
  return {
    inputName: row.sourceName,
    inputPath: row.sourcePath,
    artworkId: row.id,
    accessionNumber: row.accessionNumber,
    title: row.title,
    artist: row.artist,
    classification: row.classification,
    medium: row.medium,
    dateText: row.dateText,
    sourceUrl: row.sourceUrl,
    sam3Priority: row.detectorScore >= 0.7 ? 'high' : 'medium',
    reasons: [
      ...row.legacyReasons,
      row.checkerTargets.length ? 'detected_color_checker_grid' : null,
    ].filter(Boolean),
  };
}

function loadArtworkRows(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((item) => (Array.isArray(item?.results) ? item.results : item))
    : parsed.results || [];
  return new Map(rows.map((row) => [row.id || row.accession_number, row]));
}

function loadLegacyCandidates(filePath) {
  try {
    const rows = JSON.parse(readFileSync(filePath, 'utf8'));
    return new Map(rows.map((row) => [row.artworkId || row.accessionNumber, row]));
  } catch {
    return new Map();
  }
}

function loadAcceptedCrops(filePath) {
  try {
    const rows = JSON.parse(readFileSync(filePath, 'utf8'));
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

function loadSam3(filePath) {
  if (!filePath) return new Map();
  try {
    const rows = JSON.parse(readFileSync(filePath, 'utf8'));
    return new Map(rows.filter((row) => row.name).map((row) => [row.name, row]));
  } catch {
    return new Map();
  }
}

function listImageFiles(dir) {
  const exts = new Set(['.img', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
  return readdirSync(dir)
    .filter((name) => exts.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(dir, name));
}

function scaleTarget(target, scaleX, scaleY) {
  return {
    ...target,
    box: {
      left: Math.round(target.box.left * scaleX),
      top: Math.round(target.box.top * scaleY),
      width: Math.round(target.box.width * scaleX),
      height: Math.round(target.box.height * scaleY),
    },
  };
}

function summarizeSam3(row) {
  if (!row) return null;
  return {
    name: row.name,
    ok: row.ok,
    action: row.action,
    reason: row.reason,
    sourceBox: row.source_box || null,
    finalBox: row.final_box || null,
    selectedPrompt: row.selected?.prompt || null,
    selectedScore: row.selected?.score ?? null,
  };
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, ...value] = arg.slice(2).split('=');
      parsed.set(key, value.join('='));
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        parsed.set(key, next);
        index += 1;
      } else {
        parsed.set(key, true);
      }
    }
  }
  return parsed;
}

function idFromPath(filePath) {
  return basename(filePath).replace(/\.[^.]+$/, '');
}

function safeFilename(value) {
  return String(value || 'unknown')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function toInt(value, fallback) {
  if (value == null || value === true || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  if (value == null || value === true || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function priorityRank(row) {
  if (row.proposedCrop.source === 'manual_override') return 0;
  if (row.detectorScore >= 0.7) return 1;
  if (row.checkerTargets.length) return 2;
  return 3;
}

function printHelp() {
  console.log(`Usage: node scripts/build-ngs-colour-card-review.mjs [options]

Options:
  --artworks-json PATH       Current D1 artworks JSON dump.
  --image-dir PATH           Directory of current fetched artwork images.
  --legacy-candidates PATH   Existing heuristic colour-card candidate JSON.
  --sam3-report PATH         Optional SAM3 results JSON to use for crop boxes.
  --out-dir PATH             Output review directory.
  --max-scan-dim N           Detection scan size, default 512.
  --min-score N              Detector score threshold, default 0.58.
  --limit N                  Limit input images for smoke tests.
  --skip-assets              Scan and write JSON/TSV only.
`);
}
