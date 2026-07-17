import { describe, expect, it } from 'vitest';
import {
  PUBLIC_TEXT_SEARCH_CACHE_VERSION,
  buildPublicTextSearchCacheKey,
  isAllowedPublicSearchRouteId,
  isHiddenPublicNgsArtwork,
  resolvePublicSearchOrgId,
} from '../public-search.server';

describe('isHiddenPublicNgsArtwork', () => {
  it('hides Roots-only museum accessions when they point at Roots records', () => {
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: 'AB2004-00006',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1030018',
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
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1202039',
      })
    ).toBe(true);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: '2013-00591',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1284239',
      })
    ).toBe(true);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: '1993-01334',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1029137',
      })
    ).toBe(true);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: '1995-01559',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1081040',
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
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1271927',
      })
    ).toBe(false);
    expect(
      isHiddenPublicNgsArtwork({
        accession_number: 'GI-0202-(PC)',
        source_url:
          'https://www.roots.gov.sg/Collection-Landing/listing/1016995',
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
    expect(PUBLIC_TEXT_SEARCH_CACHE_VERSION).toBe('18');
    expect(url.searchParams.get('query')).toBe('chung cheng');
    expect(url.searchParams.get('facet')).toBeNull();
  });

  it('uses the shared NFC and whitespace-normalized query identity', () => {
    const decomposedKey = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      orgId: 'nga',
      query: '  Cafe\u0301\n\t angels  ',
      visualRefinement: '  dark\n navy  ',
    });
    const canonicalKey = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      orgId: 'nga',
      query: 'Café angels',
      visualRefinement: 'dark navy',
    });

    expect(decomposedKey.url).toBe(canonicalKey.url);
  });

  it('separates artist-facet search cache entries from semantic text search', () => {
    const semanticKey = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      orgId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
      query: 'Zhang Yiqian',
    });
    const artistKey = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      facet: 'artist',
      orgId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
      query: 'Zhang Yiqian',
    });
    const artistUrl = new URL(artistKey.url);

    expect(artistKey.url).not.toBe(semanticKey.url);
    expect(artistUrl.searchParams.get('facet')).toBe('artist');
  });

  it('separates visual refinements from the base text-search cache entry', () => {
    const baseKey = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      orgId: 'open-access-art',
      query: 'angels',
    });
    const refinedKey = buildPublicTextSearchCacheKey({
      apiBaseUrl: 'https://paillette-api-stg.berlayar.ai/api/v1',
      orgId: 'open-access-art',
      query: 'angels',
      visualRefinement: 'dark navy blue',
    });
    const refinedUrl = new URL(refinedKey.url);

    expect(refinedKey.url).not.toBe(baseKey.url);
    expect(refinedUrl.searchParams.get('query')).toBe('angels');
    expect(refinedUrl.searchParams.get('visual')).toBe('dark navy blue');
  });
});

describe('resolvePublicSearchOrgId', () => {
  it('keeps the NGA route distinct while mapping generic Open Access aliases', () => {
    expect(resolvePublicSearchOrgId('open')).toBe('open-access-art');
    expect(resolvePublicSearchOrgId('OPEN')).toBe('open-access-art');
    expect(resolvePublicSearchOrgId('nga')).toBe('nga');
    expect(resolvePublicSearchOrgId('NGA')).toBe('nga');
    expect(resolvePublicSearchOrgId('open-access-art')).toBe('open-access-art');
    expect(resolvePublicSearchOrgId('ngs')).toBe(
      'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
    );
  });
});

describe('isAllowedPublicSearchRouteId', () => {
  it('allows only the explicit NGS and NGA public-search scopes', () => {
    expect(isAllowedPublicSearchRouteId('nga')).toBe(true);
    expect(isAllowedPublicSearchRouteId('ngs')).toBe(true);
    expect(
      isAllowedPublicSearchRouteId('cf98791d-f3cc-4f9f-b40c-a350efadbd05')
    ).toBe(true);

    expect(isAllowedPublicSearchRouteId('open-access-art')).toBe(false);
    expect(isAllowedPublicSearchRouteId('private-org')).toBe(false);
    expect(
      isAllowedPublicSearchRouteId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ).toBe(false);
  });
});
