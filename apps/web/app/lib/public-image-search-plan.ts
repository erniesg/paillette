import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  normalizePublicSearchConstraints,
  parsePublicSearchConstraints,
  type PublicSearchConstraints,
} from '@paillette/types/public-search-core';

export {
  normalizePublicSearchConstraints as normalizePublicImageSearchConstraints,
} from '@paillette/types/public-search-core';

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

  return parsePublicSearchConstraints(decoded);
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
      : normalizePublicSearchConstraints(constraints);
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
