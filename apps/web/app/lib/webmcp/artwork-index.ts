/**
 * A session-scoped index of every artwork this document has seen.
 *
 * Paillette has no anonymous "get one artwork by id" endpoint — the detail
 * route is behind auth — but the browser already holds the full record for
 * anything the human searched or the agent retrieved. That is precisely the
 * kind of state a *page* tool can serve and a server tool cannot, so
 * `lookup_artwork` reads it from here instead of inventing a new endpoint.
 *
 * Bounded LRU: a long curation session can page through thousands of records
 * and we must not grow without limit inside someone's tab.
 */

import type { ArtworkSearchResult } from '~/types';

const MAX_ENTRIES = 750;

const index = new Map<string, ArtworkSearchResult>();

export const rememberArtworks = (artworks: readonly ArtworkSearchResult[]) => {
  for (const artwork of artworks) {
    if (!artwork?.id) continue;
    // Delete-then-set refreshes recency so the working set survives eviction.
    index.delete(artwork.id);
    index.set(artwork.id, artwork);
  }
  while (index.size > MAX_ENTRIES) {
    const oldest = index.keys().next().value;
    if (oldest === undefined) break;
    index.delete(oldest);
  }
};

export const recallArtwork = (id: string): ArtworkSearchResult | null => {
  const artwork = index.get(id);
  if (!artwork) return null;
  index.delete(id);
  index.set(id, artwork);
  return artwork;
};

export const recallArtworks = (ids: readonly string[]) => {
  const found: ArtworkSearchResult[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const artwork = recallArtwork(id);
    if (artwork) found.push(artwork);
    else missing.push(id);
  }
  return { found, missing };
};

export const getArtworkIndexSize = () => index.size;

export const __resetArtworkIndexForTest = () => index.clear();
