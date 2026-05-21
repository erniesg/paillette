/**
 * Artwork Segmenter using SAM3 via fal.ai
 * Uses Segment Anything Model 3 to intelligently detect and extract artwork from frames
 */

import { fal } from '@fal-ai/client';
import type { BoundingBox, ImageDimensions, FrameDetectionResult } from './types';

/**
 * SAM3 segmentation result from fal.ai
 */
interface Sam3Result {
  image?: {
    url: string;
    width: number;
    height: number;
  };
  masks?: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  metadata?: Array<{
    index: number;
    score: number;
    box?: [number, number, number, number]; // [cx, cy, w, h] normalized
  }>;
  scores?: number[];
  boxes?: Array<[number, number, number, number]>; // normalized cxcywh
}

/**
 * Configuration for artwork segmentation
 */
export interface ArtworkSegmentationConfig {
  /** Text prompt for segmentation. Default: "painting artwork canvas" */
  textPrompt: string;
  /** Minimum confidence score to accept. Default: 0.5 */
  minConfidence: number;
  /** Whether to return multiple mask options. Default: true */
  returnMultipleMasks: boolean;
  /** Maximum masks to consider. Default: 3 */
  maxMasks: number;
  /** Output format for mask. Default: "png" */
  outputFormat: 'png' | 'webp' | 'jpeg';
  /** FAL API key (required) */
  apiKey: string;
}

/**
 * Default configuration
 */
export const DEFAULT_SEGMENTATION_CONFIG: Omit<ArtworkSegmentationConfig, 'apiKey'> = {
  textPrompt: 'painting artwork canvas picture photograph',
  minConfidence: 0.5,
  returnMultipleMasks: true,
  maxMasks: 3,
  outputFormat: 'png',
};

/**
 * Result of artwork segmentation
 */
export interface ArtworkSegmentationResult {
  success: boolean;
  /** Detected artwork bounding box (in pixels) */
  boundingBox: BoundingBox | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** URL to the mask image (white = artwork, black = frame) */
  maskUrl: string | null;
  /** Original image dimensions */
  originalDimensions: ImageDimensions;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Error message if failed */
  error?: string;
  /** All detected masks with scores (for debugging/manual selection) */
  allMasks?: Array<{
    url: string;
    score: number;
    box: BoundingBox;
  }>;
}

/**
 * ArtworkSegmenter - Uses SAM3 to detect artwork boundaries
 */
export class ArtworkSegmenter {
  private config: ArtworkSegmentationConfig;

  constructor(config: Partial<ArtworkSegmentationConfig> & { apiKey: string }) {
    this.config = {
      ...DEFAULT_SEGMENTATION_CONFIG,
      ...config,
    };

    // Configure fal client
    fal.config({
      credentials: this.config.apiKey,
    });
  }

