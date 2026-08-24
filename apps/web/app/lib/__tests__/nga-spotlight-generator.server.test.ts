import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES } from '@paillette/types/public-search';
import type { ArtworkSearchResult, SearchResponse } from '~/types';
import { NGA_SPOTLIGHT_DEFINITIONS } from '../nga-spotlight-definitions';
import { NGS_SPOTLIGHT_DEFINITIONS } from '../ngs-spotlight-definitions';
import {
  generateNgaSpotlightBundle,
  generateNgsSpotlightBundle,
  type NgaSpotlightSearchRequest,
  type NgsSpotlightSearchRequest,
} from '../nga-spotlight-generator.server';

const GENERATED_AT = '2026-07-17T08:00:00.000Z';
const CORPUS_VERSION = 'nga-corpus-2026-07-17';

const makeArtwork = (
  id: string,
  overrides: Partial<ArtworkSearchResult> = {}
): ArtworkSearchResult => ({
  id,
  orgId: 'open-access-art',
  galleryId: 'open-access-art',
  title: `Artwork ${id}`,
  artist: `Artist ${id}`,
  year: 1900,
  imageUrl: `https://example.com/${id}.jpg`,
  thumbnailUrl: `https://example.com/${id}-thumb.jpg`,
  similarity: 0.9,
  metadata: {
    provider: 'nga',
    sourceInstitution: 'National Gallery of Art, Washington',
    sourceRecordId: `record-${id}`,
    sourceUrl: `https://www.nga.gov/artworks/${id}`,
    accessionNumber: `A-${id}`,
    rights: 'Open access',
    colorPalette: {
      colors: ['#999999'],
      percentages: [1],
    },
    privateNote: 'must not be serialized',
  },
  ...overrides,
});

const makeSearchResponse = (
  request: NgaSpotlightSearchRequest
): SearchResponse => {
  const prefix = request.definitionId;
  const results = [
    makeArtwork(`${prefix}-1`),
    makeArtwork(`${prefix}-duplicate`, { imageUrl: null, thumbnailUrl: null }),
    makeArtwork(`${prefix}-1`),
    makeArtwork(`${prefix}-2`),
    makeArtwork(`${prefix}-3`),
    makeArtwork(`${prefix}-4`),
    makeArtwork(`${prefix}-5`),
  ];

  if (request.definitionId === 'blue-painted-ornament') {
    return {
      count: 4,
      queryTime: 1,
      results: [
        makeArtwork(`${prefix}-red`, {
          metadata: {
            ...makeArtwork('metadata').metadata,
            provider: 'nga',
            sourceInstitution: 'National Gallery of Art, Washington',
            colorPalette: { colors: ['#ff0000'], percentages: [1] },
          },
        }),
        makeArtwork(`${prefix}-grey`, {
          metadata: {
            ...makeArtwork('metadata').metadata,
            provider: 'nga',
            sourceInstitution: 'National Gallery of Art, Washington',
            dominantColors: ['#999999'],
            colorPalette: undefined,
          },
        }),
        makeArtwork(`${prefix}-navy`, {
          metadata: {
            ...makeArtwork('metadata').metadata,
            provider: 'nga',
            sourceInstitution: 'National Gallery of Art, Washington',
            dominant_colors: ['#162d68'],
            colorPalette: undefined,
          },
        }),
        makeArtwork(`${prefix}-exact`, {
          metadata: {
            ...makeArtwork('metadata').metadata,
            provider: 'nga',
            sourceInstitution: 'National Gallery of Art, Washington',
            colour_palette: [{ color: '#4c78a8', percentage: 1 }],
            colorPalette: undefined,
          },
        }),
      ],
    };
  }

  return { count: results.length, queryTime: 1, results };
};

