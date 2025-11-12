import { describe, it, expect, beforeAll } from 'vitest';
import { ColorExtractor } from '../src/extractor';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe('ColorExtractor', () => {
  let testImageBuffer: Buffer;
  let grayscaleImageBuffer: Buffer;

  beforeAll(async () => {
    // We'll create test fixtures later
    // For now, tests will expect these to exist
  });

  describe('extract', () => {
    it('should extract 5 dominant colors from artwork', async () => {
      // Test image: a colorful artwork
      const mockImageUrl = 'https://example.com/colorful-artwork.jpg';
      const colors = await ColorExtractor.extract(mockImageUrl, 5);

      expect(colors.dominantColors).toHaveLength(5);
      expect(colors.dominantColors[0]).toHaveProperty('color');
      expect(colors.dominantColors[0]).toHaveProperty('rgb');
      expect(colors.dominantColors[0]).toHaveProperty('percentage');
      expect(colors.dominantColors[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should return colors with percentages summing to ~100%', async () => {
      const mockImageUrl = 'https://example.com/test-artwork.jpg';
      const result = await ColorExtractor.extract(mockImageUrl, 5);

      const totalPercentage = result.dominantColors.reduce(
        (sum, c) => sum + c.percentage,
        0
      );

      expect(totalPercentage).toBeGreaterThan(95);
      expect(totalPercentage).toBeLessThanOrEqual(100);
    });

    it('should handle grayscale images', async () => {
      const mockImageUrl = 'https://example.com/grayscale.jpg';
      const result = await ColorExtractor.extract(mockImageUrl, 5);

      expect(result.dominantColors).toBeDefined();
      expect(result.dominantColors.length).toBeGreaterThan(0);

      // All colors should be grayscale (r ≈ g ≈ b)
      result.dominantColors.forEach((color) => {
        const { r, g, b } = color.rgb;
        const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        expect(maxDiff).toBeLessThan(30); // Allow some tolerance
      });
    });

    it('should handle nearly monochrome images', async () => {
      const mockImageUrl = 'https://example.com/monochrome.jpg';
      const result = await ColorExtractor.extract(mockImageUrl, 5);

      expect(result.dominantColors).toBeDefined();
      // Should still return up to 5 colors even if image is mostly one color
      expect(result.dominantColors.length).toBeGreaterThan(0);
      expect(result.dominantColors.length).toBeLessThanOrEqual(5);
    });

    it('should process 200x200px image quickly', async () => {
      const mockImageUrl = 'https://example.com/small-image.jpg';
      const startTime = Date.now();

      await ColorExtractor.extract(mockImageUrl, 5);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should return colors sorted by percentage (descending)', async () => {
      const mockImageUrl = 'https://example.com/artwork.jpg';
      const result = await ColorExtractor.extract(mockImageUrl, 5);

      for (let i = 0; i < result.dominantColors.length - 1; i++) {
        expect(result.dominantColors[i].percentage).toBeGreaterThanOrEqual(
          result.dominantColors[i + 1].percentage
        );
      }
    });

    it('should include extraction timestamp', async () => {
      const mockImageUrl = 'https://example.com/artwork.jpg';
      const result = await ColorExtractor.extract(mockImageUrl, 5);

      expect(result.extractedAt).toBeDefined();
      expect(new Date(result.extractedAt).getTime()).toBeGreaterThan(0);
    });

    it('should support extracting different number of colors', async () => {
      const mockImageUrl = 'https://example.com/artwork.jpg';

      const result3 = await ColorExtractor.extract(mockImageUrl, 3);
      expect(result3.dominantColors).toHaveLength(3);

      const result8 = await ColorExtractor.extract(mockImageUrl, 8);
      expect(result8.dominantColors.length).toBeLessThanOrEqual(8);
    });

    it('should handle invalid image URL gracefully', async () => {
      const invalidUrl = 'https://example.com/nonexistent.jpg';

      await expect(ColorExtractor.extract(invalidUrl, 5)).rejects.toThrow();
    });

    it('should convert RGB to hex correctly', async () => {
      const mockImageUrl = 'https://example.com/artwork.jpg';
      const result = await ColorExtractor.extract(mockImageUrl, 5);

      result.dominantColors.forEach((color) => {
        const { r, g, b } = color.rgb;
        const expectedHex =
          '#' +
          [r, g, b]
            .map((c) => c.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase();

        expect(color.color.toUpperCase()).toBe(expectedHex);
      });
    });
  });

  describe('extractFromBuffer', () => {
    it('should extract colors from image buffer', async () => {
      // Mock buffer for testing
      const mockBuffer = Buffer.from([]);

      // This will be implemented when we have actual test images
      expect(ColorExtractor.extractFromBuffer).toBeDefined();
    });
  });
});
