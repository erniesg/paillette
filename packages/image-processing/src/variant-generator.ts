/**
 * Image Variant Generator
 * Creates multiple sizes and formats from a source image
 * Optimized for web delivery and archival storage
 */

import sharp from 'sharp';
import type { ImageDimensions, BoundingBox } from './types';

/**
 * Variant definition
 */
export interface VariantDefinition {
  /** Variant name (used as suffix) */
  name: string;
  /** Maximum width in pixels (height scales proportionally) */
  maxWidth: number;
  /** Maximum height in pixels (optional, defaults to maxWidth) */
  maxHeight?: number;
  /** Output format */
  format: 'jpeg' | 'webp' | 'png' | 'avif';
  /** Quality (1-100 for lossy formats) */
  quality: number;
  /** Whether to apply sharpening after resize */
  sharpen?: boolean;
  /** For JPEG: use mozjpeg encoder */
  mozjpeg?: boolean;
  /** For PNG: compression level (0-9) */
  compressionLevel?: number;
}

/**
 * Standard variant presets
 */
export const VARIANT_PRESETS = {
  /** Full resolution WebP for archival/high-quality display */
  master: {
    name: 'master',
    maxWidth: 4096,
    maxHeight: 4096,
    format: 'webp',
    quality: 95,
    sharpen: false,
  },
  /** Web-optimized for gallery views */
  web: {
    name: 'web',
    maxWidth: 2048,
    maxHeight: 2048,
    format: 'webp',
    quality: 85,
    sharpen: true,
  },
  /** Thumbnail for grids and search results */
  thumb: {
    name: 'thumb',
    maxWidth: 512,
    maxHeight: 512,
    format: 'webp',
    quality: 80,
    sharpen: true,
  },
  /** Small preview for quick loading */
  preview: {
    name: 'preview',
    maxWidth: 256,
    maxHeight: 256,
    format: 'webp',
    quality: 75,
    sharpen: false,
  },
  /** JPEG fallback for older browsers */
  web_jpg: {
    name: 'web_jpg',
    maxWidth: 2048,
    maxHeight: 2048,
    format: 'jpeg',
    quality: 85,
    mozjpeg: true,
    sharpen: true,
  },
  /** JPEG thumbnail fallback */
  thumb_jpg: {
    name: 'thumb_jpg',
    maxWidth: 512,
    maxHeight: 512,
    format: 'jpeg',
    quality: 80,
    mozjpeg: true,
    sharpen: true,
  },
} as const satisfies Record<string, VariantDefinition>;

/**
 * Result of variant generation
 */
export interface VariantResult {
  /** Variant name */
  name: string;
  /** Generated image buffer */
  buffer: Buffer;
  /** Output format */
  format: string;
  /** Output dimensions */
  dimensions: ImageDimensions;
  /** File size in bytes */
  sizeBytes: number;
  /** MIME type */
  mimeType: string;
}

/**
 * Configuration for variant generation
 */
export interface VariantGeneratorConfig {
  /** Which variants to generate */
  variants: VariantDefinition[];
  /** Whether to preserve original aspect ratio */
  preserveAspectRatio: boolean;
  /** Background color for padding (if not preserving aspect ratio) */
  backgroundColor?: string;
}

/**
 * Get default variants as an array
 */
function getDefaultVariants(): VariantDefinition[] {
  return [
    { ...VARIANT_PRESETS.master },
    { ...VARIANT_PRESETS.web },
    { ...VARIANT_PRESETS.thumb },
    { ...VARIANT_PRESETS.preview },
  ];
}

/**
 * Default configuration using common web variants
 */
export const DEFAULT_VARIANT_CONFIG: VariantGeneratorConfig = {
  variants: getDefaultVariants(),
  preserveAspectRatio: true,
};

/**
 * VariantGenerator - Creates multiple image variants from a source
 */
export class VariantGenerator {
  private config: VariantGeneratorConfig;

  constructor(config: Partial<VariantGeneratorConfig> = {}) {
    this.config = {
      ...DEFAULT_VARIANT_CONFIG,
      ...config,
      variants: config.variants || DEFAULT_VARIANT_CONFIG.variants,
    };
  }

