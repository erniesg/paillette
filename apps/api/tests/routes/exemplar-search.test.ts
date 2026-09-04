/**
 * POST /search/exemplars — Rocchio relevance feedback over the stored vectors.
 *
 * The arithmetic is the thing worth testing. Everything the loop does rests on
 * `max` rather than `mean` over the negatives, and on the fact that the whole
 * score is computed from vectors already in the index, so a redeal costs no
 * embedding call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../../src/routes/search';
import { resetPublicSearchColdMissRateLimitForTests } from '../../src/utils/public-search-cold-miss-rate-limit';
import type { Env } from '../../src/index';

/** Two dimensions is enough to reason about a cosine by hand. */
type Vec = [number, number];

const VECTORS: Record<string, Vec> = {
  // The exemplars: one liked, one disliked, at right angles.
  liked: [1, 0],
  disliked: [0, 1],
  // Candidates. `near-liked` is the answer; `near-disliked` must be pushed
  // away even though it is a perfectly good match for the centroid on its own.
  'near-liked': [0.99, 0.14],
  'near-disliked': [0.14, 0.99],
  neutral: [0.71, 0.71],
};

/** The open-access NGA org, which the route id `nga` resolves to. */
const OPEN_ACCESS_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const artworkRow = (id: string) => ({
  id,
  org_id: OPEN_ACCESS_ORG_ID,
  title: `Work ${id}`,
  artist: 'A. Painter',
  year: 1888,
  image_url: `https://assets.example/${id}.jpg`,
  thumbnail_url: null,
  provider: 'nga',
});

let queried: { vector: number[]; options: Record<string, unknown> } | null;
let fetchedIds: string[][];

const makeDb = (ids: string[]) =>
  ({
    prepare: (sql: string) => {
      const statement: Record<string, unknown> = {
        bind: () => statement,
        first: async () => {
          // The per-minute limiter admits by returning the new count from an
          // upsert; returning nothing is how it says "denied".
          if (sql.includes('nga_public_search_request_rate_limits')) {
            return { used: 1 };
          }
          if (sql.includes('orgs')) return { id: OPEN_ACCESS_ORG_ID };
          return null;
        },
        all: async () => ({ results: ids.map(artworkRow) }),
        run: async () => ({ success: true }),
      };
      return statement;
    },
  }) as unknown as D1Database;

const makeVectorize = (matches: string[]) =>
  ({
    getByIds: vi.fn(async (ids: string[]) => {
      fetchedIds.push(ids);
      return ids
        .filter((id) => VECTORS[id])
        .map((id) => ({ id, values: VECTORS[id] as number[] }));
    }),
    query: vi.fn(async (vector: number[], options: Record<string, unknown>) => {
      queried = { vector, options };
      return {
        matches: matches.map((id) => {
          const values = VECTORS[id] as Vec;
          // Cosine against the query vector, which is already unit length.
          const norm = Math.hypot(values[0], values[1]);
          const score =
            (vector[0]! * values[0] + vector[1]! * values[1]) / (norm || 1);
          return { id, score, metadata: {} };
        }),
      };
    }),
  }) as unknown as Vectorize;

const makeEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    DB: makeDb([]),
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    EMBEDDING_INDEX_VERSION: 'v2',
    JINA_EMBEDDING_DIMENSIONS: '2',
    DAILY_FREE_QUERY_LIMIT: '1000',
    ...overrides,
  }) as unknown as Env;

const app = new Hono<{ Bindings: Env }>();
app.route('/api/v1/orgs/:orgId', searchRoutes);

/** The same authenticated principal the rest of the search tests use. */
const AUTH = { 'X-User-Id': 'user-1' };

