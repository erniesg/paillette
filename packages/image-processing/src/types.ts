/**
 * Image Processing Types
 * Types for frame detection and removal
 */

/**
 * Bounding box representing the detected artwork region
 */
export interface BoundingBox {
  x: number; // Left coordinate (px)
  y: number; // Top coordinate (px)
  width: number; // Width (px)
  height: number; // Height (px)
}

/**
 * Image dimensions
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Result of frame detection analysis
 */
export interface FrameDetectionResult {
  hasFrame: boolean; // Whether a frame was detected
  confidence: number; // Confidence score (0.0 to 1.0)
  boundingBox: BoundingBox | null; // Detected artwork region (null if no frame)
  method: 'edge-detection' | 'contour-analysis' | 'ai-model'; // Detection method used
  originalDimensions: ImageDimensions;
  croppedDimensions: ImageDimensions | null;
}

/**
 * Result of frame removal operation
 */
export interface FrameRemovalResult {
  success: boolean;
  originalImageBuffer: Buffer;
  processedImageBuffer: Buffer | null;
  detection: FrameDetectionResult;
  error?: string;
  processingTimeMs: number;
}

/**
 * Configuration for frame detection
 */
export interface FrameDetectionConfig {
  // Edge detection parameters
  cannyLowThreshold: number; // Default: 50
  cannyHighThreshold: number; // Default: 150

  // Minimum confidence to accept result
  minConfidence: number; // Default: 0.6

  // Minimum percentage of image that must be retained
  minCropPercentage: number; // Default: 0.3 (30%)

  // Maximum percentage of image that can be cropped
  maxCropPercentage: number; // Default: 0.9 (90%)

  // Blur kernel size for preprocessing
  blurKernelSize: number; // Default: 5
}

/**
 * Default frame detection configuration
 */
export const DEFAULT_FRAME_DETECTION_CONFIG: FrameDetectionConfig = {
  cannyLowThreshold: 50,
  cannyHighThreshold: 150,
  minConfidence: 0.5, // Lowered from 0.6 to support thin frames
  minCropPercentage: 0.3,
  maxCropPercentage: 0.99, // Increased from 0.9 to support very thin frames
  blurKernelSize: 5,
};

/**
 * Processing status for tracking
 */
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Frame removal job for queue processing
 */
export interface FrameRemovalJob {
  artworkId: string;
  imageUrl: string;
  galleryId: string;
  config?: Partial<FrameDetectionConfig>;
}

/**
 * Frame removal result for database update
 */
export interface FrameRemovalUpdate {
  artworkId: string;
  processedImageUrl: string | null;
  confidence: number;
  status: ProcessingStatus;
  error?: string;
  processedAt: string;
}
