/**
 * The anonymous indexing caps, in one place.
 *
 * These mirror `INDEXING_CAPS` in `apps/api/src/routes/indexing.ts`. They are
 * stated rather than hidden: the WebMCP tools return them with every job, and
 * the `/try` page prints them before a visitor picks a file, so nobody
 * discovers a limit by having an upload rejected halfway through.
 */

import { INDEX_ARCHIVE_MAX_BYTES, INDEX_FILE_MAX_BYTES } from './client';

export const INDEX_CAPS = {
  maxImagesPerJob: 100,
  maxImageBytes: INDEX_FILE_MAX_BYTES,
  maxJobBytes: INDEX_ARCHIVE_MAX_BYTES,
  maxJobsPerHour: 6,
  imageTypes: ['jpeg', 'png', 'webp', 'gif', 'avif'],
} as const;

export type IndexCaps = typeof INDEX_CAPS;

export const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));
