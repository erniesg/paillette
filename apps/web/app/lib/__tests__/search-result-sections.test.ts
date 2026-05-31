import { describe, expect, it } from 'vitest';
import {
  buildSearchResultSections,
  getSafeSearchReturnPath,
} from '../search-result-sections';
import type { ArtworkSearchResult } from '~/types';

const artwork = (
  id: string,
  similarity?: number
): ArtworkSearchResult =>
  ({
    id,
    title: id,
    similarity,
  }) as ArtworkSearchResult;

describe('buildSearchResultSections', () => {
  it('keeps ranked search results before deduped infinite browse results', () => {
    const rankedResults = [artwork('search-1', 0.92), artwork('search-2', 0.85)];
    const browseResults = [
      artwork('browse-1'),
      artwork('search-1'),
      artwork('browse-2'),
    ];

    const sections = buildSearchResultSections({
      isBrowsingCollection: true,
      rankedResults,
      browseResults,
    });

    expect(sections.rankedResults.map((result) => result.id)).toEqual([
      'search-1',
      'search-2',
    ]);
    expect(sections.browseResults.map((result) => result.id)).toEqual([
      'browse-1',
      'browse-2',
    ]);
    expect(sections.combinedResults.map((result) => result.id)).toEqual([
      'search-1',
      'search-2',
      'browse-1',
      'browse-2',
    ]);
    expect(sections.hasBrowseDivider).toBe(true);
  });

  it('uses the ranked list directly when infinite browse is off', () => {
    const rankedResults = [artwork('search-1')];

    const sections = buildSearchResultSections({
      isBrowsingCollection: false,
      rankedResults,
      browseResults: [artwork('browse-1')],
    });

    expect(sections.rankedResults).toEqual([]);
    expect(sections.browseResults).toEqual(rankedResults);
    expect(sections.combinedResults).toEqual(rankedResults);
    expect(sections.hasBrowseDivider).toBe(false);
  });
});

describe('getSafeSearchReturnPath', () => {
  it('keeps search query state for the same gallery route', () => {
    expect(
      getSafeSearchReturnPath('/ngs/search?q=chung+cheng#results', 'ngs')
    ).toBe('/ngs/search?q=chung+cheng#results');
  });

  it('rejects external or cross-gallery return paths', () => {
    expect(getSafeSearchReturnPath('https://example.com/ngs/search', 'ngs')).toBe(
      null
    );
    expect(getSafeSearchReturnPath('/other/search?q=chung', 'ngs')).toBe(null);
    expect(getSafeSearchReturnPath('//example.com/ngs/search', 'ngs')).toBe(
      null
    );
  });
});