  /**
   * Segment artwork from an image URL
   * @param imageUrl - Public URL to the image (R2 public URL)
   * @returns Segmentation result with bounding box
   */
  async segment(imageUrl: string): Promise<ArtworkSegmentationResult> {
    const startTime = Date.now();

    try {
      // Call SAM3 via fal.ai with text prompt
      const result = await fal.subscribe('fal-ai/sam-3/image', {
        input: {
          image_url: imageUrl,
          text_prompt: this.config.textPrompt,
          apply_mask: false, // We want the mask, not the masked image
          output_format: this.config.outputFormat,
          return_multiple_masks: this.config.returnMultipleMasks,
          max_masks: this.config.maxMasks,
          include_scores: true,
          include_boxes: true,
        },
      }) as { data: Sam3Result };

      const data = result.data;
      const processingTimeMs = Date.now() - startTime;

      // Get image dimensions from the first mask or image
      const width = data.masks?.[0]?.width || data.image?.width || 0;
      const height = data.masks?.[0]?.height || data.image?.height || 0;

      if (!data.masks || data.masks.length === 0) {
        return {
          success: false,
          boundingBox: null,
          confidence: 0,
          maskUrl: null,
          originalDimensions: { width, height },
          processingTimeMs,
          error: 'No masks detected - image may not contain a framed artwork',
        };
      }

      // Process all masks with their scores and boxes
      const allMasks = data.masks.map((mask, index) => {
        const score = data.metadata?.[index]?.score ?? data.scores?.[index] ?? 0;
        const normalizedBox = data.metadata?.[index]?.box ?? data.boxes?.[index];

        // Convert normalized cxcywh to pixel bbox
        let box: BoundingBox;
        if (normalizedBox) {
          const [cx, cy, w, h] = normalizedBox;
          box = {
            x: Math.round((cx - w / 2) * width),
            y: Math.round((cy - h / 2) * height),
            width: Math.round(w * width),
            height: Math.round(h * height),
          };
        } else {
          // Fallback: use full image
          box = { x: 0, y: 0, width, height };
        }

        return {
          url: mask.url,
          score,
          box,
        };
      });

      // Sort by score and pick the best one above threshold
      const validMasks = allMasks
        .filter(m => m.score >= this.config.minConfidence)
        .sort((a, b) => b.score - a.score);

      if (validMasks.length === 0) {
        // No mask above confidence threshold - likely no frame
        const firstMask = allMasks[0];
        return {
          success: true,
          boundingBox: null,
          confidence: firstMask?.score || 0,
          maskUrl: null,
          originalDimensions: { width, height },
          processingTimeMs,
          allMasks,
          error: 'No artwork detected with sufficient confidence - may not have a frame',
        };
      }

      const bestMask = validMasks[0];
      if (!bestMask) {
        return {
          success: false,
          boundingBox: null,
          confidence: 0,
          maskUrl: null,
          originalDimensions: { width, height },
          processingTimeMs,
          error: 'Unexpected: valid masks array is empty',
        };
      }

      return {
        success: true,
        boundingBox: bestMask.box,
        confidence: bestMask.score,
        maskUrl: bestMask.url,
        originalDimensions: { width, height },
        processingTimeMs,
        allMasks,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        boundingBox: null,
        confidence: 0,
        maskUrl: null,
        originalDimensions: { width: 0, height: 0 },
        processingTimeMs,
        error: `SAM3 segmentation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Segment with point prompts (for interactive selection)
   * @param imageUrl - Public URL to the image
   * @param points - Array of point prompts (foreground/background)
   */
  async segmentWithPoints(
    imageUrl: string,
    points: Array<{ x: number; y: number; label: 0 | 1 }>
  ): Promise<ArtworkSegmentationResult> {
    const startTime = Date.now();

    try {
      const result = await fal.subscribe('fal-ai/sam-3/image', {
        input: {
          image_url: imageUrl,
          prompts: points.map(p => ({
            x: p.x,
            y: p.y,
            label: p.label,
          })),
          apply_mask: false,
          output_format: this.config.outputFormat,
          return_multiple_masks: this.config.returnMultipleMasks,
          max_masks: this.config.maxMasks,
          include_scores: true,
          include_boxes: true,
        },
      }) as { data: Sam3Result };

      // Same processing as text prompt...
      const data = result.data;
      const processingTimeMs = Date.now() - startTime;
      const width = data.masks?.[0]?.width || 0;
      const height = data.masks?.[0]?.height || 0;

      if (!data.masks || data.masks.length === 0) {
        return {
          success: false,
          boundingBox: null,
          confidence: 0,
          maskUrl: null,
          originalDimensions: { width, height },
          processingTimeMs,
          error: 'No masks detected from point prompts',
        };
      }

      const bestMask = data.masks[0];
      if (!bestMask) {
        return {
          success: false,
          boundingBox: null,
          confidence: 0,
          maskUrl: null,
          originalDimensions: { width, height },
          processingTimeMs,
          error: 'No mask returned from point-based segmentation',
        };
      }

      const score = data.metadata?.[0]?.score ?? data.scores?.[0] ?? 0.8;
      const normalizedBox = data.metadata?.[0]?.box ?? data.boxes?.[0];

      let boundingBox: BoundingBox;
      if (normalizedBox) {
        const [cx, cy, w, h] = normalizedBox;
        boundingBox = {
          x: Math.round((cx - w / 2) * width),
          y: Math.round((cy - h / 2) * height),
          width: Math.round(w * width),
          height: Math.round(h * height),
        };
      } else {
        boundingBox = { x: 0, y: 0, width, height };
      }

      return {
        success: true,
        boundingBox,
        confidence: score,
        maskUrl: bestMask.url,
        originalDimensions: { width, height },
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      return {
        success: false,
        boundingBox: null,
        confidence: 0,
        maskUrl: null,
        originalDimensions: { width: 0, height: 0 },
        processingTimeMs,
        error: `Point-based segmentation failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Convert segmentation result to FrameDetectionResult for compatibility
   */
  toFrameDetectionResult(segResult: ArtworkSegmentationResult): FrameDetectionResult {
    return {
      hasFrame: segResult.boundingBox !== null,
      confidence: segResult.confidence,
      boundingBox: segResult.boundingBox,
      method: 'ai-model',
      originalDimensions: segResult.originalDimensions,
      croppedDimensions: segResult.boundingBox
        ? { width: segResult.boundingBox.width, height: segResult.boundingBox.height }
        : null,
    };
  }
}
