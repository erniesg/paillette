import { describe, expect, it } from 'vitest';

import {
  buildZhongZhengDisintegrationFramePixels,
  buildZhongZhengAsciiParticles,
  buildZhongZhengAsciiRows,
  buildZhongZhengMaskParticles,
  buildZhongZhengTextureFragments,
  clipZhongZhengPixelsToMask,
  getZhongZhengFragmentRenderState,
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

describe('buildZhongZhengTextureFragments', () => {
  it('samples artwork atlas color only from foreground mask pixels', () => {
    const width = 4;
    const height = 4;
    const alpha = new Uint8ClampedArray(width * height);
    const sourcePixels = new Uint8ClampedArray(width * height * 4);

    for (let index = 0; index < sourcePixels.length / 4; index += 1) {
      sourcePixels[index * 4] = index;
      sourcePixels[index * 4 + 1] = 80;
      sourcePixels[index * 4 + 2] = 160;
      sourcePixels[index * 4 + 3] = 255;
    }

    alpha[5] = 255;
    alpha[10] = 220;

    const fragments = buildZhongZhengTextureFragments({
      width,
      height,
      alpha,
      sourcePixels,
      stride: 1,
      maxFragments: 10,
    });

    expect(fragments).toHaveLength(2);
    expect(fragments.map((fragment) => `${fragment.x},${fragment.y}`)).toEqual(
      ['1,1', '2,2']
    );
    expect(fragments.every((fragment) => fragment.green > 70)).toBe(true);
  });
});

describe('buildZhongZhengDisintegrationFramePixels', () => {
  it('erases only the cursor-local texture and preserves distant masked pixels', () => {
    const width = 9;
    const height = 9;
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

    const centerAlpha = pixels[(4 * width + 4) * 4 + 3];
    const cornerAlpha = pixels[0 * 4 + 3];

    expect(centerAlpha).toBeLessThan(80);
    expect(cornerAlpha).toBe(255);
    expect(pixels[0]).toBe(120);
    expect(pixels[1]).toBe(90);
    expect(pixels[2]).toBe(60);
  });
});

describe('getZhongZhengFragmentRenderState', () => {
  it('keeps cursor scatter bounded instead of drifting outward', () => {
    const fragment = {
      id: 'fragment',
      x: 40,
      y: 40,
      size: 3,
      red: 120,
      green: 90,
      blue: 60,
      alpha: 255,
      scatterX: 4,
      scatterY: -3,
      delay: 0,
    };

    const renderState = getZhongZhengFragmentRenderState({
      fragment,
      pointer: { x: 50, y: 50, active: true },
      width: 80,
      height: 80,
      progress: 1,
      radiusPixels: 20,
      featherPixels: 8,
    });

    const movement = Math.sqrt(
      (renderState.x - fragment.x) ** 2 + (renderState.y - fragment.y) ** 2
    );

    expect(renderState.active).toBe(true);
    expect(movement).toBeLessThanOrEqual(5);
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
