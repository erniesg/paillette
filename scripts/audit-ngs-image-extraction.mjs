#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';

const imageRequire = createRequire(
  new URL('../packages/image-processing/package.json', import.meta.url)
);
const sharpModule = await import(imageRequire.resolve('sharp'));
const sharp = sharpModule.default || sharpModule;

const args = new Map();
const flags = new Set();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--') && arg.includes('=')) {
    const [key, ...value] = arg.slice(2).split('=');
    args.set(key, value.join('='));
  } else if (arg.startsWith('--')) {
    const key = arg.slice(2);
    if (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
      args.set(key, process.argv[++i]);
    } else {
      flags.add(key);
    }
  }
}

const options = {
  appDb: args.get('app-db') || '/tmp/paillette-v2-bakeoff.sqlite',
  imageDir: args.get('image-dir') || 'eval/images',
  outDir:
    args.get('out-dir') ||
    '/Users/erniesg/Downloads/paillette-ngs-image-extraction-audit',
  limit: toInt(args.get('limit'), Infinity),
  concurrency: toInt(args.get('concurrency'), 8),
  maxScanDim: toInt(args.get('max-scan-dim'), 512),
  contactSheetLimit: toInt(args.get('contact-sheet-limit'), 80),
  fetchMissing: flags.has('fetch-missing'),
  fetchRole: args.get('fetch-role') || 'thumb',
};

if (flags.has('help') || !existsSync(options.appDb)) {
  printHelp();
  process.exit(flags.has('help') ? 0 : 1);
}

mkdirSync(options.outDir, { recursive: true });
const fetchedDir = join(options.outDir, 'fetched');
if (options.fetchMissing) mkdirSync(fetchedDir, { recursive: true });

const rows = loadV2Rows().slice(0, options.limit);
const startedAt = new Date().toISOString();
console.log(
  [
    `Auditing NGS v2 image extraction candidates`,
    `rows=${rows.length}`,
    `appDb=${options.appDb}`,
    `imageDir=${options.imageDir}`,
    options.fetchMissing ? `fetchMissing=${options.fetchRole}` : 'localOnly=true',
  ].join(' ')
);

const results = await mapLimit(rows, options.concurrency, async (row, index) => {
  const result = await auditRow(row);
  if ((index + 1) % 250 === 0) {
    console.log(`processed=${index + 1}/${rows.length}`);
  }
  return result;
});

const summary = summarize(results, startedAt);
writeJson(join(options.outDir, 'summary.json'), summary);
writeJson(join(options.outDir, 'manifest.json'), results);
writeJsonl(
  join(options.outDir, 'sam3-queue.jsonl'),
  results.filter((row) => row.decision === 'route_sam3')
);
for (const priority of ['high', 'medium', 'low']) {
  writeJsonl(
    join(options.outDir, `sam3-queue-${priority}.jsonl`),
    results.filter(
      (row) => row.decision === 'route_sam3' && row.sam3Priority === priority
    )
  );
}
writeJsonl(
  join(options.outDir, 'human-review.jsonl'),
  results.filter((row) => row.humanDecisionRequired)
);

await writeContactSheet(
  results.filter((row) => row.decision === 'cheap_candidate'),
  join(options.outDir, 'cheap-candidates.jpg'),
  options.contactSheetLimit
);
await writeContactSheet(
  sortSam3Queue(results.filter((row) => row.decision === 'route_sam3')),
  join(options.outDir, 'sam3-queue.jpg'),
  options.contactSheetLimit
);
await writeContactSheet(
  results.filter((row) => row.decision === 'needs_review'),
  join(options.outDir, 'needs-review.jpg'),
  options.contactSheetLimit
);

console.log(
  [
    `Done.`,
    `summary=${join(options.outDir, 'summary.json')}`,
    `manifest=${join(options.outDir, 'manifest.json')}`,
    `sam3Queue=${join(options.outDir, 'sam3-queue.jsonl')}`,
    `humanReview=${join(options.outDir, 'human-review.jsonl')}`,
  ].join(' ')
);

