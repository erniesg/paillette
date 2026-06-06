import type { MetaFunction } from '@remix-run/cloudflare';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHUNG_CHENG_ROOTS_IMAGE_URL,
  CHUNG_CHENG_STATUE_MASK_IMAGE_URL,
} from '~/lib/featured-showcase';
import {
  buildZhongZhengAsciiParticles,
  buildZhongZhengDisintegrationFramePixels,
  buildZhongZhengMaskParticles,
  buildZhongZhengMatrixTextGlyphs,
  clipZhongZhengPixelsToMask,
  getZhongZhengSeededUnit,
  ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT,
} from '~/lib/zhongzheng-ascii';
import type { ZhongZhengPointerState } from '~/lib/zhongzheng-ascii';

export const meta: MetaFunction = () => [
  { title: 'Chung Cheng Disintegration Variants - Paillette' },
  {
    name: 'description',
    content:
      'Compare Chung Cheng sculpture disintegration animation variants from the recent thread.',
  },
];

const VARIANT_CANVAS_WIDTH = 420;
const POINTER_POINTS = [
  { id: 'shoulder', label: 'Shoulder', x: 57, y: 39 },
  { id: 'torso', label: 'Torso', x: 51, y: 61 },
  { id: 'base', label: 'Base', x: 49, y: 79 },
] as const;

type PointerPointId = (typeof POINTER_POINTS)[number]['id'];

type MaskState = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  sourcePixels: Uint8ClampedArray;
  noise: Uint8ClampedArray;
};

type VariantMode =
  | 'ascii'
  | 'exploding-dust'
  | 'overlay-words'
  | 'pixel'
  | 'atlas-pixel'
  | 'displaced-words'
  | 'legacy-matrix'
  | 'clear-source'
  | 'texture'
  | 'atlas-blob'
  | 'atlas-matrix'
  | 'current-matrix';

type VariantDefinition = {
  id: string;
  title: string;
  commit: string;
  mode: VariantMode;
  note: string;
  accent: 'cyan' | 'green' | 'pink' | 'amber';
};

const VARIANTS: VariantDefinition[] = [
  {
    id: 'ascii-text-sculpture',
    title: 'Full Word Sculpture',
    commit: 'adc83d01',
    mode: 'ascii',
    note: 'Text-only statue material morphing between 中正 and CHUNG CHENG.',
    accent: 'cyan',
  },
  {
    id: 'out-of-bounds-dust',
    title: 'Bad: Exploding Dust',
    commit: 'handoff 3:09pm',
    mode: 'exploding-dust',
    note: 'The bug called out in the handoff: statue-colored particles drift beyond the original silhouette.',
    accent: 'amber',
  },
  {
    id: 'overlay-no-dissolve',
    title: 'Bad: Words On Top',
    commit: 'pre-2b5f091a',
    mode: 'overlay-words',
    note: 'The words appear, but the statue pixels underneath do not actually disappear.',
    accent: 'amber',
  },
  {
    id: 'bounded-pixel-clear',
    title: 'Bounded Pixel Clear',
    commit: '11be7700',
    mode: 'pixel',
    note: 'The sculpture itself erases under the cursor, fully clipped by the mask.',
    accent: 'amber',
  },
  {
    id: 'static-artwork-atlas',
    title: 'Static Artwork Atlas',
    commit: 'worktree atlas pass',
    mode: 'atlas-pixel',
    note: 'The first bounded correction: static sculpture material made from an artwork atlas, with local pixel dissolve.',
    accent: 'cyan',
  },
  {
    id: 'hero-displaced-words',
    title: 'Hero Displaced Words',
    commit: '0e8685bc',
    mode: 'displaced-words',
    note: 'Single hero only; glyph particles break away from source samples inside the statue.',
    accent: 'green',
  },
  {
    id: 'artwork-atlas-glyphs',
    title: 'Artwork Atlas Glyphs',
    commit: 'fd9c66a7',
    mode: 'texture',
    note: 'Hidden artwork material colors the 中正 / CHUNG CHENG particles; no side works render.',
    accent: 'pink',
  },
  {
    id: 'atlas-too-dense',
    title: 'Atlas Too Dense',
    commit: 'thread iteration',
    mode: 'atlas-blob',
    note: 'The intermediate pass where larger/brighter artwork-tinted glyphs became a glowing patch.',
    accent: 'pink',
  },
  {
    id: 'atlas-matrix-columns',
    title: 'Atlas Matrix Columns',
    commit: 'fd9c66a7 final',
    mode: 'atlas-matrix',
    note: 'Column/trail Matrix motion, Chinese-to-English morph, artwork-tinted, still clipped.',
    accent: 'green',
  },
  {
    id: 'bounded-pink-restore',
    title: 'Bounded Pink/Mint Restore',
    commit: 'eb18e89c',
    mode: 'legacy-matrix',
    note: 'Restored the liked pink/mint text stream after the atlas pass felt too muted.',
    accent: 'pink',
  },
  {
    id: 'source-clearing-words',
    title: 'Source Clears Into Words',
    commit: '2b5f091a',
    mode: 'clear-source',
    note: 'The local statue core actually drops out before the word particles draw.',
    accent: 'pink',
  },
  {
    id: 'current-matrix-rain',
    title: 'Current Matrix Rain',
    commit: 'd454ca5c',
    mode: 'current-matrix',
    note: 'Denser downward rain, live Chinese-English mixing, clamped inside the statue.',
    accent: 'green',
  },
];

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getMorphAmount = (elapsedMs: number, cycleMs = 7200) => {
  const phase = (((elapsedMs % cycleMs) + cycleMs) % cycleMs) / cycleMs;
  return phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
};

