import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search';
import type { ArtworkSearchResult, SearchResponse } from '../types';
import { compileNgaSearchPlan } from './nga-search-intent';
import {
  PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS,
  PUBLIC_SEARCH_RESULT_CACHE_HARD_TTL_SECONDS,
  PUBLIC_SEARCH_RESULT_CACHE_MAX_BYTES,
  PUBLIC_SEARCH_RESULT_CACHE_READ_TIMEOUT_MS,
  PUBLIC_SEARCH_RESULT_CACHE_SCHEMA_VERSION,
  buildPublicSearchResultCacheKey,
  getOrLoadPublicSearchResult,
  type PublicSearchResultCacheIdentity,
} from './public-search-result-cache';

const NOW = Date.parse('2026-07-17T00:00:00.000Z');

const identity = {
  query: 'Blue sky',
  orgId: 'org-1',
  provider: 'nga',
  topK: 100,
  minScore: 0,
  embeddingIndexVersion: 'v2',
  fusionMode: 'hybrid',
  modelIdentity: 'jina-clip-v2+jina-embeddings-v3',
} satisfies PublicSearchResultCacheIdentity;

const artwork: ArtworkSearchResult = {
  id: 'artwork-1',
  orgId: 'org-1',
  galleryId: 'org-1',
  title: 'Blue Sky',
  artist: 'Artist',
  year: 1901,
  imageUrl: 'https://example.com/image.jpg',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  similarity: 0.91,
  metadata: { source: { provider: 'nga' } },
};

const response: SearchResponse = {
  results: [artwork],
  count: 1,
  queryTime: 12.5,
};

const cachedValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: PUBLIC_SEARCH_RESULT_CACHE_SCHEMA_VERSION,
  contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
  orgId: identity.orgId,
  provider: identity.provider,
  storedAt: NOW,
  results: [artwork],
  count: 1,
  ...overrides,
});

