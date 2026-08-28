import type { ArtworkSearchResult } from '../types';

export const IDLE_SHOWCASE_ARTWORK_COUNT = 4;

const hasShowcaseImage = (artwork: ArtworkSearchResult) =>
  Boolean(artwork.thumbnailUrl || artwork.imageUrl);

const normalizeDisplayIdentityPart = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const getDisplayIdentity = (artwork: ArtworkSearchResult) => {
  const title = artwork.title && normalizeDisplayIdentityPart(artwork.title);
  const artist = artwork.artist && normalizeDisplayIdentityPart(artwork.artist);
  const year = artwork.year;

  if (!title || !artist || !Number.isFinite(year)) return `id:${artwork.id}`;

  return `display:${title}:${artist}:${year}`;
};

export const selectIdleShowcaseArtworks = (
  artworks: ArtworkSearchResult[],
  limit = IDLE_SHOWCASE_ARTWORK_COUNT
) => {
  const selected: ArtworkSearchResult[] = [];
  const seenIdentities = new Set<string>();

  for (const artwork of artworks) {
    const identity = getDisplayIdentity(artwork);
    if (!hasShowcaseImage(artwork) || seenIdentities.has(identity)) continue;

    selected.push(artwork);
    seenIdentities.add(identity);

    if (selected.length >= limit) break;
  }

  return selected;
};
