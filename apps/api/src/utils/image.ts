/**
 * Image Validation and Processing Utilities
 */

export interface ImageValidationConfig {
  maxSizeBytes: number;
  maxWidthPx: number;
  maxHeightPx: number;
  minWidthPx: number;
  minHeightPx: number;
  allowedTypes: string[];
}

export interface ImageInfo {
  width: number;
  height: number;
  size: number;
  type: string;
  hash: string;
}

export const DEFAULT_IMAGE_CONFIG: ImageValidationConfig = {
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
  maxWidthPx: 10000,
  maxHeightPx: 10000,
  minWidthPx: 100,
  minHeightPx: 100,
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/tiff',
  ],
};

/**
 * Validate image file
 */
export function validateImage(
  file: File,
  config: ImageValidationConfig = DEFAULT_IMAGE_CONFIG
): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > config.maxSizeBytes) {
    return {
      valid: false,
      error: `File size ${formatBytes(file.size)} exceeds maximum allowed size of ${formatBytes(config.maxSizeBytes)}`,
    };
  }

  // Check file type
  if (!config.allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} is not allowed. Allowed types: ${config.allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Generate SHA-256 hash of image data for deduplication
 */
export async function generateImageHash(
  data: ArrayBuffer
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract basic image metadata
 * Note: For full EXIF extraction, we would need a library like exif-js
 * This is a placeholder for basic validation
 */
export async function extractImageMetadata(
  file: File
): Promise<Partial<ImageInfo>> {
  const arrayBuffer = await file.arrayBuffer();
  const hash = await generateImageHash(arrayBuffer);

  // Basic metadata we can extract without additional libraries
  return {
    size: file.size,
    type: file.type,
    hash,
    // Note: Width/height would require image processing library
    // For now, we'll extract dimensions on the client side or use Cloudflare Images API
  };
}

/**
 * Validate image dimensions
 */
export function validateImageDimensions(
  width: number,
  height: number,
  config: ImageValidationConfig = DEFAULT_IMAGE_CONFIG
): { valid: boolean; error?: string } {
  if (width > config.maxWidthPx || height > config.maxHeightPx) {
    return {
      valid: false,
      error: `Image dimensions ${width}x${height} exceed maximum allowed ${config.maxWidthPx}x${config.maxHeightPx}`,
    };
  }

  if (width < config.minWidthPx || height < config.minHeightPx) {
    return {
      valid: false,
      error: `Image dimensions ${width}x${height} are below minimum required ${config.minWidthPx}x${config.minHeightPx}`,
    };
  }

  return { valid: true };
}

/**
 * Check for duplicate image by hash
 */
export async function checkDuplicateImage(
  db: D1Database,
  hash: string,
  galleryId: string
): Promise<boolean> {
  const result = await db
    .prepare('SELECT id FROM artworks WHERE image_hash = ? AND gallery_id = ?')
    .bind(hash, galleryId)
    .first();

  return result !== null;
}

/**
 * Format bytes to human readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Extract color palette from image data
 * This is a placeholder - in production, you would use:
 * - Cloudflare Images API
 * - Canvas API (client-side)
 * - A color extraction library
 */
export async function extractColorPalette(
  _imageData: ArrayBuffer
): Promise<string[]> {
  // TODO: Implement color extraction
  // Options:
  // 1. Use Cloudflare AI for color analysis
  // 2. Use a WebAssembly color extraction library
  // 3. Process on upload via queue worker
  return [];
}

/**
 * Generate thumbnail URL pattern
 */
export function getThumbnailUrl(originalUrl: string): string {
  return originalUrl.replace(/(\.[^.]+)$/, '_thumb$1');
}

/**
 * Parse image filename to extract metadata hints
 */
export function parseFilename(filename: string): {
  artist?: string;
  title?: string;
  year?: number;
} {
  // Common patterns:
  // artist_title_year.jpg
  // artist - title (year).jpg
  // title_year.jpg

  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

  // Try pattern: artist_title_year
  const underscorePattern = /^(.+?)_(.+?)_(\d{4})$/;
  const underscoreMatch = nameWithoutExt.match(underscorePattern);
  if (underscoreMatch) {
    return {
      artist: underscoreMatch[1].trim(),
      title: underscoreMatch[2].trim(),
      year: parseInt(underscoreMatch[3]),
    };
  }

  // Try pattern: artist - title (year)
  const dashPattern = /^(.+?)\s*-\s*(.+?)\s*\((\d{4})\)$/;
  const dashMatch = nameWithoutExt.match(dashPattern);
  if (dashMatch) {
    return {
      artist: dashMatch[1].trim(),
      title: dashMatch[2].trim(),
      year: parseInt(dashMatch[3]),
    };
  }

  // Try pattern: title_year
  const simplePattern = /^(.+?)_(\d{4})$/;
  const simpleMatch = nameWithoutExt.match(simplePattern);
  if (simpleMatch) {
    return {
      title: simpleMatch[1].trim(),
      year: parseInt(simpleMatch[2]),
    };
  }

  // Default: use filename as title
  return {
    title: nameWithoutExt.trim(),
  };
}
