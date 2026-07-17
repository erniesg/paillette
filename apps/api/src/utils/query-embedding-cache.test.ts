import { describe, expect, it, vi } from 'vitest';
import {
  QUERY_EMBEDDING_CACHE_MAX_BYTES,
  QUERY_EMBEDDING_CACHE_READ_TIMEOUT_MS,
  QUERY_EMBEDDING_CACHE_TTL_SECONDS,
  buildQueryEmbeddingCacheKey,
  getOrCreateQueryEmbedding,
  normalizeQueryEmbeddingText,
} from './query-embedding-cache';

const identity = {
  query: 'Blue sky',
  model: 'jina-clip-v2',
  endpointIdentity: 'https://api.jina.ai/v1/embeddings',
  dimensions: 3,
  indexVersion: 'artworks-v2',
};

const createCache = (overrides: Partial<KVNamespace> = {}) =>
  ({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as KVNamespace;

describe('normalizeQueryEmbeddingText', () => {
  it('normalizes Unicode and whitespace without folding case', () => {
    expect(normalizeQueryEmbeddingText('  Cafe\u0301\n  Blue  ')).toBe(
      'Caf\u00e9 Blue'
    );
    expect(normalizeQueryEmbeddingText('BLUE')).not.toBe(
      normalizeQueryEmbeddingText('blue')
    );
  });
});

describe('buildQueryEmbeddingCacheKey', () => {
  it('hashes every embedding identity field and ignores unrelated token data', async () => {
    const baseKey = await buildQueryEmbeddingCacheKey(identity);
    const normalizedEquivalent = await buildQueryEmbeddingCacheKey({
      ...identity,
      query: '  Blue\n sky  ',
    });
    const withTokenA = await buildQueryEmbeddingCacheKey({
      ...identity,
      apiToken: 'secret-a',
    } as typeof identity);
    const withTokenB = await buildQueryEmbeddingCacheKey({
      ...identity,
      apiToken: 'secret-b',
    } as typeof identity);

    expect(baseKey).toBe(normalizedEquivalent);
    expect(withTokenA).toBe(withTokenB);
    expect(baseKey).toMatch(/^query-embedding:v1:[a-f0-9]{64}$/);
    expect(baseKey).not.toContain(identity.query);
    expect(baseKey).not.toContain('secret');

    const variants = [
      { ...identity, query: 'blue sky' },
      { ...identity, model: 'jina-embeddings-v3' },
      { ...identity, endpointIdentity: 'http://query-embeddings:8000' },
      { ...identity, dimensions: 2 },
      { ...identity, indexVersion: 'artworks-v3' },
    ];

    const variantKeys = await Promise.all(
      variants.map((variant) => buildQueryEmbeddingCacheKey(variant))
    );

    expect(new Set([baseKey, ...variantKeys])).toHaveLength(
      variantKeys.length + 1
    );
  });
});

describe('getOrCreateQueryEmbedding', () => {
  it('returns a valid cached embedding without invoking the generator', async () => {
    const cache = createCache({
      get: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    });
    const generate = vi.fn();

    await expect(
      getOrCreateQueryEmbedding({ ...identity, cache, generate })
    ).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(generate).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('caches a generated finite embedding for 30 days', async () => {
    const cache = createCache();
    const generate = vi.fn().mockResolvedValue([0.4, 0.5, 0.6]);

    await expect(
      getOrCreateQueryEmbedding({ ...identity, cache, generate })
    ).resolves.toEqual([0.4, 0.5, 0.6]);

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith('Blue sky');
    expect(cache.put).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledWith(
      expect.stringMatching(/^query-embedding:v1:[a-f0-9]{64}$/),
      JSON.stringify([0.4, 0.5, 0.6]),
      { expirationTtl: QUERY_EMBEDDING_CACHE_TTL_SECONDS }
    );
    expect(QUERY_EMBEDDING_CACHE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it.each([
    ['not an array', { embedding: [0.1, 0.2, 0.3] }],
    ['the wrong dimensions', [0.1, 0.2]],
    ['a non-number', [0.1, '0.2', 0.3]],
    ['a non-finite number', [0.1, Number.NaN, 0.3]],
  ])('ignores cached values with %s', async (_description, cachedValue) => {
    const cache = createCache({
      get: vi.fn().mockResolvedValue(cachedValue),
    });
    const generate = vi.fn().mockResolvedValue([0.7, 0.8, 0.9]);

    await expect(
      getOrCreateQueryEmbedding({ ...identity, cache, generate })
    ).resolves.toEqual([0.7, 0.8, 0.9]);
    expect(generate).toHaveBeenCalledOnce();
  });

  it.each([
    ['the wrong dimensions', [0.1, 0.2]],
    ['a non-number', [0.1, '0.2', 0.3]],
    ['a non-finite number', [0.1, Number.POSITIVE_INFINITY, 0.3]],
  ])(
    'does not cache a generated embedding with %s',
    async (_description, generatedValue) => {
      const cache = createCache();
      const generate = vi.fn().mockResolvedValue(generatedValue);

      await expect(
        getOrCreateQueryEmbedding({
          ...identity,
          cache,
          generate,
        })
      ).resolves.toEqual(generatedValue);
      expect(cache.put).not.toHaveBeenCalled();
    }
  );

  it('fails open when KV reads or writes fail', async () => {
    const readFailureCache = createCache({
      get: vi.fn().mockRejectedValue(new Error('KV read unavailable')),
    });
    const writeFailureCache = createCache({
      put: vi.fn().mockRejectedValue(new Error('KV write unavailable')),
    });

    await expect(
      getOrCreateQueryEmbedding({
        ...identity,
        query: 'read failure',
        cache: readFailureCache,
        generate: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      })
    ).resolves.toEqual([0.1, 0.2, 0.3]);

    await expect(
      getOrCreateQueryEmbedding({
        ...identity,
        query: 'write failure',
        cache: writeFailureCache,
        generate: vi.fn().mockResolvedValue([0.4, 0.5, 0.6]),
      })
    ).resolves.toEqual([0.4, 0.5, 0.6]);
  });

  it('fails open when a KV read exceeds the lookup deadline', async () => {
    vi.useFakeTimers();
    const cache = createCache({
      get: vi.fn(
        () => new Promise<string | null>(() => undefined)
      ) as unknown as KVNamespace['get'],
    });
    const generate = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

    const pending = getOrCreateQueryEmbedding({
      ...identity,
      query: 'hung cache read',
      cache,
      generate,
    });
    await vi.waitFor(() => expect(cache.get).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(QUERY_EMBEDDING_CACHE_READ_TIMEOUT_MS);

    await expect(pending).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(generate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('returns without waiting for slow cache persistence', async () => {
    const cache = createCache({
      put: vi.fn(
        () => new Promise<void>(() => undefined)
      ) as unknown as KVNamespace['put'],
    });
    const schedule = vi.fn();

    await expect(
      getOrCreateQueryEmbedding({
        ...identity,
        query: 'background write',
        cache,
        schedule,
        generate: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      })
    ).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(schedule).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('does not persist an embedding above the KV value size budget', async () => {
    const dimensions = 20_000;
    const cache = createCache();
    const embedding = new Array(dimensions).fill(0.123456789);

    await expect(
      getOrCreateQueryEmbedding({
        ...identity,
        query: 'oversized embedding',
        dimensions,
        cache,
        generate: vi.fn().mockResolvedValue(embedding),
      })
    ).resolves.toHaveLength(dimensions);
    expect(new TextEncoder().encode(JSON.stringify(embedding)).byteLength).toBeGreaterThan(
      QUERY_EMBEDDING_CACHE_MAX_BYTES
    );
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('single-flights concurrent misses for an identical key without KV', async () => {
    let resolveEmbedding!: (embedding: number[]) => void;
    const generated = new Promise<number[]>((resolve) => {
      resolveEmbedding = resolve;
    });
    const generate = vi.fn().mockReturnValue(generated);

    const first = getOrCreateQueryEmbedding({ ...identity, generate });
    const second = getOrCreateQueryEmbedding({ ...identity, generate });

    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    resolveEmbedding([0.1, 0.2, 0.3]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
    ]);
  });

  it('lets different keys generate independently', async () => {
    const resolvers = new Map<string, (embedding: number[]) => void>();
    const started: string[] = [];
    const generate = vi.fn((query: string) => {
      started.push(query);
      return new Promise<number[]>((resolve) => {
        resolvers.set(query, resolve);
      });
    });

    const blue = getOrCreateQueryEmbedding({ ...identity, generate });
    const red = getOrCreateQueryEmbedding({
      ...identity,
      query: 'Red sky',
      generate,
    });

    await vi.waitFor(() => {
      expect(started).toHaveLength(2);
      expect(started).toEqual(expect.arrayContaining(['Blue sky', 'Red sky']));
    });
    resolvers.get('Red sky')?.([0.4, 0.5, 0.6]);
    resolvers.get('Blue sky')?.([0.1, 0.2, 0.3]);

    await expect(Promise.all([blue, red])).resolves.toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it('propagates a shared rejection and cleans up so a later call retries', async () => {
    const failure = new Error('provider failed');
    let rejectProvider!: (error: Error) => void;
    const providerRequest = new Promise<number[]>((_resolve, reject) => {
      rejectProvider = reject;
    });
    const generate = vi.fn().mockReturnValue(providerRequest);

    const first = getOrCreateQueryEmbedding({
      ...identity,
      query: 'retry after shared failure',
      generate,
    });
    const second = getOrCreateQueryEmbedding({
      ...identity,
      query: 'retry after shared failure',
      generate,
    });

    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    rejectProvider(failure);
    await expect(Promise.all([first, second])).rejects.toThrow(
      'provider failed'
    );
    generate.mockResolvedValue([0.7, 0.8, 0.9]);
    await expect(
      getOrCreateQueryEmbedding({
        ...identity,
        query: 'retry after shared failure',
        generate,
      })
    ).resolves.toEqual([0.7, 0.8, 0.9]);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
