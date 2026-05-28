import { describe, expect, it } from 'vitest';

import { selectIdleShowcaseArtworks } from '../idle-showcase';
import type { ArtworkSearchResult } from '../../types';

const artwork = (
  id: string,
  image?: Partial<Pick<ArtworkSearchResult, 'thumbnailUrl' | 'imageUrl'>>
) =>
  ({
    id,
    title: id,
    similarity: 1,
    metadata: {},
    ...image,
  }) as ArtworkSearchResult;

describe('selectIdleShowcaseArtworks', () => {
  it('uses browse fallback artworks when search returns no imageable results', () => {
    const results = selectIdleShowcaseArtworks(
      [artwork('empty-search-result')],
      [
        artwork('fallback-1', { thumbnailUrl: '/fallback-1.webp' }),
        artwork('fallback-2', { imageUrl: '/fallback-2.jpg' }),
      ]
    );

    expect(results.map((result) => result.id)).toEqual([
      'fallback-1',
      'fallback-2',
    ]);
  });

  it('deduplicates primary and fallback artworks while keeping primary order', () => {
    const results = selectIdleShowcaseArtworks(
      [
        artwork('primary-1', { thumbnailUrl: '/primary-1.webp' }),
        artwork('shared', { thumbnailUrl: '/shared-primary.webp' }),
      ],
      [
        artwork('shared', { thumbnailUrl: '/shared-fallback.webp' }),
        artwork('fallback-1', { thumbnailUrl: '/fallback-1.webp' }),
        artwork('fallback-2', { thumbnailUrl: '/fallback-2.webp' }),
        artwork('fallback-3', { thumbnailUrl: '/fallback-3.webp' }),
      ]
    );

    expect(results.map((result) => result.id)).toEqual([
      'primary-1',
      'shared',
      'fallback-1',
      'fallback-2',
    ]);
  });
});
