import { z } from 'zod';
import {
  PUBLIC_SEARCH_CONTRACT_VERSION,
  normalizePublicSearchText,
} from '@paillette/types/public-search';
import type { ArtworkSearchResult, SearchResponse } from '../types';

const PUBLIC_SEARCH_RESULT_CACHE_KEY_VERSION = 4;

export const PUBLIC_SEARCH_RESULT_CACHE_SCHEMA_VERSION = 2 as const;
export const PUBLIC_SEARCH_RESULT_CACHE_READ_TIMEOUT_MS = 300;
export const PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_SEARCH_RESULT_CACHE_HARD_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PUBLIC_SEARCH_RESULT_CACHE_MAX_BYTES = 5 * 1024 * 1024;

export type PublicSearchResultCacheDisposition =
  | 'kv-fresh'
  | 'kv-stale'
  | 'coalesced'
  | 'miss';

export interface PublicSearchResultCacheIdentity {
  query: string;
  orgId?: string;
  provider?: string;
  facet?: 'artist' | 'classification';
  visualRefinement?: string;
  topK: number;
  minScore: number;
  embeddingIndexVersion: string;
  fusionMode: string;
  modelIdentity: string;
  parserVersion?: string;
  constraints?: import('@paillette/types/public-search').PublicSearchConstraints;
}

export interface PublicSearchResultCacheLoadResult {
  response: SearchResponse;
  cacheable: boolean;
}

export interface PublicSearchResultCacheOptions
  extends PublicSearchResultCacheIdentity {
  cache?: KVNamespace;
  load: () => Promise<PublicSearchResultCacheLoadResult>;
  schedule?: (work: Promise<void>) => void;
  now?: () => number;
}

export interface PublicSearchResultCacheResult {
  response: SearchResponse;
  disposition: PublicSearchResultCacheDisposition;
}

type DirectPublicSearchResultCacheResult = Omit<
  PublicSearchResultCacheResult,
  'disposition'
> & {
  disposition: Exclude<PublicSearchResultCacheDisposition, 'coalesced'>;
};

