#!/usr/bin/env node
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const imageRequire = createRequire(
  new URL('../packages/image-processing/package.json', import.meta.url)
);
const sharpModule = await import(imageRequire.resolve('sharp'));
const sharp = sharpModule.default || sharpModule;

const args = new Map();
const flags = new Set();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && arg.includes('=')) {
    const [key, ...value] = arg.slice(2).split('=');
    args.set(key, value.join('='));
  } else if (arg.startsWith('--')) {
    flags.add(arg.slice(2));
  }
}

const options = {
  inputDir: args.get('input-dir'),
  outputDir: args.get('output-dir'),
  report: args.get('report') || 'hcc-frame-crop-report.jsonl',
  extensions: parseExtensions(args.get('extensions')),
  outputFormat: args.get('output-format') || 'tiff',
  recursive: flags.has('recursive'),
  apply: flags.has('apply'),
  force: flags.has('force'),
  limit: toInt(args.get('limit'), Infinity),
  maxScanDim: toInt(args.get('max-scan-dim'), 900),
  edgeThreshold: toFloat(args.get('edge-threshold'), 28),
  minConfidence: toFloat(args.get('min-confidence'), 0.58),
  paddingPct: toFloat(args.get('padding-pct'), 0.012),
};

if (
  flags.has('help') ||
  !options.inputDir ||
  (!options.outputDir && options.apply) ||
  !['tiff', 'source'].includes(options.outputFormat)
) {
  printHelp();
  process.exit(flags.has('help') ? 0 : 1);
}

const files = listImages(options.inputDir, options.recursive).slice(0, options.limit);
const rows = [];
let written = 0;
let failed = 0;

