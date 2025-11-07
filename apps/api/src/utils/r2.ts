/**
 * R2 Storage Utilities
 * Handles image upload, retrieval, and deletion in Cloudflare R2
 */

import { randomUUID } from 'crypto';

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  contentType: string;
}

export interface ImageMetadata {
  originalFilename: string;
  uploadedBy: string;
  galleryId: string;
  width?: number;
  height?: number;
  hash?: string;
}

/**
 * Upload an image to R2 storage
 */
export async function uploadImage(
  bucket: R2Bucket,
  file: File | ArrayBuffer,
  metadata: ImageMetadata
): Promise<UploadResult> {
  const extension = metadata.originalFilename.split('.').pop() || 'jpg';
  const key = `artworks/${metadata.galleryId}/${randomUUID()}.${extension}`;

  const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;

  // Upload to R2 with metadata
  await bucket.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: getContentType(extension),
    },
    customMetadata: {
      originalFilename: metadata.originalFilename,
      uploadedBy: metadata.uploadedBy,
      galleryId: metadata.galleryId,
      uploadedAt: new Date().toISOString(),
      ...(metadata.width && { width: metadata.width.toString() }),
      ...(metadata.height && { height: metadata.height.toString() }),
      ...(metadata.hash && { hash: metadata.hash }),
    },
  });

  return {
    key,
    url: `https://images.paillette.art/${key}`, // TODO: Configure custom domain
    size: arrayBuffer.byteLength,
    contentType: getContentType(extension),
  };
}

/**
 * Upload a thumbnail to R2 storage
 */
export async function uploadThumbnail(
  bucket: R2Bucket,
  imageData: ArrayBuffer,
  originalKey: string,
  metadata: Partial<ImageMetadata>
): Promise<UploadResult> {
  // Generate thumbnail key from original key
  const thumbnailKey = originalKey.replace(
    /(\.[^.]+)$/,
    '_thumb$1'
  );

  await bucket.put(thumbnailKey, imageData, {
    httpMetadata: {
      contentType: 'image/jpeg', // Thumbnails are always JPEG
    },
    customMetadata: {
      type: 'thumbnail',
      originalKey,
      ...(metadata.uploadedBy && { uploadedBy: metadata.uploadedBy }),
      ...(metadata.galleryId && { galleryId: metadata.galleryId }),
      uploadedAt: new Date().toISOString(),
    },
  });

  return {
    key: thumbnailKey,
    url: `https://images.paillette.art/${thumbnailKey}`,
    size: imageData.byteLength,
    contentType: 'image/jpeg',
  };
}

/**
 * Get an image from R2 storage
 */
export async function getImage(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return await bucket.get(key);
}

/**
 * Delete an image and its thumbnail from R2 storage
 */
export async function deleteImage(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  // Delete main image
  await bucket.delete(key);

  // Delete thumbnail if it exists
  const thumbnailKey = key.replace(/(\.[^.]+)$/, '_thumb$1');
  await bucket.delete(thumbnailKey);
}

/**
 * Delete multiple images in batch
 */
export async function deleteImages(
  bucket: R2Bucket,
  keys: string[]
): Promise<void> {
  const deletePromises = keys.map((key) => deleteImage(bucket, key));
  await Promise.all(deletePromises);
}

/**
 * List images in a gallery
 */
export async function listGalleryImages(
  bucket: R2Bucket,
  galleryId: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<R2Objects> {
  return await bucket.list({
    prefix: `artworks/${galleryId}/`,
    limit: options?.limit || 1000,
    cursor: options?.cursor,
  });
}

/**
 * Get content type from file extension
 */
function getContentType(extension: string): string {
  const contentTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    tiff: 'image/tiff',
    tif: 'image/tiff',
  };

  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Check if a file is a valid image
 */
export function isValidImageType(contentType: string): boolean {
  const validTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/tiff',
  ];

  return validTypes.includes(contentType);
}

/**
 * Generate a unique storage key for an image
 */
export function generateImageKey(
  galleryId: string,
  filename: string
): string {
  const extension = filename.split('.').pop() || 'jpg';
  return `artworks/${galleryId}/${randomUUID()}.${extension}`;
}
