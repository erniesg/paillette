import type { ArtworkSearchResult } from '../types';

export const IDLE_SHOWCASE_ARTWORK_COUNT = 4;

const hasShowcaseImage = (artwork: ArtworkSearchResult) =>
  Boolean(artwork.thumbnailUrl || artwork.imageUrl);

export const selectIdleShowcaseArtworks = (
  artworks: ArtworkSearchResult[],
  limit = IDLE_SHOWCASE_ARTWORK_COUNT
) => {
  const selected: ArtworkSearchResult[] = [];
  const seenIds = new Set<string>();

  for (const artwork of artworks) {
    if (!hasShowcaseImage(artwork) || seenIds.has(artwork.id)) continue;

    selected.push(artwork);
    seenIds.add(artwork.id);

    if (selected.length >= limit) break;
  }

  return selected;
};
