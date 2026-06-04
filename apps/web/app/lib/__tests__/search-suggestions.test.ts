import { describe, expect, it } from 'vitest';

import {
  buildSuggestionPool,
  CHUNG_CHENG_FEATURE_QUERY,
  getSuggestionPrefetchQueries,
  normalizeSearchQuery,
} from '../search-suggestions';
import type { HolidaySearchSuggestion } from '../singapore-holidays.server';

const holiday = (
  overrides: Partial<HolidaySearchSuggestion> = {}
): HolidaySearchSuggestion => ({
  type: 'occasion',
  label: 'Hari Raya Haji',
  query: 'Hari Raya Haji',
  dot: '#8a9a7a',
  date: '2026-05-27',
  detail: 'Today',
  isToday: true,
  source: 'mom',
  ...overrides,
});

describe('buildSuggestionPool', () => {
  it('starts with the Chung Cheng featured artwork', () => {
    const suggestions = buildSuggestionPool([]);

    expect(suggestions[0]).toMatchObject({
      type: 'keyword',
      label: 'Zhong Zheng Ren (中正人)',
      query: CHUNG_CHENG_FEATURE_QUERY,
      detail: 'featured',
    });
  });

  it('keeps the evergreen keyword after the featured artwork', () => {
    const suggestions = buildSuggestionPool([]);

    expect(suggestions[1]).toMatchObject({
      type: 'keyword',
      label: 'tropical fruit and flowers',
      query: 'a still life of tropical fruit and flowers',
    });
  });

  it('keeps the serene mood showcase query', () => {
    const suggestions = buildSuggestionPool([]);
    const moodSuggestions = suggestions.filter(
      (suggestion) => suggestion.type === 'mood'
    );

    expect(moodSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'serene and contemplative',
          query: 'serene, still and contemplative',
        }),
      ])
    );
    expect(moodSuggestions).toHaveLength(1);
  });

  it('keeps the evergreen showcase keywords curated', () => {
    const suggestions = buildSuggestionPool([]);
    const keywordSuggestions = suggestions.filter(
      (suggestion) => suggestion.type === 'keyword'
    );

    expect(keywordSuggestions).toEqual([
      expect.objectContaining({
        label: 'Zhong Zheng Ren (中正人)',
        query: CHUNG_CHENG_FEATURE_QUERY,
      }),
      expect.objectContaining({
        label: 'tropical fruit and flowers',
        query: 'a still life of tropical fruit and flowers',
      }),
    ]);
  });

  it('uses a same-day public holiday as the first showcase suggestion', () => {
    const suggestions = buildSuggestionPool([holiday()]);

    expect(suggestions[0]).toMatchObject({
      type: 'occasion',
      label: 'Hari Raya Haji',
      isToday: true,
    });
    expect(suggestions[1]).toMatchObject({
      type: 'keyword',
      label: 'Zhong Zheng Ren (中正人)',
    });
  });

  it('keeps the evergreen showcase first when the holiday is upcoming', () => {
    const suggestions = buildSuggestionPool([
      holiday({
        label: 'Vesak Day',
        query: 'Vesak Day',
        date: '2026-05-31',
        detail: '31 May',
        isToday: false,
      }),
    ]);

    expect(suggestions[0]).toMatchObject({
      type: 'keyword',
      label: 'Zhong Zheng Ren (中正人)',
    });
    expect(suggestions[1]).toMatchObject({
      type: 'occasion',
      label: 'Vesak Day',
      isToday: false,
    });
    expect(suggestions[2]).toMatchObject({
      type: 'keyword',
      label: 'tropical fruit and flowers',
    });
  });

  it('does not include hardcoded festival suggestions when holidays are unavailable', () => {
    const suggestions = buildSuggestionPool([]);

    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain(
      'Mid-Autumn Festival'
    );
  });

  it('uses one distinct dot colour for occasion suggestions', () => {
    const suggestions = buildSuggestionPool([
      holiday({
        label: 'Vesak Day',
        query: 'Vesak Day',
        dot: '#cda636',
        isToday: false,
      }),
      holiday({
        label: 'Dragon Boat Festival',
        query: 'Dragon Boat Festival dragon boats zongzi river race',
        dot: '#365f9c',
        isToday: false,
      }),
      holiday({
        label: 'National Day',
        query: 'National Day',
        dot: '#bf5631',
        isToday: false,
      }),
    ]);

    const occasionDots = suggestions
      .filter((suggestion) => suggestion.type === 'occasion')
      .map((suggestion) => suggestion.dot);
    const tropicalKeywordDot = suggestions.find(
      (suggestion) => suggestion.label === 'tropical fruit and flowers'
    )?.dot;

    expect(new Set(occasionDots)).toEqual(new Set(['#365f9c']));
    expect(tropicalKeywordDot).toBe('#cda636');
  });

  it('returns distinct suggestion queries for try-query cache prefetching', () => {
    const suggestions = buildSuggestionPool([
      holiday({
        label: 'Vesak Day',
        query: 'Vesak Day',
        isToday: false,
      }),
      holiday({
        label: 'Duplicate Vesak',
        query: '  Vesak Day  ',
        isToday: false,
      }),
    ]);

    expect(getSuggestionPrefetchQueries(suggestions)).toEqual([
      CHUNG_CHENG_FEATURE_QUERY,
      'Vesak Day',
      'a still life of tropical fruit and flowers',
      'batik or songket textile pattern',
      'serene, still and contemplative',
      'Nanyang-style fusion of Chinese and Southeast Asian',
      'watercolour painting',
      'artworks made in the 1950s',
      'muted sage green',
    ]);
  });
});

describe('normalizeSearchQuery', () => {
  it('trims query text without rewriting it', () => {
    expect(normalizeSearchQuery(' Qixi Festival weaving stars lovers ')).toBe(
      'Qixi Festival weaving stars lovers'
    );
    expect(
      normalizeSearchQuery('a still life of tropical fruit and flowers')
    ).toBe('a still life of tropical fruit and flowers');
  });

  it('keeps freeform search text unchanged', () => {
    expect(normalizeSearchQuery('  batik workers  ')).toBe('batik workers');
  });
});
