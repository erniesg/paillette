const PUBLIC_SEARCH_COLD_MISS_KEY_VERSION = 1;
const PUBLIC_SEARCH_COLD_MISS_WINDOW_MS = 60_000;

export const PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT = 10;
export const PUBLIC_SEARCH_COLD_MISS_KV_TTL_SECONDS = 120;
export const PUBLIC_SEARCH_COLD_MISS_READ_TIMEOUT_MS = 100;
export const PUBLIC_SEARCH_COLD_MISS_WRITE_TIMEOUT_MS = 100;

type LocalBucket = {
  expiresAt: number;
  fingerprints: Set<string>;
};

export interface PublicSearchColdMissRateLimitOptions {
  cache?: KVNamespace;
  clientAddress?: string;
  searchIdentity: string;
  countRepeatedRequests?: boolean;
  limit?: number;
  now?: () => number;
}

type StoredBucket = {
  schemaVersion: typeof PUBLIC_SEARCH_COLD_MISS_KEY_VERSION;
  minuteBucket: number;
  fingerprints: string[];
};

const localBuckets = new Map<string, LocalBucket>();

export class PublicSearchColdMissRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many unique public search cache misses');
    this.name = 'PublicSearchColdMissRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const toHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const sha256 = async (value: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

const normalizedLimit = (value: number | undefined) =>
  Number.isInteger(value) && Number(value) > 0
    ? Math.min(Number(value), 100)
    : PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT;

const retryAfterSeconds = (now: number) =>
  Math.max(
    1,
    Math.ceil(
      (PUBLIC_SEARCH_COLD_MISS_WINDOW_MS -
        (now % PUBLIC_SEARCH_COLD_MISS_WINDOW_MS)) /
        1000
    )
  );

const parseStoredBucket = (
  value: unknown,
  minuteBucket: number
): StoredBucket | null => {
  if (value === null) {
    return {
      schemaVersion: PUBLIC_SEARCH_COLD_MISS_KEY_VERSION,
      minuteBucket,
      fingerprints: [],
    };
  }
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<StoredBucket>;
  if (
    candidate.schemaVersion !== PUBLIC_SEARCH_COLD_MISS_KEY_VERSION ||
    candidate.minuteBucket !== minuteBucket ||
    !Array.isArray(candidate.fingerprints) ||
    candidate.fingerprints.some(
      (fingerprint) =>
        typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)
    )
  ) {
    return null;
  }

  return candidate as StoredBucket;
};

const readStoredBucket = async (
  cache: KVNamespace,
  key: string,
  minuteBucket: number
): Promise<StoredBucket | null | undefined> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const value = await Promise.race([
      cache.get<unknown>(key, 'json'),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(
          () => resolve(undefined),
          PUBLIC_SEARCH_COLD_MISS_READ_TIMEOUT_MS
        );
      }),
    ]);
    if (value === undefined) return undefined;
    return parseStoredBucket(value, minuteBucket) ?? undefined;
  } catch {
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const cleanExpiredLocalBuckets = (now: number) => {
  for (const [key, bucket] of localBuckets) {
    if (bucket.expiresAt <= now) localBuckets.delete(key);
  }
};

const persistStoredBucket = async (
  cache: KVNamespace,
  key: string,
  value: StoredBucket
): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      cache.put(key, JSON.stringify(value), {
        expirationTtl: PUBLIC_SEARCH_COLD_MISS_KV_TTL_SECONDS,
      }),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, PUBLIC_SEARCH_COLD_MISS_WRITE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Search remains available when distributed rate-limit state is down.
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const enforcePublicSearchColdMissRateLimit = async (
  options: PublicSearchColdMissRateLimitOptions
): Promise<void> => {
  const clientAddress = options.clientAddress?.trim();
  if (!clientAddress || !options.cache || !options.searchIdentity) return;

  const now = (options.now || Date.now)();
  const limit = normalizedLimit(options.limit);
  const minuteBucket = Math.floor(now / PUBLIC_SEARCH_COLD_MISS_WINDOW_MS);
  const fingerprintIdentity = options.countRepeatedRequests
    ? `${options.searchIdentity}:${crypto.randomUUID()}`
    : options.searchIdentity;
  const [clientHash, fingerprint] = await Promise.all([
    sha256(clientAddress),
    sha256(fingerprintIdentity),
  ]);
  const cacheKey = `public-search-cold-miss:v${PUBLIC_SEARCH_COLD_MISS_KEY_VERSION}:${minuteBucket}:${clientHash}`;

  cleanExpiredLocalBuckets(now);
  const local = localBuckets.get(cacheKey) || {
    expiresAt: (minuteBucket + 1) * PUBLIC_SEARCH_COLD_MISS_WINDOW_MS,
    fingerprints: new Set<string>(),
  };
  localBuckets.set(cacheKey, local);

  if (local.fingerprints.has(fingerprint)) return;
  if (local.fingerprints.size >= limit) {
    throw new PublicSearchColdMissRateLimitError(retryAfterSeconds(now));
  }

  // Reserve locally before the KV read so concurrent misses in this isolate
  // cannot all observe the same count.
  local.fingerprints.add(fingerprint);
  const stored = await readStoredBucket(options.cache, cacheKey, minuteBucket);
  if (!stored) return;

  const combined = new Set(stored.fingerprints);
  for (const localFingerprint of local.fingerprints) {
    combined.add(localFingerprint);
  }

  if (combined.size > limit) {
    local.fingerprints.delete(fingerprint);
    throw new PublicSearchColdMissRateLimitError(retryAfterSeconds(now));
  }

  await persistStoredBucket(options.cache, cacheKey, {
    schemaVersion: PUBLIC_SEARCH_COLD_MISS_KEY_VERSION,
    minuteBucket,
    fingerprints: [...combined],
  });
};

export const resetPublicSearchColdMissRateLimitForTests = () => {
  localBuckets.clear();
};