const mixChannel = (from: number, to: number, amount: number) =>
  Math.round(clampNumber(from + (to - from) * amount, 0, 255));

const mixRgb = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number
) =>
  `${mixChannel(from[0], to[0], amount)} ${mixChannel(
    from[1],
    to[1],
    amount
  )} ${mixChannel(from[2], to[2], amount)}`;

const getMaskAlphaAt = (
  alpha: Uint8ClampedArray | number[],
  width: number,
  height: number,
  x: number,
  y: number
) => {
  const sampleX = Math.round(x);
  const sampleY = Math.round(y);

  if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
    return 0;
  }

  return alpha[sampleY * width + sampleX] || 0;
};

const clampPointToMask = (
  state: MaskState,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
) => {
  if (
    getMaskAlphaAt(state.alpha, state.width, state.height, targetX, targetY) >=
    38
  ) {
    return { x: targetX, y: targetY };
  }

  for (const amount of [0.82, 0.66, 0.5, 0.34, 0.18]) {
    const x = sourceX + (targetX - sourceX) * amount;
    const y = sourceY + (targetY - sourceY) * amount;

    if (getMaskAlphaAt(state.alpha, state.width, state.height, x, y) >= 38) {
      return { x, y };
    }
  }

  return { x: sourceX, y: sourceY };
};

const getDominantAlphaComponent = (
  alpha: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const visited = new Uint8Array(width * height);
  const componentIds = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const weights: number[] = [];
  const minAlpha = 34;
  let componentId = 0;

  componentIds.fill(-1);

  for (let index = 0; index < alpha.length; index += 1) {
    if (visited[index] || (alpha[index] || 0) < minAlpha) continue;

    let head = 0;
    let tail = 0;
    let weight = 0;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;

    while (head < tail) {
      const current = queue[head] || 0;
      head += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ];

      componentIds[current] = componentId;
      weight += alpha[current] || 0;

      neighbors.forEach((neighbor) => {
        if (
          neighbor >= 0 &&
          !visited[neighbor] &&
          (alpha[neighbor] || 0) >= minAlpha
        ) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      });
    }

    weights[componentId] = weight;
    componentId += 1;
  }

  const dominant = weights.reduce(
    (strongest, weight, index) =>
      weight > strongest.weight ? { id: index, weight } : strongest,
    { id: -1, weight: 0 }
  );

  return { componentIds, dominantComponentId: dominant.id };
};

const extractMaskFromImage = (image: HTMLImageElement): MaskState | null => {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return null;

  const width = VARIANT_CANVAS_WIDTH;
  const height = Math.round((width * naturalHeight) / naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const rawAlpha = new Uint8ClampedArray(width * height);

  for (let index = 0; index < rawAlpha.length; index += 1) {
    const dataIndex = index * 4;
    const red = imageData.data[dataIndex] || 0;
    const green = imageData.data[dataIndex + 1] || 0;
    const blue = imageData.data[dataIndex + 2] || 0;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const ink = clampNumber((248 - luma) / 78, 0, 1);
    rawAlpha[index] =
      ink < 0.09 ? 0 : Math.round(clampNumber(ink * 1.32, 0, 1) * 255);
  }

  const { componentIds, dominantComponentId } = getDominantAlphaComponent(
    rawAlpha,
    width,
    height
  );
  if (dominantComponentId < 0) return null;

  const alpha = new Uint8ClampedArray(width * height);
  const sourcePixels = new Uint8ClampedArray(width * height * 4);
  const noise = new Uint8ClampedArray(width * height);

  for (let index = 0; index < alpha.length; index += 1) {
    const dataIndex = index * 4;
    const currentAlpha =
      componentIds[index] === dominantComponentId ? rawAlpha[index] || 0 : 0;
    const left = index % width > 0 ? rawAlpha[index - 1] || 0 : currentAlpha;
    const right =
      index % width < width - 1 ? rawAlpha[index + 1] || 0 : currentAlpha;
    const top = index >= width ? rawAlpha[index - width] || 0 : currentAlpha;
    const bottom =
      index < alpha.length - width
        ? rawAlpha[index + width] || 0
        : currentAlpha;
    const softenedAlpha = Math.round(
      currentAlpha * 0.78 + ((left + right + top + bottom) / 4) * 0.22
    );
    const maskAlpha = currentAlpha > 0 ? softenedAlpha : 0;
    const textureNoise = getZhongZhengSeededUnit(index + maskAlpha * 17);
    const alphaWeight = maskAlpha / 255;

    alpha[index] = maskAlpha;
    noise[index] = Math.round(textureNoise * 255);

    if (maskAlpha <= 0) {
      sourcePixels[dataIndex + 3] = 0;
      continue;
    }

    sourcePixels[dataIndex] = Math.round(
      clampNumber(
        (imageData.data[dataIndex] || 0) * (0.9 + alphaWeight * 0.08) +
          textureNoise * 8,
        0,
        255
      )
    );
    sourcePixels[dataIndex + 1] = Math.round(
      clampNumber(
        (imageData.data[dataIndex + 1] || 0) * (0.9 + alphaWeight * 0.08) +
          getZhongZhengSeededUnit(index * 3 + 19) * 8,
        0,
        255
      )
    );
    sourcePixels[dataIndex + 2] = Math.round(
      clampNumber(
        (imageData.data[dataIndex + 2] || 0) * (0.9 + alphaWeight * 0.08) +
          getZhongZhengSeededUnit(index * 5 + 31) * 8,
        0,
        255
      )
    );
    sourcePixels[dataIndex + 3] = maskAlpha;
  }

  return { width, height, alpha, sourcePixels, noise };
};

const loadMaskImage = () =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load Chung Cheng mask'));
    image.src = CHUNG_CHENG_STATUE_MASK_IMAGE_URL;
  });

