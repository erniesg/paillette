/**
 * Artwork Processor
 * Complete pipeline for processing artwork images:
 * 1. Validate and read source image
 * 2. Convert large files for API calls
 * 3. Segment artwork using SAM3 (detect frame)
 * 4. Crop to remove frame
 * 5. Generate multiple variants
 */

// sharp is used by VariantGenerator internally
import { ArtworkSegmenter, type ArtworkSegmentationResult } from './artwork-segmenter';
import {
  VariantGenerator,
  type VariantResult,
  type VariantDefinition,
  VARIANT_PRESETS,
  getVariantKey,
} from './variant-generator';
import type { BoundingBox, ImageDimensions, FrameRemovalResult } from './types';

/**
 * Processing options
 */
export interface ArtworkProcessingOptions {
  /** FAL API key for SAM3 */
  falApiKey: string;
  /** Public URL to the source image (for SAM3 API) */
  sourceUrl?: string;
  /** Text prompt for SAM3 segmentation */
  textPrompt?: string;
  /** Minimum confidence to accept frame detection */
  minConfidence?: number;
  /** Which variants to generate */
  variants?: VariantDefinition[];
  /** Skip frame removal (just generate variants) */
  skipFrameRemoval?: boolean;
  /** Force frame removal even if confidence is low */
  forceFrameRemoval?: boolean;
}

/**
 * Complete processing result
 */
export interface ArtworkProcessingResult {
  success: boolean;
  /** Frame detection result */
  segmentation: ArtworkSegmentationResult | null;
  /** Generated variants for original image */
  originalVariants: VariantResult[];
  /** Generated variants for processed (frame-removed) image */
  processedVariants: VariantResult[];
  /** Original image metadata */
  metadata: {
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
  };
  /** Processing timing */
  timing: {
    totalMs: number;
    segmentationMs: number;
    variantGenerationMs: number;
  };
  /** Error message if failed */
  error?: string;
}

/**
 * ArtworkProcessor - Complete artwork processing pipeline
 */
export class ArtworkProcessor {
  private segmenter: ArtworkSegmenter;
  private variantGenerator: VariantGenerator;

  constructor(options: { falApiKey: string; variants?: VariantDefinition[] }) {
    this.segmenter = new ArtworkSegmenter({
      apiKey: options.falApiKey,
    });
    const defaultVariants: VariantDefinition[] = [
      { ...VARIANT_PRESETS.master },
      { ...VARIANT_PRESETS.web },
      { ...VARIANT_PRESETS.thumb },
      { ...VARIANT_PRESETS.preview },
    ];
    this.variantGenerator = new VariantGenerator({
      variants: options.variants || defaultVariants,
    });
  }

