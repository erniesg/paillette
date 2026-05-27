import { describe, expect, it } from 'vitest';

import { buildSuggestionPool } from '../search-suggestions';
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
  it('uses a same-day public holiday as the first showcase suggestion', () => {
    const suggestions = buildSuggestionPool([holiday()]);

    expect(suggestions[0]).toMatchObject({
      type: 'occasion',
      label: 'Hari Raya Haji',
      isToday: true,
    });
    expect(suggestions[1]).toMatchObject({
      type: 'keyword',
      label: 'tropical fruit and flowers',
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
      label: 'tropical fruit and flowers',
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
});
