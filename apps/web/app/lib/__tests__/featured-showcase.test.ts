import { describe, expect, it } from 'vitest';

import {
  CHUNG_CHENG_ROOTS_IMAGE_URL,
  CHUNG_CHENG_STATUE_MASK_IMAGE_URL,
  getChungChengFeaturedArtwork,
  isChungChengFeatureSuggestion,
} from '../featured-showcase';
import {
  CHUNG_CHENG_FEATURE_ACCESSION,
  CHUNG_CHENG_FEATURE_QUERY,
  type EvalSuggestion,
} from '../search-suggestions';
import type { ArtworkSearchResult } from '../../types';

const suggestion = (
  overrides: Partial<EvalSuggestion> = {}
): EvalSuggestion => ({
  type: 'keyword',
  label: 'Zhong Zheng Ren (中正人)',
  query: CHUNG_CHENG_FEATURE_QUERY,
  dot: '#7dd3fc',
  detail: 'featured',
  ...overrides,
});

const artwork = (
  id: string,
  metadata: ArtworkSearchResult['metadata'] = {}
) =>
  ({
    id,
    galleryId: 'ngs',
    title: id,
    artist: 'Test Artist',
    imageUrl: null,
    thumbnailUrl: null,
    similarity: 1,
    metadata,
  }) as ArtworkSearchResult;

describe('isChungChengFeatureSuggestion', () => {
  it('matches the curated Chung Cheng query only', () => {
    expect(isChungChengFeatureSuggestion(suggestion())).toBe(true);
    expect(
      isChungChengFeatureSuggestion(
        suggestion({ query: 'a still life of tropical fruit and flowers' })
      )
    ).toBe(false);
    expect(isChungChengFeatureSuggestion(null)).toBe(false);
  });
});

describe('getChungChengFeaturedArtwork', () => {
  it('enriches the indexed artwork when the active showcase returns it', () => {
    const indexedArtwork = artwork('search-hit', {
      accessionNumber: CHUNG_CHENG_FEATURE_ACCESSION,
    });
    const featuredArtwork = getChungChengFeaturedArtwork([
      artwork('other'),
      indexedArtwork,
    ]);

    expect(featuredArtwork).toMatchObject({
      id: 'search-hit',
      imageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
      thumbnailUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
    });
    expect(featuredArtwork.metadata).toMatchObject({
      accessionNumber: CHUNG_CHENG_FEATURE_ACCESSION,
      rootsImageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
      maskImageUrl: CHUNG_CHENG_STATUE_MASK_IMAGE_URL,
    });
  });

  it('falls back to a researched artwork record with public source metadata', () => {
    const featuredArtwork = getChungChengFeaturedArtwork([]);

    expect(featuredArtwork).toMatchObject({
      id: CHUNG_CHENG_FEATURE_ACCESSION,
      title: 'Zhong Zheng Ren (中正人)',
      artist: 'Yeo Hwee Bin',
      year: 1969,
      imageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
      thumbnailUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
    });
    expect(featuredArtwork.metadata).toMatchObject({
      accessionNumber: CHUNG_CHENG_FEATURE_ACCESSION,
      rootsListingUrl: 'https://www.roots.gov.sg/Collection-Landing/listing/1454646',
      rootsImageUrl: CHUNG_CHENG_ROOTS_IMAGE_URL,
    });
  });
});
