import { z } from 'zod';
import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  type PublicSearchConstraints,
} from '@paillette/types/public-search-core';

const NGA_CLASSIFICATIONS = [
  'Painting',
  'Drawing',
  'Print',
  'Sculpture',
  'Photograph',
  'Decorative Art',
] as const;

const NGA_MEDIUM_FAMILIES = [
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

const constraintsSchema = z
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
    classifications: z.array(z.enum(NGA_CLASSIFICATIONS)).optional(),
    mediumFamilies: z.array(z.enum(NGA_MEDIUM_FAMILIES)).optional(),
    artistIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

export const normalizePublicImageSearchConstraints = (
  constraints: PublicSearchConstraints
): PublicSearchConstraints => ({
  ...(constraints.dateRange ? { dateRange: constraints.dateRange } : {}),
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

export const parsePublicImageSearchConstraints = (
  value: FormDataEntryValue | null
): PublicSearchConstraints | undefined => {
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new TypeError('Constraints must be a JSON object.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new TypeError('Constraints must contain valid JSON.');
  }

  const parsed = constraintsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TypeError('Constraints do not match the public search contract.');
  }

  return normalizePublicImageSearchConstraints(parsed.data);
};

type PublicImageSearchPlanInput = {
  orgId: string;
  image: File;
  topK: number;
  minScore: number;
  constraints?: PublicSearchConstraints;
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const readFileBytes = async (image: File): Promise<ArrayBuffer> => {
  if (typeof image.arrayBuffer === 'function') {
    return image.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new TypeError('Image bytes could not be read.'));
      }
    });
    reader.addEventListener('error', () =>
      reject(reader.error || new TypeError('Image bytes could not be read.'))
    );
    reader.readAsArrayBuffer(image);
  });
};

export const buildPublicImageSearchPlan = async ({
  orgId,
  image,
  topK,
  minScore,
  constraints,
}: PublicImageSearchPlanInput) => {
  const imageBytes = await readFileBytes(image);
  const digest = toHex(await crypto.subtle.digest('SHA-256', imageBytes));
  const canonicalConstraints =
    constraints === undefined
      ? undefined
      : normalizePublicImageSearchConstraints(constraints);
  const request = {
    image,
    topK,
    minScore,
    ...(canonicalConstraints !== undefined
      ? { constraints: canonicalConstraints }
      : {}),
  };

  return {
    digest,
    request,
    queryKey: [
      'search',
      'image',
      PUBLIC_SEARCH_CONTRACT_VERSION,
      orgId,
      digest,
      topK,
      minScore,
      JSON.stringify(canonicalConstraints ?? null),
    ] as const,
  };
};

export type PublicImageSearchPlan = Awaited<
  ReturnType<typeof buildPublicImageSearchPlan>
>;
