import type { HolidaySearchSuggestion } from './singapore-holidays.server';
import { NGA_SPOTLIGHT_DEFINITIONS } from './nga-spotlight-definitions';
import { NGS_SPOTLIGHT_DEFINITIONS } from './ngs-spotlight-definitions';

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

const NGS_SUGGESTIONS: EvalSuggestion[] = NGS_SPOTLIGHT_DEFINITIONS.map(
  ({ id, ...suggestion }) => ({ ...suggestion, spotlightId: id })
);

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
