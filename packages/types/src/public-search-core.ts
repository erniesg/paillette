import { z } from 'zod';

export const PUBLIC_SEARCH_CONTRACT_VERSION = '30' as const;
export const PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION = 1 as const;
export const PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES = 256 * 1024;
export const PUBLIC_SEARCH_CANONICAL_TOP_K = 100 as const;
export const PUBLIC_SEARCH_CANONICAL_MIN_SCORE = 0 as const;

export const normalizePublicSearchText = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ');

export type PublicSearchConstraints = {
  dateRange?: { startYear: number; endYear: number };
  classifications?: string[];
  mediumFamilies?: string[];
  artistIds?: string[];
};

export const NGA_SEARCH_CLASSIFICATIONS = [
  'Painting',
  'Drawing',
  'Print',
  'Sculpture',
  'Photograph',
  'Decorative Art',
] as const;

export const NGA_SEARCH_MEDIUM_FAMILIES = [
  'oil',
  'watercolor',
  'ink',
  'graphite',
  'charcoal',
  'etching',
  'engraving',
  'woodcut',
  'bronze',
  'marble',
] as const;

export const PublicSearchConstraintsSchema = z
  .object({
    dateRange: z
      .object({
        startYear: z.number().int().min(1000).max(2100),
        endYear: z.number().int().min(1000).max(2100),
      })
      .strict()
      .refine((range) => range.startYear <= range.endYear, {
        message: 'Invalid date range',
      })
      .optional(),
    classifications: z.array(z.enum(NGA_SEARCH_CLASSIFICATIONS)).optional(),
    mediumFamilies: z.array(z.enum(NGA_SEARCH_MEDIUM_FAMILIES)).optional(),
    artistIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

export const normalizePublicSearchConstraints = (
  constraints: PublicSearchConstraints
): PublicSearchConstraints => ({
  ...(constraints.dateRange
    ? {
        dateRange: {
          startYear: constraints.dateRange.startYear,
          endYear: constraints.dateRange.endYear,
        },
      }
    : {}),
  ...(constraints.classifications?.length
    ? { classifications: uniqueSorted(constraints.classifications) }
    : {}),
  ...(constraints.mediumFamilies?.length
    ? { mediumFamilies: uniqueSorted(constraints.mediumFamilies) }
    : {}),
  ...(constraints.artistIds?.length
    ? { artistIds: uniqueSorted(constraints.artistIds) }
    : {}),
});

export const validatePublicSearchConstraints = (
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
  const classifications = new Set<string>(NGA_SEARCH_CLASSIFICATIONS);
  if (
    constraints.classifications?.some(
      (value) => !classifications.has(value)
    )
  ) {
    return 'Unknown classification';
  }
  const mediumFamilies = new Set<string>(NGA_SEARCH_MEDIUM_FAMILIES);
  if (
    constraints.mediumFamilies?.some((value) => !mediumFamilies.has(value))
  ) {
    return 'Unknown medium family';
  }
  return null;
};

export const parsePublicSearchConstraints = (
  input: unknown
): PublicSearchConstraints => {
  const parsed = PublicSearchConstraintsSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError('Constraints do not match the public search contract.');
  }

  return normalizePublicSearchConstraints(parsed.data);
};

export type PublicSearchRelation =
  | {
      kind: 'depicts' | 'features';
      workClassification: string;
      subjectClassification: string;
    }
  | {
      kind: 'derived_from';
      workClassification: string;
      sourceClassification: string;
    };

export type NgaAttributionIntent = {
  relationship:
    | 'direct'
    | 'after'
    | 'attributed_to'
    | 'workshop_of'
    | 'studio_of'
    | 'circle_of'
    | 'school_of'
    | 'follower_of';
  targetText: string;
};

export type PublicSearchRelationEvidence = {
  policy: 'visible_subject' | 'catalogue_derivation';
  status: 'candidate' | 'verified' | 'unverified';
};

export type NgaSearchPlan = {
  version: 'nga-plan-v2';
  mode: 'structured' | 'semantic' | 'relational' | 'attribution';
  retrievalQuery: string;
  constraints: PublicSearchConstraints;
  relation?: PublicSearchRelation;
  attribution?: NgaAttributionIntent;
  relationEvidence?: PublicSearchRelationEvidence;
};

export type PublicSearchInterpretation = {
  parserVersion:
    | 'nga-v1'
    | 'nga-v2'
    | 'nga-v3'
    | 'nga-v4'
    | 'nga-v5'
    | 'nga-v6'
    | 'nga-v7';
  originalQuery: string;
  semanticQuery: string;
  constraints: PublicSearchConstraints;
  relation?: PublicSearchRelation;
  attribution?: NgaAttributionIntent;
  relationEvidence?: PublicSearchRelationEvidence;
  corrections: Array<{ from: string; to: string }>;
  unresolved: string[];
};
