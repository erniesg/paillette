/**
 * Image Processing Package
 * Frame detection and removal for artwork images
 */

// Legacy edge-detection based frame detector
export { FrameDetector } from './frame-detector';

// SAM3-based artwork segmentation (recommended for production)
export { ArtworkSegmenter } from './artwork-segmenter';
export type {
  ArtworkSegmentationConfig,
  ArtworkSegmentationResult,
} from './artwork-segmenter';

// Image variant generation (multiple sizes/formats)
export {
  VariantGenerator,
  VARIANT_PRESETS,
  getVariantKey,
  getVariantExtension,
} from './variant-generator';
export type {
  VariantDefinition,
  VariantResult,
  VariantGeneratorConfig,
} from './variant-generator';

// Complete artwork processing pipeline
export { ArtworkProcessor, removeFrame } from './artwork-processor';
export type {
  ArtworkProcessingOptions,
  ArtworkProcessingResult,
} from './artwork-processor';

// Types
export * from './types';
