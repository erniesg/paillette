import { describe, expect, it } from 'vitest';

import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  PublicSearchSpotlightBundleSchema,
  normalizePublicSearchText,
} from '@paillette/types/public-search';

const artwork = (id: string) => ({
  id,
  orgId: 'open-access-art',
  title: `Artwork ${id}`,
  imageUrl: `https://example.com/${id}.jpg`,
  similarity: 1,
  source: {
    provider: 'nga' as const,
    institution: 'National Gallery of Art, Washington',
  },
  palette: ['#4c78a8'],
});

const bundle = {
  schemaVersion: 1 as const,
  contractVersion: '22' as const,
  corpusVersion: 'nga-2026-07-17',
  provider: 'nga' as const,
  generatedAt: '2026-07-17T08:00:00.000Z',
  requestDefaults: { topK: 30 as const, minScore: 0.2 as const },
  suggestions: [
    {
      id: 'stormy-seas-ships',
      type: 'motif' as const,
      label: 'stormy seas and ships',
      dot: '#4c78a8',
      query: 'a stormy sea with ships',
      artworks: [artwork('1'), artwork('2'), artwork('3'), artwork('4')],
    },
  ],
};
const firstSuggestion = bundle.suggestions[0]!;

describe('public search contract', () => {
  it('normalizes Unicode and whitespace without folding case', () => {
    expect(normalizePublicSearchText('  stormy\tsea  ')).toBe('stormy sea');
    expect(normalizePublicSearchText('Cafe\u0301')).toBe('Café');
    expect(normalizePublicSearchText('Stormy Sea')).not.toBe(
      normalizePublicSearchText('stormy sea')
    );
    expect(PUBLIC_SEARCH_CONTRACT_VERSION).toBe('22');
  });

  it('accepts a strict four-card NGA spotlight bundle', () => {
    expect(PublicSearchSpotlightBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it('rejects duplicate suggestion ids and incomplete card sets', () => {
    expect(() =>
      PublicSearchSpotlightBundleSchema.parse({
        ...bundle,
        suggestions: [firstSuggestion, firstSuggestion],
      })
    ).toThrow();
    expect(() =>
      PublicSearchSpotlightBundleSchema.parse({
        ...bundle,
        suggestions: [
          {
            ...firstSuggestion,
            artworks: firstSuggestion.artworks.slice(0, 3),
          },
        ],
      })
    ).toThrow();
  });
});
