import { describe, expect, it } from 'vitest';
import type {
  NgaAttributionIntent,
  NgaSearchPlan,
  PublicSearchRelation,
} from '@paillette/types/public-search';
import type { ArtworkSearchResult } from '../types';
import {
  classifyNgaRelationEvidence,
  filterNgaRelationEvidence,
  matchesNgaAttributionEvidence,
} from './nga-search-evidence';

const relationship = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  constituentId: 'primary',
  displayOrder: 1,
  roleType: 'artist',
  role: 'artist',
  prefix: null,
  suffix: null,
  preferredDisplayName: 'Paul Bril',
  forwardDisplayName: 'Paul Bril',
  alternativeNames: [],
  ...overrides,
});

const attributionMetadata = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  artist: 'Paul Bril',
  primaryArtistId: 'primary',
  ngaArtists: { relationships: [relationship()] },
  ...overrides,
});

const attribution = (
  relationship: NgaAttributionIntent['relationship'],
  targetText: string
): NgaAttributionIntent => ({ relationship, targetText });

const result = (
  id: string,
  overrides: Partial<ArtworkSearchResult> = {}
): ArtworkSearchResult => ({
  id,
  galleryId: 'open-access-art',
  title: 'Untitled',
  imageUrl: null,
  similarity: 0.8,
  metadata: {},
  ...overrides,
});

const visibleRelation: PublicSearchRelation = {
  kind: 'depicts',
  workClassification: 'Painting',
  subjectClassification: 'Sculpture',
};

const visiblePlan: NgaSearchPlan = {
  version: 'nga-plan-v2',
  mode: 'relational',
  retrievalQuery: 'painting depicting sculpture',
  constraints: { classifications: ['Painting'] },
  relation: visibleRelation,
  relationEvidence: { policy: 'visible_subject', status: 'candidate' },
};

describe('NGA catalogue attribution evidence', () => {
  it('requires both the requested role and every target token on boundaries', () => {
    const metadata = attributionMetadata({
      artist: 'after Rembrandt van Rijn',
      primaryArtistId: 'rembrandt',
      ngaArtists: {
        relationships: [
          relationship({
            constituentId: 'rembrandt',
            role: 'artist after',
            preferredDisplayName: 'Rembrandt van Rijn',
            forwardDisplayName: 'Rembrandt van Rijn',
          }),
        ],
      },
    });

    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('after', 'Rembrandt Rijn')
      )
    ).toBe(true);
    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('attributed_to', 'Rembrandt Rijn')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(metadata, attribution('after', 'brandt'))
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('after', 'Rembrandt Harmenszoon')
      )
    ).toBe(false);
  });

  it('accepts official alternatives and secondary qualified relationships', () => {
    const metadata = attributionMetadata({
      ngaArtists: {
        relationships: [
          relationship(),
          relationship({
            constituentId: 'secondary',
            displayOrder: 2,
            role: 'artist after',
            preferredDisplayName: 'Rembrandt, Harmensz. van Rijn',
            forwardDisplayName: 'Rembrandt van Rijn',
            alternativeNames: ['Rembrandt Harmenszoon van Rijn'],
          }),
        ],
      },
    });

    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('after', 'Harmenszoon Rembrandt')
      )
    ).toBe(true);
  });

  it('keeps direct attribution primary-only', () => {
    const metadata = attributionMetadata({
      ngaArtists: {
        relationships: [
          relationship(),
          relationship({
            constituentId: 'secondary',
            displayOrder: 2,
            preferredDisplayName: 'Rembrandt van Rijn',
            forwardDisplayName: 'Rembrandt van Rijn',
          }),
        ],
      },
    });

    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('direct', 'Paul Bril')
      )
    ).toBe(true);
    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('direct', 'Rembrandt')
      )
    ).toBe(false);
  });
});

describe('NGA relation evidence', () => {
  it('accepts explicit institution title or description subject evidence', () => {
    expect(
      classifyNgaRelationEvidence(
        result('title', { title: 'Study of a Bronze Sculpture' }),
        visibleRelation
      )
    ).toEqual({ verified: true, source: 'institution_metadata' });
    expect(
      classifyNgaRelationEvidence(
        result('description', {
          metadata: {
            description: 'A marble sculpture stands behind the sitter.',
          },
        }),
        visibleRelation
      )
    ).toEqual({ verified: true, source: 'institution_metadata' });
  });

  it('accepts image and caption agreement but rejects either weak tail alone', () => {
    const withChannels = (...channels: string[]) =>
      result(channels.join('-'), {
        metadata: {
          searchSources: channels.map((channel) => ({ channel })),
        },
      });

    expect(
      classifyNgaRelationEvidence(
        withChannels('image_embedding', 'generated_caption_embedding'),
        visibleRelation
      )
    ).toEqual({ verified: true, source: 'image_caption_agreement' });
    expect(
      classifyNgaRelationEvidence(
        withChannels('image_embedding'),
        visibleRelation
      )
    ).toEqual({ verified: false, source: null });
    expect(
      classifyNgaRelationEvidence(
        withChannels('generated_caption_embedding'),
        visibleRelation
      )
    ).toEqual({ verified: false, source: null });
  });

  it('requires institution metadata for derived-from evidence', () => {
    const relation: PublicSearchRelation = {
      kind: 'derived_from',
      workClassification: 'Drawing',
      sourceClassification: 'Photograph',
    };
    const generatedOnly = result('generated-only', {
      metadata: {
        generated_caption: {
          text: 'A drawing based on a photograph.',
        },
        searchSources: [
          { channel: 'image_embedding' },
          { channel: 'generated_caption_embedding' },
        ],
      },
    });
    const institution = result('institution', {
      metadata: {
        description:
          'This drawing was based on a nineteenth-century photograph.',
      },
    });

    expect(classifyNgaRelationEvidence(generatedOnly, relation)).toEqual({
      verified: false,
      source: null,
    });
    expect(classifyNgaRelationEvidence(institution, relation)).toEqual({
      verified: true,
      source: 'institution_metadata',
    });
  });

  it('orders institution proof first and preserves fused order within each tier', () => {
    const agreement = result('agreement', {
      metadata: {
        search_sources: [
          { channel: 'image_embedding' },
          { channel: 'institution_caption_embedding' },
        ],
      },
    });
    const firstInstitution = result('institution-1', {
      title: 'Painting Depicting Sculpture',
    });
    const weak = result('weak', {
      metadata: { searchSources: [{ channel: 'image_embedding' }] },
    });
    const secondInstitution = result('institution-2', {
      metadata: { description: 'A view featuring a stone sculpture.' },
    });

    const filtered = filterNgaRelationEvidence(
      [agreement, firstInstitution, weak, secondInstitution],
      visiblePlan
    );

    expect(filtered.map((row) => row.id)).toEqual([
      'institution-1',
      'institution-2',
      'agreement',
    ]);
    expect(filtered.map((row) => row.metadata?.relationEvidence)).toEqual([
      { verified: true, source: 'institution_metadata' },
      { verified: true, source: 'institution_metadata' },
      { verified: true, source: 'image_caption_agreement' },
    ]);
  });
});