const putPixels = (
  context: CanvasRenderingContext2D,
  pixels: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const imageData = context.createImageData(width, height);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);
};

const applyMask = (context: CanvasRenderingContext2D, state: MaskState) => {
  const maskPixels = new Uint8ClampedArray(state.width * state.height * 4);

  for (let index = 0; index < state.alpha.length; index += 1) {
    const dataIndex = index * 4;
    maskPixels[dataIndex] = 255;
    maskPixels[dataIndex + 1] = 255;
    maskPixels[dataIndex + 2] = 255;
    maskPixels[dataIndex + 3] = state.alpha[index] || 0;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = state.width;
  maskCanvas.height = state.height;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) return;

  const maskData = maskContext.createImageData(state.width, state.height);
  maskData.data.set(maskPixels);
  maskContext.putImageData(maskData, 0, 0);

  context.save();
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskCanvas, 0, 0);
  context.restore();
};

const getPointer = (
  state: MaskState,
  point: (typeof POINTER_POINTS)[number]
): ZhongZhengPointerState => {
  const centerX = Math.round((point.x / 100) * (state.width - 1));
  const centerY = Math.round((point.y / 100) * (state.height - 1));
  let strongestHit = { alpha: 0, distance: Number.POSITIVE_INFINITY, x: centerX, y: centerY };

  for (let offsetY = -10; offsetY <= 10; offsetY += 2) {
    for (let offsetX = -10; offsetX <= 10; offsetX += 2) {
      const x = Math.max(0, Math.min(state.width - 1, centerX + offsetX));
      const y = Math.max(0, Math.min(state.height - 1, centerY + offsetY));
      const alpha = state.alpha[y * state.width + x] || 0;
      const distance = offsetX ** 2 + offsetY ** 2;

      if (
        alpha > strongestHit.alpha ||
        (alpha === strongestHit.alpha && distance < strongestHit.distance)
      ) {
        strongestHit = { alpha, distance, x, y };
      }
    }
  }

  return {
    x: (strongestHit.x / Math.max(1, state.width - 1)) * 100,
    y: (strongestHit.y / Math.max(1, state.height - 1)) * 100,
    active: strongestHit.alpha >= 38,
    activeSinceMs: 0,
  };
};

const drawStatueBase = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  alpha = 1
) => {
  context.save();
  context.globalAlpha = alpha;
  putPixels(context, state.sourcePixels, state.width, state.height);
  context.restore();
};

const drawPixelDissolve = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  progress: number,
  clearBias = 1
) => {
  const pixels = buildZhongZhengDisintegrationFramePixels({
    width: state.width,
    height: state.height,
    alpha: state.alpha,
    sourcePixels: state.sourcePixels,
    noise: state.noise,
    pointer,
    progress: clampNumber(progress * clearBias, 0, 1),
    radiusPercent: ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT * clearBias,
    featherPercent: 6.4,
  });
  const clipped = clipZhongZhengPixelsToMask(pixels, state.alpha, 0.99);
  putPixels(context, clipped, state.width, state.height);
};