  /**
   * Generate all configured variants from a source image
   * @param sourceBuffer - Source image buffer (any format Sharp supports)
   * @param cropBox - Optional bounding box to crop before generating variants
   */
  async generateAll(
    sourceBuffer: Buffer,
    cropBox?: BoundingBox
  ): Promise<VariantResult[]> {
    const results: VariantResult[] = [];

    // Pre-process: apply crop if specified
    let processedBuffer = sourceBuffer;
    if (cropBox) {
      processedBuffer = await sharp(sourceBuffer)
        .extract({
          left: cropBox.x,
          top: cropBox.y,
          width: cropBox.width,
          height: cropBox.height,
        })
        .toBuffer();
    }

    // Generate each variant
    for (const variant of this.config.variants) {
      try {
        const result = await this.generateVariant(processedBuffer, variant);
        results.push(result);
      } catch (error) {
        console.error(`Failed to generate variant ${variant.name}:`, error);
        // Continue with other variants
      }
    }

    return results;
  }

  /**
   * Generate a single variant
   */
  async generateVariant(
    sourceBuffer: Buffer,
    variant: VariantDefinition
  ): Promise<VariantResult> {
    let pipeline = sharp(sourceBuffer);

    // Resize with aspect ratio preservation
    pipeline = pipeline.resize({
      width: variant.maxWidth,
      height: variant.maxHeight || variant.maxWidth,
      fit: this.config.preserveAspectRatio ? 'inside' : 'cover',
      withoutEnlargement: true, // Don't upscale
    });

    // Apply sharpening if requested (useful after downscaling)
    if (variant.sharpen) {
      pipeline = pipeline.sharpen({
        sigma: 0.5,
        m1: 0.5,
        m2: 0.5,
      });
    }

    // Apply format-specific encoding
    switch (variant.format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality: variant.quality,
          mozjpeg: variant.mozjpeg ?? true,
        });
        break;
      case 'webp':
        pipeline = pipeline.webp({
          quality: variant.quality,
          effort: 4, // Balance between speed and compression
        });
        break;
      case 'png':
        pipeline = pipeline.png({
          compressionLevel: variant.compressionLevel ?? 6,
          adaptiveFiltering: true,
        });
        break;
      case 'avif':
        pipeline = pipeline.avif({
          quality: variant.quality,
          effort: 4,
        });
        break;
    }

    const { data: buffer, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      name: variant.name,
      buffer,
      format: variant.format,
      dimensions: {
        width: info.width,
        height: info.height,
      },
      sizeBytes: buffer.length,
      mimeType: this.getMimeType(variant.format),
    };
  }

  /**
   * Generate variants for both original and processed (frame-removed) images
   */
  async generateAllWithProcessed(
    originalBuffer: Buffer,
    processedBuffer: Buffer | null
  ): Promise<{
    original: VariantResult[];
    processed: VariantResult[];
  }> {
    const original = await this.generateAll(originalBuffer);
    const processed = processedBuffer
      ? await this.generateAll(processedBuffer)
      : [];

    return { original, processed };
  }

  /**
   * Get original image metadata
   */
  async getMetadata(buffer: Buffer): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
    hasAlpha: boolean;
    isAnimated: boolean;
  }> {
    const metadata = await sharp(buffer).metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: buffer.length,
      hasAlpha: metadata.hasAlpha || false,
      isAnimated: (metadata.pages || 1) > 1,
    };
  }

  /**
   * Convert large TIFF to WebP for API calls
   * Reduces file size significantly while preserving quality
   */
  async convertForApi(
    sourceBuffer: Buffer,
    maxDimension: number = 2048
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await sharp(sourceBuffer)
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer();

    return {
      buffer,
      mimeType: 'image/webp',
    };
  }

  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      webp: 'image/webp',
      png: 'image/png',
      avif: 'image/avif',
      gif: 'image/gif',
      tiff: 'image/tiff',
    };
    return mimeTypes[format] || 'application/octet-stream';
  }
}

/**
 * Helper to get file extension from variant
 */
export function getVariantExtension(variant: VariantDefinition): string {
  return variant.format === 'jpeg' ? 'jpg' : variant.format;
}

/**
 * Generate R2 key for a variant
 */
export function getVariantKey(
  baseKey: string,
  variantName: string,
  format: string
): string {
  const ext = format === 'jpeg' ? 'jpg' : format;
  const baseName = baseKey.replace(/\.[^.]+$/, ''); // Remove extension
  return `${baseName}_${variantName}.${ext}`;
}
