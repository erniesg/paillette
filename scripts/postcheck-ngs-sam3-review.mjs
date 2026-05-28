#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const imageRequire = createRequire(
  new URL("../packages/image-processing/package.json", import.meta.url),
);
const sharpModule = await import(imageRequire.resolve("sharp"));
const sharp = sharpModule.default || sharpModule;

const args = parseArgs(process.argv.slice(2));
const outputDir =
  args.outputDir || "/Users/erniesg/Downloads/paillette-ngs-local-sam3-review";
const resultsPath = args.results || join(outputDir, "sam3-review-results.jsonl");
const outPath = args.out || join(outputDir, "sam3-review-postcheck.json");
const maxDim = Number(args.maxDim || 512);

if (!existsSync(resultsPath)) {
  console.error(`Missing results JSONL: ${resultsPath}`);
  process.exit(1);
}

const rows = readFileSync(resultsPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const postcheck = {};
let processed = 0;

for (const row of rows) {
  if (row.action !== "crop" || !row.ok || !Array.isArray(row.final_box)) {
    continue;
  }
  postcheck[row.name] = await analyzeCrop(row);
  processed += 1;
  if (processed % 250 === 0) {
    console.log(`postchecked=${processed}`);
  }
}

const summary = summarize(postcheck);
writeFileSync(
  outPath,
  `${JSON.stringify({ summary, rows: postcheck }, null, 2)}\n`,
);
console.log(JSON.stringify({ outPath, processed, summary }, null, 2));

async function analyzeCrop(row) {
  const image = sharp(row.file, { limitInputPixels: false })
    .rotate()
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .toColourspace("srgb");
  const raw = await image.raw().toBuffer({ resolveWithObject: true });
  const width = raw.info.width;
  const height = raw.info.height;
  const scaleX = width / row.full_size[0];
  const scaleY = height / row.full_size[1];
  const box = [
    Math.round(row.final_box[0] * scaleX),
    Math.round(row.final_box[1] * scaleY),
    Math.round(row.final_box[2] * scaleX),
    Math.round(row.final_box[3] * scaleY),
  ];

  const cropWidth = Math.max(1, box[2] - box[0]);
  const cropHeight = Math.max(1, box[3] - box[1]);
  const cropArea = (cropWidth * cropHeight) / (width * height);
  const innerDepth = Math.max(4, Math.round(Math.min(width, height) * 0.05));
  const sides = [];

  addSide(sides, raw.data, width, height, "top", [0, 0, width, box[1]], [
    box[0],
    box[1],
    cropWidth,
    Math.min(innerDepth, cropHeight),
  ]);
  addSide(sides, raw.data, width, height, "bottom", [0, box[3], width, height - box[3]], [
    box[0],
    Math.max(box[1], box[3] - Math.min(innerDepth, cropHeight)),
    cropWidth,
    Math.min(innerDepth, cropHeight),
  ]);
  addSide(sides, raw.data, width, height, "left", [0, 0, box[0], height], [
    box[0],
    box[1],
    Math.min(innerDepth, cropWidth),
    cropHeight,
  ]);
  addSide(sides, raw.data, width, height, "right", [box[2], 0, width - box[2], height], [
    Math.max(box[0], box[2] - Math.min(innerDepth, cropWidth)),
    box[1],
    Math.min(innerDepth, cropWidth),
    cropHeight,
  ]);

  const removedSides = sides.filter((side) => side.removedPixels > 0);
  const contentSides = removedSides.filter((side) => side.hasContent);
  const sameSubstrateSides = removedSides.filter((side) => side.sameAsArtworkSurface);
  const distinctEmptySides = removedSides.filter((side) => side.distinctEmptyBorder);

  const flags = [];
  if (contentSides.length) flags.push("discarded_content");
  if (sameSubstrateSides.length >= 2) flags.push("discarded_artwork_surface");
  if (cropArea < 0.5) flags.push("aggressive_crop");
  if (distinctEmptySides.length >= 2) flags.push("distinct_empty_border");

  let recommendation = "needs_review";
  let rationale = "mixed edge evidence";
  if (
    contentSides.length > 0 ||
    sameSubstrateSides.length >= 2 ||
    (sameSubstrateSides.length >= 1 && distinctEmptySides.length === 0) ||
    (cropArea < 0.65 && distinctEmptySides.length < 2)
  ) {
    recommendation = "likely_false_positive";
    rationale =
      "crop appears to discard artwork background/margins or visible content";
  } else if (
    distinctEmptySides.length >= 2 &&
    contentSides.length === 0 &&
    sameSubstrateSides.length === 0
  ) {
    recommendation = "likely_border_crop";
    rationale = "removed bands look visually distinct and mostly empty";
  }

  return {
    recommendation,
    rationale,
    cropArea: round(cropArea),
    sides: removedSides,
    flags,
    counts: {
      removedSides: removedSides.length,
      contentSides: contentSides.length,
      sameSubstrateSides: sameSubstrateSides.length,
      distinctEmptySides: distinctEmptySides.length,
    },
  };
}

function addSide(sides, data, width, height, name, removedRect, innerRect) {
  const removed = statsForRect(data, width, height, removedRect);
  const inner = statsForRect(data, width, height, innerRect);
  const removedPixels = removed.count;
  if (!removedPixels || !inner.count) return;

  const colorDistance = Math.hypot(
    removed.r - inner.r,
    removed.g - inner.g,
    removed.b - inner.b,
  );
  const lumaDistance = Math.abs(removed.luma - inner.luma);
  const saturationDistance = Math.abs(removed.saturation - inner.saturation);
  const sameAsArtworkSurface =
    colorDistance <= 22 && lumaDistance <= 22 && saturationDistance <= 0.08;
  const hasContent =
    removed.edgeFrac >= 0.045 ||
    removed.inkFrac >= 0.04 ||
    (removed.stdLuma >= 42 && removed.inkFrac >= 0.02);
  const distinctEmptyBorder =
    colorDistance >= 24 &&
    removed.stdLuma <= 26 &&
    removed.edgeFrac <= 0.035 &&
    removed.inkFrac <= 0.03;

  sides.push({
    name,
    removedPixels,
    colorDistance: round(colorDistance),
    lumaDistance: round(lumaDistance),
    removed: compactStats(removed),
    inner: compactStats(inner),
    sameAsArtworkSurface,
    hasContent,
    distinctEmptyBorder,
  });
}

function statsForRect(data, width, height, rect) {
  const [leftRaw, topRaw, widthRaw, heightRaw] = rect;
  const left = clampInt(leftRaw, 0, width);
  const top = clampInt(topRaw, 0, height);
  const right = clampInt(leftRaw + widthRaw, 0, width);
  const bottom = clampInt(topRaw + heightRaw, 0, height);
  let count = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let lumaSum = 0;
  let lumaSq = 0;
  let saturationSum = 0;
  let edgeCount = 0;
  let inkCount = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 3;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const saturation = rgbSaturation(r, g, b);
      count += 1;
      rSum += r;
      gSum += g;
      bSum += b;
      lumaSum += luma;
      lumaSq += luma * luma;
      saturationSum += saturation;
      if (luma < 112 || (saturation > 0.24 && luma < 210)) {
        inkCount += 1;
      }
      if (x > left) {
        const leftIndex = (y * width + x - 1) * 3;
        const leftLuma =
          0.2126 * data[leftIndex] +
          0.7152 * data[leftIndex + 1] +
          0.0722 * data[leftIndex + 2];
        if (Math.abs(luma - leftLuma) >= 28) edgeCount += 1;
      }
      if (y > top) {
        const topIndex = ((y - 1) * width + x) * 3;
        const topLuma =
          0.2126 * data[topIndex] +
          0.7152 * data[topIndex + 1] +
          0.0722 * data[topIndex + 2];
        if (Math.abs(luma - topLuma) >= 28) edgeCount += 1;
      }
    }
  }
  if (!count) {
    return {
      count: 0,
      r: 0,
      g: 0,
      b: 0,
      luma: 0,
      stdLuma: 0,
      saturation: 0,
      edgeFrac: 0,
      inkFrac: 0,
    };
  }
  const luma = lumaSum / count;
  return {
    count,
    r: rSum / count,
    g: gSum / count,
    b: bSum / count,
    luma,
    stdLuma: Math.sqrt(Math.max(0, lumaSq / count - luma * luma)),
    saturation: saturationSum / count,
    edgeFrac: edgeCount / Math.max(1, count * 2),
    inkFrac: inkCount / count,
  };
}

function compactStats(stats) {
  return {
    luma: round(stats.luma),
    stdLuma: round(stats.stdLuma),
    saturation: round(stats.saturation),
    edgeFrac: round(stats.edgeFrac),
    inkFrac: round(stats.inkFrac),
  };
}

function rgbSaturation(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function summarize(rowsByName) {
  const counts = {};
  for (const row of Object.values(rowsByName)) {
    counts[row.recommendation] = (counts[row.recommendation] || 0) + 1;
  }
  return {
    total: Object.keys(rowsByName).length,
    recommendations: counts,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") parsed.outputDir = argv[++i];
    else if (arg.startsWith("--output-dir=")) parsed.outputDir = arg.slice(13);
    else if (arg === "--results") parsed.results = argv[++i];
    else if (arg.startsWith("--results=")) parsed.results = arg.slice(10);
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg.startsWith("--out=")) parsed.out = arg.slice(6);
    else if (arg === "--max-dim") parsed.maxDim = argv[++i];
    else if (arg.startsWith("--max-dim=")) parsed.maxDim = arg.slice(10);
  }
  return parsed;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
