#!/usr/bin/env node
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

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
  contactSheet: args.get('contact-sheet'),
  contactSheetLimit: toInt(args.get('contact-sheet-limit'), 40),
  include: parseInclude(args.get('include')),
  extensions: parseExtensions(args.get('extensions')),
  outputFormat: args.get('output-format') || 'tiff',
  target: args.get('target') || 'object',
  recursive: flags.has('recursive'),
  apply: flags.has('apply'),
  force: flags.has('force'),
  writeUnchanged: flags.has('write-unchanged'),
  limit: toInt(args.get('limit'), Infinity),
  maxScanDim: toInt(args.get('max-scan-dim'), 1100),
  minConfidence: toFloat(args.get('min-confidence'), 0.62),
  lineInsetPx: toInt(args.get('line-inset-px'), 1),
};

if (
  flags.has('help') ||
  !options.inputDir ||
  (!options.outputDir && options.apply) ||
  !['tiff', 'source'].includes(options.outputFormat) ||
  !['object', 'content', 'none'].includes(options.target)
) {
  printHelp();
  process.exit(flags.has('help') ? 0 : 1);
}

const files = listImages(options.inputDir, options.recursive)
  .filter((file) => !options.include || options.include.has(basename(file)))
  .slice(0, options.limit);
const rows = [];
let written = 0;
let failed = 0;

