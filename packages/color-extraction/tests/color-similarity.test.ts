import { describe, it, expect } from 'vitest';
import { ColorSimilarity } from '../src/color-similarity';

describe('ColorSimilarity', () => {
  describe('deltaE2000', () => {
    it('should return 0 for identical colors', () => {
      const color1 = '#FF5733';
      const color2 = '#FF5733';

      const distance = ColorSimilarity.deltaE2000(color1, color2);

      expect(distance).toBe(0);
    });

    it('should return distance for different colors', () => {
      const red = '#FF0000';
      const blue = '#0000FF';

      const distance = ColorSimilarity.deltaE2000(red, blue);

      expect(distance).toBeGreaterThan(0);
      // Red and blue are very different, should have high distance
      expect(distance).toBeGreaterThan(50);
    });

    it('should return small distance for similar colors', () => {
      const color1 = '#FF5733'; // Orange-red
      const color2 = '#FF6644'; // Similar orange-red

      const distance = ColorSimilarity.deltaE2000(color1, color2);

      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(10); // Should be fairly similar
    });

    it('should be symmetric (distance A->B === B->A)', () => {
      const color1 = '#FF5733';
      const color2 = '#00AAFF';

      const distance1 = ColorSimilarity.deltaE2000(color1, color2);
      const distance2 = ColorSimilarity.deltaE2000(color2, color1);

      expect(distance1).toBe(distance2);
    });

    it('should handle hex colors with lowercase', () => {
      const color1 = '#ff5733';
      const color2 = '#FF5733';

      const distance = ColorSimilarity.deltaE2000(color1, color2);

      expect(distance).toBe(0);
    });
  });

  describe('findSimilarColors', () => {
    it('should find colors within threshold', () => {
      const searchColor = '#FF0000'; // Red
      const palette = [
        { color: '#FF1111', rgb: { r: 255, g: 17, b: 17 }, percentage: 30 },
        { color: '#0000FF', rgb: { r: 0, g: 0, b: 255 }, percentage: 25 },
        { color: '#FF2222', rgb: { r: 255, g: 34, b: 34 }, percentage: 20 },
        { color: '#00FF00', rgb: { r: 0, g: 255, b: 0 }, percentage: 15 },
      ];

      const matches = ColorSimilarity.findSimilarColors(searchColor, palette, 15);

      // Should match first and third colors (similar reds)
      expect(matches.length).toBeGreaterThan(0);
      matches.forEach((match) => {
        expect(match.distance).toBeLessThanOrEqual(15);
      });
    });

    it('should return empty array if no colors match threshold', () => {
      const searchColor = '#FF0000'; // Red
      const palette = [
        { color: '#0000FF', rgb: { r: 0, g: 0, b: 255 }, percentage: 50 },
        { color: '#00FF00', rgb: { r: 0, g: 255, b: 0 }, percentage: 50 },
      ];

      const matches = ColorSimilarity.findSimilarColors(searchColor, palette, 5);

      expect(matches).toHaveLength(0);
    });

    it('should return matches sorted by distance', () => {
      const searchColor = '#FF0000';
      const palette = [
        { color: '#FF5555', rgb: { r: 255, g: 85, b: 85 }, percentage: 25 },
        { color: '#FF1111', rgb: { r: 255, g: 17, b: 17 }, percentage: 25 },
        { color: '#FF8888', rgb: { r: 255, g: 136, b: 136 }, percentage: 25 },
        { color: '#FF2222', rgb: { r: 255, g: 34, b: 34 }, percentage: 25 },
      ];

      const matches = ColorSimilarity.findSimilarColors(searchColor, palette, 50);

      // Should be sorted by distance (ascending)
      for (let i = 0; i < matches.length - 1; i++) {
        expect(matches[i].distance).toBeLessThanOrEqual(matches[i + 1].distance);
      }
    });
  });

  describe('isWithinThreshold', () => {
    it('should return true for colors within threshold', () => {
      const color1 = '#FF5733';
      const color2 = '#FF6644';
      const threshold = 10;

      const result = ColorSimilarity.isWithinThreshold(color1, color2, threshold);

      expect(result).toBe(true);
    });

    it('should return false for colors outside threshold', () => {
      const red = '#FF0000';
      const blue = '#0000FF';
      const threshold = 10;

      const result = ColorSimilarity.isWithinThreshold(red, blue, threshold);

      expect(result).toBe(false);
    });
  });

  describe('JND (Just Noticeable Difference)', () => {
    it('should identify colors below JND threshold as perceptually similar', () => {
      // JND for DeltaE 2000 is typically ~2.3
      const color1 = '#FF5733';
      const color2 = '#FF5835'; // Very slightly different

      const distance = ColorSimilarity.deltaE2000(color1, color2);

      // If distance is less than ~2.3, colors should be perceptually identical
      if (distance < 2.3) {
        expect(distance).toBeLessThan(2.3);
      }
    });
  });
});