for (const file of files) {
  try {
    const result = await analyze(file);
    rows.push(result);

    const shouldWrite =
      options.apply &&
      result.cropBox &&
      (options.force || result.confidence >= options.minConfidence);
    if (shouldWrite) {
      const outputPath = outputPathFor(file);
      mkdirSync(dirname(outputPath), { recursive: true });
      const pipeline = sharp(file, { limitInputPixels: false }).rotate().extract(result.cropBox);
      if (options.outputFormat === 'source') {
        await pipeline.toFile(outputPath);
      } else {
        await pipeline.tiff({ compression: 'lzw', pyramid: false }).toFile(outputPath);
      }
      result.outputPath = outputPath;
      written += 1;
    }
  } catch (error) {
    failed += 1;
    rows.push({
      inputPath: file,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

writeFileSync(options.report, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
console.log(
  [
    `scanned=${files.length}`,
    `candidateCrops=${rows.filter((row) => row.cropBox).length}`,
    `needsPreprocessing=${rows.filter((row) => row.needsPreprocessing).length}`,
    `review=${rows.filter((row) => row.recommendedAction === 'review').length}`,
    `written=${written}`,
    `failed=${failed}`,
    `report=${options.report}`,
    options.apply ? 'apply=true' : 'dry-run=true',
  ].join(' ')
);

async function analyze(file) {
  const image = sharp(file, { limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  const scale = Math.min(
    1,
    options.maxScanDim / Math.max(metadata.width, metadata.height)
  );
  const scanWidth = Math.max(1, Math.round(metadata.width * scale));
  const scanHeight = Math.max(1, Math.round(metadata.height * scale));
  const { data, info } = await image
    .clone()
    .resize(scanWidth, scanHeight, { fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const components = findEdgeComponents(data, info.width, info.height);
  const selected = selectComponent(components, info.width, info.height);
  const result = {
    inputPath: file,
    ok: true,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    scanWidth: info.width,
    scanHeight: info.height,
    components: components.slice(0, 8),
    cropBox: null,
    confidence: 0,
    needsPreprocessing: false,
    recommendedAction: 'none',
    issues: [],
  };

  if (!selected) {
    result.issues.push('no_confident_inner_artwork_component');
    return result;
  }

  const crop = expandAndMap(selected.box, scale, metadata.width, metadata.height);
  const marginFractions = {
    left: crop.left / metadata.width,
    top: crop.top / metadata.height,
    right: (metadata.width - crop.left - crop.width) / metadata.width,
    bottom: (metadata.height - crop.top - crop.height) / metadata.height,
  };
  const cropArea = (crop.width * crop.height) / (metadata.width * metadata.height);
  const maxMargin = Math.max(...Object.values(marginFractions));
  const minMargin = Math.min(...Object.values(marginFractions));
  const confidence = clamp(
    selected.score * 0.62 +
      Math.min(maxMargin * 1.8, 0.25) +
      (cropArea > 0.03 && cropArea < 0.9 ? 0.13 : 0) -
      (minMargin < 0.004 ? 0.12 : 0),
    0,
    1
  );

  result.cropBox = {
    left: crop.left,
    top: crop.top,
    width: crop.width,
    height: crop.height,
  };
  result.confidence = round(confidence);
  result.cropAreaRatio = round(cropArea);
  result.marginFractions = Object.fromEntries(
    Object.entries(marginFractions).map(([key, value]) => [key, round(value)])
  );
  result.needsPreprocessing = confidence >= options.minConfidence;
  result.recommendedAction = result.needsPreprocessing
    ? 'crop'
    : confidence >= Math.max(0.38, options.minConfidence - 0.16)
      ? 'review'
      : 'none';
  if (confidence < options.minConfidence) result.issues.push('low_confidence');
  if (maxMargin > 0.18) result.issues.push('large_surround_or_mount_detected');
  if (cropArea < 0.08) result.issues.push('small_central_artwork_or_detail');
  if (cropArea > 0.9) result.issues.push('crop_nearly_full_image');
  return result;
}

function findEdgeComponents(data, width, height) {
  const edge = new Uint8Array(width * height);
  const threshold = options.edgeThreshold;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx = Math.abs(data[idx + 1] - data[idx - 1]);
      const gy = Math.abs(data[idx + width] - data[idx - width]);
      if (gx + gy >= threshold) edge[idx] = 1;
    }
  }

  const seen = new Uint8Array(width * height);
  const components = [];
  const stack = [];
  for (let start = 0; start < edge.length; start += 1) {
    if (!edge[start] || seen[start]) continue;
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    stack.push(start);
    seen[start] = 1;

    while (stack.length) {
      const idx = stack.pop();
      pixels += 1;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const next of [idx - 1, idx + 1, idx - width, idx + width]) {
        if (next < 0 || next >= edge.length || seen[next] || !edge[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }

    const box = {
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
    const area = box.width * box.height;
    if (pixels >= 40 && area >= width * height * 0.002) {
      components.push({
        box,
        pixels,
        areaRatio: round(area / (width * height)),
        edgeDensity: round(pixels / area),
      });
    }
  }

  return components
    .sort((a, b) => b.pixels - a.pixels)
    .map((component) => ({ ...component, score: round(componentScore(component, width, height)) }));
}

function selectComponent(components, width, height) {
  return components
    .filter((component) => {
      const areaRatio = component.areaRatio;
      const box = component.box;
      const centerY = box.top + box.height / 2;
      return (
        areaRatio >= 0.015 &&
        areaRatio <= 0.88 &&
        box.width >= width * 0.08 &&
        box.height >= height * 0.08 &&
        centerY >= height * 0.16
      );
    })
    .sort((a, b) => b.score - a.score)[0];
}

function componentScore(component, width, height) {
  const box = component.box;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const centerDist = Math.hypot(cx - width / 2, cy - height / 2);
  const centerScore = 1 - centerDist / Math.hypot(width / 2, height / 2);
  const densityScore = Math.min(component.edgeDensity * 8, 1);
  const areaScore = component.areaRatio > 0.03 && component.areaRatio < 0.65 ? 1 : 0.55;
  return clamp(0.48 * centerScore + 0.32 * densityScore + 0.2 * areaScore, 0, 1);
}

function expandAndMap(box, scale, fullWidth, fullHeight) {
  const padX = Math.round(box.width * options.paddingPct);
  const padY = Math.round(box.height * options.paddingPct);
  const left = Math.max(0, Math.floor((box.left - padX) / scale));
  const top = Math.max(0, Math.floor((box.top - padY) / scale));
  const right = Math.min(fullWidth, Math.ceil((box.left + box.width + padX) / scale));
  const bottom = Math.min(fullHeight, Math.ceil((box.top + box.height + padY) / scale));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function listImages(root, recursive) {
  const output = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory() && recursive) {
      output.push(...listImages(path, recursive));
    } else if (stats.isFile() && options.extensions.has(extname(path).toLowerCase())) {
      output.push(path);
    }
  }
  return output.sort();
}

function outputPathFor(file) {
  const rel = relative(options.inputDir, file);
  if (options.outputFormat === 'source') return join(options.outputDir, rel);

  const ext = extname(rel);
  const dir = dirname(rel);
  const stem = basename(rel, ext);
  return join(options.outputDir, dir === '.' ? '' : dir, `${stem}.tif`);
}

function parseExtensions(value) {
  const defaults = ['.tif', '.tiff', '.jpg', '.jpeg', '.png', '.webp'];
  const raw = value ? value.split(',') : defaults;
  return new Set(
    raw
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`))
  );
}

function toInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function printHelp() {
  console.log(`Usage:
  node scripts/hcc-frame-crop-tiff.mjs --input-dir=/hcc/images --output-dir=/hcc/cropped --report=frame-report.jsonl --recursive --apply

Options:
  --input-dir=DIR       Folder containing source image files.
  --output-dir=DIR      Destination folder for cropped images when --apply is set.
  --report=PATH         JSONL report path. Default: hcc-frame-crop-report.jsonl.
  --extensions=LIST     Comma-separated extensions. Default: .tif,.tiff,.jpg,.jpeg,.png,.webp.
  --output-format=FMT   tiff or source. Default: tiff.
  --recursive           Recurse into subfolders.
  --limit=N             Limit files scanned.
  --apply               Write cropped outputs. Omit for scan-only dry run.
  --force               Write even when confidence is below --min-confidence.
  --min-confidence=N    Default: 0.58.
  --edge-threshold=N    Default: 28.
  --padding-pct=N       Default: 0.012.
`);
}
