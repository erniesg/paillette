import type {
  PublicSearchConstraints,
  PublicSearchInterpretation,
} from '@paillette/types/public-search';

export const NGA_SEARCH_PARSER_VERSION = 'nga-v1' as const;

type VocabularyEntry = {
  canonical: string;
  aliases: string[];
};

const CLASSIFICATIONS: VocabularyEntry[] = [
  { canonical: 'Painting', aliases: ['painting', 'paintings', 'paintng', 'paintngs'] },
  { canonical: 'Drawing', aliases: ['drawing', 'drawings'] },
  { canonical: 'Print', aliases: ['print', 'prints'] },
  { canonical: 'Sculpture', aliases: ['sculpture', 'sculptures', 'scultpure', 'scultpures'] },
  { canonical: 'Photograph', aliases: ['photograph', 'photographs', 'photo', 'photos', 'photography'] },
  { canonical: 'Decorative Art', aliases: ['decorative art', 'decorative arts'] },
];

const MEDIUMS: VocabularyEntry[] = [
  { canonical: 'oil', aliases: ['oil', 'oils'] },
  { canonical: 'watercolor', aliases: ['watercolor', 'watercolors', 'watercolour', 'watercolours', 'watercolur'] },
  { canonical: 'ink', aliases: ['ink'] },
  { canonical: 'graphite', aliases: ['graphite', 'pencil', 'pencils'] },
  { canonical: 'charcoal', aliases: ['charcoal'] },
  { canonical: 'etching', aliases: ['etching', 'etchings'] },
  { canonical: 'engraving', aliases: ['engraving', 'engravings'] },
  { canonical: 'woodcut', aliases: ['woodcut', 'woodcuts', 'woodblock', 'woodblocks'] },
  { canonical: 'bronze', aliases: ['bronze'] },
  { canonical: 'marble', aliases: ['marble'] },
];

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
  twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, twentyfirst: 21,
};

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
  ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
  xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21,
};

const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const distance = (left: string, right: string): number => {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0]![column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost
      );
      if (
        row > 1 && column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row]![column] = Math.min(
          matrix[row]![column]!,
          matrix[row - 2]![column - 2]! + cost
        );
      }
    }
  }
  return matrix[left.length]![right.length]!;
};

const findVocabularyMatch = (
  token: string,
  entries: VocabularyEntry[]
): { canonical: string; correctedFrom?: string } | null => {
  for (const entry of entries) {
    if (entry.aliases.includes(token)) {
      const preferred = fold(entry.canonical);
      return { canonical: entry.canonical, ...(token === preferred ? {} : { correctedFrom: token }) };
    }
  }
  if (token.length <= 4) return null;
  const candidates = entries
    .flatMap((entry) => entry.aliases.map((alias) => ({ entry, alias, score: distance(token, alias) })))
    .filter(({ alias, score }) => score <= (alias.length >= 8 ? 2 : 1))
    .sort((a, b) => a.score - b.score || a.alias.localeCompare(b.alias));
  if (!candidates[0] || (candidates[1] && candidates[0].score === candidates[1].score && candidates[0].entry.canonical !== candidates[1].entry.canonical)) {
    return null;
  }
  return { canonical: candidates[0].entry.canonical, correctedFrom: token };
};

const parseCenturyNumber = (raw: string): number | null => {
  const normalized = fold(raw).replace(/[-\s]/g, '');
  const numeric = normalized.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (numeric) return Number(numeric[1]);
  return ORDINALS[normalized] ?? ROMAN[normalized] ?? null;
};

const periodThird = (start: number, qualifier?: string) => {
  if (!qualifier) return { startYear: start, endYear: start + 99 };
  if (qualifier === 'early') return { startYear: start, endYear: start + 33 };
  if (qualifier === 'mid') return { startYear: start + 34, endYear: start + 66 };
  return { startYear: start + 67, endYear: start + 99 };
};