const drawExplodingDust = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawStatueBase(context, state, 0.88);
  if (!pointer.active) return;

  const pointerX = (pointer.x / 100) * Math.max(1, state.width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, state.height - 1);
  const radius = Math.min(state.width, state.height) * 0.18;

  context.save();
  for (let index = 0; index < 760; index += 1) {
    const seed = index * 83 + 19;
    const angle = getZhongZhengSeededUnit(seed) * Math.PI * 2;
    const sourceDistance = radius * Math.sqrt(getZhongZhengSeededUnit(seed + 3));
    const sourceX = pointerX + Math.cos(angle) * sourceDistance;
    const sourceY = pointerY + Math.sin(angle) * sourceDistance * 0.9;
    const maskAlpha = getMaskAlphaAt(
      state.alpha,
      state.width,
      state.height,
      sourceX,
      sourceY
    );
    if (maskAlpha < 42) continue;

    const drift =
      progress *
      (18 + getZhongZhengSeededUnit(seed + 11) * 72 + Math.sin(elapsedMs * 0.001 + seed) * 7);
    const targetX = sourceX + Math.cos(angle) * drift;
    const targetY = sourceY + Math.sin(angle) * drift * 0.62;
    const dataIndex =
      (Math.round(sourceY) * state.width + Math.round(sourceX)) * 4;
    const size = 1.2 + getZhongZhengSeededUnit(seed + 23) * 3.2;

    context.beginPath();
    context.globalAlpha = (0.14 + (maskAlpha / 255) * 0.52) * progress;
    context.fillStyle = `rgb(${state.sourcePixels[dataIndex] || 170} ${
      state.sourcePixels[dataIndex + 1] || 160
    } ${state.sourcePixels[dataIndex + 2] || 135})`;
    context.arc(targetX, targetY, size, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
};

const drawFullWordSculpture = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  elapsedMs: number
) => {
  drawStatueBase(context, state, 0.16);
  const morph = getMorphAmount(elapsedMs);
  const particles = buildZhongZhengMaskParticles({
    width: state.width,
    height: state.height,
    alpha: state.alpha,
    columns: 42,
    rows: 72,
    maxParticles: 560,
  });

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  particles.forEach((particle, index) => {
    const wave = elapsedMs * 0.0012 + particle.phase * 0.017;
    const token = getZhongZhengSeededUnit(index + Math.floor(elapsedMs / 520)) < morph
      ? particle.en
      : particle.zh;
    const x =
      (particle.x / 100) * state.width + Math.sin(wave) * (1.6 + particle.z * 0.03);
    const y =
      (particle.y / 100) * state.height + Math.cos(wave * 0.86) * (1.4 + particle.z * 0.02);
    const isLatin = token.length > 1;
    const rgb = mixRgb([165, 243, 252], [251, 207, 232], morph);
    const fontSize = (isLatin ? 5.8 : 9.4) * particle.scale;

    context.font = `700 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
    context.shadowBlur = 8;
    context.shadowColor = `rgb(${rgb} / ${0.14 + particle.shade * 0.26})`;
    context.fillStyle = `rgb(${rgb} / ${0.22 + particle.shade * 0.56})`;
    context.fillText(token, x, y);
  });
  context.restore();
  applyMask(context, state);
};

type LegacyGlyph = {
  x: number;
  y: number;
  token: '中' | '正' | 'CHUNG' | 'CHENG';
  opacity: number;
  scale: number;
  isLead: boolean;
  morph: number;
  trailIndex: number;
};

const buildLegacyGlyphs = (
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  if (!pointer.active) return [];

  const pointerX = (pointer.x / 100) * Math.max(1, state.width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, state.height - 1);
  const radius =
    (Math.min(state.width, state.height) *
      ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT *
      1.08) /
    100;
  const fontSize = Math.max(9.5, Math.min(15, state.width * 0.021));
  const streamCount = 48;
  const trailLength = 5;
  const horizontalSpan = radius * 2.08;
  const verticalSpan = radius * 2.18;
  const fallCycle = verticalSpan + fontSize * trailLength * 1.35;
  const morph = getMorphAmount(elapsedMs);
  const glyphs: LegacyGlyph[] = [];

  for (let streamId = 0; streamId < streamCount; streamId += 1) {
    const streamUnit = streamId / Math.max(1, streamCount - 1);
    const streamSeed = getZhongZhengSeededUnit(streamId * 53 + 11);
    const x =
      pointerX -
      horizontalSpan / 2 +
      streamUnit * horizontalSpan +
      (streamSeed - 0.5) * fontSize * 1.4;
    const fall =
      (elapsedMs * (0.0065 + streamSeed * 0.0045) +
        streamSeed * fallCycle) %
      fallCycle;
    const headY = pointerY - verticalSpan / 2 + fall;

    for (let trailIndex = 0; trailIndex < trailLength; trailIndex += 1) {
      const sourceY = headY - trailIndex * fontSize * 1.28;
      if (x < 0 || x >= state.width || sourceY < 0 || sourceY >= state.height) {
        continue;
      }

      const maskAlpha = getMaskAlphaAt(
        state.alpha,
        state.width,
        state.height,
        x,
        sourceY
      );
      if (maskAlpha < 38) continue;

      const distance = Math.sqrt((x - pointerX) ** 2 + (sourceY - pointerY) ** 2);
      const localInfluence = clampNumber(
        (radius * 1.2 - distance) / Math.max(1, radius * 1.2),
        0,
        1
      );
      if (localInfluence <= 0) continue;

      const particleSeed =
        streamId * 157 +
        trailIndex * 61 +
        Math.round(pointerX) * 17 +
        Math.round(pointerY) * 13;
      const scatterAngle = getZhongZhengSeededUnit(particleSeed) * Math.PI * 2;
      const scatterDistance =
        fontSize *
        (0.52 + getZhongZhengSeededUnit(particleSeed + 29) * 2.7) *
        localInfluence *
        progress;
      const targetX = x + Math.cos(scatterAngle) * scatterDistance;
      const targetY =
        sourceY +
        Math.sin(scatterAngle) *
          scatterDistance *
          (0.72 + getZhongZhengSeededUnit(particleSeed + 43) * 0.46);
      const particle = clampPointToMask(state, x, sourceY, targetX, targetY);
      const tokenIndex = Math.abs(streamId + trailIndex) % 2;
      const usesLatin = morph >= 0.5;

      glyphs.push({
        x: particle.x,
        y: particle.y,
        token: usesLatin
          ? tokenIndex === 0
            ? 'CHUNG'
            : 'CHENG'
          : tokenIndex === 0
            ? '中'
            : '正',
        opacity:
          progress *
          localInfluence *
          (trailIndex === 0 ? 0.92 : Math.max(0.14, 1 - trailIndex * 0.2) * 0.52) *
          (maskAlpha / 255),
        scale: trailIndex === 0 ? 1.08 : Math.max(0.72, 1 - trailIndex * 0.07),
        isLead: trailIndex === 0,
        morph,
        trailIndex,
      });
    }
  }

  return glyphs;
};

const drawGlyphs = (
  context: CanvasRenderingContext2D,
  glyphs: LegacyGlyph[],
  baseFontSize: number,
  palette: 'green' | 'pink'
) => {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  glyphs.forEach((glyph) => {
    const fillRgb =
      palette === 'pink'
        ? mixRgb([226, 255, 232], [255, 199, 225], glyph.morph)
        : glyph.isLead
          ? '226 255 232'
          : '88 255 173';
    const shadowRgb =
      palette === 'pink'
        ? mixRgb([97, 255, 174], [244, 114, 182], glyph.morph)
        : '97 255 174';
    const fontSize = baseFontSize * glyph.scale;

    context.font = `${glyph.isLead ? 700 : 600} ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
    context.shadowBlur = glyph.isLead ? 11 : 4;
    context.shadowColor = `rgb(${shadowRgb} / ${Math.min(
      0.64,
      glyph.opacity * 0.78
    ).toFixed(3)})`;
    context.fillStyle = `rgb(${fillRgb} / ${Math.min(
      0.94,
      glyph.opacity
    ).toFixed(3)})`;
    context.fillText(glyph.token, glyph.x, glyph.y);
  });
  context.restore();
};

