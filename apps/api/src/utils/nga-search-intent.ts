import {
  NGA_SEARCH_CLASSIFICATIONS,
  NGA_SEARCH_MEDIUM_FAMILIES,
  normalizePublicSearchConstraints,
  validatePublicSearchConstraints,
  type NgaAttributionIntent,
  type NgaSearchPlan,
  type PublicSearchConstraints,
  type PublicSearchInterpretation,
  type PublicSearchRelation,
} from '@paillette/types/public-search-core';
import { deriveNgaDisplayDateRange } from '@paillette/types/nga-date-range';

export const NGA_SEARCH_PARSER_VERSION = 'nga-v7' as const;

type VocabularyEntry = {
  canonical: string;
  aliases: string[];
};

const CLASSIFICATION_ALIASES = [
  ['painting', 'paintings', 'paintng', 'paintngs'],
  ['drawing', 'drawings'],
  ['print', 'prints'],
  ['sculpture', 'sculptures', 'scultpure', 'scultpures'],
  ['photograph', 'photographs', 'photo', 'photos', 'photography'],
  ['decorative art', 'decorative arts'],
] as const;

const CLASSIFICATIONS: VocabularyEntry[] = NGA_SEARCH_CLASSIFICATIONS.map(
  (canonical, index) => ({
    canonical,
    aliases: [...CLASSIFICATION_ALIASES[index]!],
  })
);

const MEDIUM_ALIASES = [
  ['oil', 'oils'],
  [
    'watercolor',
    'watercolors',
    'watercolour',
    'watercolours',
    'watercolur',
  ],
  ['ink'],
  ['graphite', 'pencil', 'pencils'],
  ['charcoal'],
  ['etching', 'etchings'],
  ['engraving', 'engravings'],
  ['woodcut', 'woodcuts', 'woodblock', 'woodblocks'],
  ['bronze'],
  ['marble'],
] as const;

const MEDIUMS: VocabularyEntry[] = NGA_SEARCH_MEDIUM_FAMILIES.map(
  (canonical, index) => ({
    canonical,
    aliases: [...MEDIUM_ALIASES[index]!],
  })
);

const SUBJECTS: VocabularyEntry[] = [
  { canonical: 'landscape', aliases: ['landscape'] },
  { canonical: 'portrait', aliases: ['portrait'] },
  { canonical: 'religious', aliases: ['religious'] },
  { canonical: 'seascape', aliases: ['seascape'] },
  { canonical: 'interior', aliases: ['interior'] },
  { canonical: 'vessel', aliases: ['vessel'] },
];

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  twentyfirst: 21,
};

const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16,
  xvii: 17,
  xviii: 18,
  xix: 19,
  xx: 20,
  xxi: 21,
};

const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(
      /\b(does|do|did|is|was|were|has|have|had)n['\u2019]t\b/g,
      '$1 not'
    )
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/([a-z])-/g, '$1 ')
    .replace(/-([a-z])/g, ' $1')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const includesFoldedToken = (value: string, candidate: string) => {
  const foldedCandidate = fold(candidate);
  return (
    foldedCandidate.length > 0 &&
    ` ${fold(value)} `.includes(` ${foldedCandidate} `)
  );
};

