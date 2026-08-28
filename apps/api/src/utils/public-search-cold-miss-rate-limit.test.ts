import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT,
  PUBLIC_SEARCH_COLD_MISS_KV_TTL_SECONDS,
  PUBLIC_SEARCH_COLD_MISS_WRITE_TIMEOUT_MS,
  PublicSearchColdMissRateLimitError,
  PublicSearchRequestRateLimitUnavailableError,
  enforcePublicSearchColdMissRateLimit,
  enforcePublicSearchRequestRateLimit,
  getPublicSearchRequestClientIdentity,
  resetPublicSearchColdMissRateLimitForTests,
} from './public-search-cold-miss-rate-limit';

const NOW = Date.parse('2026-07-17T10:15:20.000Z');

const createCache = () => {
  const values = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(
      async (key: string, value: string) =>
        void values.set(key, JSON.parse(value) as unknown)
    ),
  } as unknown as KVNamespace;
};

const createRequestLimiterDb = () => {
  const buckets = new Map<string, number>();
  return {
    prepare: vi.fn((sql: string) => {
      let params: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => {
          params = values;
          return statement;
        },
        first: vi.fn(async () => {
          if (!sql.includes('nga_public_search_request_rate_limits')) {
            return null;
          }
          const [clientHash, windowStart, limit] = params as [string, number, number];
          const key = `${clientHash}:${windowStart}`;
          const used = buckets.get(key) || 0;
          if (used >= limit) return null;
          buckets.set(key, used + 1);
          return { used: used + 1 };
        }),
        run: vi.fn(async () => ({ success: true })),
      };
      return statement;
    }),
  } as unknown as D1Database;
};