function loadV2Rows() {
  const sql = `
    SELECT
      id,
      accession_number,
      title,
      artist,
      classification,
      medium,
      date_text,
      image_url,
      thumbnail_url,
      source_url,
      custom_metadata
    FROM artworks
    WHERE deleted_at IS NULL
      AND image_url IS NOT NULL
    ORDER BY id
  `;
  const output = execFileSync('sqlite3', ['-json', options.appDb, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output || '[]').map((row) => ({
    ...row,
    customMetadata: parseJson(row.custom_metadata) || {},
  }));
}

async function auditRow(row) {
  const imageRef = await resolveImage(row);
  if (!imageRef) {
    return baseResult(row, {
      decision: 'needs_review',
      reasons: ['local_image_missing'],
      humanDecisionRequired: true,
      imageRef: null,
      error: options.fetchMissing
        ? 'No local image and remote fetch failed'
        : 'No local image; rerun with --fetch-missing if needed',
    });
  }

  try {
    const input =
      imageRef.kind === 'file' ? imageRef.path : readFileSync(imageRef.path);
    const image = sharp(input, { limitInputPixels: false }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Missing image dimensions');
    }

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

    const analysis = analyzeScan(scan.data, scan.info.width, scan.info.height);
    const classification = classify(row, analysis, metadata);
    const scaleX = metadata.width / scan.info.width;
    const scaleY = metadata.height / scan.info.height;
    const candidateBox = analysis.candidateBox
      ? {
          left: Math.max(0, Math.round(analysis.candidateBox.left * scaleX)),
          top: Math.max(0, Math.round(analysis.candidateBox.top * scaleY)),
          width: Math.min(
            metadata.width,
            Math.round(analysis.candidateBox.width * scaleX)
          ),
          height: Math.min(
            metadata.height,
            Math.round(analysis.candidateBox.height * scaleY)
          ),
        }
      : null;

    const result = baseResult(row, {
      imageRef,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      decision: classification.decision,
      confidence: round(classification.confidence),
      humanDecisionRequired: classification.decision !== 'use_original',
      reasons: classification.reasons,
      candidateBox,
      scanCandidateBox: analysis.candidateBox,
      marginFractions: analysis.marginFractions,
      outerStats: analysis.outerStats,
      colorCardSignal: analysis.colorCardSignal,
      sourceSignals: sourceSignals(row),
      sam3Priority:
        classification.decision === 'route_sam3'
          ? sam3Priority(classification.reasons)
          : null,
      sam3Prompt:
        classification.decision === 'route_sam3'
          ? sam3Prompt(row, classification.reasons)
          : null,
      canonicalImageRecommendation:
        classification.decision === 'use_original'
          ? 'original'
          : 'original_until_human_approval',
    });

    result._contactSheetImagePath = imageRef.path;
    return result;
  } catch (error) {
    return baseResult(row, {
      imageRef,
      decision: 'needs_review',
      confidence: 0,
      humanDecisionRequired: true,
      reasons: ['decode_or_analysis_failed'],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function baseResult(row, extra) {
  return {
    artworkId: row.id,
    accessionNumber: row.accession_number || row.id,
    title: row.title,
    artist: row.artist,
    classification: row.classification,
    medium: row.medium,
    dateText: row.date_text,
    sourceUrl: row.source_url,
    dimensionsText: row.customMetadata?.dimensions_text || null,
    ...extra,
  };
}

async function resolveImage(row) {
  const candidates = localImageCandidates(row);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { kind: 'file', path: candidate, source: 'local_cache' };
    }
  }

  if (!options.fetchMissing) return null;

  const url =
    options.fetchRole === 'original'
      ? row.image_url
      : row.thumbnail_url || row.image_url;
  if (!url) return null;

  const safeName = safeFileName(row.id);
  const outPath = join(fetchedDir, `${safeName}.img`);
  if (!existsSync(outPath)) {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(outPath, buffer);
  }
  return { kind: 'file', path: outPath, source: 'remote_asset', url };
}

function localImageCandidates(row) {
  const ids = new Set([
    row.id,
    row.accession_number,
    String(row.id || '').replace(/-(PC|OT)$/i, '-($1)'),
    String(row.accession_number || '').replace(/-(PC|OT)$/i, '-($1)'),
  ]);
  return [...ids]
    .filter(Boolean)
    .flatMap((id) => [
      join(options.imageDir, `${id}.webp`),
      join(options.imageDir, `${id}.jpg`),
      join(options.imageDir, `${id}.jpeg`),
      join(options.imageDir, `${id}.png`),
    ]);
}

function analyzeScan(data, width, height) {
  const strip = Math.max(2, Math.floor(Math.min(width, height) * 0.025));
  const outer = {
    top: statsForRect(data, width, height, 0, 0, width, strip),
    bottom: statsForRect(data, width, height, 0, height - strip, width, strip),
    left: statsForRect(data, width, height, 0, 0, strip, height),
    right: statsForRect(data, width, height, width - strip, 0, strip, height),
  };
  const outerStats = {
    lumaMedian: round(median(Object.values(outer).map((item) => item.luma))),
    stdMedian: round(median(Object.values(outer).map((item) => item.std))),
    saturationMedian: round(
      median(Object.values(outer).map((item) => item.saturation))
    ),
  };

  const margins = {
    top: scanUniformMargin(data, width, height, 'top', outer.top),
    bottom: scanUniformMargin(data, width, height, 'bottom', outer.bottom),
    left: scanUniformMargin(data, width, height, 'left', outer.left),
    right: scanUniformMargin(data, width, height, 'right', outer.right),
  };

  const candidateBox = {
    left: margins.left,
    top: margins.top,
    width: width - margins.left - margins.right,
    height: height - margins.top - margins.bottom,
  };

  const marginFractions = {
    top: round(margins.top / height),
    bottom: round(margins.bottom / height),
    left: round(margins.left / width),
    right: round(margins.right / width),
  };
  const cropAreaRatio = round(
    (candidateBox.width * candidateBox.height) / (width * height)
  );

  return {
    candidateBox:
      candidateBox.width > 0 && candidateBox.height > 0 ? candidateBox : null,
    marginFractions,
    cropAreaRatio,
    outerStats,
    colorCardSignal: detectColorCardSignal(data, width, height),
  };
}

function scanUniformMargin(data, width, height, side, ref) {
  const axis = side === 'top' || side === 'bottom' ? height : width;
  const max = Math.floor(axis * 0.36);
  const step = Math.max(2, Math.floor(axis * 0.01));
  let accepted = 0;

  for (let offset = 0; offset < max; offset += step) {
    const rect =
      side === 'top'
        ? [0, offset, width, Math.min(step, height - offset)]
        : side === 'bottom'
          ? [0, Math.max(0, height - offset - step), width, Math.min(step, height)]
          : side === 'left'
            ? [offset, 0, Math.min(step, width - offset), height]
            : [Math.max(0, width - offset - step), 0, Math.min(step, width), height];

    const stats = statsForRect(data, width, height, ...rect);
    const colorDistance = distance(stats, ref);
    const lumaDistance = Math.abs(stats.luma - ref.luma);
    const textureLimit = Math.max(18, ref.std + 13);
    if (
      colorDistance <= 26 &&
      lumaDistance <= 20 &&
      stats.std <= textureLimit
    ) {
      accepted = Math.min(axis, offset + step);
      continue;
    }
    break;
  }

  return accepted;
}

function classify(row, analysis, metadata) {
  const reasons = [];
  const margins = Object.values(analysis.marginFractions);
  const maxMargin = Math.max(...margins);
  const sidesOver4 = margins.filter((value) => value >= 0.04).length;
  const sidesOver7 = margins.filter((value) => value >= 0.07).length;
  const cropArea = analysis.cropAreaRatio;
  const outer = analysis.outerStats;
  const is2d = isLikely2d(row);
  const isObject = isLikelyObject(row);
  const source = sourceSignals(row);

  if (analysis.colorCardSignal.score >= 0.72) {
    reasons.push('possible_color_card_or_calibration_target');
  }
  if (outer.lumaMedian <= 30 && maxMargin >= 0.035) {
    reasons.push('possible_black_capture_surround');
  }
  if (outer.lumaMedian >= 226 && maxMargin >= 0.055 && outer.stdMedian <= 24) {
    reasons.push('possible_white_mat_or_scanner_surround');
  }
  if (
    outer.lumaMedian > 34 &&
    outer.lumaMedian < 218 &&
    maxMargin >= 0.04 &&
    outer.stdMedian <= 18
  ) {
    reasons.push('possible_nonwhite_uniform_surround');
  }
  if (sidesOver7 >= 2 && outer.stdMedian <= 26) {
    reasons.push('large_uniform_border');
  } else if (sidesOver4 >= 2 && outer.stdMedian <= 18) {
    reasons.push('thin_uniform_border');
  }
  if (is2d && source.hasFrameOrMountMeasure) {
    reasons.push('catalogue_has_frame_or_mount_measure');
  }
  if (source.ngsImageUrlLooksCropped) {
    reasons.push('source_already_cropped_hint');
  }
  if (isObject) {
    reasons.push('object_or_sculpture_default_original');
  }
  if (cropArea < 0.42) {
    reasons.push('candidate_crop_aggressive');
  }
  if (cropArea > 0.985) {
    reasons.push('candidate_crop_nearly_full_image');
  }

  const artifactSignal =
    reasons.includes('possible_black_capture_surround') ||
    reasons.includes('possible_white_mat_or_scanner_surround') ||
    reasons.includes('possible_nonwhite_uniform_surround') ||
    reasons.includes('possible_color_card_or_calibration_target');
  const colorCardSignal = analysis.colorCardSignal.score >= 0.72;
  const highRisk = reasons.includes('candidate_crop_aggressive') || colorCardSignal;

  let decision = 'use_original';
  let confidence = 0.15;

  if (isObject && !artifactSignal && analysis.colorCardSignal.score < 0.58) {
    return {
      decision,
      confidence: 0.82,
      reasons: reasons.filter((reason) => reason !== 'candidate_crop_nearly_full_image'),
    };
  }

  if (
    artifactSignal ||
    (highRisk && artifactSignal) ||
    (is2d && source.hasFrameOrMountMeasure && maxMargin >= 0.035)
  ) {
    decision = 'route_sam3';
    confidence =
      0.38 +
      Math.min(0.22, maxMargin * 1.2) +
      (is2d ? 0.1 : 0) +
      (source.hasFrameOrMountMeasure ? 0.08 : 0) +
      (analysis.colorCardSignal.score >= 0.58 ? 0.12 : 0);
  }

  if (decision === 'use_original') {
    reasons.push('no_extraction_signal');
    confidence = metadata.width && metadata.height ? 0.74 : 0.4;
  }

  return { decision, confidence: clamp(confidence, 0, 0.98), reasons };
}

function sourceSignals(row) {
  const custom = row.customMetadata || {};
  const provenance = custom.source_provenance || {};
  const raw = JSON.stringify({
    dimensions: custom.dimensions_text,
    source_provenance: provenance,
    ngs_image_url: custom.ngs_image_url,
    medium: row.medium,
    classification: row.classification,
  }).toLowerCase();
  return {
    hasFrameOrMountMeasure: /\b(frame|mount|mat)\b/.test(raw),
    ngsImageUrlLooksCropped: /cropp?ed|_crop|\(cropped\)/i.test(
      String(custom.ngs_image_url || row.source_url || '')
    ),
  };
}

function isLikely2d(row) {
  const text = `${row.classification || ''} ${row.medium || ''}`.toLowerCase();
  return (
    /paint|print|drawing|photograph|paper|canvas|batik|ink|watercolou?r|woodcut|linocut|screenprint/.test(
      text
    ) && !isLikelyObject(row)
  );
}

function isLikelyObject(row) {
  const text = `${row.classification || ''} ${row.medium || ''}`.toLowerCase();
  return /sculpt|object|ceramic|installation|bronze|stone|wood carving|mixed media object/.test(
    text
  );
}

function detectColorCardSignal(data, width, height) {
  const bands = [
    [0, Math.floor(height * 0.84), width, Math.ceil(height * 0.16)],
    [0, 0, width, Math.ceil(height * 0.16)],
    [0, 0, Math.ceil(width * 0.16), height],
    [Math.floor(width * 0.84), 0, Math.ceil(width * 0.16), height],
  ];
  let best = { score: 0, saturatedCells: 0, hueBins: 0 };

  for (const [left, top, bandWidth, bandHeight] of bands) {
    const cols = 12;
    const rows = 4;
    const hues = new Set();
    let saturatedCells = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = left + Math.floor((bandWidth * col) / cols);
        const y = top + Math.floor((bandHeight * row) / rows);
        const w = Math.max(1, Math.floor(bandWidth / cols));
        const h = Math.max(1, Math.floor(bandHeight / rows));
        const stats = statsForRect(data, width, height, x, y, w, h);
        if (stats.saturation >= 0.32 && stats.luma > 35 && stats.luma < 235) {
          saturatedCells += 1;
          hues.add(Math.floor(stats.hue / 35));
        }
      }
    }
    const compactSwatchLike =
      saturatedCells >= 4 && saturatedCells <= 8 && hues.size >= 4;
    const score = compactSwatchLike
      ? Math.min(1, saturatedCells / 8) * Math.min(1, hues.size / 5)
      : 0;
    if (score > best.score) {
      best = { score: round(score), saturatedCells, hueBins: hues.size };
    }
  }

  return best;
}

function statsForRect(data, width, height, left, top, rectWidth, rectHeight) {
  const x0 = clamp(Math.floor(left), 0, width - 1);
  const y0 = clamp(Math.floor(top), 0, height - 1);
  const x1 = clamp(Math.ceil(left + rectWidth), x0 + 1, width);
  const y1 = clamp(Math.ceil(top + rectHeight), y0 + 1, height);
  let r = 0;
  let g = 0;
  let b = 0;
  let lumaSum = 0;
  let lumaSq = 0;
  let sat = 0;
  let hue = 0;
  let n = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = (y * width + x) * 3;
      const rr = data[idx] ?? 0;
      const gg = data[idx + 1] ?? 0;
      const bb = data[idx + 2] ?? 0;
      const ll = 0.299 * rr + 0.587 * gg + 0.114 * bb;
      const hsv = rgbToHsv(rr, gg, bb);
      r += rr;
      g += gg;
      b += bb;
      lumaSum += ll;
      lumaSq += ll * ll;
      sat += hsv.s;
      hue += hsv.h;
      n += 1;
    }
  }

  const luma = lumaSum / Math.max(1, n);
  const variance = lumaSq / Math.max(1, n) - luma * luma;
  return {
    r: r / Math.max(1, n),
    g: g / Math.max(1, n),
    b: b / Math.max(1, n),
    luma,
    std: Math.sqrt(Math.max(0, variance)),
    saturation: sat / Math.max(1, n),
    hue: hue / Math.max(1, n),
  };
}