const parseDateRange = (query: string): { range: { startYear: number; endYear: number }; matched: string } | null => {
  const circa = query.match(/\b(?:c(?:irca)?\.?|around)\s*(1[0-9]{3}|20[0-9]{2})\b/);
  if (circa) {
    const year = Number(circa[1]);
    return { range: { startYear: year - 10, endYear: year + 10 }, matched: circa[0] };
  }
  const explicitRange = query.match(/\b(?:between\s+)?(1[0-9]{3}|20[0-9]{2})\s*(?:-|to|and)\s*(1[0-9]{3}|20[0-9]{2})\b/);
  if (explicitRange) {
    const first = Number(explicitRange[1]);
    const second = Number(explicitRange[2]);
    return { range: { startYear: Math.min(first, second), endYear: Math.max(first, second) }, matched: explicitRange[0] };
  }
  const decade = query.match(/\b((?:1[0-9]|20)[0-9])0s\b/);
  if (decade) {
    const startYear = Number(`${decade[1]}0`);
    return { range: { startYear, endYear: startYear + 9 }, matched: decade[0] };
  }
  const century = query.match(/\b(?:(early|mid|late)\s+)?([a-z-]+|[ivx]+|\d{1,2}(?:st|nd|rd|th)?)\s+cent(?:ury|ry|ryy)\b/);
  if (century) {
    const number = parseCenturyNumber(century[2]!);
    if (number && number >= 1 && number <= 21) {
      return { range: periodThird((number - 1) * 100, century[1]), matched: century[0] };
    }
  }
  const boundary = query.match(/\b(before|after)\s+(1[0-9]{3}|20[0-9]{2})\b/);
  if (boundary) {
    const year = Number(boundary[2]);
    return {
      range: boundary[1] === 'before'
        ? { startYear: 1000, endYear: year - 1 }
        : { startYear: year + 1, endYear: 2100 },
      matched: boundary[0],
    };
  }
  const exact = query.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (exact && !/\b(?:accession|object|id)\s*$/.test(query.slice(0, exact.index))) {
    const year = Number(exact[1]);
    return { range: { startYear: year, endYear: year }, matched: exact[0] };
  }
  return null;
};

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

export const validateNgaSearchConstraints = (
  constraints: PublicSearchConstraints
): string | null => {
  if (
    constraints.dateRange &&
    (!Number.isInteger(constraints.dateRange.startYear) ||
      !Number.isInteger(constraints.dateRange.endYear) ||
      constraints.dateRange.startYear < 1000 ||
      constraints.dateRange.endYear > 2100 ||
      constraints.dateRange.startYear > constraints.dateRange.endYear)
  ) {
    return 'Invalid date range';
  }
  const allowedClassifications = new Set(CLASSIFICATIONS.map((entry) => entry.canonical));
  if (constraints.classifications?.some((value) => !allowedClassifications.has(value))) {
    return 'Unknown classification';
  }
  const allowedMediums = new Set(MEDIUMS.map((entry) => entry.canonical));
  if (constraints.mediumFamilies?.some((value) => !allowedMediums.has(value))) {
    return 'Unknown medium family';
  }
  return null;
};

export const normalizePublicSearchConstraints = (
  constraints: PublicSearchConstraints
): PublicSearchConstraints => ({
  ...(constraints.dateRange ? { dateRange: constraints.dateRange } : {}),
  ...(constraints.classifications?.length ? { classifications: uniqueSorted(constraints.classifications) } : {}),
  ...(constraints.mediumFamilies?.length ? { mediumFamilies: uniqueSorted(constraints.mediumFamilies) } : {}),
  ...(constraints.artistIds?.length ? { artistIds: uniqueSorted(constraints.artistIds) } : {}),
});

