import { describe, expect, it } from 'vitest';

import {
  buildSuggestionPool,
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
  it('starts with a concise result-bearing evergreen query', () => {
    const suggestions = buildSuggestionPool([]);

    expect(suggestions[0]).toMatchObject({
      type: 'keyword',
      label: 'tropical studies',
      query: 'tropical',
    });
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
      label: 'tropical studies',
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
      label: 'tropical studies',
    });
    expect(suggestions[1]).toMatchObject({
      type: 'occasion',
      label: 'Vesak Day',
      isToday: false,
    });
  });

  it('does not include hardcoded festival suggestions when holidays are unavailable', () => {
    const suggestions = buildSuggestionPool([]);

    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain(
      'Mid-Autumn Festival'
    );
  });

  it('uses one dot colour for occasion suggestions', () => {
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

    expect(new Set(occasionDots)).toEqual(new Set(['#cda636']));
  });
});

describe('normalizeSearchQuery', () => {
  it('maps stale suggestion URLs to result-bearing queries', () => {
    expect(normalizeSearchQuery('Qixi Festival weaving stars lovers')).toBe(
      'weaving'
    );
    expect(
      normalizeSearchQuery('a still life of tropical fruit and flowers')
    ).toBe('tropical');
  });

  it('keeps freeform search text unchanged', () => {
    expect(normalizeSearchQuery('  batik workers  ')).toBe('batik workers');
  });
});
