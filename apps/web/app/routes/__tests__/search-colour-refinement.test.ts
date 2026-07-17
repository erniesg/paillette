import { describe, expect, it } from 'vitest';

import {
  getSearchParamsForQuery,
  sortResults,
} from '../galleries.$galleryId.search';
import type { ArtworkSearchResult } from '~/types';

const result = (
  id: string,
  similarity: number,
  dominantColour: string
): ArtworkSearchResult => ({
  id,
  galleryId: 'ngs',
  title: id,
  imageUrl: null,
  similarity,
  metadata: { dominantColors: [dominantColour] },
});

describe('additive colour refinement', () => {
  it('keeps the text query in the URL when a colour is selected', () => {
    expect(getSearchParamsForQuery('batik textile pattern', null, 'gold')).toEqual(
      {
        q: 'batik textile pattern',
        colour: 'gold',
      }
    );
  });

  it('reranks the same text candidates by the selected colour', () => {
    const textCandidates = [
      result('text-first', 0.99, '#193b7a'),
      result('gold-match', 0.74, '#d4af37'),
    ];

    const reranked = sortResults(textCandidates, 'colour', ['gold']);

    expect(reranked.map(({ id }) => id)).toEqual(['gold-match', 'text-first']);
    expect(new Set(reranked.map(({ id }) => id))).toEqual(
      new Set(textCandidates.map(({ id }) => id))
    );
  });
});