const post = (env: Env, body: unknown, orgId = 'nga') =>
  app.fetch(
    new Request(`https://api.test/api/v1/orgs/${orgId}/search/exemplars`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env
  );

beforeEach(() => {
  queried = null;
  fetchedIds = [];
  // The route sits behind the same per-minute public-search limit as text and
  // image search, and every test here looks like the same caller.
  resetPublicSearchColdMissRateLimitForTests();
});

afterEach(() => vi.restoreAllMocks());

describe('POST /search/exemplars', () => {
  it('queries with the unit-length centroid of the positives', async () => {
    const env = makeEnv({
      DB: makeDb(['near-liked']),
      VECTORIZE_V2: makeVectorize(['near-liked']),
    });

    const response = await post(env, { positiveIds: ['liked'], topK: 1 });

    expect(response.status).toBe(200);
    expect(queried?.vector).toEqual([1, 0]);
    expect(Math.hypot(...(queried!.vector as [number, number]))).toBeCloseTo(1);
  });

  it('averages several positives into one direction', async () => {
    const env = makeEnv({
      DB: makeDb(['neutral']),
      VECTORIZE_V2: makeVectorize(['neutral']),
    });

    await post(env, { positiveIds: ['liked', 'disliked'], topK: 1 });

    // The mean of [1,0] and [0,1], normalised.
    expect(queried?.vector[0]).toBeCloseTo(Math.SQRT1_2);
    expect(queried?.vector[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('pushes a work away from a rejection, even a well-matched one', async () => {
    const env = makeEnv({
      DB: makeDb(['near-liked', 'near-disliked', 'neutral']),
      VECTORIZE_V2: makeVectorize(['near-liked', 'neutral', 'near-disliked']),
    });

    const response = await post(env, {
      positiveIds: ['liked'],
      negativeIds: ['disliked'],
      topK: 3,
    });
    const payload = (await response.json()) as {
      data: { results: { id: string }[] };
    };

    // near-disliked scores 0.14 against the centroid and 0.99 against the
    // rejection, so 0.14 - 0.5*0.99 puts it last by a wide margin.
    expect(payload.data.results.map((result) => result.id)).toEqual([
      'near-liked',
      'neutral',
      'near-disliked',
    ]);
  });

  it('takes the worst single rejection rather than the average of them', async () => {
    // With `mean`, a second unrelated rejection would halve the penalty on
    // near-disliked and let it climb. With `max` it stays put — which is the
    // whole reason one emphatic X is worth using.
    const env = makeEnv({
      DB: makeDb(['near-liked', 'near-disliked']),
      VECTORIZE_V2: makeVectorize(['near-disliked', 'near-liked']),
    });

    const response = await post(env, {
      positiveIds: ['liked'],
      negativeIds: ['disliked', 'liked'],
      topK: 2,
    });
    const payload = (await response.json()) as {
      data: { results: { id: string }[] };
    };

    expect(payload.data.results[0]?.id).toBe('near-liked');
  });

  it('honours the negative weight it is given', async () => {
    const env = makeEnv({
      DB: makeDb(['near-liked', 'near-disliked']),
      VECTORIZE_V2: makeVectorize(['near-disliked', 'near-liked']),
    });

    // At weight 0 the rejection is ignored entirely and pure centroid distance
    // decides, so the ordering the index returned survives.
    const response = await post(env, {
      positiveIds: ['liked'],
      negativeIds: ['disliked'],
      negativeWeight: 0,
      topK: 2,
    });
    const payload = (await response.json()) as {
      data: { results: { id: string }[] };
    };

    expect(payload.data.results.map((result) => result.id)).toEqual([
      'near-liked',
      'near-disliked',
    ]);
  });

  it('never returns an exemplar or an excluded work', async () => {
    const env = makeEnv({
      DB: makeDb(['near-liked']),
      VECTORIZE_V2: makeVectorize([
        'liked',
        'disliked',
        'neutral',
        'near-liked',
      ]),
    });

    const response = await post(env, {
      positiveIds: ['liked'],
      negativeIds: ['disliked'],
      excludeIds: ['neutral'],
      topK: 10,
    });
    const payload = (await response.json()) as {
      data: { results: { id: string }[] };
    };

    expect(payload.data.results.map((result) => result.id)).toEqual([
      'near-liked',
    ]);
  });

  it('skips the second vector fetch entirely when there is nothing to reject', async () => {
    const env = makeEnv({
      DB: makeDb(['near-liked']),
      VECTORIZE_V2: makeVectorize(['near-liked']),
    });

    await post(env, { positiveIds: ['liked'], topK: 1 });

    // Only the positives were fetched: with no negative term the index score
    // already is cos(x, centroid), so re-scoring would be a wasted round trip.
    expect(fetchedIds).toEqual([['liked']]);
  });

  it('makes no outbound embedding call, so a redeal costs no Jina quota', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv({
      DB: makeDb(['near-liked']),
      VECTORIZE_V2: makeVectorize(['near-liked']),
      JINA_API_KEY: 'unused-key',
    });

    await post(env, {
      positiveIds: ['liked'],
      negativeIds: ['disliked'],
      topK: 1,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects a request with no positives', async () => {
    const response = await post(makeEnv(), { positiveIds: [] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('rejects a body that is not JSON', async () => {
    const response = await app.fetch(
      new Request(
        'https://api.test/api/v1/orgs/nga/search/exemplars',
        { method: 'POST', headers: AUTH, body: 'not json' }
      ),
      makeEnv()
    );

    expect(response.status).toBe(400);
  });

  it('says so when the exemplars have no embedding in this collection', async () => {
    const env = makeEnv({
      VECTORIZE_V2: makeVectorize([]),
    });

    const response = await post(env, { positiveIds: ['never-indexed'] });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'EXEMPLARS_NOT_INDEXED' },
    });
  });

  it('says so when no vector index is configured at all', async () => {
    const response = await post(makeEnv(), { positiveIds: ['liked'] });

    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      error: { code: 'IMAGE_INDEX_UNAVAILABLE' },
    });
  });

  it('returns an empty board rather than an error when nothing survives', async () => {
    const env = makeEnv({
      VECTORIZE_V2: makeVectorize(['liked']),
    });

    const response = await post(env, {
      positiveIds: ['liked'],
      topK: 5,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { results: [], count: 0 },
    });
  });
});

/**
 * The key the page actually holds.
 *
 * Every test above authenticates as a signed-in user, and no dev server carries
 * the public-search key, so the route passed everything while returning
 * FORBIDDEN to the only caller that reaches it in production. That is what
 * `/nga/search` does on a deployment: the browser posts to a same-origin proxy,
 * the proxy attaches `PAILLETTE_PUBLIC_SEARCH_API_KEY`, and the middleware
 * decides whether that key is allowed on this path. It was not.
 */
describe('POST /search/exemplars — the public-search key', () => {
  const publicSearchPost = (env: Env, body: unknown, orgId = 'nga') =>
    app.fetch(
      new Request(`https://api.test/api/v1/orgs/${orgId}/search/exemplars`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'public-search-secret',
          'Content-Type': 'application/json',
          // The per-minute limiter fails closed with no caller to partition
          // by, which is a 503 rather than an auth answer. Cloudflare always
          // sets this in front of the deployed worker.
          'CF-Connecting-IP': '203.0.113.7',
        },
        body: JSON.stringify(body),
      }),
      env
    );

  const publicEnv = (overrides: Partial<Env> = {}) =>
    makeEnv({
      ENVIRONMENT: 'production',
      PAILLETTE_PUBLIC_SEARCH_API_KEY: 'public-search-secret',
      ...overrides,
    } as Partial<Env>);

  it('reaches the engine, so a redeal works for a visitor with no account', async () => {
    const env = publicEnv({
      DB: makeDb(['near-liked']),
      VECTORIZE_V2: makeVectorize(['near-liked', 'liked']),
    });

    const response = await publicSearchPost(env, {
      positiveIds: ['liked'],
      topK: 5,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.success).toBe(true);
    expect(payload.data.results.map((result: any) => result.id)).toEqual([
      'near-liked',
    ]);
  });

  it('is still refused on a collection public search may not read', async () => {
    const env = publicEnv({
      DB: makeDb(['near-liked']),
      VECTORIZE_V2: makeVectorize(['near-liked']),
    });

    const response = await publicSearchPost(
      env,
      { positiveIds: ['liked'], topK: 5 },
      'private-gallery'
    );

    // The allowlist is per path *and* per collection, and the path check runs
    // first: widening it to `exemplars` widened it only under `/nga/`.
    expect(response.status).toBe(403);
    const payload = (await response.json()) as any;
    expect(payload.error.code).toBe('FORBIDDEN');
  });
});
