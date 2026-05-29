const DEFAULTS = {
  saturationMin: 0.28,
  lumaMin: 28,
  lumaMax: 244,
  maxEdgeDistance: 0.28,
  minScore: 0.58,
};

export function detectColorCheckerTargets(input, detectorOptions = {}) {
  const options = { ...DEFAULTS, ...detectorOptions };
  const { data, width, height } = input;
  if (!data || !width || !height) return [];

  const mask = buildColorMask(data, width, height, options);
  const components = connectedComponents(mask, data, width, height).filter(
    (component) => isSwatchLike(component, width, height)
  );
  if (!components.length) return [];

  const clusters = clusterComponents(components, width, height);
  const targets = [];
  for (const cluster of clusters) {
    const target = scoreCluster(cluster, width, height, options);
    if (target && target.score >= options.minScore) {
      targets.push(target);
    }
  }

  return dedupeTargets(targets).sort((left, right) => right.score - left.score);
}

export function proposeCropExcludingTargets({
  width,
  height,
  candidateBox,
  checkerTargets = [],
  margin = 4,
}) {
  const crop = normalizeCrop(candidateBox, width, height);
  const original = { ...crop };
  const adjusted = new Set();

  for (const target of checkerTargets) {
    const targetBox = normalizeCrop(target.box, width, height);
    const edge = target.edge || nearestEdge(targetBox, width, height).edge;
    const targetRight = targetBox.left + targetBox.width;
    const targetBottom = targetBox.top + targetBox.height;
    const cropRight = crop.left + crop.width;
    const cropBottom = crop.top + crop.height;
    const intersects =
      targetBox.left < cropRight &&
      targetRight > crop.left &&
      targetBox.top < cropBottom &&
      targetBottom > crop.top;

    if (!intersects) continue;

    if (edge === 'top' && targetBottom < crop.top + crop.height * 0.62) {
      const nextTop = Math.max(crop.top, targetBottom + margin);
      crop.height = cropBottom - nextTop;
      crop.top = nextTop;
      adjusted.add('top');
    } else if (edge === 'bottom' && targetBox.top > crop.top + crop.height * 0.38) {
      const nextBottom = Math.min(cropBottom, targetBox.top - margin);
      crop.height = nextBottom - crop.top;
      adjusted.add('bottom');
    } else if (edge === 'left' && targetRight < crop.left + crop.width * 0.62) {
      const nextLeft = Math.max(crop.left, targetRight + margin);
      crop.width = cropRight - nextLeft;
      crop.left = nextLeft;
      adjusted.add('left');
    } else if (edge === 'right' && targetBox.left > crop.left + crop.width * 0.38) {
      const nextRight = Math.min(cropRight, targetBox.left - margin);
      crop.width = nextRight - crop.left;
      adjusted.add('right');
    }
  }

  const clipped = normalizeCrop(crop, width, height);
  const valid =
    clipped.width >= Math.max(32, width * 0.12) &&
    clipped.height >= Math.max(32, height * 0.12);
  if (!valid) {
    return {
      box: original,
      reason: 'candidate_box_kept_after_invalid_checker_exclusion',
      adjustedEdges: [],
    };
  }

  const adjustedEdges = [...adjusted];
  return {
    box: clipped,
    reason: adjustedEdges.length
      ? `candidate_box_excludes_${adjustedEdges.join('_')}_checker`
      : 'candidate_box',
    adjustedEdges,
  };
}

export function normalizeCrop(box, width, height) {
  if (!box) return { left: 0, top: 0, width, height };
  if (Array.isArray(box)) {
    const [x1, y1, x2, y2] = box;
    return normalizeCrop(
      { left: x1, top: y1, width: x2 - x1, height: y2 - y1 },
      width,
      height
    );
  }

  const left = clamp(Math.round(box.left ?? 0), 0, Math.max(0, width - 1));
  const top = clamp(Math.round(box.top ?? 0), 0, Math.max(0, height - 1));
  const right = clamp(
    Math.round((box.left ?? 0) + (box.width ?? width)),
    left + 1,
    width
  );
  const bottom = clamp(
    Math.round((box.top ?? 0) + (box.height ?? height)),
    top + 1,
    height
  );
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function buildColorMask(data, width, height, options) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    const r = data[offset] || 0;
    const g = data[offset + 1] || 0;
    const b = data[offset + 2] || 0;
    const hsv = rgbToHsv(r, g, b);
    const lum = luma(r, g, b);
    if (
      hsv.s >= options.saturationMin &&
      lum >= options.lumaMin &&
      lum <= options.lumaMax
    ) {
      mask[index] = 1;
    }
  }
  return mask;
}