for (const file of files) {
  try {
    const result = await analyze(file);
    rows.push(result);

    const hasAcceptedCrop =
      result.cropBox &&
      (options.force || result.recommendedAction === 'crop');
    const shouldWrite = options.apply && (hasAcceptedCrop || options.writeUnchanged);
    if (shouldWrite) {
      const outputPath = outputPathFor(file);
      mkdirSync(dirname(outputPath), { recursive: true });
      const writer = await writeOutput(file, outputPath, hasAcceptedCrop ? result.cropBox : null);
      result.outputPath = outputPath;
      result.outputStatus = hasAcceptedCrop ? 'cropped' : 'unchanged';
      result.outputWriter = writer;
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
if (options.contactSheet) {
  await writeContactSheet(rows.filter((row) => row.ok), options.contactSheet);
}

console.log(
  [
    `scanned=${files.length}`,
    `candidateCrops=${rows.filter((row) => row.cropBox).length}`,
    `needsPreprocessing=${rows.filter((row) => row.needsPreprocessing).length}`,
    `review=${rows.filter((row) => row.recommendedAction === 'review').length}`,
    `kept=${rows.filter((row) => row.recommendedAction === 'keep').length}`,
    `written=${written}`,
    `failed=${failed}`,
    `report=${options.report}`,
    options.contactSheet ? `contactSheet=${options.contactSheet}` : null,
    options.apply ? 'apply=true' : 'dry-run=true',
  ]
    .filter(Boolean)
    .join(' ')
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
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scan = {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
  const fullScanBox = { left: 0, top: 0, width: scan.width, height: scan.height };
  const scanBorderStats = borderStats(scan);
  const projectionObject = findLumaProjectionObjectCrop(scan);
  const boundaryArtifact = findBoundaryArtifactCrop(scan);
  const objectBase = projectionObject?.box || boundaryArtifact?.box || fullScanBox;
  const frameBase =
    options.target === 'content'
      ? boundaryArtifact?.box || projectionObject?.box || fullScanBox
      : objectBase;
  const frameBoundary = findFrameBoundaryCrop(scan, frameBase);
  const conservativeContent = findConservativeContentFallback(
    projectionObject,
    boundaryArtifact
  );
  const selected = selectFinalCrop(
    projectionObject,
    boundaryArtifact,
    frameBoundary,
    conservativeContent
  );
  const issues = [];
  const stages = [];

  if (projectionObject) stages.push(projectionObject);
  if (boundaryArtifact) stages.push(boundaryArtifact);
  if (frameBoundary) stages.push(frameBoundary);
  if (options.target === 'content' && conservativeContent && !frameBoundary) {
    stages.push(conservativeContent);
  }
  if (
    options.target === 'object' &&
    !projectionObject &&
    !boundaryArtifact &&
    !isCleanStudioScan(scanBorderStats) &&
    hasDarkCaptureSurround(scanBorderStats)
  ) {
    issues.push('sam3_fallback_needed');
  }
  if (options.target === 'content' && !frameBoundary && !conservativeContent) {
    issues.push('no_four_sided_inner_frame_detected');
  } else if (options.target === 'content' && !frameBoundary && conservativeContent) {
    issues.push('content_fell_back_to_object');
  }

  const result = {
    inputPath: file,
    ok: true,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    scanWidth: scan.width,
    scanHeight: scan.height,
    cropBox: null,
    confidence: 0,
    needsPreprocessing: false,
    recommendedAction: 'keep',
    stages,
    issues,
  };

  if (options.target === 'none') {
    result.recommendedAction = 'keep';
    result.issues.push('target_none');
    return result;
  }

  if (!selected) {
    return result;
  }

  const crop = mapScanBoxToSource(selected.box, scale, metadata.width, metadata.height);
  const marginFractions = {
    left: crop.left / metadata.width,
    top: crop.top / metadata.height,
    right: (metadata.width - crop.left - crop.width) / metadata.width,
    bottom: (metadata.height - crop.top - crop.height) / metadata.height,
  };
  const cropArea = (crop.width * crop.height) / (metadata.width * metadata.height);
  const confidence = selected.confidence;

  result.cropBox = crop;
  result.confidence = round(confidence);
  result.selectedStage = selected.stage;
  result.selectedKind = selected.kind;
  result.cropAreaRatio = round(cropArea);
  result.marginFractions = Object.fromEntries(
    Object.entries(marginFractions).map(([key, value]) => [key, round(value)])
  );
  result.needsPreprocessing = confidence >= options.minConfidence;
  result.recommendedAction = confidence >= options.minConfidence ? 'crop' : 'review';
  if (confidence < options.minConfidence) result.issues.push('low_confidence');
  if (cropArea < 0.35) result.issues.push('aggressive_crop');
  if (cropArea > 0.98) result.issues.push('crop_nearly_full_image');
  return result;
}

function isCleanStudioScan(stats) {
  return (
    (stats.borderLightNeutralRatio >= 0.62 || stats.borderDarkRatio < 0.03) &&
    stats.borderDarkRatio < 0.03 &&
    stats.cornerDarkRatio < 0.03
  );
}

function hasDarkCaptureSurround(stats) {
  return (
    stats.borderDarkRatio >= 0.2 ||
    stats.cornerDarkRatio >= 0.2 ||
    stats.borderBlackRatio >= 0.2 ||
    stats.cornerBlackRatio >= 0.2
  );
}

function findLumaProjectionObjectCrop(scan) {
  const stats = borderStats(scan);
  const hasDarkSurround =
    stats.borderDarkRatio >= 0.42 ||
    stats.cornerDarkRatio >= 0.72 ||
    stats.borderBlackRatio >= 0.5;
  if (!hasDarkSurround || stats.borderLightNeutralRatio >= 0.62) return null;

  const candidates = [];
  for (const threshold of [120, 100, 80, 60]) {
    for (const coverage of [0.35, 0.22, 0.12]) {
      const box = lumaProjectionBox(scan, threshold, coverage);
      if (!box) continue;
      const scored = scoreProjectionObject(scan, box, threshold, coverage, stats);
      if (scored) candidates.push(scored);
    }
  }

  const selected = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (!selected || selected.confidence < 0.6) return null;

  const trimmed = trimDarkObjectRim(scan, selected.box);
  const box = trimmed?.box || selected.box;
  const cropArea = areaRatio(box, scan.width, scan.height);
  return {
    stage: 'luma-projection-object',
    kind: trimmed ? 'threshold-projection+rim-trim' : 'threshold-projection',
    box,
    confidence: round(selected.confidence),
    cropAreaRatio: round(cropArea),
    marginFractions: roundObject(marginFractions(box, scan.width, scan.height)),
    projection: {
      threshold: selected.threshold,
      coverage: selected.coverage,
      insideMean: round(selected.insideMean),
      outsideMean: round(selected.outsideMean),
    },
    trim: trimmed?.trim || null,
    borderStats: roundObject(stats),
  };
}

function lumaProjectionBox(scan, threshold, coverage) {
  const colCounts = new Uint16Array(scan.width);
  const rowCounts = new Uint16Array(scan.height);
  const { data, width, height, channels } = scan;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * channels;
      if (lumaAt(data, idx) <= threshold) continue;
      colCounts[x] += 1;
      rowCounts[y] += 1;
    }
  }

  const xRun = dominantCoverageRun(colCounts, height, coverage, width);
  const yRun = dominantCoverageRun(rowCounts, width, coverage, height);
  if (!xRun || !yRun) return null;

  const box = {
    left: xRun.start,
    top: yRun.start,
    width: xRun.end - xRun.start,
    height: yRun.end - yRun.start,
  };
  if (box.width <= 0 || box.height <= 0) return null;
  return box;
}

function dominantCoverageRun(counts, supportLength, coverage, axisLength) {
  const minCount = supportLength * coverage;
  const runs = [];
  let start = -1;

  for (let index = 0; index <= axisLength; index += 1) {
    const active = index < axisLength && counts[index] >= minCount;
    if (active && start === -1) {
      start = index;
    } else if (!active && start !== -1) {
      runs.push({ start, end: index, width: index - start });
      start = -1;
    }
  }

  if (!runs.length) return null;
  const mergedRuns = mergeCloseRuns(runs, Math.max(4, Math.round(axisLength * 0.06)));
  return mergedRuns
    .filter((run) => run.width >= axisLength * 0.08)
    .sort((a, b) => {
      const aCenter = (a.start + a.end) / 2;
      const bCenter = (b.start + b.end) / 2;
      const aScore = a.width - Math.abs(aCenter - axisLength / 2) * 0.12;
      const bScore = b.width - Math.abs(bCenter - axisLength / 2) * 0.12;
      return bScore - aScore;
    })[0] || null;
}

function mergeCloseRuns(runs, maxGap) {
  const merged = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && run.start - previous.end <= maxGap) {
      previous.end = run.end;
      previous.width = previous.end - previous.start;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function scoreProjectionObject(scan, box, threshold, coverage, stats) {
  const widthFrac = box.width / scan.width;
  const heightFrac = box.height / scan.height;
  const cropArea = areaRatio(box, scan.width, scan.height);
  if (
    widthFrac < 0.18 ||
    heightFrac < 0.28 ||
    cropArea < 0.36 ||
    cropArea > 0.96
  ) {
    return null;
  }

  const margins = marginFractions(box, scan.width, scan.height);
  const maxMargin = Math.max(...Object.values(margins));
  const minMargin = Math.min(...Object.values(margins));
  const fullHeight = margins.top <= 0.01 && margins.bottom <= 0.01;
  const fullWidth = margins.left <= 0.01 && margins.right <= 0.01;
  const verticalScroll = fullHeight && widthFrac <= 0.7 && margins.left >= 0.12 && margins.right >= 0.12;
  if ((fullHeight && !verticalScroll) || fullWidth || maxMargin < 0.018) return null;

  const means = insideOutsideLumaMeans(scan, box);
  const separation = clamp((means.inside - means.outside) / 120, 0, 1);
  const areaScore = cropArea <= 0.84 ? 1 : clamp((0.96 - cropArea) / 0.12, 0, 1);
  const marginScore = clamp(maxMargin / 0.18, 0, 1);
  const thresholdScore = clamp((threshold - 55) / 75, 0, 1);
  const sidePanelBonus = verticalScroll ? 0.1 : 0;
  const rimRiskPenalty = minMargin <= 0.004 && !verticalScroll ? 0.08 : 0;

  const confidence = clamp(
    0.36 * separation +
      0.24 * areaScore +
      0.2 * marginScore +
      0.12 * thresholdScore +
      0.08 * stats.borderDarkRatio +
      sidePanelBonus -
      rimRiskPenalty,
    0,
    1
  );

  return {
    box,
    confidence,
    threshold,
    coverage,
    insideMean: means.inside,
    outsideMean: means.outside,
  };
}

function insideOutsideLumaMeans(scan, box) {
  let insideSum = 0;
  let insideCount = 0;
  let outsideSum = 0;
  let outsideCount = 0;

  for (let y = 0; y < scan.height; y += 1) {
    for (let x = 0; x < scan.width; x += 1) {
      const idx = (y * scan.width + x) * scan.channels;
      const lum = lumaAt(scan.data, idx);
      const inside =
        x >= box.left &&
        x < box.left + box.width &&
        y >= box.top &&
        y < box.top + box.height;
      if (inside) {
        insideSum += lum;
        insideCount += 1;
      } else {
        outsideSum += lum;
        outsideCount += 1;
      }
    }
  }

  return {
    inside: insideCount ? insideSum / insideCount : 0,
    outside: outsideCount ? outsideSum / outsideCount : 0,
  };
}

function trimDarkObjectRim(scan, box) {
  const cuts = {
    left: darkRimCut(scan, box, 'left'),
    right: darkRimCut(scan, box, 'right'),
    top: darkRimCut(scan, box, 'top'),
    bottom: darkRimCut(scan, box, 'bottom'),
  };
  const accepted = Object.fromEntries(Object.entries(cuts).filter(([, value]) => value));
  if (!Object.keys(accepted).length) return null;

  const left = accepted.left?.pixels || 0;
  const top = accepted.top?.pixels || 0;
  const right = box.width - (accepted.right?.pixels || 0);
  const bottom = box.height - (accepted.bottom?.pixels || 0);
  if (right <= left || bottom <= top) return null;

  const area = ((right - left) * (bottom - top)) / (box.width * box.height);
  if (area < 0.9) return null;

  return {
    box: {
      left: box.left + left,
      top: box.top + top,
      width: right - left,
      height: bottom - top,
    },
    trim: Object.fromEntries(
      Object.entries(accepted).map(([side, cut]) => [side, cut.pixels])
    ),
  };
}

function darkRimCut(scan, box, side) {
  const axisLength = side === 'left' || side === 'right' ? box.width : box.height;
  const supportLength = side === 'left' || side === 'right' ? box.height : box.width;
  const maxScan = Math.min(32, Math.max(4, Math.floor(axisLength * 0.045)));
  let lastDark = -1;

  for (let offset = 0; offset < maxScan; offset += 1) {
    let dark = 0;
    let lumSum = 0;
    for (let pos = 0; pos < supportLength; pos += 1) {
      const x =
        side === 'left'
          ? box.left + offset
          : side === 'right'
            ? box.left + box.width - 1 - offset
            : box.left + pos;
      const y =
        side === 'top'
          ? box.top + offset
          : side === 'bottom'
            ? box.top + box.height - 1 - offset
            : box.top + pos;
      const idx = (y * scan.width + x) * scan.channels;
      const lum = lumaAt(scan.data, idx);
      lumSum += lum;
      if (lum < 80) dark += 1;
    }
    const darkFrac = dark / supportLength;
    const meanLum = lumSum / supportLength;
    if (darkFrac >= 0.12 && meanLum <= 145) {
      lastDark = offset;
      continue;
    }
    if (lastDark >= 0 && darkFrac <= 0.08 && meanLum >= 155) break;
  }

  if (lastDark < 0) return null;
  const pixels = lastDark + 1;
  if (pixels / axisLength > 0.055) return null;
  return { pixels };
}

function findBoundaryArtifactCrop(scan) {
  const stats = borderStats(scan);
  const kind =
    stats.cornerBlackRatio >= 0.72 && stats.borderBlackRatio >= 0.55
      ? 'black-surround'
      : stats.cornerWhiteRatio >= 0.72 && stats.borderWhiteRatio >= 0.68
        ? 'white-surround'
        : null;

  if (!kind) return null;

  const components = findForegroundComponents(scan, kind);
  const selected = selectBoundaryComponent(components, scan.width, scan.height, kind);
  if (!selected) return null;

  const box = expandScanBox(selected.box, scan.width, scan.height, 1);
  const margins = marginFractions(box, scan.width, scan.height);
  const maxMargin = Math.max(...Object.values(margins));
  const minMargin = Math.min(...Object.values(margins));
  const cropArea = areaRatio(box, scan.width, scan.height);
  const fillScore = clamp((selected.fillRatio - 0.45) / 0.45, 0, 1);
  const marginScore = clamp(maxMargin / 0.18, 0, 1);
  const areaScore = cropArea >= 0.12 && cropArea <= 0.94 ? 1 : 0.45;
  const confidence = clamp(
    0.42 * fillScore +
      0.28 * marginScore +
      0.2 * areaScore +
      0.1 * selected.centerScore -
      (minMargin > 0.25 ? 0.12 : 0),
    0,
    1
  );

  if (maxMargin < 0.025 || confidence < 0.52) return null;

  return {
    stage: 'boundary-artifact',
    kind,
    box,
    confidence: round(confidence),
    cropAreaRatio: round(cropArea),
    marginFractions: roundObject(margins),
    component: {
      box: selected.box,
      fillRatio: round(selected.fillRatio),
      areaRatio: round(selected.areaRatio),
    },
    borderStats: roundObject(stats),
  };
}

function findForegroundComponents(scan, kind) {
  const { data, width, height, channels } = scan;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * channels;
      const lum = lumaAt(data, idx);
      const sat = saturationAt(data, idx);
      const background =
        kind === 'black-surround'
          ? lum < 30 && sat < 0.35
          : lum > 238 && sat < 0.08;
      if (!background) mask[y * width + x] = 1;
    }
  }

  const seen = new Uint8Array(width * height);
  const components = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;

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

      for (let ny = y - 1; ny <= y + 1; ny += 1) {
        if (ny < 0 || ny >= height) continue;
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (nx < 0 || nx >= width || (nx === x && ny === y)) continue;
          const next = ny * width + nx;
          if (!mask[next] || seen[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    const box = {
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
    const area = box.width * box.height;
    if (pixels >= 50 && area >= width * height * 0.002) {
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const centerDist = Math.hypot(cx - width / 2, cy - height / 2);
      components.push({
        box,
        pixels,
        fillRatio: pixels / area,
        areaRatio: area / (width * height),
        centerScore: 1 - centerDist / Math.hypot(width / 2, height / 2),
      });
    }
  }

  return components.sort((a, b) => b.pixels - a.pixels);
}

function selectBoundaryComponent(components, width, height, kind) {
  const minFill = kind === 'black-surround' ? 0.5 : 0.55;
  const candidates = components
    .filter((component) => {
      const box = component.box;
      const margins = marginFractions(box, width, height);
      return (
        component.areaRatio >= 0.08 &&
        component.areaRatio <= 0.96 &&
        component.fillRatio >= minFill &&
        box.width >= width * 0.35 &&
        box.height >= height * 0.35 &&
        Math.max(...Object.values(margins)) >= 0.025
      );
    })
    .map((component) => {
      const margins = marginFractions(component.box, width, height);
      const marginScore = clamp(Math.max(...Object.values(margins)) / 0.2, 0, 1);
      const score =
        component.areaRatio * 0.42 +
        component.fillRatio * 0.32 +
        component.centerScore * 0.16 +
        marginScore * 0.1;
      return { ...component, score };
    });

  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function findFrameBoundaryCrop(scan, baseBox) {
  if (baseBox.width < 90 || baseBox.height < 90) return null;

  const luma = lumaRegion(scan, baseBox);
  const profiles = edgeProfiles(luma, baseBox.width, baseBox.height);
  const left = bestLineCandidate(
    profiles.vertical,
    profiles.verticalCoverage,
    baseBox.height,
    baseBox.width,
    'leading'
  );
  const right = bestLineCandidate(
    profiles.vertical,
    profiles.verticalCoverage,
    baseBox.height,
    baseBox.width,
    'trailing'
  );
  const top = bestLineCandidate(
    profiles.horizontal,
    profiles.horizontalCoverage,
    baseBox.width,
    baseBox.height,
    'leading'
  );
  const bottom = bestLineCandidate(
    profiles.horizontal,
    profiles.horizontalCoverage,
    baseBox.width,
    baseBox.height,
    'trailing'
  );

  if (!left || !right || !top || !bottom) return null;

  const inset = Math.max(0, options.lineInsetPx);
  const box = {
    left: baseBox.left + left.index + inset,
    top: baseBox.top + top.index + inset,
    width: right.index - left.index - inset * 2,
    height: bottom.index - top.index - inset * 2,
  };
  if (box.width <= 0 || box.height <= 0) return null;

  const margins = marginFractions(box, scan.width, scan.height);
  const localMargins = {
    left: (box.left - baseBox.left) / baseBox.width,
    top: (box.top - baseBox.top) / baseBox.height,
    right: (baseBox.left + baseBox.width - box.left - box.width) / baseBox.width,
    bottom: (baseBox.top + baseBox.height - box.top - box.height) / baseBox.height,
  };
  const localArea = (box.width * box.height) / (baseBox.width * baseBox.height);
  const minCoverage = Math.min(
    left.coverage,
    right.coverage,
    top.coverage,
    bottom.coverage
  );
  const minStrength = Math.min(
    left.strength,
    right.strength,
    top.strength,
    bottom.strength
  );
  const minLocalMargin = Math.min(...Object.values(localMargins));
  const maxLocalMargin = Math.max(...Object.values(localMargins));

  if (
    minCoverage < 0.48 ||
    minStrength < 18 ||
    minLocalMargin < 0.012 ||
    maxLocalMargin > 0.38 ||
    localArea < 0.38 ||
    localArea > 0.97
  ) {
    return null;
  }

  const averageLineScore = (left.score + right.score + top.score + bottom.score) / 4;
  const coverageScore = clamp((minCoverage - 0.45) / 0.35, 0, 1);
  const strengthScore = clamp((minStrength - 15) / 30, 0, 1);
  const marginScore = clamp((minLocalMargin - 0.012) / 0.08, 0, 1);
  const areaScore = localArea >= 0.45 && localArea <= 0.94 ? 1 : 0.55;
  const confidence = clamp(
    0.36 * averageLineScore +
      0.24 * coverageScore +
      0.22 * strengthScore +
      0.1 * marginScore +
      0.08 * areaScore,
    0,
    1
  );

  return {
    stage: 'inner-frame-boundary',
    kind: 'four-sided-line-support',
    box,
    confidence: round(confidence),
    cropAreaRatio: round(areaRatio(box, scan.width, scan.height)),
    localCropAreaRatio: round(localArea),
    marginFractions: roundObject(margins),
    localMarginFractions: roundObject(localMargins),
    lines: {
      left: roundLine(left),
      right: roundLine(right),
      top: roundLine(top),
      bottom: roundLine(bottom),
    },
  };
}

function lumaRegion(scan, box) {
  const output = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const sourceIdx =
        ((box.top + y) * scan.width + (box.left + x)) * scan.channels;
      output[y * box.width + x] = lumaAt(scan.data, sourceIdx);
    }
  }
  return output;
}

function edgeProfiles(luma, width, height) {
  const vertical = new Float32Array(width);
  const horizontal = new Float32Array(height);
  const verticalCoverage = new Uint16Array(width);
  const horizontalCoverage = new Uint16Array(height);
  const threshold = 22;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx = Math.abs(luma[idx + 1] - luma[idx - 1]);
      const gy = Math.abs(luma[idx + width] - luma[idx - width]);
      if (gx >= threshold) {
        vertical[x] += Math.min(gx, 90);
        verticalCoverage[x] += 1;
      }
      if (gy >= threshold) {
        horizontal[y] += Math.min(gy, 90);
        horizontalCoverage[y] += 1;
      }
    }
  }

  return { vertical, horizontal, verticalCoverage, horizontalCoverage };
}

function bestLineCandidate(profile, coverage, supportLength, axisLength, side) {
  const smoothedProfile = smoothArray(profile, 3);
  const smoothedCoverage = smoothArray(coverage, 3);
  const start =
    side === 'leading'
      ? Math.max(2, Math.floor(axisLength * 0.018))
      : Math.floor(axisLength * 0.62);
  const end =
    side === 'leading'
      ? Math.ceil(axisLength * 0.38)
      : Math.min(axisLength - 3, Math.ceil(axisLength * 0.985));
  const candidates = [];

  for (let index = start; index <= end; index += 1) {
    if (!isLocalPeak(smoothedProfile, index, start, end, 4)) continue;
    const coverageRatio = smoothedCoverage[index] / supportLength;
    const strength = smoothedProfile[index] / supportLength;
    if (coverageRatio < 0.44 || strength < 15) continue;
    const coverageScore = clamp((coverageRatio - 0.4) / 0.45, 0, 1);
    const strengthScore = clamp((strength - 14) / 40, 0, 1);
    const distanceFromEdge =
      side === 'leading' ? index / axisLength : (axisLength - index) / axisLength;
    const distanceScore = clamp((distanceFromEdge - 0.015) / 0.1, 0, 1);
    const score = 0.52 * coverageScore + 0.38 * strengthScore + 0.1 * distanceScore;
    candidates.push({
      index,
      coverage: coverageRatio,
      strength,
      score,
    });
  }

  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function findConservativeContentFallback(projectionObject, boundaryArtifact) {
  const base = projectionObject || boundaryArtifact;
  if (!base || base.confidence < 0.6) return null;

  return {
    stage: 'content-conservative-fallback',
    kind: 'object-crop-no-safe-inner-boundary',
    box: base.box,
    confidence: round(Math.min(base.confidence, 0.82)),
    cropAreaRatio: base.cropAreaRatio,
    marginFractions: base.marginFractions,
    sourceStage: base.stage,
  };
}

function selectFinalCrop(
  projectionObject,
  boundaryArtifact,
  frameBoundary,
  conservativeContent
) {
  if (options.target === 'content') {
    if (frameBoundary && frameBoundary.confidence >= 0.58) return frameBoundary;
    if (conservativeContent && conservativeContent.confidence >= 0.6) {
      return conservativeContent;
    }
    return null;
  }

  if (options.target === 'object') {
    if (projectionObject && projectionObject.confidence >= 0.6) return projectionObject;
    if (boundaryArtifact && boundaryArtifact.confidence >= 0.52) return boundaryArtifact;
    return null;
  }

  return null;
}

function borderStats(scan) {
  const border = [];
  const corners = [];
  const borderWidth = Math.max(2, Math.round(Math.min(scan.width, scan.height) * 0.04));
  const cornerWidth = Math.max(2, Math.round(Math.min(scan.width, scan.height) * 0.08));
  for (let y = 0; y < scan.height; y += 1) {
    for (let x = 0; x < scan.width; x += 1) {
      const isBorder =
        x < borderWidth ||
        x >= scan.width - borderWidth ||
        y < borderWidth ||
        y >= scan.height - borderWidth;
      const isCorner =
        (x < cornerWidth || x >= scan.width - cornerWidth) &&
        (y < cornerWidth || y >= scan.height - cornerWidth);
      if (!isBorder && !isCorner) continue;
      const idx = (y * scan.width + x) * scan.channels;
      const lum = lumaAt(scan.data, idx);
      const sat = saturationAt(scan.data, idx);
      const sample = { lum, sat };
      if (isBorder) border.push(sample);
      if (isCorner) corners.push(sample);
    }
  }

  return {
    borderBlackRatio: ratio(border, (sample) => sample.lum < 25),
    borderDarkRatio: ratio(border, (sample) => sample.lum < 60),
    borderWhiteRatio: ratio(border, (sample) => sample.lum > 238 && sample.sat < 0.08),
    borderLightNeutralRatio: ratio(
      border,
      (sample) => sample.lum > 220 && sample.sat < 0.12
    ),
    cornerBlackRatio: ratio(corners, (sample) => sample.lum < 25),
    cornerDarkRatio: ratio(corners, (sample) => sample.lum < 60),
    cornerWhiteRatio: ratio(corners, (sample) => sample.lum > 238 && sample.sat < 0.08),
  };
}

function mapScanBoxToSource(box, scale, fullWidth, fullHeight) {
  const left = Math.max(0, Math.floor(box.left / scale));
  const top = Math.max(0, Math.floor(box.top / scale));
  const right = Math.min(fullWidth, Math.ceil((box.left + box.width) / scale));
  const bottom = Math.min(fullHeight, Math.ceil((box.top + box.height) / scale));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function expandScanBox(box, fullWidth, fullHeight, padding) {
  const left = Math.max(0, box.left - padding);
  const top = Math.max(0, box.top - padding);
  const right = Math.min(fullWidth, box.left + box.width + padding);
  const bottom = Math.min(fullHeight, box.top + box.height + padding);
  return { left, top, width: right - left, height: bottom - top };
}

function marginFractions(box, width, height) {
  return {
    left: box.left / width,
    top: box.top / height,
    right: (width - box.left - box.width) / width,
    bottom: (height - box.top - box.height) / height,
  };
}

function areaRatio(box, width, height) {
  return (box.width * box.height) / (width * height);
}

function lumaAt(data, idx) {
  return 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
}

function saturationAt(data, idx) {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function ratio(samples, predicate) {
  if (!samples.length) return 0;
  let matches = 0;
  for (const sample of samples) {
    if (predicate(sample)) matches += 1;
  }
  return matches / samples.length;
}

function smoothArray(values, radius) {
  const output = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const next = index + offset;
      if (next < 0 || next >= values.length) continue;
      sum += values[next];
      count += 1;
    }
    output[index] = count ? sum / count : 0;
  }
  return output;
}

function isLocalPeak(values, index, start, end, radius) {
  const value = values[index];
  if (value <= 0) return false;
  for (let next = index - radius; next <= index + radius; next += 1) {
    if (next < start || next > end || next === index) continue;
    if (values[next] > value) return false;
  }
  return true;
}

async function writeContactSheet(rows, outputPath) {
  const selectedRows = rows.slice(0, options.contactSheetLimit);
  if (!selectedRows.length) return;

  const thumbWidth = 360;
  const thumbHeight = 360;
  const labelHeight = 46;
  const cellWidth = thumbWidth;
  const cellHeight = thumbHeight + labelHeight;
  const cells = [];

  for (const row of selectedRows) {
    cells.push(await contactCell(row.inputPath, null, `${basename(row.inputPath)} - original`));
    const proposedCrop = row.recommendedAction === 'crop' ? row.cropBox : null;
    const label =
      row.cropBox && row.recommendedAction === 'crop'
        ? `${basename(row.inputPath)} - proposed ${row.confidence}`
        : `${basename(row.inputPath)} - keep`;
    cells.push(await contactCell(row.inputPath, proposedCrop, label));
  }

  const sheetWidth = cellWidth * 2;
  const sheetHeight = cellHeight * selectedRows.length;
  mkdirSync(dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(
      cells.map((input, index) => ({
        input,
        left: (index % 2) * cellWidth,
        top: Math.floor(index / 2) * cellHeight,
      }))
    )
    .jpeg({ quality: 92 })
    .toFile(outputPath);
}

async function contactCell(file, cropBox, label) {
  let image = sharp(file, { limitInputPixels: false }).rotate();
  if (cropBox) image = image.extract(cropBox);
  const thumb = await image
    .resize({
      width: 360,
      height: 360,
      fit: 'contain',
      background: '#f4f4f4',
    })
    .png()
    .toBuffer();
  const escaped = escapeXml(label);
  const labelSvg = Buffer.from(
    `<svg width="360" height="46" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="12" y="28" font-family="Arial" font-size="14" fill="#fff">${escaped}</text></svg>`
  );
  return sharp({
    create: {
      width: 360,
      height: 406,
      channels: 3,
      background: '#f4f4f4',
    },
  })
    .composite([
      { input: labelSvg, left: 0, top: 0 },
      { input: thumb, left: 0, top: 46 },
    ])
    .png()
    .toBuffer();
}

async function writeOutput(file, outputPath, cropBox) {
  if (options.outputFormat === 'tiff') {
    const metadata = await sharp(file, { limitInputPixels: false }).metadata();
    if (metadata.depth === 'ushort' && canRunMagick()) {
      writeTiffWithMagick(file, outputPath, cropBox);
      return 'magick-16bit-lzw';
    }
    if (metadata.depth === 'ushort') {
      throw new Error('16-bit TIFF output requires ImageMagick `magick` in PATH');
    }
  }

  let pipeline = sharp(file, { limitInputPixels: false }).rotate();
  if (cropBox) {
    pipeline = pipeline.extract(cropBox);
  }
  if (options.outputFormat === 'source') {
    await pipeline.toFile(outputPath);
  } else {
    await pipeline.tiff({ compression: 'lzw', pyramid: false }).toFile(outputPath);
  }
  return options.outputFormat === 'source' ? 'sharp-source' : 'sharp-tiff-lzw';
}

function writeTiffWithMagick(file, outputPath, cropBox) {
  const magickArgs = [file, '-auto-orient'];
  if (cropBox) {
    magickArgs.push(
      '-crop',
      `${cropBox.width}x${cropBox.height}+${cropBox.left}+${cropBox.top}`,
      '+repage'
    );
  }
  magickArgs.push('-compress', 'LZW', outputPath);

  const result = spawnSync('magick', magickArgs, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        'ImageMagick TIFF writer failed',
        result.stderr?.trim(),
        result.stdout?.trim(),
      ]
        .filter(Boolean)
        .join(': ')
    );
  }
}

function canRunMagick() {
  if (canRunMagick.cached !== undefined) return canRunMagick.cached;
  const result = spawnSync('magick', ['-version'], { stdio: 'ignore' });
  canRunMagick.cached = result.status === 0;
  return canRunMagick.cached;
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

function parseInclude(value) {
  if (!value) return null;
  const names = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return names.length ? new Set(names) : null;
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

function roundObject(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, round(value)]));
}

