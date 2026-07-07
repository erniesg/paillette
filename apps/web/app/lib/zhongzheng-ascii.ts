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