export const parseNgaSearchIntent = (
  originalQuery: string,
  explicitConstraints?: PublicSearchConstraints
): PublicSearchInterpretation => {
  const normalized = fold(originalQuery);
  const corrections: Array<{ from: string; to: string }> = [];
  if (explicitConstraints) {
    return {
      parserVersion: NGA_SEARCH_PARSER_VERSION,
      originalQuery,
      semanticQuery: normalized,
      constraints: normalizePublicSearchConstraints(explicitConstraints),
      corrections,
      unresolved: [],
    };
  }

  const constraints: PublicSearchConstraints = {};
  const removals: string[] = [];
  const parsedDate = parseDateRange(normalized);
  if (parsedDate) {
    constraints.dateRange = parsedDate.range;
    removals.push(parsedDate.matched);
    if (/cent(?:ry|ryy)/.test(parsedDate.matched)) {
      const typo = parsedDate.matched.match(/cent(?:ry|ryy)/)?.[0];
      if (typo && typo !== 'century') corrections.push({ from: typo, to: 'century' });
    }
  }

  const ambiguousClassification = /\bpainting\s+of\s+a?\s*sculpture\b|\b18th-century\s+style\b/.test(normalized);
  const classifications: string[] = [];
  const mediums: string[] = [];
  const tokens = normalized.split(' ');
  for (const token of tokens) {
    const classification = ambiguousClassification ? null : findVocabularyMatch(token, CLASSIFICATIONS);
    if (classification) {
      classifications.push(classification.canonical);
      removals.push(token);
      if (classification.correctedFrom && !CLASSIFICATIONS.some((entry) => fold(entry.canonical) === token)) {
        corrections.push({ from: token, to: fold(classification.canonical) });
      }
      continue;
    }
    const medium = findVocabularyMatch(token, MEDIUMS);
    if (medium) {
      mediums.push(medium.canonical);
      removals.push(token);
      if (medium.correctedFrom && medium.correctedFrom !== medium.canonical) {
        corrections.push({ from: token, to: medium.canonical });
      }
    }
  }
  if (classifications.length) constraints.classifications = uniqueSorted(classifications);
  if (mediums.length) constraints.mediumFamilies = uniqueSorted(mediums);

  let semanticQuery = normalized;
  for (const removal of [...removals].sort((a, b) => b.length - a.length)) {
    semanticQuery = semanticQuery.replace(new RegExp(`\\b${removal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  }
  semanticQuery = semanticQuery
    .replace(/\b(?:from|in|made|works?|artworks?|art|the|of|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    parserVersion: NGA_SEARCH_PARSER_VERSION,
    originalQuery,
    semanticQuery,
    constraints: normalizePublicSearchConstraints(constraints),
    corrections: corrections.filter((item, index, all) => all.findIndex((candidate) => candidate.from === item.from && candidate.to === item.to) === index),
    unresolved: [],
  };
};

export const matchesNgaSearchConstraints = (
  artwork: {
    year?: number | null;
    yearStart?: number | null;
    yearEnd?: number | null;
    classification?: string | null;
    visualClassification?: string | null;
    medium?: string | null;
    mediumFamily?: string | null;
    primaryArtistId?: string | null;
  },
  constraints: PublicSearchConstraints
) => {
  if (constraints.dateRange) {
    const start = artwork.yearStart ?? artwork.year ?? null;
    const end = artwork.yearEnd ?? artwork.year ?? null;
    if (start === null || end === null || start > constraints.dateRange.endYear || end < constraints.dateRange.startYear) return false;
  }
  if (constraints.classifications?.length) {
    const value = fold(artwork.visualClassification || artwork.classification || '');
    if (!constraints.classifications.some((candidate) => fold(candidate) === value)) return false;
  }
  if (constraints.mediumFamilies?.length) {
    const haystack = fold(`${artwork.mediumFamily || ''} ${artwork.medium || ''}`);
    if (!constraints.mediumFamilies.some((candidate) => haystack.includes(fold(candidate)))) return false;
  }
  if (constraints.artistIds?.length && (!artwork.primaryArtistId || !constraints.artistIds.includes(artwork.primaryArtistId))) return false;
  return true;
};
