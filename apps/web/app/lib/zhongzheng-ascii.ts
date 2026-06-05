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
export const ZHONG_ZHENG_DISINTEGRATION_RADIUS_PERCENT = 8.4;
export const ZHONG_ZHENG_DISINTEGRATION_FEATHER_PERCENT = 4.8;

export type ZhongZhengPointerState = {
  x: number;
  y: number;
  active: boolean;
};

export type ZhongZhengTextureFragment = {
  id: string;
  x: number;
  y: number;
  size: number;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  scatterX: number;
  scatterY: number;
  delay: number;
};

export type ZhongZhengTextureFragmentRenderState = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  active: boolean;
};

export type ZhongZhengTextureFragmentInput = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray | number[];
  sourcePixels: Uint8ClampedArray | number[];
  stride?: number;
  maxFragments?: number;
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

export const getZhongZhengSeededUnit = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

export const enhanceZhongZhengTextureChannel = (
  value: number,
  alphaWeight = 1,
  noise = 0.5
) =>
  Math.round(
    clampZhongZhengNumber(
      value * (0.76 + alphaWeight * 0.2) + 14 + (noise - 0.5) * 18,
      0,
      255
    )
  );

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

export const buildZhongZhengTextureFragments = ({
  width,
  height,
  alpha,
  sourcePixels,
  stride = 3,
  maxFragments = 18000,
}: ZhongZhengTextureFragmentInput) => {
  if (
    width <= 0 ||
    height <= 0 ||
    alpha.length < width * height ||
    sourcePixels.length < width * height * 4
  ) {
    return [];
  }

  const candidates: ZhongZhengTextureFragment[] = [];
  const safeStride = Math.max(1, Math.round(stride));

  for (let y = 0; y < height; y += safeStride) {
    for (let x = 0; x < width; x += safeStride) {
      const index = y * width + x;
      const maskAlpha = alpha[index] || 0;
      if (maskAlpha < 28) continue;

      const dataIndex = index * 4;
      const noise = getZhongZhengSeededUnit(x * 73 + y * 151 + maskAlpha);
      const alphaWeight = maskAlpha / 255;

      candidates.push({
        id: `texture-${x}-${y}`,
        x,
        y,
        size: safeStride + noise * 1.2,
        red: enhanceZhongZhengTextureChannel(
          sourcePixels[dataIndex] || 0,
          alphaWeight,
          noise
        ),
        green: enhanceZhongZhengTextureChannel(
          sourcePixels[dataIndex + 1] || 0,
          alphaWeight,
          getZhongZhengSeededUnit(x * 41 + y * 97)
        ),
        blue: enhanceZhongZhengTextureChannel(
          sourcePixels[dataIndex + 2] || 0,
          alphaWeight,
          getZhongZhengSeededUnit(x * 109 + y * 53)
        ),
        alpha: maskAlpha,
        scatterX: (getZhongZhengSeededUnit(x * 127 + y * 31) - 0.5) * 7.2,
        scatterY: (getZhongZhengSeededUnit(x * 67 + y * 167) - 0.5) * 7.2,
        delay: getZhongZhengSeededUnit(x * 23 + y * 191),
      });
    }
  }

  if (candidates.length <= maxFragments) return candidates;

  const sampleEvery = Math.ceil(candidates.length / maxFragments);
  return candidates
    .filter((_, index) => index % sampleEvery === 0)
    .slice(0, maxFragments);
};

export const getZhongZhengFragmentRenderState = ({
  fragment,
  pointer,
  width,
  height,
  progress,
  radiusPixels,
  featherPixels,
}: {
  fragment: ZhongZhengTextureFragment;
  pointer: ZhongZhengPointerState;
  width: number;
  height: number;
  progress: number;
  radiusPixels: number;
  featherPixels: number;
}): ZhongZhengTextureFragmentRenderState => {
  if (!pointer.active || progress <= 0) {
    return {
      x: fragment.x,
      y: fragment.y,
      size: fragment.size,
      opacity: fragment.alpha / 255,
      active: false,
    };
  }

  const pointerX = (pointer.x / 100) * Math.max(1, width - 1);
  const pointerY = (pointer.y / 100) * Math.max(1, height - 1);
  const distance = Math.sqrt(
    (fragment.x - pointerX) ** 2 + (fragment.y - pointerY) ** 2
  );
  const edgeStart = Math.max(0, radiusPixels - featherPixels);
  const localInfluence = clampZhongZhengNumber(
    (radiusPixels - distance) / Math.max(1, radiusPixels - edgeStart),
    0,
    1
  );
  const delayedProgress = clampZhongZhengNumber(
    (progress - fragment.delay * 0.16) / 0.84,
    0,
    1
  );
  const dissolve = localInfluence * delayedProgress;

  if (dissolve <= 0) {
    return {
      x: fragment.x,
      y: fragment.y,
      size: fragment.size,
      opacity: fragment.alpha / 255,
      active: false,
    };
  }

  return {
    x: fragment.x + fragment.scatterX * dissolve,
    y: fragment.y + fragment.scatterY * dissolve,
    size: fragment.size * (1 - dissolve * 0.22),
    opacity: (fragment.alpha / 255) * (1 - dissolve * 0.68),
    active: true,
  };
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
    }

    const alphaMultiplier = 1 - dissolve * 0.94;
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
