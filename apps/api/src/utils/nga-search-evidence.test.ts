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
  constituentId: '23812',
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
  primaryArtistId: '23812',
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
      primaryArtistId: '1364',
      ngaArtists: {
        relationships: [
          relationship({
            constituentId: '1364',
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
            constituentId: '1364',
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
            constituentId: '1364',
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

  it.each(['painter', 'draughtsman', 'printmaker'])(
    'accepts a matching authoritative primary whose official role is %s',
    (role) => {
      const metadata = attributionMetadata({
        artist: 'Lavinia Fontana',
        primaryArtistId: '1364',
        ngaArtists: {
          relationships: [
            relationship({
              constituentId: '1364',
              role,
              preferredDisplayName: 'Fontana, Lavinia',
              forwardDisplayName: 'Lavinia Fontana',
            }),
            relationship({
              constituentId: '2402',
              displayOrder: 2,
              role: 'artist',
              preferredDisplayName: 'Secondary Contributor',
              forwardDisplayName: 'Secondary Contributor',
            }),
          ],
        },
      });

      expect(
        matchesNgaAttributionEvidence(
          metadata,
          attribution('direct', 'Lavinia Fontana')
        )
      ).toBe(true);
      expect(
        matchesNgaAttributionEvidence(
          metadata,
          attribution('direct', 'Secondary Contributor')
        )
      ).toBe(false);
    }
  );

  it('binds a legacy flat qualifier to its own contributor segment', () => {
    const cases = [
      {
        artist: 'Rembrandt van Rijn and follower of Frans Hals',
        target: 'Rembrandt van Rijn',
        expected: false,
      },
      {
        artist: 'follower of Frans Hals and Rembrandt van Rijn',
        target: 'Rembrandt van Rijn',
        expected: false,
      },
      {
        artist: 'Rembrandt van Rijn; follower of Frans Hals',
        target: 'Rembrandt van Rijn',
        expected: false,
      },
      {
        artist: 'Rembrandt van Rijn and follower of Frans Hals',
        target: 'Frans Hals',
        expected: true,
      },
      {
        artist: 'follower of Frans Hals and Rembrandt van Rijn',
        target: 'Frans Hals',
        expected: true,
      },
    ] as const;

    for (const fixture of cases) {
      expect(
        matchesNgaAttributionEvidence(
          { artist: fixture.artist },
          attribution('follower_of', fixture.target)
        ),
        `${fixture.artist} -> ${fixture.target}`
      ).toBe(fixture.expected);
    }
  });

  it('treats legacy commas as ambiguous contributor boundaries', () => {
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'Charles Nègre, André Jammes' },
        attribution('direct', 'André Jammes')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'Charles Nègre, André Jammes' },
        attribution('direct', 'Charles Nègre')
      )
    ).toBe(true);
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'follower of Frans Hals, Rembrandt van Rijn' },
        attribution('follower_of', 'Rembrandt van Rijn')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'follower of Frans Hals, Rembrandt van Rijn' },
        attribution('follower_of', 'Frans Hals')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'Rembrandt van Rijn, follower of Frans Hals' },
        attribution('follower_of', 'Frans Hals')
      )
    ).toBe(true);
  });

  it('fails closed for comma-delimited surname-order ambiguity', () => {
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'Nègre, Charles' },
        attribution('direct', 'Charles Nègre')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'follower of Hals, Frans' },
        attribution('follower_of', 'Frans Hals')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        { artist: 'Hals, Frans, follower of Rembrandt van Rijn' },
        attribution('follower_of', 'Frans Hals')
      )
    ).toBe(false);
  });

  it('uses valid structured relationships exclusively for qualified roles', () => {
    const metadata = attributionMetadata({
      artist: 'Rembrandt van Rijn and follower of Frans Hals',
      primaryArtistId: '1364',
      ngaArtists: {
        relationships: [
          relationship({
            constituentId: '1364',
            preferredDisplayName: 'Rembrandt van Rijn',
            forwardDisplayName: 'Rembrandt van Rijn',
          }),
          relationship({
            constituentId: '2402',
            displayOrder: 2,
            role: 'artist follower of',
            prefix: 'follower of',
            preferredDisplayName: 'Frans Hals',
            forwardDisplayName: 'Frans Hals',
          }),
        ],
      },
    });

    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('follower_of', 'Rembrandt van Rijn')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('follower_of', 'Frans Hals')
      )
    ).toBe(true);
  });

  it('rejects malformed structured primitives without losing valid siblings', () => {
    const malformedRelationships = [
      relationship({ roleType: ['artist'] }),
      relationship({ role: ['artist after'] }),
      relationship({ prefix: ['after'], role: 'artist' }),
      relationship({ suffix: { value: 'after' }, role: 'artist' }),
      relationship({ preferredDisplayName: ['Rembrandt van Rijn'] }),
      relationship({ forwardDisplayName: { value: 'Rembrandt van Rijn' } }),
      relationship({ alternativeNames: [['Rembrandt van Rijn']] }),
      relationship({ constituentId: 1364 }),
      relationship({ displayOrder: '1' }),
      relationship({ role: null }),
      relationship({ preferredDisplayName: null }),
    ];
    const validSibling = relationship({
      constituentId: '2402',
      displayOrder: 2,
      role: 'artist after',
      prefix: 'after',
      preferredDisplayName: 'Frans Hals',
      forwardDisplayName: 'Frans Hals',
    });
    const metadata = attributionMetadata({
      artist: 'after Rembrandt van Rijn',
      ngaArtists: {
        relationships: [...malformedRelationships, validSibling],
      },
    });

    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('after', 'Rembrandt van Rijn')
      )
    ).toBe(false);
    expect(
      matchesNgaAttributionEvidence(
        metadata,
        attribution('after', 'Frans Hals')
      )
    ).toBe(true);
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

  it('requires caption subject evidence alongside image and caption channels', () => {
    const withChannels = (caption: string | null, ...channels: string[]) =>
      result(channels.join('-'), {
        metadata: {
          searchSources: channels.map((channel) => ({ channel })),
          ...(caption
            ? { generated_caption: { text: caption } }
            : {}),
        },
      });

    expect(
      classifyNgaRelationEvidence(
        withChannels(
          'A marble statue stands behind the sitter.',
          'image_embedding',
          'generated_caption_embedding'
        ),
        visibleRelation
      )
    ).toEqual({ verified: true, source: 'image_caption_agreement' });
    expect(
      classifyNgaRelationEvidence(
        withChannels(
          'A crowd gathers in a landscape.',
          'image_embedding',
          'generated_caption_embedding'
        ),
        visibleRelation
      )
    ).toEqual({ verified: false, source: null });
    expect(
      classifyNgaRelationEvidence(
        withChannels(
          'A bronze sculpture fills the foreground.',
          'image_embedding',
          'institution_caption_embedding'
        ),
        visibleRelation
      )
    ).toEqual({ verified: false, source: null });
    expect(
      classifyNgaRelationEvidence(
        withChannels(null, 'image_embedding'),
        visibleRelation
      )
    ).toEqual({ verified: false, source: null });
    expect(
      classifyNgaRelationEvidence(
        withChannels(
          'A bronze sculpture fills the foreground.',
          'generated_caption_embedding'
        ),
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
        generated_caption: {
          text: 'A bronze sculpture fills the foreground.',
        },
        search_sources: [
          { channel: 'image_embedding' },
          { channel: 'generated_caption_embedding' },
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
