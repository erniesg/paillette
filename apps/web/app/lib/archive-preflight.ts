/**
 * What an archive will actually become, worked out before a single byte is
 * uploaded.
 *
 * The server plans the same thing again (`planIndexJob` in
 * `apps/api/src/routes/indexing.ts`) and is the authority. This is the
 * *honesty* pass: the zip is already open in the browser, so the page can tell
 * a visitor "63 images, the first 40 will be indexed" while they still have the
 * chance to send something else — rather than letting them wait through an
 * upload and then reading the truth out of a job status.
 *
 * Pure, so it is testable without a network or a DOM.
 */

import type { ParsedZip } from './indexing-client';
import { INDEX_CAPS, type IndexCaps } from './webmcp/caps';

export type ArchivePreflight = {
  /** Indexable images found in the archive, before any cap is applied. */
  imageCount: number;
  /** How many of them this job will actually accept. */
  willIndex: number;
  /** Images dropped because the archive exceeds the per-job image cap. */
  overCapCount: number;
  /** Names of images larger than the per-image ceiling. */
  oversizeNames: string[];
  /** Real entries that are not indexable images (docs, stray files). */
  skippedNames: string[];
  /** Total bytes of the images that will be uploaded. */
  uploadBytes: number;
  /** True when the archive is over the whole-job byte budget. */
  overBudget: boolean;
  /** True when a CSV sidecar was found and mapped to at least one row. */
  hasMetadata: boolean;
  /** Entries that could not even be listed. Never fatal on their own. */
  unreadable: string[];
  /** One line each, written for the visitor. Empty when nothing is amiss. */
  warnings: string[];
  /** When set, nothing can be indexed and the reason is final. */
  blocker: string | null;
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Order matters: oversize images are rejected first (the server rejects them
 * too), and only what survives is measured against the per-job image cap.
 */
export const preflightArchive = (
  parsed: Pick<ParsedZip, 'images' | 'skipped' | 'metadata' | 'errors'>,
  caps: IndexCaps = INDEX_CAPS
): ArchivePreflight => {
  const oversize = parsed.images.filter(
    (image) => image.size > caps.maxImageBytes
  );
  const usable = parsed.images.filter(
    (image) => image.size <= caps.maxImageBytes
  );

  const willIndex = Math.min(usable.length, caps.maxImagesPerJob);
  const overCapCount = Math.max(0, usable.length - caps.maxImagesPerJob);
  const uploadBytes = usable
    .slice(0, willIndex)
    .reduce((total, image) => total + image.size, 0);
  const overBudget = uploadBytes > caps.maxJobBytes;

  const warnings: string[] = [];
  if (overCapCount > 0) {
    warnings.push(
      `This archive holds ${plural(usable.length, 'image')}. Anonymous jobs index the first ${caps.maxImagesPerJob}, so ${plural(overCapCount, 'image')} will be left out.`
    );
  }
  if (oversize.length > 0) {
    warnings.push(
      `${plural(oversize.length, 'image')} exceed the ${Math.round(caps.maxImageBytes / (1024 * 1024))} MB per-image limit and will be skipped: ${oversize
        .slice(0, 3)
        .map((image) => image.name)
        .join(', ')}${oversize.length > 3 ? '…' : ''}`
    );
  }
  if (parsed.skipped.length > 0) {
    warnings.push(
      `${plural(parsed.skipped.length, 'entry')} in the archive ${parsed.skipped.length === 1 ? 'is' : 'are'} not an indexable image and will be reported as skipped.`
    );
  }
  if (parsed.errors.length > 0) {
    warnings.push(
      `${plural(parsed.errors.length, 'entry')} could not be read out of the archive.`
    );
  }

  let blocker: string | null = null;
  if (willIndex === 0) {
    blocker =
      parsed.images.length === 0
        ? `No indexable images were found in this archive. Supported types: ${caps.imageTypes.join(', ')}.`
        : `Every image in this archive is larger than the ${Math.round(caps.maxImageBytes / (1024 * 1024))} MB per-image limit.`;
  } else if (overBudget) {
    blocker = `This archive would upload ${(uploadBytes / (1024 * 1024)).toFixed(0)} MB, over the ${Math.round(caps.maxJobBytes / (1024 * 1024))} MB per-job budget. Send fewer images.`;
  }

  return {
    imageCount: parsed.images.length,
    willIndex,
    overCapCount,
    oversizeNames: oversize.map((image) => image.name),
    skippedNames: parsed.skipped.map((entry) => entry.name),
    uploadBytes,
    overBudget,
    hasMetadata: Object.keys(parsed.metadata).length > 0,
    unreadable: parsed.errors.map((error) => error.file),
    warnings,
    blocker,
  };
};