describe('generateNgaSpotlightBundle', () => {
  it('makes one bounded unrefined request for every stable definition', async () => {
    const search = vi.fn(async (request: NgaSpotlightSearchRequest) =>
      makeSearchResponse(request)
    );

    const generated = await generateNgaSpotlightBundle({
      corpusVersion: CORPUS_VERSION,
      now: () => new Date(GENERATED_AT),
      search,
    });

    expect(NGA_SPOTLIGHT_DEFINITIONS.map(({ id }) => id)).toEqual([
      'stormy-seas-ships',
      'paintings-collection',
      'ginevra-de-benci',
      'the-annunciation',
      'feast-of-the-gods',
      'women-profile',
      'mother-child',
      'quiet-interiors',
      'index-american-design',
      'photographs',
      'blue-painted-ornament',
    ]);
    expect(search).toHaveBeenCalledTimes(11);
    expect(generated.searchRequestCount).toBe(11);
    expect(generated.bundle).toMatchObject({
      schemaVersion: 1,
      contractVersion: '32',
      provider: 'nga',
      corpusVersion: CORPUS_VERSION,
      generatedAt: GENERATED_AT,
      requestDefaults: { topK: 30, minScore: 0.2 },
    });

    for (const [index, definition] of NGA_SPOTLIGHT_DEFINITIONS.entries()) {
      const request = search.mock.calls[index]![0];
      expect(request).toEqual({
        provider: 'nga',
        definitionId: definition.id,
        query: definition.query,
        topK: 30,
        minScore: 0.2,
        ...('facet' in definition ? { facet: definition.facet } : {}),
      });
      expect(request).not.toHaveProperty('visualRefinement');
    }
  });

  it('keeps every unique imageable allowlisted result and ranks colour locally', async () => {
    const { bundle } = await generateNgaSpotlightBundle({
      corpusVersion: CORPUS_VERSION,
      now: () => new Date(GENERATED_AT),
      search: async (request) => makeSearchResponse(request),
    });

    for (const suggestion of bundle.suggestions) {
      const expectedCount = suggestion.id === 'blue-painted-ornament' ? 4 : 5;
      expect(suggestion.artworks).toHaveLength(expectedCount);
      expect(new Set(suggestion.artworks.map(({ id }) => id)).size).toBe(
        expectedCount
      );
      expect(
        suggestion.artworks.every(
          ({ imageUrl, thumbnailUrl }) => imageUrl || thumbnailUrl
        )
      ).toBe(true);
    }

    const firstCard = bundle.suggestions[0]!.artworks[0]!;
    expect(firstCard).not.toHaveProperty('metadata');
    expect(firstCard).not.toHaveProperty('privateNote');
    expect(firstCard).toMatchObject({
      source: {
        provider: 'nga',
        institution: 'National Gallery of Art, Washington',
      },
      palette: ['#999999'],
    });

    const colourSuggestion = bundle.suggestions.find(
      ({ id }) => id === 'blue-painted-ornament'
    );
    expect(colourSuggestion?.artworks[0]?.id).toBe(
      'blue-painted-ornament-exact'
    );
  });

  it('fails closed when search returns a non-NGA row', async () => {
    await expect(
      generateNgaSpotlightBundle({
        corpusVersion: CORPUS_VERSION,
        now: () => new Date(GENERATED_AT),
        search: async (request) => {
          const response = makeSearchResponse(request);
          response.results[0] = makeArtwork('wrong-provider', {
            metadata: {
              provider: 'artic',
              sourceInstitution: 'Art Institute of Chicago',
            },
          });
          return response;
        },
      })
    ).rejects.toThrow(/non-NGA/i);
  });

  it('fails when no renderable unique cached results are available', async () => {
    await expect(
      generateNgaSpotlightBundle({
        corpusVersion: CORPUS_VERSION,
        now: () => new Date(GENERATED_AT),
        search: async (request) => ({
          ...makeSearchResponse(request),
          results: [],
        }),
      })
    ).rejects.toThrow(/at least one.*renderable.*unique/i);
  });

  it('fails rather than returning a bundle above the UTF-8 size cap', async () => {
    const oversized = 'x'.repeat(7_000);

    await expect(
      generateNgaSpotlightBundle({
        corpusVersion: CORPUS_VERSION,
        now: () => new Date(GENERATED_AT),
        search: async (request) => ({
          count: 4,
          queryTime: 1,
          results: Array.from({ length: 4 }, (_, index) =>
            makeArtwork(`${request.definitionId}-${index}`, {
              title: oversized,
            })
          ),
        }),
      })
    ).rejects.toThrow(String(PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES));
  });
});

describe('generateNgsSpotlightBundle', () => {
  it('caches every stable NGS Try term without requiring public metadata', async () => {
    const search = vi.fn(async (request: NgsSpotlightSearchRequest) => ({
      count: 1,
      queryTime: 1,
      results: [
        makeArtwork(`${request.definitionId}-1`, {
          orgId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
          galleryId: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
          metadata: {
            sourceInstitution: 'National Gallery Singapore',
            sourceRecordId: `${request.definitionId}-1`,
            sourceUrl: `https://www.nationalgallery.sg/${request.definitionId}`,
            colorPalette: { colors: ['#8a9a7a'], percentages: [1] },
          },
        }),
      ],
    }));

    const generated = await generateNgsSpotlightBundle({
      corpusVersion: 'ngs-corpus-2026-08-24',
      now: () => new Date(GENERATED_AT),
      search,
    });

    expect(search).toHaveBeenCalledTimes(10);
    expect(generated.searchRequestCount).toBe(10);
    expect(generated.bundle.provider).toBe('ngs');
    expect(generated.bundle.suggestions.map(({ id }) => id)).toEqual(
      NGS_SPOTLIGHT_DEFINITIONS.map(({ id }) => id)
    );
    expect(generated.bundle.suggestions[0]?.artworks[0]?.source).toMatchObject({
      provider: 'ngs',
      institution: 'National Gallery Singapore',
    });
  });
});