const distance = (left: string, right: string): number => {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () =>
    new Array<number>(columns).fill(0)
  );
  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let column = 0; column < columns; column += 1)
    matrix[0]![column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost
      );
      if (
        row > 1 &&
        column > 1 &&
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

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findExactPhraseMatches = (
  query: string,
  entries: VocabularyEntry[]
): Array<{ canonical: string; matched: string }> => {
  const occupied: Array<{ start: number; end: number }> = [];
  const matches: Array<{ canonical: string; matched: string }> = [];
  const phrases = entries
    .flatMap((entry) =>
      entry.aliases
        .filter((alias) => alias.includes(' '))
        .map((alias) => ({ canonical: entry.canonical, alias }))
    )
    .sort(
      (left, right) =>
        right.alias.length - left.alias.length ||
        left.alias.localeCompare(right.alias)
    );

  for (const phrase of phrases) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase.alias)}\\b`, 'g');
    for (const match of query.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some((span) => start < span.end && end > span.start)) {
        continue;
      }
      occupied.push({ start, end });
      matches.push({ canonical: phrase.canonical, matched: match[0] });
    }
  }

  return matches;
};

type ClassificationSpan = {
  canonical: string;
  matched: string;
  start: number;
  end: number;
};

const findClassificationSpans = (query: string): ClassificationSpan[] => {
  const occupied: Array<{ start: number; end: number }> = [];
  const matches: ClassificationSpan[] = [];
  const aliases = CLASSIFICATIONS.flatMap((entry) =>
    entry.aliases.map((alias) => ({ canonical: entry.canonical, alias }))
  ).sort(
    (left, right) =>
      right.alias.length - left.alias.length ||
      left.alias.localeCompare(right.alias)
  );

  for (const { canonical, alias } of aliases) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'g');
    for (const match of query.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some((span) => start < span.end && end > span.start)) {
        continue;
      }
      occupied.push({ start, end });
      matches.push({ canonical, matched: match[0], start, end });
    }
  }

  return matches.sort((left, right) => left.start - right.start);
};

export type NgaSearchIntentSpan = { start: number; end: number };

type NormalizedAttributionQuery = {
  text: string;
  originalStarts: number[];
  originalEnds: number[];
};

const normalizeAttributionQuery = (
  value: string
): NormalizedAttributionQuery => {
  let text = '';
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  let pendingSpace: NgaSearchIntentSpan | null = null;

  const append = (textValue: string, start: number, end: number) => {
    text += textValue;
    for (let index = 0; index < textValue.length; index += 1) {
      originalStarts.push(start);
      originalEnds.push(end);
    }
  };

  for (let start = 0; start < value.length; ) {
    const codePoint = String.fromCodePoint(value.codePointAt(start)!);
    let end = start + codePoint.length;
    while (end < value.length) {
      const next = String.fromCodePoint(value.codePointAt(end)!);
      if (!/^\p{M}$/u.test(next)) break;
      end += next.length;
    }

    const segment = value.slice(start, end).normalize('NFC');
    if (/^[\p{P}\p{S}\s]+$/u.test(segment)) {
      pendingSpace = pendingSpace
        ? { start: pendingSpace.start, end }
        : { start, end };
    } else {
      if (pendingSpace && text) {
        append(' ', pendingSpace.start, pendingSpace.end);
      }
      pendingSpace = null;
      append(segment, start, end);
    }
    start = end;
  }

  return { text, originalStarts, originalEnds };
};

const normalizeAttributionText = (value: string) =>
  normalizeAttributionQuery(value).text;

const originalAttributionSpan = (
  normalized: NormalizedAttributionQuery,
  start: number,
  end: number
): NgaSearchIntentSpan => ({
  start: normalized.originalStarts[start] ?? normalized.text.length,
  end:
    normalized.originalEnds[Math.max(start, end - 1)] ??
    normalized.originalStarts[start] ??
    normalized.text.length,
});

const ATTRIBUTION_CARRIERS = [
  ...CLASSIFICATIONS.flatMap((entry) => entry.aliases),
  'work',
  'works',
  'artwork',
  'artworks',
  'picture',
  'pictures',
  'piece',
  'pieces',
].sort((left, right) => right.length - left.length);

const ATTRIBUTION_CARRIER_PATTERN = new RegExp(
  `\\b(?:${ATTRIBUTION_CARRIERS.map(escapeRegExp).join('|')})\\b`,
  'iu'
);

const ATTRIBUTION_CONTROL_TOKENS = new Set([
  'a',
  'an',
  'art',
  'artist',
  'artists',
  'artwork',
  'artworks',
  'attributed',
  'by',
  'example',
  'examples',
  'from',
  'made',
  'me',
  'of',
  'piece',
  'pieces',
  'please',
  'show',
  'the',
  'to',
  'work',
  'works',
]);

const ATTRIBUTION_PATTERNS: ReadonlyArray<{
  relationship: NgaAttributionIntent['relationship'];
  marker: RegExp;
}> = [
  {
    relationship: 'attributed_to',
    marker: /\b(?:attributed|ascribed)\s+to\b/iu,
  },
  {
    relationship: 'workshop_of',
    marker: /\b(?:from\s+(?:the\s+)?)?workshop\s+of\b/iu,
  },
  {
    relationship: 'studio_of',
    marker: /\b(?:from\s+(?:the\s+)?)?studio\s+of\b/iu,
  },
  {
    relationship: 'circle_of',
    marker: /\b(?:from\s+(?:the\s+)?)?circle\s+of\b/iu,
  },
  {
    relationship: 'school_of',
    marker: /\b(?:from\s+(?:the\s+)?)?school\s+of\b/iu,
  },
  {
    relationship: 'follower_of',
    marker: /\b(?:(?:by|from)\s+)?(?:a\s+|the\s+)?follower\s+of\b/iu,
  },
  { relationship: 'after', marker: /\bafter\b/iu },
  {
    relationship: 'direct',
    marker: /\b(?:(?:created|made|painted|drawn|sculpted|executed)\s+)?by\b/iu,
  },
];

const targetIsControlOnly = (targetText: string): boolean => {
  const normalized = fold(targetText);
  if (!normalized || /^(?:1[0-9]{3}|20[0-9]{2})$/.test(normalized)) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  const vocabularyTokens = new Set([
    ...ATTRIBUTION_CONTROL_TOKENS,
    ...CLASSIFICATIONS.flatMap((entry) => entry.aliases.map(fold)),
    ...MEDIUMS.flatMap((entry) => entry.aliases.map(fold)),
  ]);
  return tokens.every(
    (token) =>
      ATTRIBUTION_CONTROL_TOKENS.has(token) ||
      vocabularyTokens.has(token) ||
      /^\d+(?:st|nd|rd|th)?$/.test(token) ||
      /^(?:century|centry|centryy|before|after|around|circa)$/.test(token)
  );
};

const overlapsOccupiedSpan = (
  start: number,
  end: number,
  occupiedSpans: readonly NgaSearchIntentSpan[]
) =>
  occupiedSpans.some((span) => start < span.end && end > span.start);

const findAttributionConstraintSuffix = (
  normalized: NormalizedAttributionQuery,
  originalQuery: string,
  targetStart: number
): number | null => {
  const targetAndSuffix = normalized.text.slice(targetStart);
  for (const boundary of targetAndSuffix.matchAll(
    /\b(?:in|from|before|after|between|around|circa|made|on)\b/giu
  )) {
    if (!boundary.index) continue;
    const suffixStart = targetStart + boundary.index;
    const originalSuffixStart = originalAttributionSpan(
      normalized,
      suffixStart,
      suffixStart + boundary[0].length
    ).start;
    const suffix = originalQuery.slice(originalSuffixStart);
    const suffixIntent = parseNgaSearchIntentFlat(suffix);
    if (
      Object.keys(suffixIntent.constraints).length > 0 &&
      /^(?:(?:and|or|to)\s*)*$/.test(suffixIntent.semanticQuery)
    ) {
      return suffixStart;
    }
  }
  return null;
};

type ParsedNgaAttribution = {
  intent: NgaAttributionIntent;
  workQuery: string;
};

const parseNgaAttributionMatch = (
  query: string,
  occupiedSpans: readonly NgaSearchIntentSpan[] = []
): ParsedNgaAttribution | null => {
  const normalized = normalizeAttributionQuery(query);

  for (const pattern of ATTRIBUTION_PATTERNS) {
    const marker = pattern.marker.exec(normalized.text);
    if (!marker || marker.index === undefined) continue;
    if (
      !ATTRIBUTION_CARRIER_PATTERN.test(
        normalized.text.slice(0, marker.index)
      )
    ) {
      continue;
    }

    let targetStart = marker.index + marker[0].length;
    while (normalized.text[targetStart] === ' ') targetStart += 1;
    const suffixStart = findAttributionConstraintSuffix(
      normalized,
      query,
      targetStart
    );
    let targetEnd = suffixStart ?? normalized.text.length;
    while (normalized.text[targetEnd - 1] === ' ') targetEnd -= 1;
    const targetText = normalized.text
      .slice(targetStart, targetEnd)
      .replace(/\s+please$/iu, '')
      .trim();
    const matchSpan = originalAttributionSpan(
      normalized,
      marker.index,
      targetEnd
    );
    if (
      !targetText ||
      targetIsControlOnly(targetText) ||
      overlapsOccupiedSpan(matchSpan.start, matchSpan.end, occupiedSpans)
    ) {
      continue;
    }

    const suffixOriginalStart =
      suffixStart === null
        ? query.length
        : originalAttributionSpan(normalized, suffixStart, suffixStart + 1)
            .start;
    return {
      intent: { relationship: pattern.relationship, targetText },
      workQuery: `${query.slice(0, matchSpan.start)} ${query.slice(
        suffixOriginalStart
      )}`.trim(),
    };
  }

  return null;
};

export const parseNgaAttributionIntent = (
  query: string,
  occupiedSpans: readonly NgaSearchIntentSpan[] = []
): NgaAttributionIntent | null =>
  parseNgaAttributionMatch(query, occupiedSpans)?.intent ?? null;

export const canonicalNgaAttribution = (
  intent: NgaAttributionIntent
): NgaAttributionIntent => ({
  relationship: intent.relationship,
  targetText: normalizeAttributionText(intent.targetText)
    .toLocaleLowerCase('en-US')
    .replace(/(^|\s)(\p{L})/gu, (_, prefix: string, letter: string) =>
      `${prefix}${letter.toLocaleUpperCase('en-US')}`
    ),
});

const attributionNegationSpans = (query: string): NgaSearchIntentSpan[] => {
  const normalized = normalizeAttributionQuery(query);
  const marker =
    '(?:after|(?:attributed|ascribed)\\s+to|(?:from\\s+(?:the\\s+)?)?(?:workshop|studio|circle|school)\\s+of|(?:(?:by|from)\\s+)?(?:a\\s+|the\\s+)?follower\\s+of|(?:(?:created|made|painted|drawn|sculpted|executed)\\s+)?by)';
  const carrier = `(?:${ATTRIBUTION_CARRIERS.map(escapeRegExp).join('|')})`;
  const workModifier = `(?:(?:a|an|the|early|mid|late|first|second|third|fourth|\\d+(?:st|nd|rd|th)?|century|centry|centryy|${MEDIUMS.flatMap(
    (entry) => entry.aliases
  )
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')})\\s+)*`;
  const patterns = [
    new RegExp(
      `\\b(?:not|never)\\s+(?:really\\s+|actually\\s+|directly\\s+)?${marker}\\b[\\s\\S]*$`,
      'giu'
    ),
    new RegExp(
      `\\b(?:no|not)\\s+${workModifier}${carrier}\\b[\\s\\S]*?${marker}\\b[\\s\\S]*$`,
      'giu'
    ),
  ];

  return patterns.flatMap((pattern) =>
    [...normalized.text.matchAll(pattern)].map((match) =>
      originalAttributionSpan(
        normalized,
        match.index,
        match.index + match[0].length
      )
    )
  );
};

type RelationConnector = {
  kind: PublicSearchRelation['kind'];
  pattern: RegExp;
  workSide: 'left' | 'right';
};

const RELATION_CONNECTORS: RelationConnector[] = [
  {
    kind: 'derived_from',
    pattern: /\bused\s+as\s+(?:the\s+)?basis\s+for\b/g,
    workSide: 'right',
  },
  {
    kind: 'depicts',
    pattern: /\b(?:shown|depicted)\s+in\b/g,
    workSide: 'right',
  },
  {
    kind: 'features',
    pattern: /\bfeatured\s+in\b/g,
    workSide: 'right',
  },
  {
    kind: 'derived_from',
    pattern: /\b(?:based\s+on|after)\b/g,
    workSide: 'left',
  },
  {
    kind: 'depicts',
    pattern:
      /\b(?:does|do|did)\s+not\s+(?:only|merely|just)\s+(?:show|depict)\b/g,
    workSide: 'left',
  },
  {
    kind: 'depicts',
    pattern: /\b(?:showing|depicting|of)\b/g,
    workSide: 'left',
  },
  {
    kind: 'features',
    pattern: /\b(?:with|features?|featuring)\b/g,
    workSide: 'left',
  },
];

type CompiledRelation = {
  relation: PublicSearchRelation;
  workText: string;
  targetText: string;
  targetMatch: ClassificationSpan;
  connectorStart: number;
  connectorEnd: number;
};

type RelationAnalysis = {
  compiled?: CompiledRelation;
  ambiguous: boolean;
};

type NegatedRelationConnector = {
  kind: PublicSearchRelation['kind'];
  pattern: RegExp;
  workSide: 'left' | 'right';
  targetNegated?: boolean;
};

type CompiledNegatedRelation = {
  kind: PublicSearchRelation['kind'];
  workText: string;
  targetText: string;
  workMatch: ClassificationSpan;
  targetMatch: ClassificationSpan;
};

const NEGATED_RELATION_CONNECTORS: NegatedRelationConnector[] = [
  {
    kind: 'derived_from',
    pattern: /\bused\s+as\s+(?:the\s+)?basis\s+for\b/g,
    workSide: 'right',
    targetNegated: true,
  },
  {
    kind: 'derived_from',
    pattern: /\bnot\s+used\s+as\s+(?:the\s+)?basis\s+for\b/g,
    workSide: 'right',
  },
  {
    kind: 'depicts',
    pattern: /\b(?:shown|depicted)\s+in\b/g,
    workSide: 'right',
    targetNegated: true,
  },
  {
    kind: 'depicts',
    pattern: /\b(?:not|never)\s+(?:shown|depicted)\s+in\b/g,
    workSide: 'right',
  },
  {
    kind: 'features',
    pattern: /\bfeatured\s+in\b/g,
    workSide: 'right',
    targetNegated: true,
  },
  {
    kind: 'features',
    pattern: /\b(?:not|never)\s+featured\s+in\b/g,
    workSide: 'right',
  },
  {
    kind: 'derived_from',
    pattern: /\b(?:not|never)\s+based\s+on\b/g,
    workSide: 'left',
  },
  {
    kind: 'depicts',
    pattern:
      /\b(?:(?:not|never)\s+(?:showing|depicting)|(?:does|do|did)\s+not(?!\s+(?:only|merely|just)\b)(?:\s+[a-z]+){0,2}\s+(?:show|depict))\b/g,
    workSide: 'left',
  },
  {
    kind: 'features',
    pattern:
      /\b(?:(?:not|never)\s+(?:featuring|with)|(?:does|do|did)\s+not(?!\s+(?:only|merely|just)\b)(?:\s+[a-z]+){0,2}\s+feature|(?:with\s+no|without))\b/g,
    workSide: 'left',
  },
];

const isAfterRelationTargetPrefix = (value: string): boolean => {
  const allowed = new Set([
    'a',
    'an',
    'the',
    ...MEDIUMS.flatMap((entry) => entry.aliases).filter(
      (alias) => !alias.includes(' ')
    ),
  ]);
  return value
    .split(' ')
    .filter(Boolean)
    .every((token) => allowed.has(token));
};

const hasNegatedTargetPrefix = (query: string, targetStart: number) => {
  const match = query.slice(0, targetStart).match(/\bno\b([\s\S]*)$/);
  return Boolean(
    match && isAfterRelationTargetPrefix((match[1] || '').trim())
  );
};

const analyzeNegatedRelation = (
  query: string
): CompiledNegatedRelation | undefined => {
  const spans = findClassificationSpans(query);
  const candidates: CompiledNegatedRelation[] = [];

  for (const connector of NEGATED_RELATION_CONNECTORS) {
    for (const match of query.matchAll(connector.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const left = spans.filter((span) => span.end <= start);
      const right = spans.filter((span) => span.start >= end);
      if (left.length !== 1 || right.length !== 1) continue;
      if (
        connector.workSide === 'left' &&
        !isAfterRelationTargetPrefix(
          query.slice(end, right[0]!.start).trim()
        )
      ) {
        continue;
      }
      if (
        connector.targetNegated &&
        !hasNegatedTargetPrefix(query, left[0]!.start)
      ) {
        continue;
      }
      const rawTargetText =
        connector.workSide === 'left'
          ? query.slice(end).trim()
          : query.slice(0, start).trim();
      const targetText = connector.targetNegated
        ? rawTargetText.replace(/\bno\b/, ' ').replace(/\s+/g, ' ').trim()
        : rawTargetText;

      candidates.push({
        kind: connector.kind,
        workText:
          connector.workSide === 'left'
            ? query.slice(0, start).trim()
            : query.slice(end).trim(),
        targetText,
        workMatch: connector.workSide === 'left' ? left[0]! : right[0]!,
        targetMatch: connector.workSide === 'left' ? right[0]! : left[0]!,
      });
    }
  }

  return candidates.length === 1 ? candidates[0] : undefined;
};

const isClassificationList = (
  query: string,
  spans: ClassificationSpan[]
): boolean => {
  if (spans.length < 2) return false;
  const connectors = spans.slice(1).map((span, index) => {
    const previous = spans[index]!;
    return query.slice(previous.end, span.start).trim();
  });
  return (
    connectors.some((connector) => /^(?:and|or)\b/.test(connector)) &&
    connectors.every(
      (connector) =>
        connector === '' ||
        /^(?:and|or)(?:\s+(?:a|an|the))?$/.test(connector)
    )
  );
};

const analyzeRelation = (query: string): RelationAnalysis => {
  const spans = findClassificationSpans(query);
  const candidates: CompiledRelation[] = [];
  let incompleteRelation = false;

  for (const connector of RELATION_CONNECTORS) {
    for (const match of query.matchAll(connector.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const left = spans.filter((span) => span.end <= start);
      const right = spans.filter((span) => span.start >= end);
      if (!left.length || !right.length) continue;
      if (
        connector.kind === 'derived_from' &&
        match[0] === 'after' &&
        !isAfterRelationTargetPrefix(query.slice(end, right[0]!.start).trim())
      ) {
        continue;
      }
      if (left.length !== 1 || right.length !== 1) {
        incompleteRelation = true;
        continue;
      }

      const workMatch = connector.workSide === 'left' ? left[0]! : right[0]!;
      const targetMatch = connector.workSide === 'left' ? right[0]! : left[0]!;
      const workClassification = workMatch.canonical;
      const relation: PublicSearchRelation =
        connector.kind === 'derived_from'
          ? {
              kind: 'derived_from',
              workClassification,
              sourceClassification: targetMatch.canonical,
            }
          : {
              kind: connector.kind,
              workClassification,
              subjectClassification: targetMatch.canonical,
            };
      candidates.push({
        relation,
        workText:
          connector.workSide === 'left'
            ? query.slice(0, start).trim()
            : query.slice(end).trim(),
        targetText:
          connector.workSide === 'left'
            ? query.slice(end).trim()
            : query.slice(0, start).trim(),
        targetMatch,
        connectorStart: start,
        connectorEnd: end,
      });
    }
  }

  if (candidates.length === 1 && !incompleteRelation) {
    return { compiled: candidates[0], ambiguous: false };
  }

  const ambiguousPicture = new RegExp(
    `\\bpictures?\\s+of\\s+(?:(?:a|an|the)\\s+)?(?:${CLASSIFICATIONS.flatMap(
      (entry) => entry.aliases
    )
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join('|')})\\b`
  ).test(query);

  return {
    ambiguous:
      candidates.length > 1 ||
      incompleteRelation ||
      ambiguousPicture ||
      (spans.length > 1 && !isClassificationList(query, spans)),
  };
};

const compileScopedNegatedRelation = (
  query: string,
  compiled: CompiledRelation
): CompiledNegatedRelation | undefined => {
  const spans = findClassificationSpans(query);
  if (spans.length !== 2) return undefined;

  const targetIsFirst = spans[0]!.start === compiled.targetMatch.start;
  const targetPrefixIsNegated =
    targetIsFirst &&
    hasNegatedTargetPrefix(query, compiled.targetMatch.start);

  const workMatch = spans.find(
    (span) => span.start !== compiled.targetMatch.start
  );
  if (!workMatch) return undefined;
  const workModifier = query
    .slice(workMatch.end, compiled.connectorStart)
    .trim();
  const targetModifier = query
    .slice(compiled.targetMatch.end, compiled.connectorStart)
    .trim();
  const targetPrefixModifier = query
    .slice(compiled.connectorEnd, compiled.targetMatch.start)
    .trim();
  const isNegatedModifier = (value: string) =>
    /(?:^|\s)(?:not|never)(?:\s+(?!(?:by|in|with|without|only|merely|just)\b)[a-z]+){0,2}$/.test(
      value
    ) ||
    /(?:^|\s)(?:not|never)\s+(?:at\s+all|in\s+(?:any|no)\s+way)$/.test(
      value
    ) ||
    /(?:^|\s)in\s+no\s+way$/.test(value) ||
    /(?:^|\s)(?:that|which)\s+is\s+not\s+(?:a|an|the)\s+(?:depiction|representation|feature|copy)$/.test(
      value
    ) || /(?:^|\s)(?:free|devoid)$/.test(value);
  const targetPrefixNegatesRelation = (value: string) => {
    return (
      /^(?:no|not|zero)\b/.test(value) ||
      /^(?:anything|everything|all)\s+(?:but|except)\b/.test(value)
    );
  };
  const modifierIsNegated =
    isNegatedModifier(workModifier) ||
    (targetIsFirst && isNegatedModifier(targetModifier)) ||
    (!targetIsFirst && targetPrefixNegatesRelation(targetPrefixModifier));
  if (!modifierIsNegated && !targetPrefixIsNegated) return undefined;

  const workText = modifierIsNegated && !targetIsFirst
    ? compiled.workText
        .replace(/\b(?:no|not|never|without|free|devoid)\b[\s\S]*$/, ' ')
        .replace(/\b(?:that|which)\s+is\s*$/, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : compiled.workText;
  const targetText = (
    targetIsFirst && isNegatedModifier(targetModifier)
      ? query.slice(0, compiled.targetMatch.end)
      : compiled.targetText
  )
    .replace(/\b(?:no|not|never|zero)\b/g, ' ')
    .replace(/\b(?:anything|everything|all)\s+(?:but|except)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    kind: compiled.relation.kind,
    workText,
    targetText,
    workMatch,
    targetMatch: compiled.targetMatch,
  };
};

const negatesReturnedWorkClassification = (
  query: string,
  compiled: CompiledRelation
) => {
  const workMatch = findClassificationSpans(query).find(
    (span) => span.start !== compiled.targetMatch.start
  );
  if (!workMatch) return false;
  const match = query
    .slice(0, workMatch.start)
    .match(/\b(?:no|not)\b([\s\S]*)$/);
  if (!match) return false;
  const modifier = (match[1] || '').trim();
  if (isAfterRelationTargetPrefix(modifier)) return true;

  const modifierIntent = parseNgaSearchIntentFlat(
    `${modifier} ${workMatch.matched}`
  );
  return (
    /^(?:a|an|the)?$/.test(modifierIntent.semanticQuery) &&
    modifierIntent.constraints.classifications?.includes(
      workMatch.canonical
    ) === true
  );
};

const findVocabularyMatch = (
  token: string,
  entries: VocabularyEntry[]
): { canonical: string; correctedFrom?: string } | null => {
  for (const entry of entries) {
    if (entry.aliases.includes(token)) {
      const preferred = fold(entry.canonical);
      return {
        canonical: entry.canonical,
        ...(token === preferred ? {} : { correctedFrom: token }),
      };
    }
  }
  if (token.length <= 4) return null;
  const candidates = entries
    .flatMap((entry) =>
      entry.aliases
        .filter((alias) => !alias.includes(' '))
        .map((alias) => ({
          entry,
          alias,
          score: distance(token, alias),
        }))
    )
    .filter(({ alias, score }) => score <= (alias.length >= 8 ? 2 : 1))
    .sort((a, b) => a.score - b.score || a.alias.localeCompare(b.alias));
  if (
    !candidates[0] ||
    (candidates[1] &&
      candidates[0].score === candidates[1].score &&
      candidates[0].entry.canonical !== candidates[1].entry.canonical)
  ) {
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
  if (qualifier === 'mid')
    return { startYear: start + 34, endYear: start + 66 };
  return { startYear: start + 67, endYear: start + 99 };
};

const centuryPeriod = (start: number, qualifier?: string) => {
  if (!qualifier || /^(?:early|mid|late)$/.test(qualifier)) {
    return periodThird(start, qualifier);
  }

  const ordinal = qualifier.split(' ')[0];
  if (qualifier.endsWith(' half')) {
    return ordinal === 'first' || ordinal === '1st'
      ? { startYear: start, endYear: start + 49 }
      : { startYear: start + 50, endYear: start + 99 };
  }

  const quarterIndex =
    ordinal === 'first' || ordinal === '1st'
      ? 0
      : ordinal === 'second' || ordinal === '2nd'
        ? 1
        : ordinal === 'third' || ordinal === '3rd'
          ? 2
          : 3;
  return {
    startYear: start + quarterIndex * 25,
    endYear: start + quarterIndex * 25 + 24,
  };
};

const parseDateBoundaries = (query: string) => [
  ...query.matchAll(/\b(before|after)\s+(1[0-9]{3}|20[0-9]{2})\b/g),
];

const intersectDateBoundaries = (
  range: { startYear: number; endYear: number },
  boundaries: readonly RegExpExecArray[]
) => {
  let { startYear, endYear } = range;
  for (const boundary of boundaries) {
    const year = Number(boundary[2]);
    if (boundary[1] === 'before') {
      endYear = Math.min(endYear, year - 1);
    } else {
      startYear = Math.max(startYear, year + 1);
    }
  }
  return startYear <= endYear ? { startYear, endYear } : null;
};

const parseDateRange = (
  query: string
): {
  range: { startYear: number; endYear: number } | null;
  matched: string[];
} | null => {
  const circa = query.match(
    /\b(?:c(?:irca)?\.?|around)\s*(1[0-9]{3}|20[0-9]{2})\b/
  );
  if (circa) {
    const year = Number(circa[1]);
    return {
      range: { startYear: year - 10, endYear: year + 10 },
      matched: [circa[0]],
    };
  }
  const explicitRange = query.match(
    /\b(?:between\s+)?(1[0-9]{3}|20[0-9]{2})\s*(?:-|to|and)\s*(1[0-9]{3}|20[0-9]{2})\b/
  );
  if (explicitRange) {
    const first = Number(explicitRange[1]);
    const second = Number(explicitRange[2]);
    return {
      range: {
        startYear: Math.min(first, second),
        endYear: Math.max(first, second),
      },
      matched: [explicitRange[0]],
    };
  }
  const decade = query.match(/\b((?:1[0-9]|20)[0-9])0s\b/);
  if (decade) {
    const startYear = Number(`${decade[1]}0`);
    return {
      range: { startYear, endYear: startYear + 9 },
      matched: [decade[0]],
    };
  }
  const century = query.match(
    /\b(?:(early|mid|late)\s+|((?:first|second|1st|2nd)\s+half|(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter)(?:\s+of(?:\s+the)?)?\s+)?([a-z-]+|[ivx]+|\d{1,2}(?:st|nd|rd|th)?)\s+cent(?:ury|ry|ryy)\b/
  );
  if (century) {
    const number = parseCenturyNumber(century[3]!);
    if (number && number >= 1 && number <= 21) {
      const boundaries = parseDateBoundaries(query);
      const range = intersectDateBoundaries(
        centuryPeriod((number - 1) * 100, century[1] || century[2]),
        boundaries
      );
      return {
        range,
        matched: range
          ? [century[0], ...boundaries.map((boundary) => boundary[0])]
          : [],
      };
    }
  }
  const boundaries = parseDateBoundaries(query);
  if (boundaries.length) {
    const range = intersectDateBoundaries(
      { startYear: 1000, endYear: 2100 },
      boundaries
    );
    if (!range) return { range: null, matched: [] };
    return {
      range,
      matched: boundaries.map((boundary) => boundary[0]),
    };
  }
  const exact = query.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (
    exact &&
    !/\b(?:accession|object|id)\s*$/.test(query.slice(0, exact.index))
  ) {
    const year = Number(exact[1]);
    return {
      range: { startYear: year, endYear: year },
      matched: [exact[0]],
    };
  }
  return null;
};

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

export { normalizePublicSearchConstraints };
export const validateNgaSearchConstraints = validatePublicSearchConstraints;

const parseNgaSearchIntentFlat = (
  originalQuery: string,
  explicitConstraints?: PublicSearchConstraints
): PublicSearchInterpretation => {
  const normalized = fold(originalQuery);
  const corrections: Array<{ from: string; to: string }> = [];
  if (explicitConstraints) {
    // Explicit constraints are authoritative, but callers can still send a
    // stale query string that contains the words represented by old chips.
    // Reuse the normal parser only to remove those structured phrases from
    // retrieval text; never merge its inferred constraints back in.
    const semanticInterpretation = parseNgaSearchIntentFlat(originalQuery);
    return {
      ...semanticInterpretation,
      constraints: normalizePublicSearchConstraints(explicitConstraints),
    };
  }

  const constraints: PublicSearchConstraints = {};
  const removals: string[] = [];
  const ambiguousDate = /\b\d{1,2}(?:st|nd|rd|th)\s+century\s+style\b/.test(
    normalized
  );
  const parsedDate = ambiguousDate ? null : parseDateRange(normalized);
  if (parsedDate?.range) {
    constraints.dateRange = parsedDate.range;
    removals.push(...parsedDate.matched);
    for (const matched of parsedDate.matched) {
      if (!/cent(?:ry|ryy)/.test(matched)) continue;
      const typo = matched.match(/cent(?:ry|ryy)/)?.[0];
      if (typo && typo !== 'century')
        corrections.push({ from: typo, to: 'century' });
    }
  }

  const classificationTerm = `(?:${CLASSIFICATIONS.flatMap(
    (entry) => entry.aliases
  )
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')})`;
  const relationalConnector =
    '(?:of|in|depicting|after|showing|with|depicted\\s+in|based\\s+on)';
  const relationalDeterminer = '(?:(?:a|an|the)\\s+)?';
  const ambiguousClassification =
    new RegExp(
      `\\b${classificationTerm}\\s+${relationalConnector}\\s+${relationalDeterminer}${classificationTerm}\\b`
    ).test(normalized) ||
    new RegExp(
      `\\bpictures?\\s+${relationalConnector}\\s+${relationalDeterminer}${classificationTerm}\\b`
    ).test(normalized);
  const classifications: string[] = [];
  const mediums: string[] = [];
  let tokenSource = normalized;
  if (!ambiguousClassification) {
    for (const phrase of findExactPhraseMatches(normalized, CLASSIFICATIONS)) {
      classifications.push(phrase.canonical);
      removals.push(phrase.matched);
      tokenSource = tokenSource.replace(
        new RegExp(`\\b${escapeRegExp(phrase.matched)}\\b`, 'g'),
        ' '
      );
    }
  }
  const tokens = tokenSource.split(' ');
  for (const token of tokens) {
    const classification = ambiguousClassification
      ? null
      : findVocabularyMatch(token, CLASSIFICATIONS);
    if (classification) {
      classifications.push(classification.canonical);
      removals.push(token);
      if (
        classification.correctedFrom &&
        !CLASSIFICATIONS.some((entry) => fold(entry.canonical) === token)
      ) {
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
  if (classifications.length)
    constraints.classifications = uniqueSorted(classifications);
  if (mediums.length) constraints.mediumFamilies = uniqueSorted(mediums);

  let semanticQuery = normalized;
  for (const removal of [...removals].sort((a, b) => b.length - a.length)) {
    semanticQuery = semanticQuery.replace(
      new RegExp(
        `\\b${removal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'g'
      ),
      ' '
    );
  }
  const semanticStopwords = ambiguousClassification
    ? /\b(?:from|in|made|works?|artworks?|the|of|by)\b/g
    : /\b(?:from|in|made|works?|artworks?|art|the|of|by)\b/g;
  semanticQuery = semanticQuery
    .replace(semanticStopwords, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const subjectTokens = semanticQuery.split(' ');
  for (const token of subjectTokens) {
    const subject = findVocabularyMatch(token, SUBJECTS);
    if (!subject?.correctedFrom || token === subject.canonical) continue;
    semanticQuery = semanticQuery.replace(
      new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
      subject.canonical
    );
    corrections.push({ from: token, to: subject.canonical });
  }

  if (/\breligious\b/.test(semanticQuery)) {
    semanticQuery = semanticQuery.replace(
      /\breligious\b/,
      'religious biblical sacred scene'
    );
  }
  if (/\bpainting a sculpture\b/.test(semanticQuery)) {
    semanticQuery = semanticQuery.replace(
      /\bpainting a sculpture\b/,
      'painting depicting a sculpture'
    );
  }
  if (semanticQuery === 'after rembrandt') {
    semanticQuery = 'after rembrandt attribution';
  }
  if (semanticQuery === 'italian renaissance') {
    semanticQuery = 'italian renaissance 1400s 1500s';
  }

  return {
    parserVersion: NGA_SEARCH_PARSER_VERSION,
    originalQuery,
    semanticQuery,
    constraints: normalizePublicSearchConstraints(constraints),
    corrections: corrections.filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.from === item.from && candidate.to === item.to
        ) === index
    ),
    unresolved: [],
  };
};

const cleanRoleExtras = (value: string) =>
  value
    .replace(/\b(?:a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildRelationRetrievalQuery = (
  compiled: CompiledRelation,
  workSemanticQuery: string
): string => {
  const workClassification = fold(compiled.relation.workClassification);
  const targetClassification =
    compiled.relation.kind === 'derived_from'
      ? compiled.relation.sourceClassification
      : compiled.relation.subjectClassification;
  const targetExtras = cleanRoleExtras(
    compiled.targetText.replace(
      new RegExp(`\\b${escapeRegExp(compiled.targetMatch.matched)}\\b`),
      ' '
    )
  );
  const workPhrase = [cleanRoleExtras(workSemanticQuery), workClassification]
    .filter(Boolean)
    .join(' ');
  const targetPhrase = [targetExtras, fold(targetClassification)]
    .filter(Boolean)
    .join(' ');
  const connector =
    compiled.relation.kind === 'depicts'
      ? 'depicting'
      : compiled.relation.kind === 'features'
        ? 'featuring'
        : 'based on';
  return `${workPhrase} ${connector} ${targetPhrase}`;
};

const buildNegatedRelationRetrievalQuery = (
  compiled: CompiledNegatedRelation,
  workSemanticQuery: string
): string => {
  const targetExtras = cleanRoleExtras(
    compiled.targetText.replace(
      new RegExp(`\\b${escapeRegExp(compiled.targetMatch.matched)}\\b`),
      ' '
    )
  );
  const workPhrase = [
    cleanRoleExtras(workSemanticQuery),
    fold(compiled.workMatch.canonical),
  ]
    .filter(Boolean)
    .join(' ');
  const targetPhrase = [targetExtras, fold(compiled.targetMatch.canonical)]
    .filter(Boolean)
    .join(' ');
  const connector =
    compiled.kind === 'depicts'
      ? 'not depicting'
      : compiled.kind === 'features'
        ? 'not featuring'
        : 'not based on';
  return `${workPhrase} ${connector} ${targetPhrase}`;
};

export const parseNgaSearchIntent = (
  originalQuery: string,
  explicitConstraints?: PublicSearchConstraints
): PublicSearchInterpretation => {
  const normalized = fold(originalQuery);
  const relationAnalysis = analyzeRelation(normalized);
  if (
    relationAnalysis.compiled &&
    negatesReturnedWorkClassification(normalized, relationAnalysis.compiled)
  ) {
    return {
      parserVersion: NGA_SEARCH_PARSER_VERSION,
      originalQuery,
      semanticQuery: normalized,
      constraints:
        explicitConstraints === undefined
          ? {}
          : normalizePublicSearchConstraints(explicitConstraints),
      corrections: [],
      unresolved: [normalized],
    };
  }
  const negatedRelation =
    analyzeNegatedRelation(normalized) ||
    (relationAnalysis.compiled
      ? compileScopedNegatedRelation(normalized, relationAnalysis.compiled)
      : undefined);
  if (negatedRelation) {
    const inferredWorkIntent = parseNgaSearchIntentFlat(
      negatedRelation.workText
    );
    return {
      parserVersion: NGA_SEARCH_PARSER_VERSION,
      originalQuery,
      semanticQuery: buildNegatedRelationRetrievalQuery(
        negatedRelation,
        inferredWorkIntent.semanticQuery
      ),
      constraints:
        explicitConstraints === undefined
          ? inferredWorkIntent.constraints
          : normalizePublicSearchConstraints(explicitConstraints),
      corrections: inferredWorkIntent.corrections,
      unresolved: [normalized],
    };
  }
  if (relationAnalysis.compiled) {
    const inferredWorkIntent = parseNgaSearchIntentFlat(
      relationAnalysis.compiled.workText
    );
    return {
      parserVersion: NGA_SEARCH_PARSER_VERSION,
      originalQuery,
      semanticQuery: buildRelationRetrievalQuery(
        relationAnalysis.compiled,
        inferredWorkIntent.semanticQuery
      ),
      constraints:
        explicitConstraints === undefined
          ? inferredWorkIntent.constraints
          : normalizePublicSearchConstraints(explicitConstraints),
      relation: relationAnalysis.compiled.relation,
      corrections: inferredWorkIntent.corrections,
      unresolved: [],
    };
  }

  const attributionMatch = relationAnalysis.ambiguous
    ? null
    : parseNgaAttributionMatch(
        originalQuery,
        attributionNegationSpans(originalQuery)
      );
  if (attributionMatch) {
    const workIntent = parseNgaSearchIntentFlat(
      attributionMatch.workQuery,
      explicitConstraints
    );
    const targetSemanticText = fold(attributionMatch.intent.targetText);
    return {
      ...workIntent,
      originalQuery,
      semanticQuery:
        attributionMatch.intent.relationship === 'after'
          ? `after ${targetSemanticText} attribution`
          : targetSemanticText,
      attribution: attributionMatch.intent,
    };
  }

  const interpretation = parseNgaSearchIntentFlat(
    originalQuery,
    explicitConstraints
  );
  if (!relationAnalysis.ambiguous) return interpretation;

  return {
    ...interpretation,
    constraints:
      explicitConstraints === undefined ? {} : interpretation.constraints,
    unresolved: [normalized],
  };
};

const buildPlanRetrievalFallback = (constraints: PublicSearchConstraints) => {
  const classifications = uniqueSorted(
    (constraints.classifications || []).map(fold)
  );
  const mediumFamilies = uniqueSorted(
    (constraints.mediumFamilies || []).map(fold)
  );
  return [...classifications, ...mediumFamilies].join(' ') || 'art';
};

export const compileNgaSearchPlan = (
  query: string,
  explicitConstraints?: PublicSearchConstraints
): NgaSearchPlan => {
  const interpretation = parseNgaSearchIntent(query, explicitConstraints);
  if (interpretation.relation) {
    return {
      version: 'nga-plan-v2',
      mode: 'relational',
      retrievalQuery: interpretation.semanticQuery,
      constraints: interpretation.constraints,
      relation: interpretation.relation,
    };
  }
  if (interpretation.attribution) {
    const attribution = canonicalNgaAttribution(interpretation.attribution);
    return {
      version: 'nga-plan-v2',
      mode: 'attribution',
      retrievalQuery: fold(attribution.targetText),
      constraints: interpretation.constraints,
      attribution,
    };
  }

  const structured = Object.keys(interpretation.constraints).length > 0;
  const meaningfulSemanticQuery = /^(?!(?:and|or)(?:\s+(?:and|or))*$).+/.test(
    interpretation.semanticQuery
  )
    ? interpretation.semanticQuery
    : '';
  return {
    version: 'nga-plan-v2',
    mode: structured ? 'structured' : 'semantic',
    retrievalQuery:
      meaningfulSemanticQuery ||
      buildPlanRetrievalFallback(interpretation.constraints),
    constraints: interpretation.constraints,
  };
};

export const matchesNgaSearchConstraints = (
  artwork: {
    year?: number | null;
    yearStart?: number | null;
    yearEnd?: number | null;
    dateText?: string | null;
    classification?: string | null;
    visualClassification?: string | null;
    medium?: string | null;
    mediumFamily?: string | null;
    primaryArtistId?: string | null;
  },
  constraints: PublicSearchConstraints
) => {
  if (constraints.dateRange) {
    const displayRange =
      artwork.dateText === undefined
        ? null
        : deriveNgaDisplayDateRange(artwork.dateText || '');
    if (artwork.dateText !== undefined && displayRange === null) return false;
    const start =
      displayRange?.startYear ?? artwork.yearStart ?? artwork.year ?? null;
    const end =
      displayRange?.endYear ?? artwork.yearEnd ?? artwork.year ?? null;
    if (
      start === null ||
      end === null ||
      start > constraints.dateRange.endYear ||
      end < constraints.dateRange.startYear
    )
      return false;
  }
  if (constraints.classifications?.length) {
    const value = fold(
      artwork.visualClassification || artwork.classification || ''
    );
    if (
      !constraints.classifications.some(
        (candidate) => fold(candidate) === value
      )
    )
      return false;
  }
  if (constraints.mediumFamilies?.length) {
    if (
      !constraints.mediumFamilies.some((candidate) =>
        includesFoldedToken(
          `${artwork.mediumFamily || ''} ${artwork.medium || ''}`,
          candidate
        )
      )
    )
      return false;
  }
  if (
    constraints.artistIds?.length &&
    (!artwork.primaryArtistId ||
      !constraints.artistIds.includes(artwork.primaryArtistId))
  )
    return false;
  return true;
};