function connectedComponents(mask, data, width, height) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  const stack = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;

    let count = 0;
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    let hueX = 0;
    let hueY = 0;
    let satSum = 0;
    let lumaSum = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      const offset = index * 3;
      const r = data[offset] || 0;
      const g = data[offset + 1] || 0;
      const b = data[offset + 2] || 0;
      const hsv = rgbToHsv(r, g, b);
      const radians = (hsv.h / 180) * Math.PI;

      count += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      hueX += Math.cos(radians);
      hueY += Math.sin(radians);
      satSum += hsv.s;
      lumaSum += luma(r, g, b);

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbors) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    let hue = (Math.atan2(hueY, hueX) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    components.push({
      count,
      box: {
        left,
        top,
        width: right - left + 1,
        height: bottom - top + 1,
      },
      center: {
        x: left + (right - left + 1) / 2,
        y: top + (bottom - top + 1) / 2,
      },
      hue,
      saturation: satSum / Math.max(1, count),
      luma: lumaSum / Math.max(1, count),
    });
  }

  return components;
}

function isSwatchLike(component, width, height) {
  const area = width * height;
  const componentArea = component.box.width * component.box.height;
  const minPixels = Math.max(4, Math.floor(area * 0.000035));
  const maxPixels = Math.max(80, Math.floor(area * 0.035));
  if (component.count < minPixels || component.count > maxPixels) return false;
  if (component.box.width < 2 || component.box.height < 2) return false;
  const aspect = component.box.width / Math.max(1, component.box.height);
  if (aspect < 0.18 || aspect > 5.5) return false;
  const fill = component.count / Math.max(1, componentArea);
  return fill >= 0.18;
}

