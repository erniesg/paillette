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
  it('does not mix fallback artworks into an active suggestion showcase', () => {
    const results = selectIdleShowcaseArtworks(
      [artwork('empty-search-result')],
      [
        artwork('fallback-1', { thumbnailUrl: '/fallback-1.webp' }),
        artwork('fallback-2', { imageUrl: '/fallback-2.jpg' }),
      ]
    );

    expect(results).toEqual([]);
  });

  it('filters to imageable active suggestion artworks while keeping order', () => {
    const results = selectIdleShowcaseArtworks([
      artwork('primary-1', { thumbnailUrl: '/primary-1.webp' }),
      artwork('no-image'),
      artwork('shared', { thumbnailUrl: '/shared-primary.webp' }),
      artwork('primary-2', { thumbnailUrl: '/primary-2.webp' }),
      artwork('primary-3', { thumbnailUrl: '/primary-3.webp' }),
      artwork('primary-4', { thumbnailUrl: '/primary-4.webp' }),
    ]);

    expect(results.map((result) => result.id)).toEqual([
      'primary-1',
      'shared',
      'primary-2',
      'primary-3',
    ]);
  });
});
