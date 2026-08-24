const QUERY_EMBEDDING_CACHE_KEY_VERSION = 1;

export const QUERY_EMBEDDING_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const QUERY_EMBEDDING_CACHE_READ_TIMEOUT_MS = 300;
export const QUERY_EMBEDDING_CACHE_MAX_BYTES = 64 * 1024;

export interface QueryEmbeddingIdentity {
  query: string;
  model: string;
  endpointIdentity: string;
  dimensions: number;
  indexVersion: string;
}

export interface QueryEmbeddingCacheOptions extends QueryEmbeddingIdentity {
  cache?: KVNamespace;
  generate: (normalizedQuery: string) => Promise<number[]>;
  schedule?: (work: Promise<void>) => void;
}

const inFlightEmbeddings = new Map<string, Promise<number[]>>();

export const normalizeQueryEmbeddingText = (query: string): string =>
  query.normalize('NFC').trim().replace(/\s+/gu, ' ');

const assertValidDimensions = (dimensions: number): void => {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new TypeError('Embedding dimensions must be a positive integer');
  }
};

const toHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

export const buildQueryEmbeddingCacheKey = async (
  identity: QueryEmbeddingIdentity
): Promise<string> => {
  assertValidDimensions(identity.dimensions);

  const cacheIdentity = JSON.stringify({
    keyVersion: QUERY_EMBEDDING_CACHE_KEY_VERSION,
    query: normalizeQueryEmbeddingText(identity.query),
    model: identity.model,
    endpointIdentity: identity.endpointIdentity,
    dimensions: identity.dimensions,
    indexVersion: identity.indexVersion,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(cacheIdentity)
  );

  return `query-embedding:v${QUERY_EMBEDDING_CACHE_KEY_VERSION}:${toHex(digest)}`;
};

const isValidEmbedding = (
  value: unknown,
  dimensions: number
): value is number[] =>
  Array.isArray(value) &&
  value.length === dimensions &&
  value.every((coordinate) =>
    typeof coordinate === 'number' ? Number.isFinite(coordinate) : false
  );

const readCachedEmbedding = async (
  cache: KVNamespace | undefined,
  key: string,
  dimensions: number
): Promise<number[] | null> => {
  if (!cache) {
    return null;
  }

  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cached = await Promise.race([
      cache.get<unknown>(key, 'json'),
      new Promise<null>((resolve) => {
        timeout = setTimeout(
          () => resolve(null),
          QUERY_EMBEDDING_CACHE_READ_TIMEOUT_MS
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    return isValidEmbedding(cached, dimensions) ? cached : null;
  } catch {
    return null;
  }
};

const writeCachedEmbedding = async (
  cache: KVNamespace | undefined,
  key: string,
  embedding: number[]
): Promise<void> => {
  if (!cache) {
    return;
  }

  try {
    const serialized = JSON.stringify(embedding);
    if (
      new TextEncoder().encode(serialized).byteLength >
      QUERY_EMBEDDING_CACHE_MAX_BYTES
    ) {
      return;
    }

    await cache.put(key, serialized, {
      expirationTtl: QUERY_EMBEDDING_CACHE_TTL_SECONDS,
    });
  } catch {
    // Embedding generation remains usable when KV is unavailable.
  }
};

const resolveQueryEmbedding = async (
  key: string,
  options: QueryEmbeddingCacheOptions
): Promise<number[]> => {
  const cached = await readCachedEmbedding(
    options.cache,
    key,
    options.dimensions
  );
  if (cached) {
    return cached;
  }

  const generated = await options.generate(
    normalizeQueryEmbeddingText(options.query)
  );

  if (isValidEmbedding(generated, options.dimensions)) {
    const persistence = writeCachedEmbedding(options.cache, key, generated);
    if (options.schedule) {
      options.schedule(persistence);
    }
  }

  return generated;
};

export const getOrCreateQueryEmbedding = async (
  options: QueryEmbeddingCacheOptions
): Promise<number[]> => {
  const key = await buildQueryEmbeddingCacheKey(options);
  const existing = inFlightEmbeddings.get(key);
  if (existing) {
    return existing;
  }

  const pending = resolveQueryEmbedding(key, options);
  inFlightEmbeddings.set(key, pending);

  try {
    return await pending;
  } finally {
    if (inFlightEmbeddings.get(key) === pending) {
      inFlightEmbeddings.delete(key);
    }
  }
};