const drawOverlayWords = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawStatueBase(context, state, 0.96);
  const glyphs = buildLegacyGlyphs(state, pointer, elapsedMs, progress);
  drawGlyphs(context, glyphs, Math.max(10, Math.min(16, state.width * 0.023)), 'pink');
  applyMask(context, state);
};

const drawLegacyMatrix = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number,
  clearBias = 1,
  palette: 'green' | 'pink' = 'green'
) => {
  drawPixelDissolve(context, state, pointer, progress, clearBias);
  const glyphs = buildLegacyGlyphs(state, pointer, elapsedMs, progress);
  drawGlyphs(context, glyphs, Math.max(9.5, Math.min(15, state.width * 0.021)), palette);
  applyMask(context, state);
};

const drawCurrentMatrix = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawPixelDissolve(context, state, pointer, progress, 1);
  const radiusPixels =
    (Math.min(state.width, state.height) *
      ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT) /
    100;
  const fontSize = Math.max(8.5, Math.min(13.5, state.width * 0.0215));
  const glyphs = buildZhongZhengMatrixTextGlyphs({
    width: state.width,
    height: state.height,
    alpha: state.alpha,
    pointer,
    progress,
    elapsedMs,
    radiusPixels: radiusPixels * 1.18,
    fontSize,
    streamCount: 88,
    trailLength: 8,
  });

  drawGlyphs(context, glyphs, fontSize, 'pink');
  applyMask(context, state);
};

const drawTextureTiles = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawPixelDissolve(context, state, pointer, progress, 1.06);
  if (!pointer.active) return;

  const pointerX = (pointer.x / 100) * Math.max(1, state.width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, state.height - 1);
  const radius = Math.min(state.width, state.height) * 0.145;
  const morph = getMorphAmount(elapsedMs);

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let index = 0; index < 480; index += 1) {
    const seed = index * 101 + 37;
    const angle = getZhongZhengSeededUnit(seed) * Math.PI * 2;
    const distance = radius * Math.sqrt(getZhongZhengSeededUnit(seed + 11));
    const sourceX = pointerX + Math.cos(angle) * distance;
    const sourceY = pointerY + Math.sin(angle) * distance * 1.08;
    const maskAlpha = getMaskAlphaAt(
      state.alpha,
      state.width,
      state.height,
      sourceX,
      sourceY
    );
    if (maskAlpha < 46) continue;

    const dataIndex =
      (Math.round(sourceY) * state.width + Math.round(sourceX)) * 4;
    const scatter = progress * (2.4 + getZhongZhengSeededUnit(seed + 23) * 8.5);
    const float = Math.sin(elapsedMs * 0.002 + seed) * 2.2;
    const target = clampPointToMask(
      state,
      sourceX,
      sourceY,
      sourceX + Math.cos(angle) * scatter,
      sourceY + Math.sin(angle) * scatter * 0.58 + float
    );
    const red = state.sourcePixels[dataIndex] || 180;
    const green = state.sourcePixels[dataIndex + 1] || 174;
    const blue = state.sourcePixels[dataIndex + 2] || 150;
    const size = 2.2 + getZhongZhengSeededUnit(seed + 31) * 4.8;
    const token =
      getZhongZhengSeededUnit(seed + Math.floor(elapsedMs / 460)) < morph
        ? index % 2 === 0
          ? 'CHUNG'
          : 'CHENG'
        : index % 2 === 0
          ? '中'
          : '正';

    context.save();
    context.translate(target.x, target.y);
    context.rotate((getZhongZhengSeededUnit(seed + 43) - 0.5) * progress * 1.2);
    context.globalAlpha = (0.24 + (maskAlpha / 255) * 0.54) * progress;
    context.fillStyle = `rgb(${red} ${green} ${blue})`;
    context.fillRect(-size / 2, -size / 2, size, size);
    context.restore();

    if (index % 6 === 0) {
      context.font = `700 ${token.length > 1 ? 5.5 : 8.5}px "IBM Plex Mono", ui-monospace, monospace`;
      context.shadowBlur = 7;
      context.shadowColor = `rgb(244 114 182 / ${0.2 + progress * 0.32})`;
      context.fillStyle = `rgb(${mixRgb(
        [226, 255, 232],
        [255, 199, 225],
        morph
      )} / ${0.24 + progress * 0.45})`;
      context.fillText(token, target.x, target.y);
    }
  }
  context.restore();
  applyMask(context, state);
};

