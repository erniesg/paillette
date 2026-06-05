export type ZhongZhengAsciiMode = 'en' | 'zh';

export const ZHONG_ZHENG_ASCII_MASK = [
  '                      ######                      ',
  '                    ##########                    ',
  '                   ############                   ',
  '                   ############                   ',
  '                   ############                   ',
  '                    ##########                    ',
  '                     ########                     ',
  '                    ##########                    ',
  '              ######################              ',
  '           ############################           ',
  '         ################################         ',
  '        ###########            ###########        ',
  '       #########                  #########       ',
  '      ########                      ########      ',
  '     ########                        ########     ',
  '     #######                          #######     ',
  '    #######                            #######    ',
  '    ######        ############        ######      ',
  '    ######       ##############       ######      ',
  '    ######       ##############       ######      ',
  '    ######       ##############       ######      ',
  '    ######        ############        ######      ',
  '     #######                        #######       ',
  '     ########                      ########       ',
  '      #########                  #########        ',
  '       ##########              ##########         ',
  '        ##############################            ',
  '         ############################             ',
  '          ##########################              ',
  '            ###########  ###########              ',
  '            ##########    ##########              ',
  '            #########      #########              ',
  '            ########        ########              ',
  '            ########        ########              ',
  '            ########        ########              ',
  '            #######          #######              ',
  '            #######          #######              ',
  '            #######          #######              ',
  '            ######            ######              ',
  '            ######            ######              ',
  '            ######            ######              ',
  '            #####              #####              ',
  '            #####              #####              ',
  '            #####              #####              ',
  '           ######              ######             ',
  '          #######              #######            ',
] as const;

const WORD_MATERIAL: Record<ZhongZhengAsciiMode, string> = {
  en: 'CHUNGCHENG',
  zh: '中正',
};

export type ZhongZhengAsciiParticle = {
  id: string;
  row: number;
  column: number;
  x: number;
  y: number;
  z: number;
  en: string;
  zh: string;
  phase: number;
  shade: number;
  scale: number;
};

export type ZhongZhengMaskParticleInput = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray | number[];
  columns?: number;
  rows?: number;
  maxParticles?: number;
};

export const ZHONG_ZHENG_EFFECT_WIDTH = 560;
export const ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT = 12.8;
export const ZHONG_ZHENG_DISINTEGRATION_FEATHER_PERCENT = 6.4;
export const ZHONG_ZHENG_TEXT_MORPH_CYCLE_MS = 7200;

export type ZhongZhengPointerState = {
  x: number;
  y: number;
  active: boolean;
  activeSinceMs?: number;
};

const ZHONG_ZHENG_CHINESE_MORPH_TOKENS = ['中', '正'] as const;
const ZHONG_ZHENG_LATIN_MORPH_TOKENS = ['CHUNG', 'CHENG'] as const;

export type ZhongZhengMorphToken =
  | (typeof ZHONG_ZHENG_CHINESE_MORPH_TOKENS)[number]
  | (typeof ZHONG_ZHENG_LATIN_MORPH_TOKENS)[number];

export type ZhongZhengMorphTokenInput = {
  index: number;
  elapsedMs: number;
  cycleMs?: number;
};

export type ZhongZhengMatrixTextGlyph = {
  streamId: number;
  trailIndex: number;
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  token: ZhongZhengMorphToken;
  opacity: number;
  scale: number;
  isLead: boolean;
  morph: number;
};

export type ZhongZhengMatrixTextGlyphInput = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray | number[];
  pointer: ZhongZhengPointerState;
  progress: number;
  elapsedMs: number;
  radiusPixels: number;
  fontSize: number;
  streamCount?: number;
  trailLength?: number;
};

export type ZhongZhengDisintegrationFrameInput = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray | number[];
  sourcePixels: Uint8ClampedArray | number[];
  noise?: Uint8ClampedArray | number[];
  pointer: ZhongZhengPointerState;
  progress: number;
  radiusPercent?: number;
  featherPercent?: number;
};

const clampZhongZhengNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getZhongZhengMaskAlphaAt = (
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

export const getZhongZhengSeededUnit = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const getZhongZhengMorphAmount = (
  elapsedMs: number,
  cycleMs = ZHONG_ZHENG_TEXT_MORPH_CYCLE_MS
) => {
  const safeCycle = Math.max(1, cycleMs);
  const phase = (((elapsedMs % safeCycle) + safeCycle) % safeCycle) / safeCycle;
  return phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
};

export const getZhongZhengMorphToken = ({
  index,
  elapsedMs,
  cycleMs,
}: ZhongZhengMorphTokenInput): ZhongZhengMorphToken => {
  const tokenIndex = Math.abs(Math.floor(index)) % 2;
  const morph = getZhongZhengMorphAmount(elapsedMs, cycleMs);

  return morph >= 0.5
    ? ZHONG_ZHENG_LATIN_MORPH_TOKENS[tokenIndex] ||
        ZHONG_ZHENG_LATIN_MORPH_TOKENS[0]
    : ZHONG_ZHENG_CHINESE_MORPH_TOKENS[tokenIndex] ||
        ZHONG_ZHENG_CHINESE_MORPH_TOKENS[0];
};

export const buildZhongZhengMatrixTextGlyphs = ({
  width,
  height,
  alpha,
  pointer,
  progress,
  elapsedMs,
  radiusPixels,
  fontSize,
  streamCount = 58,
  trailLength = 5,
}: ZhongZhengMatrixTextGlyphInput) => {
  if (
    width <= 0 ||
    height <= 0 ||
    alpha.length < width * height ||
    !pointer.active ||
    progress <= 0 ||
    radiusPixels <= 0 ||
    fontSize <= 0
  ) {
    return [];
  }

  const pointerX = (pointer.x / 100) * Math.max(1, width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, height - 1);
  const safeStreamCount = Math.max(1, Math.round(streamCount));
  const safeTrailLength = Math.max(1, Math.round(trailLength));
  const radius = Math.max(fontSize * 2, radiusPixels);
  const horizontalSpan = radius * 2.08;
  const verticalSpan = radius * 2.18;
  const fallCycle = verticalSpan + fontSize * safeTrailLength * 1.35;
  const glyphs: ZhongZhengMatrixTextGlyph[] = [];
  const clampedProgress = clampZhongZhengNumber(progress, 0, 1);

  for (let streamId = 0; streamId < safeStreamCount; streamId += 1) {
    const streamUnit =
      safeStreamCount === 1 ? 0.5 : streamId / (safeStreamCount - 1);
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

    for (let trailIndex = 0; trailIndex < safeTrailLength; trailIndex += 1) {
      const y = headY - trailIndex * fontSize * 1.28;

      if (
        x < 0 ||
        x >= width ||
        y < 0 ||
        y >= height ||
        y < pointerY - verticalSpan / 2 - fontSize ||
        y > pointerY + verticalSpan / 2 + fontSize
      ) {
        continue;
      }

      const sourceX = x;
      const sourceY = y;
      const maskAlpha = getZhongZhengMaskAlphaAt(
        alpha,
        width,
        height,
        sourceX,
        sourceY
      );
      if (maskAlpha < 38) continue;

      const distance = Math.sqrt(
        (sourceX - pointerX) ** 2 + (sourceY - pointerY) ** 2
      );
      const localInfluence = clampZhongZhengNumber(
        (radius * 1.2 - distance) / Math.max(1, radius * 1.2),
        0,
        1
      );
      if (localInfluence <= 0) continue;

      const trailFalloff =
        trailIndex === 0 ? 1 : Math.max(0.14, 1 - trailIndex * 0.2);
      const morph = getZhongZhengMorphAmount(elapsedMs);
      const particleSeed =
        streamId * 157 +
        trailIndex * 61 +
        Math.round(pointerX) * 17 +
        Math.round(pointerY) * 13;
      const scatterAngle =
        getZhongZhengSeededUnit(particleSeed) * Math.PI * 2;
      const scatterDistance =
        fontSize *
        (0.52 + getZhongZhengSeededUnit(particleSeed + 29) * 2.7) *
        localInfluence *
        clampedProgress;
      let particleX = sourceX + Math.cos(scatterAngle) * scatterDistance;
      let particleY =
        sourceY +
        Math.sin(scatterAngle) *
          scatterDistance *
          (0.72 + getZhongZhengSeededUnit(particleSeed + 43) * 0.46);

      if (
        getZhongZhengMaskAlphaAt(alpha, width, height, particleX, particleY) <
        38
      ) {
        particleX = sourceX + (particleX - sourceX) * 0.58;
        particleY = sourceY + (particleY - sourceY) * 0.58;
      }

      if (
        getZhongZhengMaskAlphaAt(alpha, width, height, particleX, particleY) <
        38
      ) {
        particleX = sourceX;
        particleY = sourceY;
      }

      glyphs.push({
        streamId,
        trailIndex,
        sourceX,
        sourceY,
        x: particleX,
        y: particleY,
        token: getZhongZhengMorphToken({
          index: streamId + trailIndex,
          elapsedMs,
        }),
        opacity:
          clampedProgress *
          localInfluence *
          trailFalloff *
          (maskAlpha / 255) *
          (trailIndex === 0 ? 0.92 : 0.52),
        scale: trailIndex === 0 ? 1.08 : Math.max(0.72, 1 - trailIndex * 0.07),
        isLead: trailIndex === 0,
        morph,
      });
    }
  }

  return glyphs;
};

export const buildZhongZhengAsciiRows = (mode: ZhongZhengAsciiMode) => {
  const material = WORD_MATERIAL[mode];
  let cursor = 0;

  return ZHONG_ZHENG_ASCII_MASK.map((row) =>
    [...row]
      .map((char) => {
        if (char === ' ') return char;

        const nextChar = material[cursor % material.length] || char;
        cursor += 1;
        return nextChar;
      })
      .join('')
  );
};

const ASCII_WORD_TOKENS = ['CHUNG', 'CHENG'] as const;

export const buildZhongZhengAsciiParticles = () => {
  const rows = ZHONG_ZHENG_ASCII_MASK.length;
  const columns = Math.max(...ZHONG_ZHENG_ASCII_MASK.map((row) => row.length));
  const particles: ZhongZhengAsciiParticle[] = [];
  let cursor = 0;

  ZHONG_ZHENG_ASCII_MASK.forEach((row, rowIndex) => {
    [...row].forEach((char, columnIndex) => {
      if (char === ' ') return;
      if ((rowIndex + columnIndex) % 2 === 1) return;

      const tokenIndex = cursor % ASCII_WORD_TOKENS.length;
      const token = ASCII_WORD_TOKENS[tokenIndex] ?? ASCII_WORD_TOKENS[0];
      particles.push({
        id: `${rowIndex}-${columnIndex}`,
        row: rowIndex,
        column: columnIndex,
        x: columns <= 1 ? 0 : (columnIndex / (columns - 1)) * 100,
        y: rows <= 1 ? 0 : (rowIndex / (rows - 1)) * 100,
        z: 4 + ((rowIndex + columnIndex) % 7),
        en: token,
        zh: tokenIndex === 0 ? '中' : '正',
        phase: (rowIndex * 17 + columnIndex * 11) % 360,
        shade: 0.62,
        scale: 1,
      });
      cursor += 1;
    });
  });

  return particles;
};

const sampleMaskAlpha = (
  alpha: Uint8ClampedArray | number[],
  width: number,
  height: number,
  x: number,
  y: number
) => {
  const samplePoints = [
    [0, 0],
    [-0.34, -0.34],
    [0.34, -0.34],
    [-0.34, 0.34],
    [0.34, 0.34],
  ] as const;
  let total = 0;

  samplePoints.forEach(([offsetX, offsetY]) => {
    const sampleX = Math.max(
      0,
      Math.min(width - 1, Math.round(x + offsetX))
    );
    const sampleY = Math.max(
      0,
      Math.min(height - 1, Math.round(y + offsetY))
    );
    total += alpha[sampleY * width + sampleX] || 0;
  });

  return total / samplePoints.length;
};

export const buildZhongZhengMaskParticles = ({
  width,
  height,
  alpha,
  columns = 56,
  rows = 76,
  maxParticles = 620,
}: ZhongZhengMaskParticleInput) => {
  if (width <= 0 || height <= 0 || alpha.length < width * height) {
    return buildZhongZhengAsciiParticles();
  }

  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const candidates: ZhongZhengAsciiParticle[] = [];
  let cursor = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sampleX = (column + 0.5) * cellWidth;
      const sampleY = (row + 0.5) * cellHeight;
      const maskAlpha = sampleMaskAlpha(alpha, width, height, sampleX, sampleY);

      if (maskAlpha < 42) continue;
      if (maskAlpha < 108 && (row + column) % 2 === 1) continue;

      const tokenIndex = cursor % ASCII_WORD_TOKENS.length;
      const token = ASCII_WORD_TOKENS[tokenIndex] ?? ASCII_WORD_TOKENS[0];
      const alphaWeight = maskAlpha / 255;
      const centerFalloff =
        1 - Math.min(1, Math.abs(sampleX / width - 0.5) * 1.9);

      candidates.push({
        id: `mask-${row}-${column}`,
        row,
        column,
        x: (sampleX / Math.max(1, width - 1)) * 100,
        y: (sampleY / Math.max(1, height - 1)) * 100,
        z: 3 + alphaWeight * 18 + centerFalloff * 6,
        en: token,
        zh: tokenIndex === 0 ? '中' : '正',
        phase: (row * 19 + column * 13 + Math.round(maskAlpha)) % 360,
        shade: 0.44 + alphaWeight * 0.48,
        scale: 0.72 + alphaWeight * 0.42,
      });
      cursor += 1;
    }
  }

  if (candidates.length <= maxParticles) {
    return candidates;
  }

  const stride = Math.ceil(candidates.length / maxParticles);
  return candidates
    .filter((_, index) => index % stride === 0)
    .slice(0, maxParticles);
};

