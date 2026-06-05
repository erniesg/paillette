import { describe, expect, it } from 'vitest';

import {
  buildZhongZhengDisintegrationFramePixels,
  buildZhongZhengAsciiParticles,
  buildZhongZhengAsciiRows,
  buildZhongZhengMatrixTextGlyphs,
  buildZhongZhengMaskParticles,
  clipZhongZhengPixelsToMask,
  getZhongZhengMorphToken,
  ZHONG_ZHENG_ASCII_MASK,
} from '../zhongzheng-ascii';

describe('buildZhongZhengAsciiRows', () => {
  it('paints the Chung Cheng silhouette with English and Chinese word material', () => {
    const englishRows = buildZhongZhengAsciiRows('en');
    const chineseRows = buildZhongZhengAsciiRows('zh');

    expect(englishRows).toHaveLength(ZHONG_ZHENG_ASCII_MASK.length);
    expect(chineseRows).toHaveLength(ZHONG_ZHENG_ASCII_MASK.length);
    expect(englishRows.join('')).toContain('CHUNG');
    expect(englishRows.join('')).toContain('CHENG');
    expect(chineseRows.join('')).toContain('中正');
  });

  it('keeps both language layers on the same fixed-width mask', () => {
    const englishRows = buildZhongZhengAsciiRows('en');
    const chineseRows = buildZhongZhengAsciiRows('zh');
    const expectedWidths = ZHONG_ZHENG_ASCII_MASK.map((row) => row.length);

    expect(englishRows.map((row) => row.length)).toEqual(expectedWidths);
    expect(chineseRows.map((row) => row.length)).toEqual(expectedWidths);
  });
});

describe('buildZhongZhengAsciiParticles', () => {
  it('creates positioned English-to-Chinese word particles from the statue mask', () => {
    const particles = buildZhongZhengAsciiParticles();

    expect(particles.length).toBeGreaterThan(250);
    expect(particles.every((particle) => particle.en.length >= 5)).toBe(true);
    expect(new Set(particles.map((particle) => particle.zh))).toEqual(
      new Set(['中', '正'])
    );
    expect(
      particles.every(
        (particle) =>
          particle.x >= 0 &&
          particle.x <= 100 &&
          particle.y >= 0 &&
          particle.y <= 100
      )
    ).toBe(true);
  });
});

describe('buildZhongZhengMaskParticles', () => {
  it('creates particles only from foreground alpha pixels', () => {
    const width = 8;
    const height = 8;
    const alpha = new Uint8ClampedArray(width * height);

    for (let y = 2; y <= 5; y += 1) {
      for (let x = 2; x <= 5; x += 1) {
        alpha[y * width + x] = 255;
      }
    }

    const particles = buildZhongZhengMaskParticles({
      width,
      height,
      alpha,
      columns: 8,
      rows: 8,
      maxParticles: 32,
    });

    expect(particles.length).toBeGreaterThan(0);
    expect(particles.every((particle) => particle.x > 12)).toBe(true);
    expect(particles.every((particle) => particle.x < 88)).toBe(true);
    expect(particles.every((particle) => particle.y > 12)).toBe(true);
    expect(particles.every((particle) => particle.y < 88)).toBe(true);
  });
});

describe('getZhongZhengMorphToken', () => {
  it('cycles from 中正 to Chung Cheng and back as hover dwell grows', () => {
    const chineseStart = [0, 1, 2, 3].map((index) =>
      getZhongZhengMorphToken({ index, elapsedMs: 0 })
    );
    const latinPeak = [0, 1, 2, 3].map((index) =>
      getZhongZhengMorphToken({ index, elapsedMs: 3600 })
    );
    const chineseReturn = [0, 1, 2, 3].map((index) =>
      getZhongZhengMorphToken({ index, elapsedMs: 7200 })
    );

    expect(new Set(chineseStart)).toEqual(new Set(['中', '正']));
    expect(new Set(latinPeak)).toEqual(new Set(['CHUNG', 'CHENG']));
    expect(new Set(chineseReturn)).toEqual(new Set(['中', '正']));
  });
});