const ATLAS_PALETTE = [
  [244, 114, 182],
  [125, 211, 252],
  [134, 239, 172],
  [251, 191, 36],
  [196, 181, 253],
  [248, 250, 252],
] as const;

const getAtlasRgb = (seed: number, morph: number) => {
  const from =
    ATLAS_PALETTE[Math.floor(getZhongZhengSeededUnit(seed) * ATLAS_PALETTE.length)] ||
    ATLAS_PALETTE[0];
  const to =
    ATLAS_PALETTE[
      Math.floor(getZhongZhengSeededUnit(seed + 41) * ATLAS_PALETTE.length)
    ] || ATLAS_PALETTE[1];

  return mixRgb(from, to, morph);
};

const drawMaskedAtlasMosaic = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  elapsedMs: number,
  alpha = 0.86
) => {
  const morph = getMorphAmount(elapsedMs, 9000);
  const tileSize = Math.max(14, Math.round(state.width / 22));

  context.save();
  context.globalAlpha = alpha;
  for (let y = -tileSize; y < state.height + tileSize; y += tileSize) {
    for (let x = -tileSize; x < state.width + tileSize; x += tileSize) {
      const tileX = Math.round(x / tileSize);
      const tileY = Math.round(y / tileSize);
      const seed = tileX * 97 + tileY * 131;
      const jitterX = (getZhongZhengSeededUnit(seed + 7) - 0.5) * tileSize * 0.32;
      const jitterY = (getZhongZhengSeededUnit(seed + 13) - 0.5) * tileSize * 0.32;
      const width = tileSize * (0.78 + getZhongZhengSeededUnit(seed + 19) * 0.5);
      const height = tileSize * (0.78 + getZhongZhengSeededUnit(seed + 23) * 0.5);

      context.fillStyle = `rgb(${getAtlasRgb(seed, morph)} / ${
        0.28 + getZhongZhengSeededUnit(seed + 29) * 0.34
      })`;
      context.fillRect(x + jitterX, y + jitterY, width, height);
    }
  }
  context.restore();
  applyMask(context, state);
};