describe('enforcePublicSearchColdMissRateLimit', () => {
  beforeEach(() => {
    resetPublicSearchColdMissRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows ten unique cold searches per client and rejects the next one', async () => {
    const cache = createCache();

    for (
      let index = 0;
      index < PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT;
      index += 1
    ) {
      await expect(
        enforcePublicSearchColdMissRateLimit({
          cache,
          clientAddress: '203.0.113.10',
          searchIdentity: `query-${index}`,
          now: () => NOW,
        })
      ).resolves.toBeUndefined();
    }

    await expect(
      enforcePublicSearchColdMissRateLimit({
        cache,
        clientAddress: '203.0.113.10',
        searchIdentity: 'query-over-limit',
        now: () => NOW,
      })
    ).rejects.toMatchObject({
      name: 'PublicSearchColdMissRateLimitError',
      retryAfterSeconds: 40,
    });
    expect(cache.put).toHaveBeenCalledTimes(
      PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT
    );
  });

  it('does not charge the same cold-search identity twice in one minute', async () => {
    const cache = createCache();
    const options = {
      cache,
      clientAddress: '203.0.113.11',
      searchIdentity: 'same-result-cache-key',
      limit: 1,
      now: () => NOW,
    };

    await enforcePublicSearchColdMissRateLimit(options);
    await enforcePublicSearchColdMissRateLimit(options);

    expect(cache.get).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('can count repeated identities for uncached image-search requests', async () => {
    const cache = createCache();
    const options = {
      cache,
      clientAddress: '203.0.113.19',
      searchIdentity: 'same-image-digest',
      countRepeatedRequests: true,
      limit: 1,
      now: () => NOW,
    };

    await enforcePublicSearchColdMissRateLimit(options);

    await expect(
      enforcePublicSearchColdMissRateLimit(options)
    ).rejects.toBeInstanceOf(PublicSearchColdMissRateLimitError);
  });

  it('hashes client addresses in KV keys and isolates clients', async () => {
    const cache = createCache();

    await enforcePublicSearchColdMissRateLimit({
      cache,
      clientAddress: '203.0.113.12',
      searchIdentity: 'first',
      limit: 1,
      now: () => NOW,
    });
    await enforcePublicSearchColdMissRateLimit({
      cache,
      clientAddress: '203.0.113.13',
      searchIdentity: 'second',
      limit: 1,
      now: () => NOW,
    });

    const keys = vi.mocked(cache.put).mock.calls.map(([key]) => String(key));
    expect(keys).toHaveLength(2);
    expect(new Set(keys)).toHaveLength(2);
    expect(keys.join(' ')).not.toContain('203.0.113');
  });

  it('resets on the next minute bucket', async () => {
    const cache = createCache();

    await enforcePublicSearchColdMissRateLimit({
      cache,
      clientAddress: '203.0.113.14',
      searchIdentity: 'first',
      limit: 1,
      now: () => NOW,
    });
    await expect(
      enforcePublicSearchColdMissRateLimit({
        cache,
        clientAddress: '203.0.113.14',
        searchIdentity: 'second',
        limit: 1,
        now: () => NOW + 60_000,
      })
    ).resolves.toBeUndefined();
  });

  it('fails open when KV reads, writes, or payload parsing fail', async () => {
    const readFailure = {
      get: vi.fn().mockRejectedValue(new Error('KV unavailable')),
      put: vi.fn(),
    } as unknown as KVNamespace;
    const writeFailure = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockRejectedValue(new Error('KV unavailable')),
    } as unknown as KVNamespace;
    const malformed = {
      get: vi.fn().mockResolvedValue({ fingerprints: 'invalid' }),
      put: vi.fn(),
    } as unknown as KVNamespace;

    await expect(
      enforcePublicSearchColdMissRateLimit({
        cache: readFailure,
        clientAddress: '203.0.113.15',
        searchIdentity: 'read failure',
        now: () => NOW,
      })
    ).resolves.toBeUndefined();
    await expect(
      enforcePublicSearchColdMissRateLimit({
        cache: writeFailure,
        clientAddress: '203.0.113.16',
        searchIdentity: 'write failure',
        now: () => NOW,
      })
    ).resolves.toBeUndefined();
    await expect(
      enforcePublicSearchColdMissRateLimit({
        cache: malformed,
        clientAddress: '203.0.113.17',
        searchIdentity: 'malformed payload',
        now: () => NOW,
      })
    ).resolves.toBeUndefined();
  });

  it('does not wait on a hung KV write', async () => {
    vi.useFakeTimers();
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(() => new Promise<void>(() => undefined)),
    } as unknown as KVNamespace;
    const pending = enforcePublicSearchColdMissRateLimit({
      cache,
      clientAddress: '203.0.113.20',
      searchIdentity: 'hung write',
      now: () => NOW,
    });

    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(PUBLIC_SEARCH_COLD_MISS_WRITE_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined();
  });

  it('fails open without a trustworthy client address', async () => {
    const cache = createCache();

    await expect(
      enforcePublicSearchColdMissRateLimit({
        cache,
        searchIdentity: 'anonymous',
        now: () => NOW,
      })
    ).resolves.toBeUndefined();

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('uses a short KV lifetime and a typed rate-limit error', async () => {
    const cache = createCache();

    await enforcePublicSearchColdMissRateLimit({
      cache,
      clientAddress: '203.0.113.18',
      searchIdentity: 'first',
      now: () => NOW,
    });

    expect(vi.mocked(cache.put).mock.calls[0]?.[2]).toEqual({
      expirationTtl: PUBLIC_SEARCH_COLD_MISS_KV_TTL_SECONDS,
    });
    expect(new PublicSearchColdMissRateLimitError(20)).toMatchObject({
      retryAfterSeconds: 20,
    });
  });
});

describe('enforcePublicSearchRequestRateLimit', () => {
  beforeEach(() => {
    resetPublicSearchColdMissRateLimitForTests();
  });

  it('counts cached replays per client and rejects before an eleventh request', async () => {
    const db = createRequestLimiterDb();
    const options = {
      db,
      clientIdentity: 'public:203.0.113.42',
      limit: 2,
      now: () => NOW,
    };

    await expect(enforcePublicSearchRequestRateLimit(options)).resolves.toBeUndefined();
    await expect(enforcePublicSearchRequestRateLimit(options)).resolves.toBeUndefined();
    await expect(enforcePublicSearchRequestRateLimit(options)).rejects.toMatchObject({
      name: 'PublicSearchColdMissRateLimitError',
      retryAfterSeconds: 40,
    });
  });

  it('keeps independently identified clients in separate request buckets', async () => {
    const db = createRequestLimiterDb();

    await enforcePublicSearchRequestRateLimit({
      db,
      clientIdentity: 'public:203.0.113.43',
      limit: 1,
      now: () => NOW,
    });
    await expect(
      enforcePublicSearchRequestRateLimit({
        db,
        clientIdentity: 'api-key:key-2',
        limit: 1,
        now: () => NOW,
      })
    ).resolves.toBeUndefined();
  });

  it('admits no more than the configured limit under concurrent attempts', async () => {
    const db = createRequestLimiterDb();
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        enforcePublicSearchRequestRateLimit({
          db,
          clientIdentity: 'public:203.0.113.46',
          limit: 2,
          now: () => NOW,
        })
      )
    );

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(2);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(3);
  });

  it('fails closed when distributed request-limit state is unavailable', async () => {
    await expect(
      enforcePublicSearchRequestRateLimit({
        db: undefined,
        clientIdentity: 'public:203.0.113.44',
        now: () => NOW,
      })
    ).rejects.toBeInstanceOf(PublicSearchRequestRateLimitUnavailableError);
  });
});

describe('getPublicSearchRequestClientIdentity', () => {
  it('uses only Cloudflare’s connecting address for the shared public proxy key', () => {
    expect(
      getPublicSearchRequestClientIdentity({
        isPublicSearchPrincipal: true,
        kind: 'api_key',
        userId: 'public-search-web',
        apiKeyId: 'shared-key',
        connectingIp: '203.0.113.45',
        forwardedFor: '198.51.100.99',
      })
    ).toBe('public-edge:203.0.113.45');
  });

  it('uses the authenticated key or user identity for direct API callers', () => {
    expect(
      getPublicSearchRequestClientIdentity({
        isPublicSearchPrincipal: false,
        kind: 'api_key',
        userId: 'user-1',
        apiKeyId: 'key-1',
      })
    ).toBe('api-key:key-1');
    expect(
      getPublicSearchRequestClientIdentity({
        isPublicSearchPrincipal: false,
        kind: 'user',
        userId: 'user-2',
      })
    ).toBe('user:user-2');
  });

  it('rejects missing or untrusted public client addresses', () => {
    expect(
      getPublicSearchRequestClientIdentity({
        isPublicSearchPrincipal: true,
        kind: 'api_key',
        userId: 'public-search-web',
        apiKeyId: 'shared-key',
        forwardedFor: '198.51.100.99',
      })
    ).toBeUndefined();
  });
});
