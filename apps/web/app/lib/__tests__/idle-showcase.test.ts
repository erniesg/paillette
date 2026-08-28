import { describe, expect, it } from 'vitest';

import { selectIdleShowcaseArtworks } from '../idle-showcase';
import type { ArtworkSearchResult } from '../../types';

const artwork = (
  id: string,
  image?: Partial<ArtworkSearchResult>
) =>
  ({
    id,
    galleryId: 'nga',
    title: id,
    similarity: 1,
    metadata: {},
    ...image,
  }) as ArtworkSearchResult;

describe('selectIdleShowcaseArtworks', () => {
  it('does not mix fallback artworks into an active suggestion showcase', () => {
    const results = selectIdleShowcaseArtworks([
      artwork('empty-search-result'),
    ]);

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

  it('shows a displayed artwork identity once when cached records have different ids', () => {
    const results = selectIdleShowcaseArtworks([
      artwork('mother-child-primary', {
        title: 'Mother and Child, No. 1',
        artist: 'James McNeill Whistler',
        year: 1889,
        thumbnailUrl: '/mother-child-primary.webp',
      }),
      artwork('mother-child-cached-duplicate', {
        title: '  mother   AND child, no. 1 ',
        artist: 'JAMES MCNEILL WHISTLER',
        year: 1889,
        thumbnailUrl: '/mother-child-cached-duplicate.webp',
      }),
      artwork('leibl-primary', {
        title: 'Portrait of an Old Peasant Woman',
        artist: 'Wilhelm Leibl',
        year: 1875,
        thumbnailUrl: '/leibl-primary.webp',
      }),
    ]);

    expect(results.map((result) => result.id)).toEqual([
      'mother-child-primary',
      'leibl-primary',
    ]);
  });

  it('keeps distinct records when their display identity is incomplete', () => {
    const results = selectIdleShowcaseArtworks([
      artwork('same-title-a', {
        title: 'Untitled',
        thumbnailUrl: '/same-title-a.webp',
      }),
      artwork('same-title-b', {
        title: 'Untitled',
        thumbnailUrl: '/same-title-b.webp',
      }),
    ]);

    expect(results.map((result) => result.id)).toEqual([
      'same-title-a',
      'same-title-b',
    ]);
  });
});
