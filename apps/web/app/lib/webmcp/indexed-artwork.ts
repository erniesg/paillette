/**
 * One projection from an indexed-collection hit to the artwork record the rest
 * of Paillette speaks.
 *
 * Shared deliberately: the `/try` page and `get_index_status` must produce the
 * *same* record for the same image, or the human's grid and the agent's result
 * set would drift apart the moment a zip becomes searchable.
 */

import type { ArtworkSearchResult } from '~/types';
import type { IndexedSearchResult } from '~/lib/indexing-client';

export const toIndexedArtwork = (
  result: IndexedSearchResult,
  collectionId: string,
  collectionName: string
): ArtworkSearchResult => ({
  id: result.id,
  galleryId: collectionId,
  ...(result.title ? { title: result.title } : {}),
  ...(result.artist ? { artist: result.artist } : {}),
  ...(typeof result.year === 'number' ? { year: result.year } : {}),
  imageUrl: result.imageUrl,
  thumbnailUrl: result.imageUrl,
  similarity: result.similarity,
  metadata: {
    ...(result.medium ? { medium: result.medium } : {}),
    ...(result.classification ? { classification: result.classification } : {}),
    ...(result.description ? { description: result.description } : {}),
    ...(result.original_filename
      ? { originalFilename: result.original_filename }
      : {}),
    // No sourceUrl or institution: these came from the human's own files, and
    // inventing a citation for them would be a lie.
    sourceCollection: collectionName,
  },
});
