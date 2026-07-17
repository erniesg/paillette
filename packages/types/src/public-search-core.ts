export const PUBLIC_SEARCH_CONTRACT_VERSION = '18' as const;
export const PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION = 1 as const;
export const PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES = 256 * 1024;
export const PUBLIC_SEARCH_CANONICAL_TOP_K = 100 as const;
export const PUBLIC_SEARCH_CANONICAL_MIN_SCORE = 0 as const;

export const normalizePublicSearchText = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ');