function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / delta + 2);
    else h = 60 * ((rr - gg) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function distance(left, right) {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

function sam3Prompt(row, reasons) {
  return [
    'Segment the artwork image area only.',
    'Exclude frame, mat, mount, scanner bed, wall, labels, color cards, borders, and shadows.',
    'Do not crop to an internal signature, detail, or single figure.',
    `Artwork: ${row.title || row.id}`,
    `Accession: ${row.accession_number || row.id}`,
    reasons.length ? `Routing reasons: ${reasons.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function sam3Priority(reasons) {
  if (
    reasons.includes('possible_color_card_or_calibration_target') ||
    reasons.includes('possible_black_capture_surround') ||
    reasons.includes('catalogue_has_frame_or_mount_measure')
  ) {
    return 'high';
  }
  if (
    reasons.includes('possible_white_mat_or_scanner_surround') ||
    (reasons.includes('possible_nonwhite_uniform_surround') &&
      reasons.includes('candidate_crop_aggressive')) ||
    (reasons.includes('possible_nonwhite_uniform_surround') &&
      !reasons.includes('source_already_cropped_hint'))
  ) {
    return 'medium';
  }
  return 'low';
}

function sortSam3Queue(rows) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return [...rows].sort((left, right) => {
    const priorityDiff =
      (priorityRank[left.sam3Priority] ?? 3) -
      (priorityRank[right.sam3Priority] ?? 3);
    if (priorityDiff) return priorityDiff;
    return (right.confidence || 0) - (left.confidence || 0);
  });
}

async function writeContactSheet(rows, outPath, limit) {
  const items = rows
    .filter((row) => row._contactSheetImagePath || row.imageRef?.path)
    .slice(0, limit);
  if (!items.length) return;

  const tileWidth = 300;
  const tileHeight = 355;
  const imageSize = 250;
  const columns = 5;
  const sheetWidth = tileWidth * columns;
  const sheetHeight = tileHeight * Math.ceil(items.length / columns);
  const composites = [];

  for (let index = 0; index < items.length; index += 1) {
    const row = items[index];
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * tileHeight;
    const imagePath = row._contactSheetImagePath || row.imageRef.path;
    const image = sharp(imagePath, { limitInputPixels: false }).rotate();
    const meta = await image.metadata();
    const resized = await image
      .resize({
        width: imageSize,
        height: imageSize,
        fit: 'inside',
        background: '#f5f5f5',
      })
      .flatten({ background: '#f5f5f5' })
      .jpeg({ quality: 82 })
      .toBuffer();
    composites.push({ input: resized, left: left + 25, top: top + 12 });

    if (row.candidateBox && meta.width && meta.height) {
      const scale = Math.min(imageSize / meta.width, imageSize / meta.height);
      const renderedWidth = Math.round(meta.width * scale);
      const renderedHeight = Math.round(meta.height * scale);
      const xOffset = left + 25 + Math.floor((imageSize - renderedWidth) / 2);
      const yOffset = top + 12 + Math.floor((imageSize - renderedHeight) / 2);
      const box = {
        x: xOffset + Math.round(row.candidateBox.left * scale),
        y: yOffset + Math.round(row.candidateBox.top * scale),
        w: Math.round(row.candidateBox.width * scale),
        h: Math.round(row.candidateBox.height * scale),
      };
      const overlay = Buffer.from(
        `<svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="#ff4d00" stroke-width="3"/></svg>`
      );
      composites.push({ input: overlay, left: 0, top: 0 });
    }

    const label = [
      row.artworkId,
      row.decision,
      `conf ${row.confidence ?? 0}`,
      row.reasons?.slice(0, 2).join(', '),
    ]
      .filter(Boolean)
      .join('\n');
    const labelSvg = Buffer.from(
      `<svg width="${tileWidth}" height="88" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff"/><text x="10" y="18" font-family="Arial, sans-serif" font-size="13" fill="#111">${escapeXml(label)}</text></svg>`
    );
    composites.push({ input: labelSvg, left, top: top + 265 });
  }

  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .jpeg({ quality: 88 })
    .toFile(outPath);
}

function summarize(results, generatedAt) {
  const byDecision = countBy(results, (row) => row.decision);
  const byReason = new Map();
  for (const row of results) {
    for (const reason of row.reasons || []) {
      byReason.set(reason, (byReason.get(reason) || 0) + 1);
    }
  }
  const reasonCounts = Object.fromEntries(
    [...byReason.entries()].sort((a, b) => b[1] - a[1])
  );

  return {
    generatedAt,
    completedAt: new Date().toISOString(),
    source: {
      appDb: options.appDb,
      imageDir: options.imageDir,
      corpus: 'NGS v2 app DB rows with image_url',
    },
    totals: {
      rows: results.length,
      humanReview: results.filter((row) => row.humanDecisionRequired).length,
      sam3Queue: results.filter((row) => row.decision === 'route_sam3').length,
      sam3High: results.filter((row) => row.sam3Priority === 'high').length,
      sam3Medium: results.filter((row) => row.sam3Priority === 'medium').length,
      sam3Low: results.filter((row) => row.sam3Priority === 'low').length,
      cheapCandidates: results.filter((row) => row.decision === 'cheap_candidate')
        .length,
      useOriginal: results.filter((row) => row.decision === 'use_original').length,
      needsReview: results.filter((row) => row.decision === 'needs_review').length,
      localCache: results.filter((row) => row.imageRef?.source === 'local_cache')
        .length,
      fetched: results.filter((row) => row.imageRef?.source === 'remote_asset')
        .length,
    },
    byDecision,
    reasonCounts,
    outputs: {
      manifest: join(options.outDir, 'manifest.json'),
      sam3Queue: join(options.outDir, 'sam3-queue.jsonl'),
      sam3QueueHigh: join(options.outDir, 'sam3-queue-high.jsonl'),
      sam3QueueMedium: join(options.outDir, 'sam3-queue-medium.jsonl'),
      sam3QueueLow: join(options.outDir, 'sam3-queue-low.jsonl'),
      humanReview: join(options.outDir, 'human-review.jsonl'),
      cheapCandidatesSheet: join(options.outDir, 'cheap-candidates.jpg'),
      sam3QueueSheet: join(options.outDir, 'sam3-queue.jpg'),
      needsReviewSheet: join(options.outDir, 'needs-review.jpg'),
    },
    notes: [
      'This audit is read-only. It does not write processed assets, crop images, update D1, or upsert Vectorize.',
      'Non-original decisions are routing suggestions and still require human approval before becoming canonical v2 image sources.',
      'Image embeddings should be regenerated after accepted extraction decisions are materialized additively.',
    ],
  };
}

function countBy(items, fn) {
  const counts = {};
  for (const item of items) {
    const key = fn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return output;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(stripPrivate(value), null, 2)}\n`);
}

function writeJsonl(path, rows) {
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(stripPrivate(row))).join('\n') +
      (rows.length ? '\n' : '')
  );
}

function stripPrivate(value) {
  if (Array.isArray(value)) return value.map(stripPrivate);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, item]) => [key, stripPrivate(item)])
  );
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function safeFileName(value) {
  return String(value || 'image').replace(/[^a-z0-9_.-]+/gi, '_');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '</text><text x="10" dy="16" font-family="Arial, sans-serif" font-size="13" fill="#111">');
}

function round(value, digits = 4) {
  return Number(Number(value || 0).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function printHelp() {
  console.log(`Usage:
  node scripts/audit-ngs-image-extraction.mjs [options]

Options:
  --app-db PATH             v2 app SQLite DB. Default: /tmp/paillette-v2-bakeoff.sqlite
  --image-dir PATH          local image cache. Default: eval/images
  --out-dir PATH            output directory. Default: ~/Downloads/paillette-ngs-image-extraction-audit
  --limit N                 audit first N imageable v2 rows
  --concurrency N           parallel sharp workers. Default: 8
  --max-scan-dim N          longest side for heuristic scan. Default: 512
  --contact-sheet-limit N   max rows per contact sheet. Default: 80
  --fetch-missing           fetch missing local cache images from staging asset URLs
  --fetch-role thumb|original

Outputs:
  summary.json, manifest.json, sam3-queue.jsonl, human-review.jsonl,
  cheap-candidates.jpg, sam3-queue.jpg, needs-review.jpg.

This is read-only: no crops are materialized and no DB/vector data changes.
`);
}