function roundLine(line) {
  return {
    index: line.index,
    coverage: round(line.coverage),
    strength: round(line.strength),
    score: round(line.score),
  };
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function printHelp() {
  console.log(`Usage:
  node scripts/hcc-frame-crop-tiff.mjs --input-dir=/hcc/images --output-dir=/hcc/cropped --report=frame-report.jsonl --recursive --apply

Options:
  --input-dir=DIR          Folder containing source image files.
  --output-dir=DIR         Destination folder when --apply is set.
  --report=PATH            JSONL report path. Default: hcc-frame-crop-report.jsonl.
  --contact-sheet=PATH     Write a JPEG side-by-side original/proposed review sheet.
  --contact-sheet-limit=N  Max rows in the contact sheet. Default: 40.
  --include=LIST           Comma-separated basenames to scan.
  --extensions=LIST        Comma-separated extensions. Default: .tif,.tiff,.jpg,.jpeg,.png,.webp.
  --output-format=FMT      tiff or source. Default: tiff.
  --target=object|content|none
                           object keeps the mounted/scroll object and removes capture surround.
                           content uses inner-frame detection only. Default: object.
  --recursive              Recurse into subfolders.
  --limit=N                Limit files scanned.
  --apply                  Write outputs. Omit for scan-only dry run.
  --write-unchanged        With --apply, also write valid TIFFs for kept images.
  --force                  Write low-confidence proposed crops.
  --min-confidence=N       Default: 0.62.
  --max-scan-dim=N         Max dimension for analysis scan. Default: 1100.
  --line-inset-px=N        Inset detected inner frame lines in scan pixels. Default: 1.

16-bit TIFF sources are written through ImageMagick when --output-format=tiff
so HCC masters keep ushort/rgb16 depth instead of Sharp's 8-bit TIFF path.
`);
}