function clusterComponents(components, width, height) {
  const visited = new Set();
  const clusters = [];
  const joinRadius = Math.max(4, Math.round(Math.min(width, height) * 0.035));

  for (let index = 0; index < components.length; index += 1) {
    if (visited.has(index)) continue;
    const queue = [index];
    const memberIndexes = [];
    visited.add(index);

    while (queue.length) {
      const current = queue.shift();
      memberIndexes.push(current);
      const currentBox = components[current].box;
      for (let next = 0; next < components.length; next += 1) {
        if (visited.has(next)) continue;
        if (boxesTouch(currentBox, components[next].box, joinRadius)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const members = memberIndexes.map((memberIndex) => components[memberIndex]);
    clusters.push({
      components: members,
      box: boundingBox(members.map((component) => component.box)),
    });
  }

  return clusters;
}

function scoreCluster(cluster, width, height, options) {
  const box = cluster.box;
  const swatchCount = cluster.components.length;
  const hueBins = new Set(
    cluster.components.map((component) => Math.floor(component.hue / 32))
  ).size;
  const areaRatio = (box.width * box.height) / (width * height);
  const aspect = box.width / Math.max(1, box.height);
  const edge = nearestEdge(box, width, height);
  const regularity = gridRegularity(cluster.components);

  if (swatchCount < 4 || hueBins < 3) return null;
  if (areaRatio < 0.0012 || areaRatio > 0.12) return null;
  if (aspect < 0.25 || aspect > 5.0) return null;
  if (edge.distance > options.maxEdgeDistance) return null;
  if (!regularity || regularity.score < 0.58) return null;

  const swatchScore = Math.min(1, swatchCount / 8) * 0.4;
  const hueScore = Math.min(1, hueBins / 5) * 0.25;
  const edgeScore = (1 - edge.distance / options.maxEdgeDistance) * 0.2;
  const shapeScore = aspect >= 0.45 && aspect <= 3.2 ? 0.1 : 0.03;
  const fillRatio =
    cluster.components.reduce((sum, component) => sum + component.count, 0) /
    Math.max(1, box.width * box.height);
  const fillScore = Math.min(0.05, fillRatio * 0.16);
  const score = swatchScore + hueScore + edgeScore + shapeScore + fillScore;

  return {
    box: {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    },
    score: round(score),
    edge: edge.edge,
    edgeDistance: round(edge.distance),
    swatchCount,
    hueBins,
    grid: regularity,
    areaRatio: round(areaRatio),
    aspect: round(aspect),
    fillRatio: round(fillRatio),
  };
}

function gridRegularity(components) {
  if (components.length < 4) return null;
  const widths = components.map((component) => component.box.width);
  const heights = components.map((component) => component.box.height);
  const areas = components.map(
    (component) => component.box.width * component.box.height
  );
  const medianWidth = median(widths);
  const medianHeight = median(heights);
  const medianArea = median(areas);
  const sizeConsistency =
    components.filter((component) => {
      const area = component.box.width * component.box.height;
      const widthRatio = component.box.width / Math.max(1, medianWidth);
      const heightRatio = component.box.height / Math.max(1, medianHeight);
      const areaRatio = area / Math.max(1, medianArea);
      return (
        widthRatio >= 0.42 &&
        widthRatio <= 2.4 &&
        heightRatio >= 0.42 &&
        heightRatio <= 2.4 &&
        areaRatio >= 0.25 &&
        areaRatio <= 3.2
      );
    }).length / components.length;

  if (sizeConsistency < 0.55) return null;

  const rows = groupPositions(
    components.map((component) => component.center.y),
    Math.max(3, medianHeight * 0.75)
  );
  const cols = groupPositions(
    components.map((component) => component.center.x),
    Math.max(3, medianWidth * 0.75)
  );

  if (rows.length < 2 || cols.length < 2) return null;
  if (rows.length > 7 || cols.length > 9) return null;

  const rowCounts = countsByGroup(components, rows, 'y');
  const colCounts = countsByGroup(components, cols, 'x');
  const hasStructuredRun =
    rowCounts.some((count) => count >= 3) || colCounts.some((count) => count >= 3);
  if (!hasStructuredRun) return null;

  const occupancy = components.length / Math.max(1, rows.length * cols.length);
  if (occupancy < 0.28 || occupancy > 1.25) return null;

  const rowScore = Math.min(1, rows.length / 3);
  const colScore = Math.min(1, cols.length / 4);
  const occupancyScore = 1 - Math.min(1, Math.abs(occupancy - 0.75) / 0.75);
  const score =
    sizeConsistency * 0.36 +
    rowScore * 0.18 +
    colScore * 0.2 +
    occupancyScore * 0.26;

  return {
    score: round(score),
    rows: rows.length,
    cols: cols.length,
    occupancy: round(occupancy),
    sizeConsistency: round(sizeConsistency),
  };
}

function groupPositions(values, tolerance) {
  const groups = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    const group = groups.find((candidate) => Math.abs(candidate.mean - value) <= tolerance);
    if (group) {
      group.values.push(value);
      group.mean =
        group.values.reduce((sum, item) => sum + item, 0) / group.values.length;
    } else {
      groups.push({ mean: value, values: [value] });
    }
  }
  return groups;
}

function countsByGroup(components, groups, axis) {
  return groups.map((group) => {
    const min = Math.min(...group.values);
    const max = Math.max(...group.values);
    return components.filter((component) => {
      const value = component.center[axis];
      return value >= min - 0.001 && value <= max + 0.001;
    }).length;
  });
}

function dedupeTargets(targets) {
  const kept = [];
  for (const target of targets) {
    const duplicate = kept.some(
      (other) => intersectionOverUnion(target.box, other.box) >= 0.55
    );
    if (!duplicate) kept.push(target);
  }
  return kept;
}

function nearestEdge(box, width, height) {
  const distances = [
    ['left', box.left / width],
    ['top', box.top / height],
    ['right', (width - box.left - box.width) / width],
    ['bottom', (height - box.top - box.height) / height],
  ];
  distances.sort((left, right) => left[1] - right[1]);
  return {
    edge: distances[0][0],
    distance: distances[0][1],
  };
}

function boxesTouch(left, right, margin) {
  return !(
    left.left + left.width + margin < right.left ||
    right.left + right.width + margin < left.left ||
    left.top + left.height + margin < right.top ||
    right.top + right.height + margin < left.top
  );
}

function boundingBox(boxes) {
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function intersectionOverUnion(left, right) {
  const x1 = Math.max(left.left, right.left);
  const y1 = Math.max(left.top, right.top);
  const x2 = Math.min(left.left + left.width, right.left + right.width);
  const y2 = Math.min(left.top + left.height, right.top + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  return intersection / Math.max(1, leftArea + rightArea - intersection);
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

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
