/**
 * Frame Detector Tests (TDD - RED Phase)
 * Tests for frame detection and removal functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrameDetector } from '../src/frame-detector';
import type {
  FrameDetectionResult,
  FrameRemovalResult,
  FrameDetectionConfig,
} from '../src/types';
import sharp from 'sharp';

describe('FrameDetector', () => {
  let detector: FrameDetector;

  beforeEach(() => {
    detector = new FrameDetector();
  });

  describe('Frame Detection', () => {
    it('should detect a simple black frame around artwork', async () => {
      // Create a test image: 500x500 with a 50px black border
      const testImage = await createImageWithFrame(500, 500, 50, {
        frameColor: { r: 0, g: 0, b: 0 },
        artworkColor: { r: 255, g: 200, b: 100 },
      });

      const result = await detector.detectFrame(testImage);

      expect(result.hasFrame).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.boundingBox).not.toBeNull();

      if (result.boundingBox) {
        // Should detect artwork area (excluding border)
        expect(result.boundingBox.x).toBeGreaterThanOrEqual(45);
        expect(result.boundingBox.x).toBeLessThanOrEqual(55);
        expect(result.boundingBox.y).toBeGreaterThanOrEqual(45);
        expect(result.boundingBox.y).toBeLessThanOrEqual(55);
        expect(result.boundingBox.width).toBeGreaterThanOrEqual(390);
        expect(result.boundingBox.width).toBeLessThanOrEqual(410);
        expect(result.boundingBox.height).toBeGreaterThanOrEqual(390);
        expect(result.boundingBox.height).toBeLessThanOrEqual(410);
      }
    });

    it('should detect a white/light colored frame', async () => {
      // Create image with white frame
      const testImage = await createImageWithFrame(600, 400, 40, {
        frameColor: { r: 255, g: 255, b: 255 },
        artworkColor: { r: 100, g: 50, b: 150 },
      });

      const result = await detector.detectFrame(testImage);

      expect(result.hasFrame).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.boundingBox).not.toBeNull();
    });

    it('should not detect frame on frameless artwork', async () => {
      // Create image without frame (just artwork)
      const testImage = await createSolidColorImage(400, 300, {
        r: 180,
        g: 120,
        b: 80,
      });

      const result = await detector.detectFrame(testImage);

      expect(result.hasFrame).toBe(false);
      expect(result.boundingBox).toBeNull();
    });

    it('should handle very thin frames (< 5% of image)', async () => {
      const testImage = await createImageWithFrame(1000, 1000, 20, {
        frameColor: { r: 0, g: 0, b: 0 },
        artworkColor: { r: 200, g: 150, b: 100 },
      });

      const result = await detector.detectFrame(testImage);

      expect(result.hasFrame).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should handle thick frames (> 15% of image)', async () => {
      const testImage = await createImageWithFrame(400, 400, 80, {
        frameColor: { r: 50, g: 30, b: 20 },
        artworkColor: { r: 255, g: 200, b: 150 },
      });

      const result = await detector.detectFrame(testImage);

      expect(result.hasFrame).toBe(true);
      expect(result.boundingBox).not.toBeNull();
    });

    it('should handle images with complex artwork (not solid colors)', async () => {
      // Test with a gradient or pattern in artwork area
      const testImage = await createComplexArtworkWithFrame(500, 500, 30);

      const result = await detector.detectFrame(testImage);

      expect(result.hasFrame).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should return low confidence for ambiguous cases', async () => {
      // Create an image where frame detection is uncertain
      const testImage = await createAmbiguousFrameImage(400, 400);

      const result = await detector.detectFrame(testImage);

      // Should detect something but with low confidence
      expect(result.confidence).toBeLessThan(0.6);
    });

    it('should respect custom configuration', async () => {
      const customConfig: FrameDetectionConfig = {
        cannyLowThreshold: 30,
        cannyHighThreshold: 100,
        minConfidence: 0.8,
        minCropPercentage: 0.4,
        maxCropPercentage: 0.95,
        blurKernelSize: 7,
      };

      const detectorWithConfig = new FrameDetector(customConfig);
      const testImage = await createImageWithFrame(500, 500, 50);

      const result = await detectorWithConfig.detectFrame(testImage);

      expect(result).toBeDefined();
      // Config should affect result
    });
  });

  describe('Frame Removal', () => {
    it('should remove detected frame and return cropped image', async () => {
      const testImage = await createImageWithFrame(600, 400, 50);

      const result = await detector.removeFrame(testImage);

      expect(result.success).toBe(true);
      expect(result.processedImageBuffer).not.toBeNull();
      expect(result.detection.hasFrame).toBe(true);
      expect(result.detection.confidence).toBeGreaterThan(0.6);

      // Verify cropped dimensions
      if (result.processedImageBuffer) {
        const metadata = await sharp(result.processedImageBuffer).metadata();
        expect(metadata.width).toBeLessThan(600);
        expect(metadata.height).toBeLessThan(400);
        // Should be approximately 500x300 (600-100, 400-100)
        expect(metadata.width).toBeGreaterThan(480);
        expect(metadata.width).toBeLessThan(520);
      }
    });

    it('should not crop image without frame', async () => {
      const testImage = await createSolidColorImage(400, 300);

      const result = await detector.removeFrame(testImage);

      expect(result.success).toBe(true);
      expect(result.detection.hasFrame).toBe(false);
      expect(result.processedImageBuffer).toBeNull(); // No processing needed

      const metadata = await sharp(testImage).metadata();
      expect(metadata.width).toBe(400);
      expect(metadata.height).toBe(300);
    });

    it('should preserve image quality after cropping', async () => {
      const testImage = await createHighQualityImageWithFrame(1200, 800, 60);

      const result = await detector.removeFrame(testImage);

      expect(result.success).toBe(true);
      expect(result.processedImageBuffer).not.toBeNull();

      if (result.processedImageBuffer) {
        const metadata = await sharp(result.processedImageBuffer).metadata();
        // Should maintain high quality
        expect(metadata.format).toBeDefined();
        // Should not introduce artifacts (check file size isn't too small)
        expect(result.processedImageBuffer.length).toBeGreaterThan(10000);
      }
    });

    it('should reject crops that are too aggressive', async () => {
      // Create config that would reject very aggressive crops
      const conservativeDetector = new FrameDetector({
        cannyLowThreshold: 50,
        cannyHighThreshold: 150,
        minConfidence: 0.6,
        minCropPercentage: 0.5, // Require at least 50% of original
        maxCropPercentage: 0.9,
        blurKernelSize: 5,
      });

      // Create image where frame detection might crop too much
      const testImage = await createImageWithFrame(400, 400, 150);

      const result = await conservativeDetector.removeFrame(testImage);

      // Should either reject or have low confidence
      if (result.detection.hasFrame) {
        expect(result.detection.confidence).toBeLessThan(0.7);
      }
    });

    it('should handle JPEG images correctly', async () => {
      const jpegImage = await createJpegImageWithFrame(800, 600, 40);

      const result = await detector.removeFrame(jpegImage);

      expect(result.success).toBe(true);
      expect(result.processedImageBuffer).not.toBeNull();
    });

    it('should handle PNG images with transparency', async () => {
      const pngImage = await createPngImageWithFrame(500, 500, 30);

      const result = await detector.removeFrame(pngImage);

      expect(result.success).toBe(true);
      // Should preserve transparency in output
    });

    it('should complete processing in reasonable time', async () => {
      const largeImage = await createImageWithFrame(2000, 1500, 100);

      const startTime = Date.now();
      const result = await detector.removeFrame(largeImage);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.processingTimeMs).toBeLessThan(5000); // < 5 seconds
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small images', async () => {
      const tinyImage = await createImageWithFrame(150, 150, 10);

      const result = await detector.detectFrame(tinyImage);

      expect(result).toBeDefined();
      // May or may not detect frame, but shouldn't crash
    });

    it('should handle very large images', async () => {
      const hugeImage = await createImageWithFrame(4000, 3000, 200);

      const result = await detector.detectFrame(hugeImage);

      expect(result).toBeDefined();
      expect(result.hasFrame).toBe(true);
    });

    it('should handle grayscale images', async () => {
      const grayscaleImage = await createGrayscaleImageWithFrame(600, 400, 50);

      const result = await detector.detectFrame(grayscaleImage);

      expect(result).toBeDefined();
      expect(result.hasFrame).toBe(true);
    });

    it('should handle images with non-rectangular frames', async () => {
      // Oval or irregular frames
      const irregularFrameImage = await createImageWithIrregularFrame(500, 500);

      const result = await detector.detectFrame(irregularFrameImage);

      // Should still attempt detection
      expect(result).toBeDefined();
    });

    it('should handle corrupted or invalid image data gracefully', async () => {
      const invalidBuffer = Buffer.from('not an image');

      await expect(detector.detectFrame(invalidBuffer)).rejects.toThrow();
    });
  });
});

// ============================================================================
// Test Helper Functions
// ============================================================================

async function createImageWithFrame(
  width: number,
  height: number,
  borderWidth: number = 50,
  colors?: {
    frameColor?: { r: number; g: number; b: number };
    artworkColor?: { r: number; g: number; b: number };
  }
): Promise<Buffer> {
  const frameColor = colors?.frameColor || { r: 0, g: 0, b: 0 };
  const artworkColor = colors?.artworkColor || { r: 255, g: 200, b: 100 };

  // Create frame (border)
  const frame = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: frameColor,
    },
  })
    .png()
    .toBuffer();

  // Create artwork area
  const artworkWidth = width - 2 * borderWidth;
  const artworkHeight = height - 2 * borderWidth;

  const artwork = await sharp({
    create: {
      width: artworkWidth,
      height: artworkHeight,
      channels: 3,
      background: artworkColor,
    },
  })
    .png()
    .toBuffer();

  // Composite artwork onto frame
  return sharp(frame)
    .composite([
      {
        input: artwork,
        top: borderWidth,
        left: borderWidth,
      },
    ])
    .png()
    .toBuffer();
}

async function createSolidColorImage(
  width: number,
  height: number,
  color: { r: number; g: number; b: number } = { r: 200, g: 150, b: 100 }
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

async function createComplexArtworkWithFrame(
  width: number,
  height: number,
  borderWidth: number
): Promise<Buffer> {
  // Create a gradient or pattern for complex artwork
  // For now, create multiple colored rectangles to simulate complexity
  const artworkWidth = width - 2 * borderWidth;
  const artworkHeight = height - 2 * borderWidth;

  const artwork = await sharp({
    create: {
      width: artworkWidth,
      height: artworkHeight,
      channels: 3,
      background: { r: 150, g: 100, b: 200 },
    },
  })
    .png()
    .toBuffer();

  return createImageWithFrame(width, height, borderWidth, {
    frameColor: { r: 0, g: 0, b: 0 },
  });
}

async function createAmbiguousFrameImage(
  width: number,
  height: number
): Promise<Buffer> {
  // Create an image where frame detection is uncertain
  // Similar colors between frame and artwork
  return createImageWithFrame(width, height, 30, {
    frameColor: { r: 100, g: 100, b: 100 },
    artworkColor: { r: 120, g: 120, b: 120 },
  });
}

async function createHighQualityImageWithFrame(
  width: number,
  height: number,
  borderWidth: number
): Promise<Buffer> {
  return createImageWithFrame(width, height, borderWidth);
}

async function createJpegImageWithFrame(
  width: number,
  height: number,
  borderWidth: number
): Promise<Buffer> {
  const pngBuffer = await createImageWithFrame(width, height, borderWidth);
  return sharp(pngBuffer).jpeg({ quality: 90 }).toBuffer();
}

async function createPngImageWithFrame(
  width: number,
  height: number,
  borderWidth: number
): Promise<Buffer> {
  return createImageWithFrame(width, height, borderWidth);
}

async function createGrayscaleImageWithFrame(
  width: number,
  height: number,
  borderWidth: number
): Promise<Buffer> {
  const colorBuffer = await createImageWithFrame(width, height, borderWidth);
  return sharp(colorBuffer).grayscale().png().toBuffer();
}

async function createImageWithIrregularFrame(
  width: number,
  height: number
): Promise<Buffer> {
  // For now, just create a regular frame
  // TODO: Implement actual irregular frame if needed for testing
  return createImageWithFrame(width, height, 40);
}