const ArtworkSearchResultSchema: z.ZodType<ArtworkSearchResult> = z
  .object({
    id: z.string().min(1),
    orgId: z.string().min(1).optional(),
    galleryId: z.string().min(1),
    title: z.string().optional(),
    artist: z.string().optional(),
    year: z.number().finite().optional(),
    imageUrl: z.string().nullable(),
    thumbnailUrl: z.string().nullable().optional(),
    similarity: z.number().finite(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const CachedPublicSearchResultSchema = z
  .object({
    schemaVersion: z.literal(PUBLIC_SEARCH_RESULT_CACHE_SCHEMA_VERSION),
    contractVersion: z.literal(PUBLIC_SEARCH_CONTRACT_VERSION),
    orgId: z.string().min(1).nullable(),
    provider: z.string().min(1).nullable(),
    storedAt: z.number().int().nonnegative(),
    results: z.array(ArtworkSearchResultSchema),
    count: z.number().int().nonnegative(),
    interpretation: z.unknown().optional(),
  })
  .strict()
  .refine((value) => value.count === value.results.length, {
    message: 'Cached search count must match the result list',
  });

type CachedPublicSearchResult = z.infer<typeof CachedPublicSearchResultSchema>;

type CacheLookup =
  | { state: 'fresh'; value: CachedPublicSearchResult }
  | { state: 'stale'; value: CachedPublicSearchResult }
  | { state: 'miss' };

const inFlightLoads = new Map<
  string,
  Promise<DirectPublicSearchResultCacheResult>
>();
const inFlightRefreshes = new Map<string, Promise<void>>();

const normalizeScope = (value: string | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeOptionalText = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const normalized = normalizePublicSearchText(value);
  return normalized || null;
};

const assertValidIdentity = (
  identity: PublicSearchResultCacheIdentity
): void => {
  if (!normalizePublicSearchText(identity.query)) {
    throw new TypeError('Public search cache query cannot be empty');
  }
  if (!Number.isInteger(identity.topK) || identity.topK <= 0) {
    throw new TypeError('Public search cache topK must be a positive integer');
  }
  if (
    !Number.isFinite(identity.minScore) ||
    identity.minScore < 0 ||
    identity.minScore > 1
  ) {
    throw new TypeError('Public search cache minScore must be between 0 and 1');
  }
  for (const [name, value] of [
    ['embeddingIndexVersion', identity.embeddingIndexVersion],
    ['fusionMode', identity.fusionMode],
    ['modelIdentity', identity.modelIdentity],
  ] as const) {
    if (!value.trim()) {
      throw new TypeError(`Public search cache ${name} cannot be empty`);
    }
  }
};

const toHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

export const buildPublicSearchResultCacheKey = async (
  identity: PublicSearchResultCacheIdentity
): Promise<string> => {
  const serializedIdentity = serializePublicSearchResultCacheIdentity(identity);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serializedIdentity)
  );

  return `public-search-result:v${PUBLIC_SEARCH_RESULT_CACHE_KEY_VERSION}:${toHex(digest)}`;
};

const serializePublicSearchResultCacheIdentity = (
  identity: PublicSearchResultCacheIdentity
): string => {
  assertValidIdentity(identity);

  return JSON.stringify({
    keyVersion: PUBLIC_SEARCH_RESULT_CACHE_KEY_VERSION,
    contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
    query: normalizePublicSearchText(identity.query).toLocaleLowerCase('en-US'),
    orgId: normalizeScope(identity.orgId),
    provider: normalizeScope(identity.provider),
    facet: identity.facet || null,
    visualRefinement: normalizeOptionalText(identity.visualRefinement),
    topK: identity.topK,
    minScore: identity.minScore,
    embeddingIndexVersion: identity.embeddingIndexVersion.trim(),
    fusionMode: identity.fusionMode.trim(),
    modelIdentity: identity.modelIdentity.trim(),
    parserVersion: identity.parserVersion?.trim() || null,
    constraints: identity.constraints
      ? {
          ...(identity.constraints.dateRange ? { dateRange: identity.constraints.dateRange } : {}),
          classifications: [...(identity.constraints.classifications || [])].sort(),
          mediumFamilies: [...(identity.constraints.mediumFamilies || [])].sort(),
          artistIds: [...(identity.constraints.artistIds || [])].sort(),
        }
      : null,
  });
};

const reconstructResponse = (
  value: CachedPublicSearchResult
): SearchResponse => ({
  results: value.results,
  count: value.count,
  queryTime: 0,
  ...(value.interpretation
    ? {
        interpretation:
          value.interpretation as SearchResponse['interpretation'],
      }
    : {}),
});

const readCacheValue = async (
  cache: KVNamespace | undefined,
  key: string
): Promise<unknown | null> => {
  if (!cache) return null;

  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return await Promise.race([
      cache.get<unknown>(key, 'json'),
      new Promise<null>((resolve) => {
        timeout = setTimeout(
          () => resolve(null),
          PUBLIC_SEARCH_RESULT_CACHE_READ_TIMEOUT_MS
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  } catch {
    return null;
  }
};

const lookupCachedResult = async (
  cache: KVNamespace | undefined,
  key: string,
  identity: PublicSearchResultCacheIdentity,
  now: number
): Promise<CacheLookup> => {
  const rawValue = await readCacheValue(cache, key);
  const parsed = CachedPublicSearchResultSchema.safeParse(rawValue);
  if (!parsed.success) return { state: 'miss' };

  const expectedOrgId = normalizeScope(identity.orgId);
  const expectedProvider = normalizeScope(identity.provider);
  if (
    parsed.data.orgId !== expectedOrgId ||
    parsed.data.provider !== expectedProvider
  ) {
    return { state: 'miss' };
  }

  const age = now - parsed.data.storedAt;
  if (age < 0) return { state: 'miss' };
  if (age <= PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS) {
    return { state: 'fresh', value: parsed.data };
  }
  if (age <= PUBLIC_SEARCH_RESULT_CACHE_HARD_TTL_SECONDS * 1000) {
    return { state: 'stale', value: parsed.data };
  }
  return { state: 'miss' };
};

const stableValueFromResponse = (
  response: SearchResponse,
  identity: PublicSearchResultCacheIdentity,
  storedAt: number
): CachedPublicSearchResult | null => {
  const parsed = CachedPublicSearchResultSchema.safeParse({
    schemaVersion: PUBLIC_SEARCH_RESULT_CACHE_SCHEMA_VERSION,
    contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
    orgId: normalizeScope(identity.orgId),
    provider: normalizeScope(identity.provider),
    storedAt,
    results: response.results,
    count: response.count,
    interpretation: response.interpretation,
  });
  return parsed.success ? parsed.data : null;
};

const persistResult = async (
  cache: KVNamespace | undefined,
  key: string,
  identity: PublicSearchResultCacheIdentity,
  response: SearchResponse,
  storedAt: number
): Promise<void> => {
  if (!cache) return;

  const stableValue = stableValueFromResponse(response, identity, storedAt);
  if (!stableValue) return;

  const serialized = JSON.stringify(stableValue);
  if (
    new TextEncoder().encode(serialized).byteLength >
    PUBLIC_SEARCH_RESULT_CACHE_MAX_BYTES
  ) {
    return;
  }

  try {
    await cache.put(key, serialized, {
      expirationTtl: PUBLIC_SEARCH_RESULT_CACHE_HARD_TTL_SECONDS,
    });
  } catch {
    // Search remains usable when KV persistence is unavailable.
  }
};

const scheduleBackground = (
  work: Promise<void>,
  schedule: PublicSearchResultCacheOptions['schedule']
): void => {
  const guarded = work.catch(() => undefined);
  if (!schedule) {
    void guarded;
    return;
  }

  try {
    schedule(guarded);
  } catch {
    // The work has already started; local runtimes may not expose waitUntil.
  }
};

const beginStaleRefresh = (
  key: string,
  options: PublicSearchResultCacheOptions,
  now: () => number
): void => {
  if (inFlightRefreshes.has(key)) return;

  const refresh = (async () => {
    const loaded = await options.load();
    if (loaded.cacheable === true) {
      await persistResult(options.cache, key, options, loaded.response, now());
    }
  })().finally(() => {
    if (inFlightRefreshes.get(key) === refresh) {
      inFlightRefreshes.delete(key);
    }
  });
  inFlightRefreshes.set(key, refresh);
  scheduleBackground(refresh, options.schedule);
};

const resolveResult = async (
  key: string,
  options: PublicSearchResultCacheOptions,
  now: () => number
): Promise<DirectPublicSearchResultCacheResult> => {
  const lookup = await lookupCachedResult(options.cache, key, options, now());
  if (lookup.state === 'fresh') {
    return {
      response: reconstructResponse(lookup.value),
      disposition: 'kv-fresh',
    };
  }
  if (lookup.state === 'stale') {
    beginStaleRefresh(key, options, now);
    return {
      response: reconstructResponse(lookup.value),
      disposition: 'kv-stale',
    };
  }

  const loaded = await options.load();
  if (loaded.cacheable === true) {
    scheduleBackground(
      persistResult(options.cache, key, options, loaded.response, now()),
      options.schedule
    );
  }
  return { response: loaded.response, disposition: 'miss' };
};

export const getOrLoadPublicSearchResult = async (
  options: PublicSearchResultCacheOptions
): Promise<PublicSearchResultCacheResult> => {
  // Reserve the synchronous identity before hashing or reading KV. Otherwise,
  // two callers can race through the async digest and invert leader/follower
  // telemetry even though the backend load itself is still single-flighted.
  const inFlightIdentity = serializePublicSearchResultCacheIdentity(options);
  const existing = inFlightLoads.get(inFlightIdentity);
  if (existing) {
    const resolved = await existing;
    return { response: resolved.response, disposition: 'coalesced' };
  }

  const now = options.now || Date.now;
  const pending = (async () => {
    const key = await buildPublicSearchResultCacheKey(options);
    return resolveResult(key, options, now);
  })();
  inFlightLoads.set(inFlightIdentity, pending);

  try {
    return await pending;
  } finally {
    if (inFlightLoads.get(inFlightIdentity) === pending) {
      inFlightLoads.delete(inFlightIdentity);
    }
  }
};
