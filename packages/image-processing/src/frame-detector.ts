/**
 * Frame Detector
 * Detects and removes frames from artwork images using edge detection
 */

import sharp from 'sharp';
import type {
  FrameDetectionResult,
  FrameRemovalResult,
  FrameDetectionConfig,
  BoundingBox,
  ImageDimensions,
} from './types';
import { DEFAULT_FRAME_DETECTION_CONFIG } from './types';

export class FrameDetector {
  private config: FrameDetectionConfig;

  constructor(config?: Partial<FrameDetectionConfig>) {
    this.config = { ...DEFAULT_FRAME_DETECTION_CONFIG, ...config };
  }

  /**
   * Detect frame in an artwork image
   * Uses edge detection and analysis to identify frame boundaries
   */
  async detectFrame(imageBuffer: Buffer): Promise<FrameDetectionResult> {
    const startTime = Date.now();

    try {
      // Get original image dimensions
      const metadata = await sharp(imageBuffer).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error('Could not determine image dimensions');
      }

      const originalDimensions: ImageDimensions = {
        width: metadata.width,
        height: metadata.height,
      };

      // Step 1: Convert to grayscale and apply Gaussian blur to reduce noise
      const processedImage = await sharp(imageBuffer)
        .grayscale()
        .blur(this.config.blurKernelSize / 2) // Sharp uses sigma, not kernel size
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Step 2: Detect edges using simple gradient approach
      // (Sharp doesn't have built-in Canny edge detection, so we use a simplified approach)
      const edgeData = await this.detectEdges(processedImage.data, processedImage.info);

      // Step 3: Analyze edge distribution to find frame boundaries
      const boundingBox = this.findArtworkBounds(
        edgeData,
        processedImage.info.width,
        processedImage.info.height
      );

      // Step 4: Calculate confidence score
      const confidence = this.calculateConfidence(
        boundingBox,
        originalDimensions
      );

      // Step 5: Validate the result
      const hasFrame = this.validateDetection(boundingBox, originalDimensions, confidence);

      let croppedDimensions: ImageDimensions | null = null;
      if (hasFrame && boundingBox) {
        croppedDimensions = {
          width: boundingBox.width,
          height: boundingBox.height,
        };
      }

      return {
        hasFrame,
        confidence,
        boundingBox: hasFrame ? boundingBox : null,
        method: 'edge-detection',
        originalDimensions,
        croppedDimensions,
      };
    } catch (error) {
      // If detection fails, return no frame detected
      const metadata = await sharp(imageBuffer).metadata();
      return {
        hasFrame: false,
        confidence: 0,
        boundingBox: null,
        method: 'edge-detection',
        originalDimensions: {
          width: metadata.width || 0,
          height: metadata.height || 0,
        },
        croppedDimensions: null,
      };
    }
  }

  /**
   * Remove detected frame from image
   */
  async removeFrame(imageBuffer: Buffer): Promise<FrameRemovalResult> {
    const startTime = Date.now();

    try {
      // First, detect the frame
      const detection = await this.detectFrame(imageBuffer);

      // If no frame detected or low confidence, return original
      if (!detection.hasFrame || !detection.boundingBox) {
        return {
          success: true,
          originalImageBuffer: imageBuffer,
          processedImageBuffer: null, // No processing needed
          detection,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Crop the image to the detected artwork bounds
      const { boundingBox } = detection;
      const processedImageBuffer = await sharp(imageBuffer)
        .extract({
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        })
        .toBuffer();

      return {
        success: true,
        originalImageBuffer: imageBuffer,
        processedImageBuffer,
        detection,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const detection = await this.detectFrame(imageBuffer);
      return {
        success: false,
        originalImageBuffer: imageBuffer,
        processedImageBuffer: null,
        detection,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Simplified edge detection using gradient approach
   * Since Sharp doesn't have Canny, we use Sobel-like approach
   */
  private async detectEdges(
    imageData: Buffer,
    info: { width: number; height: number; channels: number }
  ): Promise<Uint8Array> {
    // Convert to Uint8Array for easier manipulation
    const data = new Uint8Array(imageData);
    const { width, height, channels } = info;
    const edgeData = new Uint8Array(width * height);

    // Apply simple Sobel operator for edge detection
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;

        // Get 3x3 neighborhood
        const tl = data[(y - 1) * width * channels + (x - 1) * channels];
        const tc = data[(y - 1) * width * channels + x * channels];
        const tr = data[(y - 1) * width * channels + (x + 1) * channels];
        const ml = data[y * width * channels + (x - 1) * channels];
        const mr = data[y * width * channels + (x + 1) * channels];
        const bl = data[(y + 1) * width * channels + (x - 1) * channels];
        const bc = data[(y + 1) * width * channels + x * channels];
        const br = data[(y + 1) * width * channels + (x + 1) * channels];

        // Sobel X gradient
        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;

        // Sobel Y gradient
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

        // Gradient magnitude
        const magnitude = Math.sqrt(gx * gx + gy * gy);

        // Threshold
        edgeData[idx] =
          magnitude > this.config.cannyLowThreshold ? 255 : 0;
      }
    }

    return edgeData;
  }

  /**
   * Find artwork bounds by analyzing edge distribution
   * Frames typically have strong edges at their boundaries
   */
  private findArtworkBounds(
    edgeData: Uint8Array,
    width: number,
    height: number
  ): BoundingBox {
    // Calculate edge density for each row and column
    const rowEdges = new Uint32Array(height);
    const colEdges = new Uint32Array(width);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (edgeData[idx] > 0) {
          rowEdges[y]++;
          colEdges[x]++;
        }
      }
    }

    // Find top edge (first significant jump in edge density)
    const top = this.findEdgeBoundary(rowEdges, 'forward');

    // Find bottom edge (last significant jump in edge density)
    const bottom = this.findEdgeBoundary(rowEdges, 'backward');

    // Find left edge
    const left = this.findEdgeBoundary(colEdges, 'forward');

    // Find right edge
    const right = this.findEdgeBoundary(colEdges, 'backward');

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  /**
   * Find edge boundary by detecting significant changes in edge density
   * Uses a more sophisticated approach to find frame boundaries
   */
  private findEdgeBoundary(
    edgeDensity: Uint32Array,
    direction: 'forward' | 'backward'
  ): number {
    const length = edgeDensity.length;
    const start = direction === 'forward' ? 0 : length - 1;
    const end = direction === 'forward' ? length : -1;
    const step = direction === 'forward' ? 1 : -1;

    // Calculate statistics
    const densityArray = Array.from(edgeDensity);
    const sortedDensity = [...densityArray].sort((a, b) => b - a);
    const maxDensity = sortedDensity[0];
    const medianDensity = sortedDensity[Math.floor(sortedDensity.length / 2)];

    // Use median instead of mean to be more robust to outliers
    const threshold = Math.max(medianDensity * 1.5, maxDensity * 0.3);

    // Find the first significant peak (frame edge)
    let peakFound = false;
    let peakPosition = start;
    let boundary = start;

    // Look for a sustained high-density region (frame edge)
    for (let i = start; i !== end; i += step) {
      const density = edgeDensity[i];

      if (density > threshold && !peakFound) {
        peakFound = true;
        peakPosition = i;
      }

      // After finding peak, look for significant drop (entering artwork)
      if (peakFound) {
        // Check if we've moved significantly past the peak
        const distanceFromPeak = Math.abs(i - peakPosition);

        if (distanceFromPeak > 2 && density < threshold * 0.4) {
          boundary = i;
          break;
        }
      }
    }

    // If no boundary found, use conservative estimate
    if (!peakFound) {
      boundary = direction === 'forward' ?
        Math.floor(length * 0.05) : // 5% from edge
        Math.floor(length * 0.95);   // 95% position
    }

    return boundary;
  }

  /**
   * Calculate confidence score based on detection quality
   */
  private calculateConfidence(
    boundingBox: BoundingBox,
    originalDimensions: ImageDimensions
  ): number {
    const originalArea =
      originalDimensions.width * originalDimensions.height;
    const croppedArea = boundingBox.width * boundingBox.height;
    const cropRatio = croppedArea / originalArea;

    // Start with base confidence
    let confidence = 0.3;

    // 1. Crop ratio should be reasonable
    // Award more confidence for moderate cropping (indicates frame present)
    if (cropRatio >= 0.5 && cropRatio <= 0.85) {
      // Optimal range - clear frame detected
      confidence += 0.4;
    } else if (cropRatio >= 0.3 && cropRatio < 0.5) {
      // Heavy cropping - possible thick frame
      confidence += 0.25;
    } else if (cropRatio > 0.85 && cropRatio <= 0.95) {
      // Light cropping - thin frame
      confidence += 0.2;
    } else if (cropRatio > 0.95) {
      // Very little cropping - likely no frame
      confidence -= 0.3;
    }

    // 2. Bounding box should be reasonably centered
    const centerX = boundingBox.x + boundingBox.width / 2;
    const centerY = boundingBox.y + boundingBox.height / 2;
    const imageCenterX = originalDimensions.width / 2;
    const imageCenterY = originalDimensions.height / 2;

    const centerOffsetX = Math.abs(centerX - imageCenterX) / imageCenterX;
    const centerOffsetY = Math.abs(centerY - imageCenterY) / imageCenterY;

    if (centerOffsetX < 0.15 && centerOffsetY < 0.15) {
      confidence += 0.2;
    } else if (centerOffsetX < 0.25 && centerOffsetY < 0.25) {
      confidence += 0.1;
    }

    // 3. Aspect ratio should be preserved (roughly)
    const originalAspect =
      originalDimensions.width / originalDimensions.height;
    const croppedAspect = boundingBox.width / boundingBox.height;
    const aspectDiff = Math.abs(originalAspect - croppedAspect) / originalAspect;

    if (aspectDiff < 0.15) {
      confidence += 0.1;
    } else if (aspectDiff > 0.4) {
      // Significant aspect ratio change - suspicious
      confidence -= 0.2;
    }

    // Normalize to 0-1 range
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Validate detection result
   */
  private validateDetection(
    boundingBox: BoundingBox,
    originalDimensions: ImageDimensions,
    confidence: number
  ): boolean {
    // Check confidence threshold
    if (confidence < this.config.minConfidence) {
      return false;
    }

    // Check crop ratio
    const originalArea =
      originalDimensions.width * originalDimensions.height;
    const croppedArea = boundingBox.width * boundingBox.height;
    const cropRatio = croppedArea / originalArea;

    if (
      cropRatio < this.config.minCropPercentage ||
      cropRatio > this.config.maxCropPercentage
    ) {
      return false;
    }

    // Check that bounding box is within image bounds
    if (
      boundingBox.x < 0 ||
      boundingBox.y < 0 ||
      boundingBox.x + boundingBox.width > originalDimensions.width ||
      boundingBox.y + boundingBox.height > originalDimensions.height
    ) {
      return false;
    }

    return true;
  }
}
