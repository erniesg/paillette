import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchTrace } from './search-trace';
import { getOrCreateQueryEmbedding } from './query-embedding-cache';
import {
  getOrLoadPublicSearchResult,
  PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS,
} from './public-search-result-cache';
import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const capture = () => {
  let now = 0;
  const emit = vi.fn();
  const trace = new SearchTrace('text', 'foreground', () => now, emit);
  return {
    trace,
    emit,
    at: (value: number) => {
      now = value;
    },
    event: () => emit.mock.calls[0]![0],
  };
};
const embedding = {
  query: 'private query',
  model: 'private model',
  endpointIdentity: 'https://secret.example/token',
  dimensions: 2,
  indexVersion: 'test',
  generate: async () => [0.6, 0.8],
};
const identity = {
  query: 'private query',
  orgId: 'private org',
  topK: 10,
  minScore: 0,
  embeddingIndexVersion: 'test',
  fusionMode: 'hybrid',
  modelIdentity: 'secret model',
};
const response = { results: [], count: 0, queryTime: 987654 };
const cache = (get: () => Promise<unknown>) =>
  ({
    get,
    put: vi.fn().mockResolvedValue(undefined),
  }) as unknown as KVNamespace;

afterEach(() => vi.useRealTimers());

describe('search traces', () => {
  it('records overlapping monotonic spans and wall total, not their sum; emits once', async () => {
    const c = capture();
    const a = deferred<void>();
    const b = deferred<void>();
    c.at(2);
    const first = c.trace.run('metadata', () => a.promise);
    c.at(5);
    const second = c.trace.run('vector_image', () => b.promise);
    c.at(12);
    a.resolve();
    await first;
    c.at(20);
    b.resolve();
    await second;
    c.at(25);
    c.trace.finish(200);
    c.trace.finish(500);
    expect(c.emit).toHaveBeenCalledTimes(1);
    expect(c.event()).toMatchObject({
      totalMs: 25,
      spans: [
        { stage: 'metadata', startMs: 2, durationMs: 10, status: 'ok' },
        { stage: 'vector_image', startMs: 5, durationMs: 15, status: 'ok' },
      ],
    });
  });

  it('classifies errors without serializing them and tolerates a broken log sink', async () => {
    const c = capture();
    const error = new Error(
      'provider timed out: secret credential / private query'
    );
    await expect(
      c.trace.run('embedding_image_generate', async () => {
        throw error;
      })
    ).rejects.toBe(error);
    await expect(
      c.trace.run('metadata', async () => {
        throw new Error('private identity');
      })
    ).rejects.toThrow();
    c.trace.finish(500);
    expect(
      c.event().spans.map((span: { status: string }) => span.status)
    ).toEqual(['timeout', 'error']);
    expect(JSON.stringify(c.event())).not.toMatch(
      /secret|private|credential|provider/
    );
    expect(() =>
      new SearchTrace(
        'image',
        'foreground',
        () => 0,
        () => {
          throw error;
        }
      ).finish(200)
    ).not.toThrow();
  });

  it('attributes embedding cache and generation only to the owner; followers record wait time', async () => {
    const leader = capture();
    const follower = capture();
    const reading = deferred<unknown>();
    const readStarted = deferred<void>();
    const kv = cache(() => {
      readStarted.resolve();
      return reading.promise;
    });
    const generate = vi.fn(async () => [0.6, 0.8]);
    const own = getOrCreateQueryEmbedding({
      ...embedding,
      cache: kv,
      generate,
      trace: leader.trace,
    });
    await readStarted.promise;
    follower.at(4);
    const followerCache = vi.spyOn(follower.trace, 'cache');
    const following = getOrCreateQueryEmbedding({
      ...embedding,
      cache: kv,
      generate,
      trace: follower.trace,
    });
    // Hashing is asynchronous. Wait until the follower has joined the pending lookup.
    await vi.waitFor(() =>
      expect(followerCache).toHaveBeenCalledWith('image', 'coalesced')
    );
    leader.at(10);
    follower.at(14);
    reading.resolve(null);
    await Promise.all([own, following]);
    leader.trace.finish(200);
    follower.trace.finish(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(leader.event().spans.map((s: { stage: string }) => s.stage)).toEqual(
      ['embedding_image_cache', 'embedding_image_generate']
    );
    expect(follower.event()).toMatchObject({
      caches: { image: 'coalesced' },
      spans: [{ stage: 'embedding_image_wait', startMs: 4, durationMs: 10 }],
    });
    expect(JSON.stringify([leader.event(), follower.event()])).not.toMatch(
      /private|secret|0\.6|0\.8/
    );
  });

  it('records cache hits without generating, and KV timeout/failure with unchanged fallback', async () => {
    const hit = capture();
    const generate = vi.fn(embedding.generate);
    await getOrCreateQueryEmbedding({
      ...embedding,
      trace: hit.trace,
      generate,
      cache: cache(async () => [0.6, 0.8]),
    });
    hit.trace.finish(200);
    expect(hit.event().caches.image).toBe('hit');
    expect(generate).not.toHaveBeenCalled();
    const failure = capture();
    await getOrCreateQueryEmbedding({
      ...embedding,
      trace: failure.trace,
      cache: cache(async () => {
        throw new Error('secret');
      }),
    });
    failure.trace.finish(200);
    expect(failure.event()).toMatchObject({
      caches: { image: 'error' },
      spans: [{ status: 'error' }, { status: 'ok' }],
    });

    vi.useFakeTimers();
    const timeout = capture();
    const started = deferred<void>();
    const pending = getOrCreateQueryEmbedding({
      ...embedding,
      trace: timeout.trace,
      cache: cache(() => {
        started.resolve();
        return new Promise(() => {});
      }),
    });
    await started.promise;
    timeout.at(300);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toEqual([0.6, 0.8]);
    timeout.trace.finish(200);
    expect(timeout.event()).toMatchObject({
      caches: { image: 'timeout' },
      spans: [{ durationMs: 300, status: 'timeout' }, { status: 'ok' }],
    });
  });

  it('measures result followers in their own request, never using the leader queryTime', async () => {
    const owner = capture();
    const follower = capture();
    const loaded = deferred<{
      response: typeof response;
      cacheable: boolean;
    }>();
    const started = deferred<void>();
    const load = vi.fn(() => {
      started.resolve();
      return loaded.promise;
    });
    const first = getOrLoadPublicSearchResult({
      ...identity,
      trace: owner.trace,
      load,
    });
    await started.promise;
    follower.at(3);
    const second = getOrLoadPublicSearchResult({
      ...identity,
      trace: follower.trace,
      load,
    });
    owner.at(100);
    follower.at(9);
    loaded.resolve({ response, cacheable: false });
    await first;
    const result = await second;
    follower.trace.finish(200);
    owner.trace.finish(200);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.disposition).toBe('coalesced');
    expect(follower.event()).toMatchObject({
      totalMs: 9,
      caches: { result: 'coalesced' },
      spans: [{ stage: 'result_cache_wait', startMs: 3, durationMs: 6 }],
    });
    expect(JSON.stringify(follower.event())).not.toContain('987654');
  });

  it('records result-cache read failures/timeouts while preserving the loader fallback', async () => {
    const failed = capture();
    const load = vi.fn(async () => ({ response, cacheable: false }));
    await getOrLoadPublicSearchResult({
      ...identity,
      trace: failed.trace,
      load,
      cache: cache(async () => {
        throw new Error('private credentials');
      }),
    });
    failed.trace.finish(200);
    expect(failed.event()).toMatchObject({
      caches: { result: 'error' },
      spans: [{ stage: 'result_cache_read', status: 'error' }],
    });
    vi.useFakeTimers();
    const timed = capture();
    const started = deferred<void>();
    const pending = getOrLoadPublicSearchResult({
      ...identity,
      trace: timed.trace,
      load,
      cache: cache(() => {
        started.resolve();
        return new Promise(() => {});
      }),
    });
    await started.promise;
    timed.at(300);
    await vi.advanceTimersByTimeAsync(300);
    expect((await pending).response).toBe(response);
    timed.trace.finish(200);
    expect(timed.event()).toMatchObject({
      caches: { result: 'timeout' },
      spans: [
        { stage: 'result_cache_read', durationMs: 300, status: 'timeout' },
      ],
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([failed.event(), timed.event()])).not.toMatch(
      /private|credentials|987654/
    );
  });

  it('reports fresh/stale cache hits and marks stale loads as background', async () => {
    for (const stale of [false, true]) {
      const c = capture();
      const now = 1_000_000_000;
      const load = vi.fn(async () => ({ response, cacheable: false }));
      const result = await getOrLoadPublicSearchResult({
        ...identity,
        trace: c.trace,
        now: () => now,
        load,
        cache: cache(async () => ({
          schemaVersion: 2,
          contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
          orgId: identity.orgId,
          provider: null,
          storedAt: now - (stale ? PUBLIC_SEARCH_RESULT_CACHE_FRESH_MS + 1 : 0),
          results: [],
          count: 0,
        })),
      });
      c.at(7);
      c.trace.finish(200);
      expect(result.response.queryTime).toBe(0);
      expect(c.event()).toMatchObject({
        totalMs: 7,
        caches: { result: stale ? 'stale' : 'hit' },
      });
      if (stale) expect(load).toHaveBeenCalledWith(true);
      else expect(load).not.toHaveBeenCalled();
    }
  });
});