  /**
   * Process an artwork image
   * @param sourceBuffer - Original image buffer (TIFF, JPEG, PNG, etc.)
   * @param options - Processing options
   */
  async process(
    sourceBuffer: Buffer,
    options: ArtworkProcessingOptions
  ): Promise<ArtworkProcessingResult> {
    const startTime = Date.now();
    let segmentationMs = 0;
    let variantGenerationMs = 0;

    try {
      // Get source metadata
      const metadata = await this.variantGenerator.getMetadata(sourceBuffer);

      // Check if we need to convert for API (large files)
      const apiImageUrl = options.sourceUrl;

      if (!apiImageUrl && metadata.size > 10 * 1024 * 1024) {
        // Convert large images for API call
        // Note: Would need to upload the converted buffer to get a URL for SAM3
        // For now, we skip segmentation if no URL is provided
        console.warn('Large image without URL - skipping SAM3 segmentation');
      }

      // Segment to detect frame
      let segmentation: ArtworkSegmentationResult | null = null;
      let cropBox: BoundingBox | null = null;

      if (!options.skipFrameRemoval && apiImageUrl) {
        const segStartTime = Date.now();

        // Configure segmenter with custom prompt if provided
        if (options.textPrompt) {
          this.segmenter = new ArtworkSegmenter({
            apiKey: options.falApiKey,
            textPrompt: options.textPrompt,
            minConfidence: options.minConfidence || 0.5,
          });
        }

        segmentation = await this.segmenter.segment(apiImageUrl);
        segmentationMs = Date.now() - segStartTime;

        // Determine if we should crop
        const shouldCrop =
          segmentation.success &&
          segmentation.boundingBox &&
          (segmentation.confidence >= (options.minConfidence || 0.5) || options.forceFrameRemoval);

        if (shouldCrop && segmentation.boundingBox) {
          // Scale bounding box if we used a resized image for API
          cropBox = this.scaleBoundingBox(
            segmentation.boundingBox,
            segmentation.originalDimensions,
            { width: metadata.width, height: metadata.height }
          );
        }
      }

      // Generate variants
      const variantStartTime = Date.now();

      // Original variants (no cropping)
      const originalVariants = await this.variantGenerator.generateAll(sourceBuffer);

      // Processed variants (with cropping if frame detected)
      let processedVariants: VariantResult[] = [];
      if (cropBox) {
        processedVariants = await this.variantGenerator.generateAll(sourceBuffer, cropBox);
      }

      variantGenerationMs = Date.now() - variantStartTime;

      return {
        success: true,
        segmentation,
        originalVariants,
        processedVariants,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          sizeBytes: metadata.size,
        },
        timing: {
          totalMs: Date.now() - startTime,
          segmentationMs,
          variantGenerationMs,
        },
      };
    } catch (error) {
      return {
        success: false,
        segmentation: null,
        originalVariants: [],
        processedVariants: [],
        metadata: {
          width: 0,
          height: 0,
          format: 'unknown',
          sizeBytes: sourceBuffer.length,
        },
        timing: {
          totalMs: Date.now() - startTime,
          segmentationMs,
          variantGenerationMs,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process with manual crop box (skip SAM3)
   */
  async processWithCrop(
    sourceBuffer: Buffer,
    cropBox: BoundingBox
  ): Promise<{
    originalVariants: VariantResult[];
    processedVariants: VariantResult[];
  }> {
    const originalVariants = await this.variantGenerator.generateAll(sourceBuffer);
    const processedVariants = await this.variantGenerator.generateAll(sourceBuffer, cropBox);

    return { originalVariants, processedVariants };
  }

  /**
   * Generate only variants (no frame detection)
   */
  async generateVariantsOnly(sourceBuffer: Buffer): Promise<VariantResult[]> {
    return this.variantGenerator.generateAll(sourceBuffer);
  }

  /**
   * Scale bounding box from one image size to another
   */
  private scaleBoundingBox(
    box: BoundingBox,
    fromDimensions: ImageDimensions,
    toDimensions: ImageDimensions
  ): BoundingBox {
    const scaleX = toDimensions.width / fromDimensions.width;
    const scaleY = toDimensions.height / fromDimensions.height;

    return {
      x: Math.round(box.x * scaleX),
      y: Math.round(box.y * scaleY),
      width: Math.round(box.width * scaleX),
      height: Math.round(box.height * scaleY),
    };
  }

  /**
   * Create R2 keys for all variants
   */
  static createVariantKeys(
    baseKey: string,
    variants: VariantResult[],
    prefix: 'original' | 'processed' = 'original'
  ): Map<string, string> {
    const keys = new Map<string, string>();

    for (const variant of variants) {
      const key = getVariantKey(baseKey, `${prefix}_${variant.name}`, variant.format);
      keys.set(variant.name, key);
    }

    return keys;
  }
}

/**
 * Quick helper for simple frame removal
 */
export async function removeFrame(
  imageBuffer: Buffer,
  imageUrl: string,
  falApiKey: string
): Promise<FrameRemovalResult> {
  const startTime = Date.now();

  const processor = new ArtworkProcessor({ falApiKey });
  const result = await processor.process(imageBuffer, {
    falApiKey,
    sourceUrl: imageUrl,
  });

  // Find the web variant for processed image
  const processedBuffer = result.processedVariants.find(v => v.name === 'web')?.buffer || null;

  return {
    success: result.success,
    originalImageBuffer: imageBuffer,
    processedImageBuffer: processedBuffer,
    detection: result.segmentation
      ? processor['segmenter'].toFrameDetectionResult(result.segmentation)
      : {
          hasFrame: false,
          confidence: 0,
          boundingBox: null,
          method: 'ai-model',
          originalDimensions: { width: result.metadata.width, height: result.metadata.height },
          croppedDimensions: null,
        },
    processingTimeMs: Date.now() - startTime,
    error: result.error,
  };
}