export const buildZhongZhengDisintegrationFramePixels = ({
  width,
  height,
  alpha,
  sourcePixels,
  noise,
  pointer,
  progress,
  radiusPercent = ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT,
  featherPercent = ZHONG_ZHENG_DISINTEGRATION_FEATHER_PERCENT,
}: ZhongZhengDisintegrationFrameInput) => {
  const output = new Uint8ClampedArray(width * height * 4);
  if (
    width <= 0 ||
    height <= 0 ||
    alpha.length < width * height ||
    sourcePixels.length < width * height * 4
  ) {
    return output;
  }

  const pointerX = (pointer.x / 100) * Math.max(1, width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, height - 1);
  const radiusPixels = (Math.min(width, height) * radiusPercent) / 100;
  const featherPixels = (Math.min(width, height) * featherPercent) / 100;
  const clampedProgress = clampZhongZhengNumber(progress, 0, 1);

  for (let index = 0; index < alpha.length; index += 1) {
    const maskAlpha = alpha[index] || 0;
    const dataIndex = index * 4;

    if (maskAlpha <= 0) {
      output[dataIndex] = 0;
      output[dataIndex + 1] = 0;
      output[dataIndex + 2] = 0;
      output[dataIndex + 3] = 0;
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    let dissolve = 0;

    if (pointer.active && clampedProgress > 0) {
      const distance = Math.sqrt((x - pointerX) ** 2 + (y - pointerY) ** 2);
      const localInfluence = clampZhongZhengNumber(
        (radiusPixels + featherPixels - distance) /
          Math.max(1, radiusPixels + featherPixels),
        0,
        1
      );
      const grain =
        (noise?.[index] ?? Math.round(getZhongZhengSeededUnit(index) * 255)) /
        255;
      dissolve =
        clampZhongZhengNumber(
          (localInfluence * clampedProgress - grain * 0.3) / 0.7,
          0,
          1
        ) ** 1.22;

      const coreClear = clampZhongZhengNumber(
        (radiusPixels * 0.92 - distance) / Math.max(1, featherPixels * 0.75),
        0,
        1
      );
      dissolve = Math.max(dissolve, coreClear * clampedProgress);
    }

    const clearedCore = clampZhongZhengNumber((dissolve - 0.58) / 0.34, 0, 1);
    const alphaMultiplier = (1 - dissolve * 0.98) * (1 - clearedCore);
    output[dataIndex] = sourcePixels[dataIndex] || 0;
    output[dataIndex + 1] = sourcePixels[dataIndex + 1] || 0;
    output[dataIndex + 2] = sourcePixels[dataIndex + 2] || 0;
    output[dataIndex + 3] = Math.round(maskAlpha * alphaMultiplier);
  }

  return output;
};

export const clipZhongZhengPixelsToMask = (
  pixels: Uint8ClampedArray,
  alpha: Uint8ClampedArray | number[],
  alphaScale = 1
) => {
  const clipped = new Uint8ClampedArray(pixels);
  const pixelCount = Math.min(alpha.length, Math.floor(clipped.length / 4));

  for (let index = 0; index < pixelCount; index += 1) {
    const dataIndex = index * 4;
    const maskAlpha = Math.round((alpha[index] || 0) * alphaScale);
    const nextAlpha = Math.min(clipped[dataIndex + 3] || 0, maskAlpha);
    clipped[dataIndex + 3] = nextAlpha;

    if (maskAlpha <= 0 || nextAlpha <= 0) {
      clipped[dataIndex] = 0;
      clipped[dataIndex + 1] = 0;
      clipped[dataIndex + 2] = 0;
      clipped[dataIndex + 3] = 0;
    }
  }

  return clipped;
};