describe('buildZhongZhengMatrixTextGlyphs', () => {
  it('builds only Chung Cheng text glyph streams on foreground mask pixels', () => {
    const width = 24;
    const height = 24;
    const alpha = new Uint8ClampedArray(width * height);

    for (let y = 6; y <= 17; y += 1) {
      for (let x = 6; x <= 17; x += 1) {
        alpha[y * width + x] = 255;
      }
    }

    const glyphs = buildZhongZhengMatrixTextGlyphs({
      width,
      height,
      alpha,
      pointer: { x: 50, y: 50, active: true },
      progress: 1,
      elapsedMs: 3600,
      radiusPixels: 9,
      fontSize: 3,
      streamCount: 12,
      trailLength: 4,
    });
    const allowedTokens = new Set(['中', '正', 'CHUNG', 'CHENG']);

    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((glyph) => allowedTokens.has(glyph.token))).toBe(true);
    expect(
      glyphs.every(
        (glyph) =>
          alpha[Math.round(glyph.y) * width + Math.round(glyph.x)] === 255
      )
    ).toBe(true);
    expect(glyphs.some((glyph) => glyph.token === 'CHUNG')).toBe(true);
    expect(glyphs.some((glyph) => glyph.token === 'CHENG')).toBe(true);
    expect(glyphs.some((glyph) => glyph.trailIndex > 0)).toBe(true);
  });

  it('displaces text glyphs from their source samples like particles without leaving the mask', () => {
    const width = 40;
    const height = 40;
    const alpha = new Uint8ClampedArray(width * height);

    for (let y = 8; y <= 31; y += 1) {
      for (let x = 8; x <= 31; x += 1) {
        alpha[y * width + x] = 255;
      }
    }

    const glyphs = buildZhongZhengMatrixTextGlyphs({
      width,
      height,
      alpha,
      pointer: { x: 50, y: 50, active: true },
      progress: 1,
      elapsedMs: 1200,
      radiusPixels: 14,
      fontSize: 3,
      streamCount: 24,
      trailLength: 4,
    });
    const displacedGlyphs = glyphs.filter((glyph) => {
      const movement = Math.sqrt(
        (glyph.x - glyph.sourceX) ** 2 + (glyph.y - glyph.sourceY) ** 2
      );
      return movement >= 1.4;
    });

    expect(displacedGlyphs.length).toBeGreaterThan(4);
    expect(
      glyphs.every(
        (glyph) =>
          alpha[Math.round(glyph.y) * width + Math.round(glyph.x)] === 255
      )
    ).toBe(true);
  });

  it('matrix-animates text streams mostly downward while morphing 中正 into Chung Cheng', () => {
    const width = 48;
    const height = 48;
    const alpha = new Uint8ClampedArray(width * height);

    for (let y = 6; y <= 41; y += 1) {
      for (let x = 6; x <= 41; x += 1) {
        alpha[y * width + x] = 255;
      }
    }

    const baseInput = {
      width,
      height,
      alpha,
      pointer: { x: 50, y: 50, active: true },
      progress: 1,
      radiusPixels: 17,
      fontSize: 3,
      streamCount: 28,
      trailLength: 4,
    };
    const chineseGlyphs = buildZhongZhengMatrixTextGlyphs({
      ...baseInput,
      elapsedMs: 0,
    });
    const laterGlyphs = buildZhongZhengMatrixTextGlyphs({
      ...baseInput,
      elapsedMs: 900,
    });
    const latinGlyphs = buildZhongZhengMatrixTextGlyphs({
      ...baseInput,
      elapsedMs: 3600,
    });
    const laterByKey = new Map(
      laterGlyphs.map((glyph) => [
        `${glyph.streamId}-${glyph.trailIndex}`,
        glyph,
      ])
    );
    const sharedGlyphs = chineseGlyphs
      .map((glyph) => {
        const later = laterByKey.get(`${glyph.streamId}-${glyph.trailIndex}`);
        if (!later) return null;

        return {
          x: Math.abs(later.x - glyph.x),
          y: Math.abs(later.y - glyph.y),
        };
      })
      .filter((movement): movement is { x: number; y: number } =>
        Boolean(movement)
      );
    const averageX =
      sharedGlyphs.reduce((sum, movement) => sum + movement.x, 0) /
      sharedGlyphs.length;
    const averageY =
      sharedGlyphs.reduce((sum, movement) => sum + movement.y, 0) /
      sharedGlyphs.length;

    expect(sharedGlyphs.length).toBeGreaterThan(20);
    expect(averageY).toBeGreaterThan(averageX * 1.35);
    expect(
      chineseGlyphs.every(
        (glyph) => glyph.token === '中' || glyph.token === '正'
      )
    ).toBe(true);
    expect(
      latinGlyphs.every(
        (glyph) => glyph.token === 'CHUNG' || glyph.token === 'CHENG'
      )
    ).toBe(true);
  });
});

describe('buildZhongZhengDisintegrationFramePixels', () => {
  it('erases only the cursor-local texture and preserves distant masked pixels', () => {
    const width = 21;
    const height = 21;
    const alpha = new Uint8ClampedArray(width * height).fill(255);
    const sourcePixels = new Uint8ClampedArray(width * height * 4);
    const noise = new Uint8ClampedArray(width * height).fill(0);

    for (let index = 0; index < width * height; index += 1) {
      sourcePixels[index * 4] = 120;
      sourcePixels[index * 4 + 1] = 90;
      sourcePixels[index * 4 + 2] = 60;
      sourcePixels[index * 4 + 3] = 255;
    }

    const pixels = buildZhongZhengDisintegrationFramePixels({
      width,
      height,
      alpha,
      sourcePixels,
      noise,
      pointer: { x: 50, y: 50, active: true },
      progress: 1,
      radiusPercent: 14,
      featherPercent: 8,
    });

    const centerAlpha = pixels[(10 * width + 10) * 4 + 3];
    const nearCoreAlpha = pixels[(10 * width + 11) * 4 + 3];
    const cornerAlpha = pixels[0 * 4 + 3];

    expect(centerAlpha).toBe(0);
    expect(nearCoreAlpha).toBeLessThan(48);
    expect(cornerAlpha).toBe(255);
    expect(pixels[0]).toBe(120);
    expect(pixels[1]).toBe(90);
    expect(pixels[2]).toBe(60);
  });
});

describe('clipZhongZhengPixelsToMask', () => {
  it('clamps every output alpha channel through the statue mask', () => {
    const pixels = new Uint8ClampedArray([
      20, 30, 40, 255, 50, 60, 70, 255, 80, 90, 100, 255,
    ]);
    const alpha = new Uint8ClampedArray([0, 120, 220]);

    const clipped = clipZhongZhengPixelsToMask(pixels, alpha);

    expect(Array.from(clipped)).toEqual([
      0, 0, 0, 0, 50, 60, 70, 120, 80, 90, 100, 220,
    ]);
  });
});
