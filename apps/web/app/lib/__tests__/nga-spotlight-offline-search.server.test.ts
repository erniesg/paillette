import { describe, expect, it } from 'vitest';

import type { ArtworkSearchResult } from '~/types';
import {
  createNgaOfflineSpotlightSearch,
  type NgaOfflineCorpusRecord,
} from '../nga-spotlight-offline-search.server';

const makeRecord = (
  id: string,
  overrides: Partial<NgaOfflineCorpusRecord> = {}
): NgaOfflineCorpusRecord => ({
  id,
  title: `Artwork ${id}`,
  artist: 'Unknown artist',
  image_url: `https://example.com/${id}.jpg`,
  thumbnail_url: `https://example.com/${id}-thumb.jpg`,
  source_institution: 'National Gallery of Art, Washington',
  source_record_id: id,
  source_url: `https://www.nga.gov/artworks/${id}`,
  rights: 'Open Access / Public Domain',
  custom_metadata: { provider: 'nga', openAccess: true },
  ...overrides,
});

const makeEnrichment = (
  id: string,
  metadata: Record<string, unknown>
): ArtworkSearchResult => ({
  id,
  orgId: 'nga-org-id',
  galleryId: 'nga-org-id',
  title: `Artwork ${id}`,
  imageUrl: `https://assets.example.com/${id}.jpg`,
  thumbnailUrl: `https://assets.example.com/${id}-thumb.jpg`,
  similarity: 0.8,
  metadata: {
    provider: 'nga',
    sourceInstitution: 'National Gallery of Art, Washington',
    ...metadata,
  },
});

describe('createNgaOfflineSpotlightSearch', () => {
  it('ranks exact metadata and lexical matches deterministically', async () => {
    const search = createNgaOfflineSpotlightSearch({
      orgId: 'nga-org-id',
      records: [
        makeRecord('other', {
          title: 'Landscape with a River',
          artist: 'Another artist',
          description: 'A calm landscape.',
        }),
        makeRecord('ginevra', {
          title: "Ginevra de' Benci [obverse]",
          artist: 'Leonardo da Vinci',
          classification: 'Painting',
        }),
        makeRecord('leonardo-study', {
          title: 'Study of Drapery',
          artist: 'Leonardo da Vinci',
          classification: 'Drawing',
        }),
      ],
    });

    const response = await search({
      provider: 'nga',
      definitionId: 'ginevra-de-benci',
      query: "Leonardo da Vinci Ginevra de' Benci",
      topK: 30,
      minScore: 0.2,
    });

    expect(response.results.map(({ id }) => id)).toEqual([
      'ginevra',
      'leonardo-study',
    ]);
    expect(response.results[0]).toMatchObject({
      galleryId: 'nga-org-id',
      similarity: 1,
      metadata: { provider: 'nga', isPublic: true },
    });
  });

  it('honours classification facets and excludes non-public or non-imageable rows', async () => {
    const search = createNgaOfflineSpotlightSearch({
      orgId: 'nga-org-id',
      records: [
        makeRecord('painting-a', { classification: 'Painting' }),
        makeRecord('painting-b', { classification: 'Painting' }),
        makeRecord('drawing', { classification: 'Drawing' }),
        makeRecord('private', {
          classification: 'Painting',
          custom_metadata: { provider: 'nga', openAccess: false },
        }),
        makeRecord('no-image', {
          classification: 'Painting',
          image_url: null,
          thumbnail_url: null,
        }),
        makeRecord('wrong-provider', {
          classification: 'Painting',
          custom_metadata: { provider: 'ngs', openAccess: true },
        }),
      ],
    });

    const response = await search({
      provider: 'nga',
      definitionId: 'paintings-collection',
      query: 'Painting',
      facet: 'classification',
      topK: 30,
      minScore: 0.2,
    });

    expect(response.results.map(({ id }) => id)).toEqual([
      'painting-a',
      'painting-b',
    ]);
    expect(
      response.results.every(
        ({ metadata }) => metadata?.classification === 'Painting'
      )
    ).toBe(true);
  });

  it('merges stored palettes from local result snapshots without changing provider scope', async () => {
    const search = createNgaOfflineSpotlightSearch({
      orgId: 'fallback-org',
      records: [
        makeRecord('a-blue-paper', {
          title: 'Painted Ornament',
          description: 'A vivid blue ornamental tile.',
        }),
        makeRecord('blue-tile', {
          title: 'Painted Ornament',
          description: 'A vivid blue ornamental tile.',
        }),
      ],
      enrichments: [
        makeEnrichment('blue-tile', {
          dominantColors: [
            { color: '#4C78A8', percentage: 80 },
            { color: '#ffffff', percentage: 20 },
          ],
          privateNote: 'not relevant to ranking',
        }),
        {
          ...makeEnrichment('blue-tile', {}),
          metadata: {
            provider: 'ngs',
            sourceInstitution: 'National Gallery Singapore',
          },
        },
      ],
    });

    const response = await search({
      provider: 'nga',
      definitionId: 'blue-painted-ornament',
      query: 'blue painted ornament',
      topK: 30,
      minScore: 0.2,
    });

    expect(response.results[0]).toMatchObject({
      id: 'blue-tile',
      orgId: 'nga-org-id',
      imageUrl: 'https://assets.example.com/blue-tile.jpg',
      metadata: {
        provider: 'nga',
        dominantColors: [
          { color: '#4C78A8', percentage: 80 },
          { color: '#ffffff', percentage: 20 },
        ],
      },
    });
  });

  it('recognises the motif vocabulary used by offline spotlight definitions', async () => {
    const search = createNgaOfflineSpotlightSearch({
      orgId: 'nga-org-id',
      records: [
        makeRecord('sea', {
          description:
            'Sailing vessels struggle through ocean waves in a tempest.',
        }),
        makeRecord('profile', {
          description: 'A female sitter shown in side profile.',
        }),
        makeRecord('mother', {
          description: 'A Madonna cradling the infant Christ.',
        }),
        makeRecord('interior', {
          description: 'A serene room in a family home.',
        }),
      ],
    });

    const requests = [
      ['stormy-seas-ships', 'a stormy sea with ships', 'sea'],
      ['women-profile', 'a portrait of a woman in profile', 'profile'],
      ['mother-child', 'a mother holding a child', 'mother'],
      ['quiet-interiors', 'a quiet domestic interior', 'interior'],
    ] as const;

    for (const [definitionId, query, expectedId] of requests) {
      const response = await search({
        provider: 'nga',
        definitionId,
        query,
        topK: 30,
        minScore: 0.2,
      });
      expect(response.results[0]?.id).toBe(expectedId);
    }
  });
});