const createCache = (overrides: Partial<KVNamespace> = {}) =>
  ({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as KVNamespace;

describe('buildPublicSearchResultCacheKey', () => {
  it('hashes the complete retrieval identity with canonical text and constraints', async () => {
    const baseKey = await buildPublicSearchResultCacheKey(identity);
    const normalizedEquivalent = await buildPublicSearchResultCacheKey({
      ...identity,
      query: '  Blue\n sky  ',
    });
    const caseEquivalent = await buildPublicSearchResultCacheKey({ ...identity, query: 'blue SKY' });
    const composedEquivalent = await buildPublicSearchResultCacheKey({
      ...identity,
      query: 'Cafe\u0301 sky',
    });
    const composed = await buildPublicSearchResultCacheKey({
      ...identity,
      query: 'Caf\u00e9 sky',
    });
    const withSecretA = await buildPublicSearchResultCacheKey({
      ...identity,
      apiToken: 'secret-a',
    } as PublicSearchResultCacheIdentity);
    const withSecretB = await buildPublicSearchResultCacheKey({
      ...identity,
      apiToken: 'secret-b',
    } as PublicSearchResultCacheIdentity);

    expect(baseKey).toBe(normalizedEquivalent);
    expect(baseKey).toBe(caseEquivalent);
    expect(composedEquivalent).toBe(composed);
    expect(withSecretA).toBe(withSecretB);
    expect(baseKey).toMatch(/^public-search-result:v10:[a-f0-9]{64}$/);
    expect(baseKey).not.toContain(identity.query);
    expect(baseKey).not.toContain('secret');

    const variants: PublicSearchResultCacheIdentity[] = [
      { ...identity, parserVersion: 'nga-v1' },
      { ...identity, constraints: { classifications: ['Painting'] } },
      { ...identity, orgId: 'org-2' },
      { ...identity, provider: undefined },
      { ...identity, facet: 'artist' },
      { ...identity, visualRefinement: 'navy blue' },
      { ...identity, topK: 30 },
      { ...identity, minScore: 0.2 },
      { ...identity, embeddingIndexVersion: 'v1' },
      { ...identity, fusionMode: 'metadata' },
      { ...identity, modelIdentity: 'different-model' },
    ];
    const variantKeys = await Promise.all(
      variants.map((variant) => buildPublicSearchResultCacheKey(variant))
    );

    expect(new Set([baseKey, ...variantKeys])).toHaveLength(
      variantKeys.length + 1
    );
  });

  it('shares canonical paraphrases while relation shape and direction affect identity', async () => {
    const activePlan = compileNgaSearchPlan('painting showing a sculpture');
    const passivePlan = compileNgaSearchPlan('sculpture shown in a painting');
    const oppositeDirectionPlan = {
      ...activePlan,
      relation: {
        kind: 'depicts' as const,
        workClassification: 'Sculpture',
        subjectClassification: 'Painting',
      },
    };
    const differentShapePlan = {
      ...activePlan,
      relation: {
        kind: 'features' as const,
        workClassification: 'Painting',
        subjectClassification: 'Sculpture',
      },
    };

    const activeKey = await buildPublicSearchResultCacheKey({
      ...identity,
      query: activePlan.retrievalQuery,
      constraints: activePlan.constraints,
      ngaPlan: activePlan,
    } as PublicSearchResultCacheIdentity);
    const passiveKey = await buildPublicSearchResultCacheKey({
      ...identity,
      query: passivePlan.retrievalQuery,
      constraints: passivePlan.constraints,
      ngaPlan: passivePlan,
    } as PublicSearchResultCacheIdentity);
    const oppositeDirectionKey = await buildPublicSearchResultCacheKey({
      ...identity,
      query: activePlan.retrievalQuery,
      constraints: activePlan.constraints,
      ngaPlan: oppositeDirectionPlan,
    });
    const differentShapeKey = await buildPublicSearchResultCacheKey({
      ...identity,
      query: activePlan.retrievalQuery,
      constraints: activePlan.constraints,
      ngaPlan: differentShapePlan,
    });

    expect(activeKey).toBe(passiveKey);
    expect(oppositeDirectionKey).not.toBe(activeKey);
    expect(differentShapeKey).not.toBe(activeKey);
  });

  it('does not address the obsolete nga-plan-v1 identity', async () => {
    const plan = compileNgaSearchPlan('drawing based on photograph');
    const currentKey = await buildPublicSearchResultCacheKey({
      ...identity,
      query: plan.retrievalQuery,
      constraints: plan.constraints,
      ngaPlan: plan,
    });
    const obsoleteKey = await buildPublicSearchResultCacheKey({
      ...identity,
      query: plan.retrievalQuery,
      constraints: plan.constraints,
      ngaPlan: { ...plan, version: 'nga-plan-v1' },
    });

    expect(obsoleteKey).not.toBe(currentKey);
  });

  it('canonicalizes attribution while separating role, target, and evidence policy', async () => {
    const displayPlan = compileNgaSearchPlan('PAINTING — after Rembrandt');
    const canonicalPlan = compileNgaSearchPlan('painting after rembrandt');
    const cacheIdentity = (ngaPlan: typeof displayPlan) => ({
      ...identity,
      query: ngaPlan.retrievalQuery,
      constraints: ngaPlan.constraints,
      ngaPlan,
    });
    const baseKey = await buildPublicSearchResultCacheKey(
      cacheIdentity(displayPlan)
    );
    const canonicalKey = await buildPublicSearchResultCacheKey(
      cacheIdentity(canonicalPlan)
    );
    const roleKey = await buildPublicSearchResultCacheKey(
      cacheIdentity({
        ...displayPlan,
        attribution: {
          relationship: 'attributed_to',
          targetText: 'Rembrandt',
        },
      })
    );
    const targetKey = await buildPublicSearchResultCacheKey(
      cacheIdentity({
        ...displayPlan,
        attribution: { relationship: 'after', targetText: 'Rubens' },
      })
    );
    const evidenceKey = await buildPublicSearchResultCacheKey(
      cacheIdentity({
        ...displayPlan,
        relationEvidence: {
          policy: 'catalogue_derivation',
          status: 'candidate',
        },
      })
    );

    expect(canonicalKey).toBe(baseKey);
    expect(roleKey).not.toBe(baseKey);
    expect(targetKey).not.toBe(baseKey);
    expect(evidenceKey).not.toBe(baseKey);
  });

  it.each(['-', '\u2013', '\u2014'])(
    'uses one canonical cache identity when a %s-delimited range moves across attribution',
    async (dash) => {
      const prefixPlan = compileNgaSearchPlan(
        `paintings from 1700${dash}1800 by Rembrandt`
      );
      const suffixPlan = compileNgaSearchPlan(
        `paintings by Rembrandt from 1700${dash}1800`
      );
      const cacheIdentity = (ngaPlan: typeof prefixPlan) => ({
        ...identity,
        query: ngaPlan.retrievalQuery,
        constraints: ngaPlan.constraints,
        ngaPlan,
      });

      expect(suffixPlan.attribution).toEqual({
        relationship: 'direct',
        targetText: 'Rembrandt',
      });
      await expect(
        buildPublicSearchResultCacheKey(cacheIdentity(suffixPlan))
      ).resolves.toBe(
        await buildPublicSearchResultCacheKey(cacheIdentity(prefixPlan))
      );
    }
  );
});

describe('getOrLoadPublicSearchResult', () => {
  it('does not address a stale v9 entry for an nga-v7 exact-date search', async () => {
    const cache = createCache({
      get: vi.fn(async (key: string) =>
        key.startsWith('public-search-result:v9:') ? cachedValue() : null
      ) as unknown as KVNamespace['get'],
    });
    const load = vi.fn().mockResolvedValue({ response, cacheable: false });

    await expect(
      getOrLoadPublicSearchResult({
        ...identity,
        parserVersion: 'nga-v7',
        constraints: { dateRange: { startYear: 1889, endYear: 1889 } },
        cache,
        load,
        now: () => NOW,
      })
    ).resolves.toEqual({ response, disposition: 'miss' });

    expect(load).toHaveBeenCalledOnce();
  });

  it('returns a fresh validated KV value with zero query time', async () => {
    const cache = createCache({
      get: vi.fn().mockResolvedValue(cachedValue()),
    });
    const load = vi.fn();

    await expect(
      getOrLoadPublicSearchResult({
        ...identity,
        cache,
        load,
        now: () => NOW + PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS - 1,
      })
    ).resolves.toEqual({
      response: { results: [artwork], count: 1, queryTime: 0 },
      disposition: 'kv-fresh',
    });
    expect(load).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed value', { results: 'not-an-array' }],
    ['a schema mismatch', { schemaVersion: 999 }],
    ['a contract mismatch', { contractVersion: 'old' }],
    ['an org mismatch', { orgId: 'other-org' }],
    ['a provider mismatch', { provider: 'ngs' }],
    ['an inconsistent count', { count: 2 }],
  ])('recomputes instead of serving %s', async (_reason, overrides) => {
    const cache = createCache({
      get: vi.fn().mockResolvedValue(cachedValue(overrides)),
    });
    const load = vi.fn().mockResolvedValue({ response, cacheable: false });

    await expect(
      getOrLoadPublicSearchResult({
        ...identity,
        query: `${identity.query} ${_reason}`,
        cache,
        load,
        now: () => NOW,
      })
    ).resolves.toEqual({ response, disposition: 'miss' });
    expect(load).toHaveBeenCalledOnce();
  });

  it('recomputes a value older than the seven-day hard limit', async () => {
    const cache = createCache({
      get: vi.fn().mockResolvedValue(
        cachedValue({
          storedAt:
            NOW - PUBLIC_SEARCH_RESULT_CACHE_HARD_TTL_SECONDS * 1000 - 1,
        })
      ),
    });
    const load = vi.fn().mockResolvedValue({ response, cacheable: false });

    await expect(
      getOrLoadPublicSearchResult({
        ...identity,
        query: 'hard expired',
        cache,
        load,
        now: () => NOW,
      })
    ).resolves.toEqual({ response, disposition: 'miss' });
    expect(load).toHaveBeenCalledOnce();
  });

  it('serves stale data immediately and starts only one background refresh per isolate key', async () => {
    const stale = cachedValue({
      storedAt: NOW - PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS - 1,
    });
    const cache = createCache({
      get: vi.fn().mockResolvedValue(stale),
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const load = vi.fn(async () => {
      await refreshGate;
      return { response, cacheable: true };
    });
    const scheduled: Promise<void>[] = [];
    const schedule = vi.fn((work: Promise<void>) => {
      scheduled.push(work);
    });

    const first = await getOrLoadPublicSearchResult({
      ...identity,
      cache,
      load,
      schedule,
      now: () => NOW,
    });
    const second = await getOrLoadPublicSearchResult({
      ...identity,
      cache,
      load,
      schedule,
      now: () => NOW,
    });

    expect(first).toEqual({
      response: { results: [artwork], count: 1, queryTime: 0 },
      disposition: 'kv-stale',
    });
    expect(second.disposition).toBe('kv-stale');
    expect(load).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
    expect(cache.put).not.toHaveBeenCalled();

    releaseRefresh();
    await Promise.all(scheduled);
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('single-flights concurrent misses and reports coalesced followers', async () => {
    const cache = createCache();
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const load = vi.fn(async () => {
      await loadGate;
      return { response, cacheable: false };
    });

    const first = getOrLoadPublicSearchResult({
      ...identity,
      query: 'singleflight miss',
      cache,
      load,
      now: () => NOW,
    });
    const second = getOrLoadPublicSearchResult({
      ...identity,
      query: 'singleflight miss',
      cache,
      load,
      now: () => NOW,
    });

    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    releaseLoad();

    await expect(first).resolves.toEqual({
      response,
      disposition: 'miss',
    });
    await expect(second).resolves.toEqual({
      response,
      disposition: 'coalesced',
    });
  });

  it('keeps different attribution intents separate during concurrent cold misses', async () => {
    const cache = createCache();
    const afterPlan = compileNgaSearchPlan('painting after Rembrandt');
    let releaseLoads!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoads = resolve;
    });
    const afterLoad = vi.fn(async () => {
      await loadGate;
      return { response, cacheable: false };
    });
    const directLoad = vi.fn(async () => {
      await loadGate;
      return { response, cacheable: false };
    });

    const after = getOrLoadPublicSearchResult({
      ...identity,
      query: afterPlan.retrievalQuery,
      constraints: afterPlan.constraints,
      ngaPlan: afterPlan,
      cache,
      load: afterLoad,
      now: () => NOW,
    });
    const direct = getOrLoadPublicSearchResult({
      ...identity,
      query: afterPlan.retrievalQuery,
      constraints: afterPlan.constraints,
      ngaPlan: {
        ...afterPlan,
        attribution: { relationship: 'direct', targetText: 'Rembrandt' },
      },
      cache,
      load: directLoad,
      now: () => NOW,
    });

    await vi.waitFor(() => {
      expect(afterLoad).toHaveBeenCalledOnce();
      expect(directLoad).toHaveBeenCalledOnce();
    });
    releaseLoads();

    await expect(after).resolves.toMatchObject({ disposition: 'miss' });
    await expect(direct).resolves.toMatchObject({ disposition: 'miss' });
  });

  it('does not persist a loader response unless it is explicitly cacheable', async () => {
    const cache = createCache();

    await getOrLoadPublicSearchResult({
      ...identity,
      query: 'degraded result',
      cache,
      load: vi.fn().mockResolvedValue({ response, cacheable: false }),
      now: () => NOW,
    });

    expect(cache.put).not.toHaveBeenCalled();
  });

  it('schedules persistence without delaying the response and stores no query time', async () => {
    const cache = createCache({
      put: vi.fn(
        () => new Promise<void>(() => undefined)
      ) as unknown as KVNamespace['put'],
    });
    const schedule = vi.fn();

    await expect(
      getOrLoadPublicSearchResult({
        ...identity,
        query: 'background persistence',
        cache,
        load: vi.fn().mockResolvedValue({ response, cacheable: true }),
        schedule,
        now: () => NOW,
      })
    ).resolves.toEqual({ response, disposition: 'miss' });

    expect(schedule).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
    const [, serialized, options] = vi.mocked(cache.put).mock.calls[0]!;
    const stored = JSON.parse(serialized as string);
    expect(stored).toEqual(cachedValue());
    expect(stored).not.toHaveProperty('queryTime');
    expect(options).toEqual({
      expirationTtl: PUBLIC_SEARCH_RESULT_CACHE_HARD_TTL_SECONDS,
    });
  });

  it('does not persist serialized values above the 5 MiB result budget', async () => {
    const cache = createCache();
    const oversizedResponse: SearchResponse = {
      results: [
        {
          ...artwork,
          metadata: {
            description: 'x'.repeat(PUBLIC_SEARCH_RESULT_CACHE_MAX_BYTES),
          },
        },
      ],
      count: 1,
      queryTime: 3,
    };

    await getOrLoadPublicSearchResult({
      ...identity,
      query: 'oversized result',
      cache,
      load: vi.fn().mockResolvedValue({
        response: oversizedResponse,
        cacheable: true,
      }),
      now: () => NOW,
    });

    expect(cache.put).not.toHaveBeenCalled();
  });

  it('persists representative canonical responses larger than the embedding cache budget', async () => {
    const cache = createCache();
    const representativeResponse: SearchResponse = {
      results: [
        {
          ...artwork,
          metadata: {
            description: 'x'.repeat(256 * 1024),
          },
        },
      ],
      count: 1,
      queryTime: 3,
    };

    await getOrLoadPublicSearchResult({
      ...identity,
      query: 'representative result payload',
      cache,
      load: vi.fn().mockResolvedValue({
        response: representativeResponse,
        cacheable: true,
      }),
      now: () => NOW,
    });

    expect(PUBLIC_SEARCH_RESULT_CACHE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('fails open when a KV read rejects or exceeds 300ms', async () => {
    const rejectedCache = createCache({
      get: vi.fn().mockRejectedValue(new Error('KV unavailable')),
    });
    const rejectedLoad = vi.fn().mockResolvedValue({
      response,
      cacheable: false,
    });

    await expect(
      getOrLoadPublicSearchResult({
        ...identity,
        query: 'rejected read',
        cache: rejectedCache,
        load: rejectedLoad,
        now: () => NOW,
      })
    ).resolves.toEqual({ response, disposition: 'miss' });

    vi.useFakeTimers();
    const hungCache = createCache({
      get: vi.fn(
        () => new Promise<string | null>(() => undefined)
      ) as unknown as KVNamespace['get'],
    });
    const timedLoad = vi.fn().mockResolvedValue({
      response,
      cacheable: false,
    });
    const pending = getOrLoadPublicSearchResult({
      ...identity,
      query: 'timed out read',
      cache: hungCache,
      load: timedLoad,
      now: () => NOW,
    });
    await vi.waitFor(() => expect(hungCache.get).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(
      PUBLIC_SEARCH_RESULT_CACHE_READ_TIMEOUT_MS
    );

    await expect(pending).resolves.toEqual({
      response,
      disposition: 'miss',
    });
    expect(timedLoad).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
