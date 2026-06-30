import { describe, expect, it } from 'vitest';

import {
  buildZhongZhengAsciiParticles,
  buildZhongZhengAsciiRows,
  buildZhongZhengMaskParticles,
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
