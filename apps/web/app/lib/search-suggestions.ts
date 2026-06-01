import type { HolidaySearchSuggestion } from './singapore-holidays.server';

const OCCASION_DOT = '#365f9c';

export type EvalSuggestion = {
  type:
    | 'keyword'
    | 'occasion'
    | 'motif'
    | 'mood'
    | 'style'
    | 'medium'
    | 'metadata'
    | 'colour';
  label: string;
  query: string;
  dot: string;
  detail?: string;
  date?: string;
  isToday?: boolean;
  colourId?: string;
  source?: HolidaySearchSuggestion['source'];
};

const EVAL_SUGGESTIONS: EvalSuggestion[] = [
  {
    type: 'keyword',
    label: 'tropical fruit and flowers',
    query: 'a still life of tropical fruit and flowers',
    dot: '#cda636',
  },
  {
    type: 'motif',
    label: 'batik textile pattern',
    query: 'batik or songket textile pattern',
    dot: '#bf5631',
  },
  {
    type: 'mood',
    label: 'serene and contemplative',
    query: 'serene, still and contemplative',
    dot: '#8a9a7a',
  },
  {
    type: 'style',
    label: 'Nanyang style',
    query: 'Nanyang-style fusion of Chinese and Southeast Asian',
    dot: '#365f9c',
  },
  {
    type: 'medium',
    label: 'watercolour painting',
    query: 'watercolour painting',
    dot: '#6e8ea8',
  },
  {
    type: 'metadata',
    label: '1950s works',
    query: 'artworks made in the 1950s',
    dot: '#6a5238',
  },
  {
    type: 'colour',
    label: 'muted sage green',
    query: 'muted sage green',
    dot: '#8a9a7a',
    colourId: 'sage',
  },
];

const toEvalHolidaySuggestion = (
  suggestion: HolidaySearchSuggestion
): EvalSuggestion => ({
  type: suggestion.type,
  label: suggestion.label,
  query: suggestion.query,
  dot: OCCASION_DOT,
  detail: suggestion.detail,
  date: suggestion.date,
  isToday: suggestion.isToday,
  source: suggestion.source,
});

export const buildSuggestionPool = (
  holidaySuggestions: HolidaySearchSuggestion[]
): EvalSuggestion[] => {
  const [firstSuggestion, ...remainingSuggestions] = EVAL_SUGGESTIONS;
  const leadingSuggestions = firstSuggestion ? [firstSuggestion] : [];
  const holidayEvalSuggestions = holidaySuggestions.map(
    toEvalHolidaySuggestion
  );

  if (!holidayEvalSuggestions.length) {
    return EVAL_SUGGESTIONS;
  }

  if (holidayEvalSuggestions.some((suggestion) => suggestion.isToday)) {
    return [...holidayEvalSuggestions, ...EVAL_SUGGESTIONS];
  }

  return [
    ...leadingSuggestions,
    ...holidayEvalSuggestions,
    ...remainingSuggestions,
  ];
};

export const getSuggestionKey = (suggestion: EvalSuggestion) =>
  `${suggestion.type}-${suggestion.label}-${suggestion.query}`;

export const normalizeSearchQuery = (query: string) => {
  const trimmed = query.trim();
  if (!trimmed) return '';

  return trimmed;
};

export const getSuggestionPrefetchQueries = (
  suggestions: EvalSuggestion[]
) => {
  const queries: string[] = [];
  const seen = new Set<string>();

  for (const suggestion of suggestions) {
    const query = normalizeSearchQuery(suggestion.query);
    if (!query || seen.has(query)) continue;

    queries.push(query);
    seen.add(query);
  }

  return queries;
};