const drawAtlasPixelDissolve = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawStatueBase(context, state, 0.16);
  drawMaskedAtlasMosaic(context, state, elapsedMs, 0.9);
  if (!pointer.active) return;

  const pointerX = (pointer.x / 100) * Math.max(1, state.width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, state.height - 1);
  const radius = Math.min(state.width, state.height) * 0.16;
  const morph = getMorphAmount(elapsedMs, 9000);

  context.save();
  context.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < 420; index += 1) {
    const seed = index * 67 + 31;
    const angle = getZhongZhengSeededUnit(seed) * Math.PI * 2;
    const distance = radius * Math.sqrt(getZhongZhengSeededUnit(seed + 5));
    const sourceX = pointerX + Math.cos(angle) * distance;
    const sourceY = pointerY + Math.sin(angle) * distance * 1.08;
    const maskAlpha = getMaskAlphaAt(
      state.alpha,
      state.width,
      state.height,
      sourceX,
      sourceY
    );
    if (maskAlpha < 44) continue;

    const size = 1.6 + getZhongZhengSeededUnit(seed + 17) * 5.6;
    context.globalAlpha = progress * (0.16 + (maskAlpha / 255) * 0.72);
    context.beginPath();
    context.arc(sourceX, sourceY, size, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  for (let index = 0; index < 360; index += 1) {
    const seed = index * 89 + 47;
    const angle = getZhongZhengSeededUnit(seed) * Math.PI * 2;
    const distance = radius * Math.sqrt(getZhongZhengSeededUnit(seed + 11));
    const sourceX = pointerX + Math.cos(angle) * distance;
    const sourceY = pointerY + Math.sin(angle) * distance * 1.04;
    const maskAlpha = getMaskAlphaAt(
      state.alpha,
      state.width,
      state.height,
      sourceX,
      sourceY
    );
    if (maskAlpha < 44) continue;

    const scatter = progress * (1.8 + getZhongZhengSeededUnit(seed + 19) * 8.4);
    const target = clampPointToMask(
      state,
      sourceX,
      sourceY,
      sourceX + Math.cos(angle) * scatter,
      sourceY + Math.sin(angle) * scatter * 0.52
    );
    const size = 1.2 + getZhongZhengSeededUnit(seed + 31) * 3.6;

    context.save();
    context.translate(target.x, target.y);
    context.rotate((getZhongZhengSeededUnit(seed + 37) - 0.5) * 0.9);
    context.globalAlpha = progress * (0.18 + (maskAlpha / 255) * 0.54);
    context.fillStyle = `rgb(${getAtlasRgb(seed, morph)})`;
    context.fillRect(-size / 2, -size / 2, size * 1.34, size);
    context.restore();
  }
  context.restore();
  applyMask(context, state);
};

const drawAtlasBlob = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawPixelDissolve(context, state, pointer, progress, 1.12);
  if (!pointer.active) return;

  const pointerX = (pointer.x / 100) * Math.max(1, state.width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, state.height - 1);
  const morph = getMorphAmount(elapsedMs);
  const radius = Math.min(state.width, state.height) * 0.16;

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let index = 0; index < 650; index += 1) {
    const seed = index * 109 + 61;
    const angle = getZhongZhengSeededUnit(seed) * Math.PI * 2;
    const distance = radius * Math.sqrt(getZhongZhengSeededUnit(seed + 7));
    const sourceX = pointerX + Math.cos(angle) * distance;
    const sourceY = pointerY + Math.sin(angle) * distance;
    const maskAlpha = getMaskAlphaAt(
      state.alpha,
      state.width,
      state.height,
      sourceX,
      sourceY
    );
    if (maskAlpha < 44) continue;

    const floatX = Math.sin(elapsedMs * 0.002 + seed) * 4.5 * progress;
    const floatY = Math.cos(elapsedMs * 0.0017 + seed) * 3.5 * progress;
    const target = clampPointToMask(
      state,
      sourceX,
      sourceY,
      sourceX + floatX,
      sourceY + floatY
    );
    const token =
      getZhongZhengSeededUnit(seed + Math.floor(elapsedMs / 400)) < morph
        ? index % 2 === 0
          ? 'CHUNG'
          : 'CHENG'
        : index % 2 === 0
          ? '中'
          : '正';

    context.font = `800 ${token.length > 1 ? 7.5 : 13.5}px "IBM Plex Mono", ui-monospace, monospace`;
    context.shadowBlur = 16;
    context.shadowColor = `rgb(${getAtlasRgb(seed + 13, morph)} / ${0.22 + progress * 0.45})`;
    context.fillStyle = `rgb(${getAtlasRgb(seed, morph)} / ${0.2 + (maskAlpha / 255) * 0.58})`;
    context.fillText(token, target.x, target.y);
  }
  context.restore();
  applyMask(context, state);
};

const drawAtlasMatrixColumns = (
  context: CanvasRenderingContext2D,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number,
  progress: number
) => {
  drawPixelDissolve(context, state, pointer, progress, 1.06);
  const glyphs = buildLegacyGlyphs(state, pointer, elapsedMs, progress);
  const fontSize = Math.max(10.5, Math.min(16, state.width * 0.024));

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  glyphs.forEach((glyph) => {
    const seed = glyph.x * 3.1 + glyph.y * 7.7 + glyph.trailIndex * 13;
    const rgb = getAtlasRgb(seed, glyph.morph);
    const shadowRgb = mixRgb([97, 255, 174], [244, 114, 182], glyph.morph);
    const glyphFontSize = fontSize * (glyph.token.length > 1 ? 0.74 : 1.06) * glyph.scale;

    context.font = `${glyph.isLead ? 800 : 700} ${glyphFontSize}px "IBM Plex Mono", ui-monospace, monospace`;
    context.shadowBlur = glyph.isLead ? 12 : 5;
    context.shadowColor = `rgb(${shadowRgb} / ${Math.min(0.62, glyph.opacity)})`;
    context.fillStyle = `rgb(${rgb} / ${Math.min(0.96, glyph.opacity * 1.08)})`;
    context.fillText(glyph.token, glyph.x, glyph.y);
  });
  context.restore();
  applyMask(context, state);
};

const drawVariant = (
  canvas: HTMLCanvasElement,
  variant: VariantDefinition,
  state: MaskState,
  pointer: ZhongZhengPointerState,
  elapsedMs: number
) => {
  if (canvas.width !== state.width) canvas.width = state.width;
  if (canvas.height !== state.height) canvas.height = state.height;

  const context = canvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  const pulse = 0.72 + Math.sin(elapsedMs * 0.0017) * 0.14;
  const progress = clampNumber(pulse, 0, 1);

  if (variant.mode === 'ascii') {
    drawFullWordSculpture(context, state, elapsedMs);
    return;
  }

  if (variant.mode === 'exploding-dust') {
    drawExplodingDust(context, state, pointer, elapsedMs, progress);
    return;
  }

  if (variant.mode === 'overlay-words') {
    drawOverlayWords(context, state, pointer, elapsedMs, progress);
    return;
  }

  if (variant.mode === 'pixel') {
    drawPixelDissolve(context, state, pointer, progress, 0.98);
    return;
  }

  if (variant.mode === 'atlas-pixel') {
    drawAtlasPixelDissolve(context, state, pointer, elapsedMs, progress);
    return;
  }

  if (variant.mode === 'displaced-words') {
    drawLegacyMatrix(context, state, pointer, elapsedMs, progress, 1.04);
    return;
  }

  if (variant.mode === 'legacy-matrix') {
    drawLegacyMatrix(context, state, pointer, elapsedMs, progress, 1, 'pink');
    return;
  }

  if (variant.mode === 'clear-source') {
    drawLegacyMatrix(context, state, pointer, elapsedMs, progress, 1.24, 'pink');
    return;
  }

  if (variant.mode === 'texture') {
    drawTextureTiles(context, state, pointer, elapsedMs, progress);
    return;
  }

  if (variant.mode === 'atlas-blob') {
    drawAtlasBlob(context, state, pointer, elapsedMs, progress);
    return;
  }

  if (variant.mode === 'atlas-matrix') {
    drawAtlasMatrixColumns(context, state, pointer, elapsedMs, progress);
    return;
  }

  drawCurrentMatrix(context, state, pointer, elapsedMs, progress);
};

