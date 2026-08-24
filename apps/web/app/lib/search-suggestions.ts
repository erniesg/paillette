import type { HolidaySearchSuggestion } from './singapore-holidays.server';
import { NGA_SPOTLIGHT_DEFINITIONS } from './nga-spotlight-definitions';

const OCCASION_DOT = '#365f9c';

export const CHUNG_CHENG_FEATURE_LABEL = 'Zhong Zheng Ren (中正人)';
export const CHUNG_CHENG_FEATURE_QUERY =
  'Zhong Zheng Ren 中正人 Yeo Hwee Bin Chung Cheng High School sculpture';
export const CHUNG_CHENG_FEATURE_ACCESSION = '2019-00754';

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
  facet?: 'artist' | 'classification';
  spotlightId?: string;
};

export type SuggestionContext = {
  routeId?: string | null;
  source?: string | null;
  institutionName?: string | null;
};

const NGS_SUGGESTIONS: EvalSuggestion[] = [
  {
    type: 'keyword',
    label: 'tropical fruit and flowers',
    query: 'a still life of tropical fruit and flowers',
    dot: '#cda636',
  },
  {
    type: 'motif',
    label: 'fishing boats and sampans',
    query: 'fishing boats and sampans by the shore',
    dot: '#4c78a8',
  },
  {
    type: 'keyword',
    label: 'wet markets and hawkers',
    query: 'a crowded wet market with hawker stalls',
    dot: '#bf5631',
  },
  {
    type: 'motif',
    label: 'mother and child',
    query: 'a mother holding a child',
    dot: '#8a9a7a',
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

const NGA_SUGGESTIONS: EvalSuggestion[] = NGA_SPOTLIGHT_DEFINITIONS.map(
  ({ id, ...suggestion }) => ({ ...suggestion, spotlightId: id })
);

const normalizeContextKey = (context?: SuggestionContext) => {
  const routeId = context?.routeId?.trim().toLowerCase();
  const source = context?.source?.trim().toLowerCase();
  const institutionName = context?.institutionName?.trim().toLowerCase();

  if (
    routeId === 'nga' ||
    source === 'nga' ||
    institutionName?.includes('national gallery of art')
  ) {
    return 'nga';
  }

  return 'ngs';
};

const getBaseSuggestions = (context?: SuggestionContext) =>
  normalizeContextKey(context) === 'nga' ? NGA_SUGGESTIONS : NGS_SUGGESTIONS;

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
  holidaySuggestions: HolidaySearchSuggestion[],
  context?: SuggestionContext
): EvalSuggestion[] => {
  const contextKey = normalizeContextKey(context);
  const baseSuggestions = getBaseSuggestions(context);
  const [firstSuggestion, ...remainingSuggestions] = baseSuggestions;
  const leadingSuggestions = firstSuggestion ? [firstSuggestion] : [];
  const holidayEvalSuggestions = holidaySuggestions.map(
    toEvalHolidaySuggestion
  );

  if (contextKey === 'nga') {
    return baseSuggestions;
  }

  if (!holidayEvalSuggestions.length) {
    return baseSuggestions;
  }

  if (holidayEvalSuggestions.some((suggestion) => suggestion.isToday)) {
    return [...holidayEvalSuggestions, ...baseSuggestions];
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
