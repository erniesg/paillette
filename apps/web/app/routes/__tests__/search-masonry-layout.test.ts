import { describe, expect, it } from 'vitest';

import {
  getMasonryImageFrameStyle,
  shouldObserveMasonryColumnEnds,
} from '../galleries.$galleryId.search';
import type { ArtworkSearchResult } from '~/types';

const artwork = (
  metadata: ArtworkSearchResult['metadata'] = {}
): ArtworkSearchResult => ({
  id: 'artwork-1',
  galleryId: 'gallery-1',
  title: 'Stable masonry work',
  imageUrl: 'https://example.com/artwork.jpg',
  similarity: 1,
  metadata,
});

describe('masonry image layout', () => {
  it('reserves image height from artwork dimensions before lazy images load', () => {
    expect(
      getMasonryImageFrameStyle(
        artwork({
          dimensions: {
            width: 200,
            height: 100,
          },
        })
      )
    ).toEqual({
      aspectRatio: '1 / 0.5',
    });
  });

  it('uses a deterministic fallback ratio when dimensions are missing', () => {
    const first = getMasonryImageFrameStyle(artwork());
    const second = getMasonryImageFrameStyle(artwork());

    expect(first).toEqual(second);
    expect(first.aspectRatio).toMatch(/^1 \/ \d+(\.\d+)?$/);
  });
});

describe('masonry infinite loading', () => {
  it('watches column ends only for active masonry infinite browse', () => {
    expect(
      shouldObserveMasonryColumnEnds({
        hasMoreResults: true,
        isBrowsingCollection: true,
        isFetchingNextPage: false,
        isLoading: false,
        view: 'masonry',
      })
    ).toBe(true);

    expect(
      shouldObserveMasonryColumnEnds({
        hasMoreResults: true,
        isBrowsingCollection: true,
        isFetchingNextPage: false,
        isLoading: false,
        view: 'table',
      })
    ).toBe(false);
    expect(
      shouldObserveMasonryColumnEnds({
        hasMoreResults: true,
        isBrowsingCollection: true,
        isFetchingNextPage: true,
        isLoading: false,
        view: 'masonry',
      })
    ).toBe(false);
  });
});
