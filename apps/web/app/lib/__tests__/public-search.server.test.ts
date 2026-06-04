import { describe, expect, it } from 'vitest';
import {
  PUBLIC_TEXT_SEARCH_CACHE_VERSION,
  buildPublicTextSearchCacheKey,
  isHiddenPublicNgsArtwork,
} from '../public-search.server';

describe('isHiddenPublicNgsArtwork', () => {
  it('hides Roots-only museum accessions when they point at Roots records', () => {
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: 'AB2004-00006',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1030018',
      })
    ).toBe(true);
    expect(
      isHiddenPublicNgsArtwork({
        metadata: {
          accessionNumber: 'HP-0126',
          sourceUrl:
            'https://www.roots.gov.sg/Collection-Landing/listing/1129656',
        },
      })
    ).toBe(true);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: 'Gi-0007-(AB)',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1202039',
      })
    ).toBe(true);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: '2013-00591',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1284239',
      })
    ).toBe(true);
  });

  it('keeps AB-like accessions when the source is not Roots', () => {
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: 'AB2004-00006',
        source_url:
          'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/example.html',
      })
    ).toBe(false);
  });

  it('keeps NGS Roots-backed records and PC suffixes', () => {
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: '2013-00170',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1271927',
      })
    ).toBe(false);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: 'GI-0202-(PC)',
        source_url: 'https://www.roots.gov.sg/Collection-Landing/listing/1016995',
      })
    ).toBe(false);
  });
});

describe('buildPublicTextSearchCacheKey', () => {
  it('includes the public text-search cache version', () => {
    const key = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      orgId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
      query: ' chung cheng ',
    });
    const url = new URL(key.url);

    expect(url.searchParams.get('v')).toBe(PUBLIC_TEXT_SEARCH_CACHE_VERSION);
    expect(url.searchParams.get('query')).toBe('chung cheng');
  });
});
