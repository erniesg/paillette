import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT,
  PUBLIC_SEARCH_COLD_MISS_KV_TTL_SECONDS,
  PUBLIC_SEARCH_COLD_MISS_WRITE_TIMEOUT_MS,
  PublicSearchColdMissRateLimitError,
  enforcePublicSearchColdMissRateLimit,
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
