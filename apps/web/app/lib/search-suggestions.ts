import type { HolidaySearchSuggestion } from './singapore-holidays.server';

const OCCASION_DOT = '#cda636';

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
    label: 'tropical studies',
    query: 'tropical',
    dot: '#cda636',
  },
  {
    type: 'motif',
    label: 'batik textile pattern',
    query: 'batik',
    dot: '#bf5631',
  },
  {
    type: 'mood',
    label: 'serene landscapes',
    query: 'serene',
    dot: '#8a9a7a',
  },
  {
    type: 'style',
    label: 'Nanyang style',
    query: 'Nanyang',
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
    query: '1950s',
    dot: '#6a5238',
  },
  {
    type: 'colour',
    label: 'landscape greens',
    query: 'landscape',
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