export default function ChungChengDisintegrationVariants() {
  const [maskState, setMaskState] = useState<MaskState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointId, setPointId] = useState<PointerPointId>('torso');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const fallbackParticles = useMemo(() => buildZhongZhengAsciiParticles(), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const image = await loadMaskImage();
        const extracted = extractMaskFromImage(image);
        if (!cancelled) {
          if (extracted) {
            setMaskState(extracted);
            setLoadError(null);
          } else {
            setLoadError('The sculpture image loaded, but the mask could not be extracted.');
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load sculpture image.'
          );
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!maskState) return undefined;

    let frameId = 0;
    const startedAt = performance.now();
    const point =
      POINTER_POINTS.find((candidate) => candidate.id === pointId) ||
      POINTER_POINTS[1];
    const pointer = getPointer(maskState, point);

    const render = (timeMs: number) => {
      const elapsedMs = timeMs - startedAt + 1600;
      VARIANTS.forEach((variant) => {
        const canvas = canvasRefs.current[variant.id];
        if (canvas) drawVariant(canvas, variant, maskState, pointer, elapsedMs);
      });
      frameId = window.requestAnimationFrame(render);
    };

    frameId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [maskState, pointId]);

  return (
    <main className="min-h-screen bg-[#07090b] px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-200/55">
              Zhong Zheng Ren / 中正人 / 2019-00754
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">
              Chung Cheng Disintegration Variants
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Animated snapshots reconstructed from the thread and commit sequence,
              including the broken states. The live search page is unchanged; this
              route is only for choosing a direction.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {POINTER_POINTS.map((point) => (
              <button
                key={point.id}
                type="button"
                onClick={() => setPointId(point.id)}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                  pointId === point.id
                    ? 'border-cyan-200/70 bg-cyan-200/14 text-cyan-50'
                    : 'border-white/12 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:bg-white/[0.07]'
                }`}
              >
                {point.label}
              </button>
            ))}
            <a
              href="/ngs/search"
              className="rounded-md border border-white/12 bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.07]"
            >
              Live Search
            </a>
          </div>
        </header>

        {loadError ? (
          <section className="rounded-lg border border-rose-300/25 bg-rose-950/30 p-5 text-sm text-rose-100">
            {loadError}
          </section>
        ) : null}

        {!maskState && !loadError ? (
          <section className="grid min-h-[22rem] place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-sm text-zinc-400">
            Loading sculpture mask...
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {VARIANTS.map((variant) => (
            <article
              key={variant.id}
              data-variant-card={variant.id}
              className="overflow-hidden rounded-lg border border-white/10 bg-[#0d1115]"
            >
              <div className="relative grid aspect-[1539/2048] place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.12),transparent_36%),linear-gradient(180deg,#111820,#07090b)]">
                {maskState ? (
                  <canvas
                    ref={(node) => {
                      canvasRefs.current[variant.id] = node;
                    }}
                    className="h-full w-full object-contain"
                    aria-label={`${variant.title} animation preview`}
                  />
                ) : (
                  <div className="relative h-full w-full">
                    <img
                      src={CHUNG_CHENG_ROOTS_IMAGE_URL}
                      alt=""
                      className="h-full w-full object-contain opacity-20"
                    />
                    {fallbackParticles.slice(0, 260).map((particle) => (
                      <span
                        key={`${variant.id}-${particle.id}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[7px] font-semibold text-cyan-100/40"
                        style={{
                          left: `${particle.x}%`,
                          top: `${particle.y}%`,
                        }}
                      >
                        {particle.zh}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t ${
                    variant.accent === 'pink'
                      ? 'from-pink-400/12'
                      : variant.accent === 'green'
                        ? 'from-emerald-300/12'
                        : variant.accent === 'amber'
                          ? 'from-amber-200/12'
                          : 'from-cyan-300/12'
                  } to-transparent`}
                />
              </div>

              <div className="flex min-h-[10rem] flex-col gap-3 border-t border-white/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold tracking-normal text-white">
                    {variant.title}
                  </h2>
                  <span className="shrink-0 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-zinc-400">
                    {variant.commit}
                  </span>
                </div>
                <p className="text-sm leading-6 text-zinc-400">{variant.note}</p>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
