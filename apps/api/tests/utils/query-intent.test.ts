import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCollectionMetadataInventory,
  resolveQueryIntent,
  type CollectionMetadataInventory,
} from '../../src/utils/query-intent';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

const inventory: CollectionMetadataInventory = {
  artists: [
    { value: 'Jean-Baptiste-Camille Corot', count: 12 },
    { value: 'Jean-Francois Millet', count: 5 },
  ],
  media: [
    { value: 'oil on canvas', count: 15 },
    { value: 'bronze', count: 3 },
  ],
  classifications: [
    { value: 'painting', count: 15 },
    { value: 'sculpture', count: 3 },
  ],
  minYear: 1820,
  maxYear: 1875,
};

const makeKv = () => {
  const values = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, JSON.parse(value) as unknown);
    }),
    values,
  };
};

const makeEnv = (overrides: Record<string, unknown> = {}) => ({
  OPENAI_API_KEY: 'test-openai-key',
  CACHE: makeKv() as unknown as KVNamespace,
  ...overrides,
});

const openAiJsonResponse = (content: unknown) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

const stubOpenAi = (content: unknown) => {
  const fetchMock = vi.fn(async () => openAiJsonResponse(content));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const resolve = (
  env: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) =>
  resolveQueryIntent(env as never, {
    collectionId: 'collection-1',
    query: 'corot oil sketches from the 1860s',
    inventory,
    ...overrides,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveQueryIntent', () => {
  it('resolves grounded filters and the rewritten query from the LLM completion', async () => {
    const fetchMock = stubOpenAi({
      rewrittenQuery: 'oil sketches',
      filters: {
        artist: 'Jean-Baptiste-Camille Corot',
        yearFrom: 1860,
        yearTo: 1869,
      },
      rationale: 'Artist and decade extracted.',
    });

    const intent = await resolve(makeEnv());

    expect(intent).toEqual({
      rewrittenQuery: 'oil sketches',
      filters: {
        artist: 'Jean-Baptiste-Camille Corot',
        yearFrom: 1860,
        yearTo: 1869,
      },
      rationale: 'Artist and decade extracted.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe(OPENAI_CHAT_URL);
    const request = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
    };
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.messages[0]?.role).toBe('system');
    const userPayload = JSON.parse(request.messages[1]?.content || '{}') as {
      query: string;
      inventory: { artists: string[] };
    };
    expect(userPayload.query).toBe('corot oil sketches from the 1860s');
    expect(userPayload.inventory.artists).toContain(
      'Jean-Baptiste-Camille Corot'
    );
  });

  it('drops filter values that are not grounded in the inventory', async () => {
    stubOpenAi({
      rewrittenQuery: 'sketches',
      filters: {
        artist: 'Claude Monet',
        medium: 'bronze',
        classification: 'painting',
      },
      rationale: 'Two of three grounded.',
    });

    await expect(resolve(makeEnv())).resolves.toEqual({
      rewrittenQuery: 'sketches',
      filters: {
        medium: 'bronze',
        classification: 'painting',
      },
      rationale: 'Two of three grounded.',
    });
  });

  it('coerces numeric-string years and drops out-of-range ones', async () => {
    stubOpenAi({
      rewrittenQuery: 'bronzes',
      filters: {
        yearFrom: '1850',
        yearTo: String(new Date().getUTCFullYear() + 500),
      },
      rationale: 'Only the start year is sane.',
    });

    await expect(resolve(makeEnv())).resolves.toMatchObject({
      filters: { yearFrom: 1850 },
    });
  });

  it('drops the whole year range when the bounds are inverted', async () => {
    stubOpenAi({
      rewrittenQuery: 'bronzes',
      filters: { yearFrom: 1869, yearTo: 1860 },
      rationale: 'Inverted.',
    });

    await expect(resolve(makeEnv())).resolves.toMatchObject({
      filters: {},
    });
  });

  it('keeps the query unchanged with empty filters when nothing constrains metadata', async () => {
    stubOpenAi({
      rewrittenQuery: 'a quiet shore at dusk',
      filters: {},
      rationale: 'No metadata constraints.',
    });

    await expect(
      resolveQueryIntent(makeEnv() as never, {
        collectionId: 'collection-1',
        query: 'a quiet shore at dusk',
        inventory,
      })
    ).resolves.toEqual({
      rewrittenQuery: 'a quiet shore at dusk',
      filters: {},
      rationale: 'No metadata constraints.',
    });
  });

  it('falls back to the original query when the rewrite is missing', async () => {
    stubOpenAi({
      filters: { classification: 'painting' },
      rationale: 'Classification only.',
    });

    await expect(resolve(makeEnv())).resolves.toMatchObject({
      rewrittenQuery: 'corot oil sketches from the 1860s',
      filters: { classification: 'painting' },
    });
  });

  it('returns null on malformed LLM JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'not json at all' } }],
          }),
          { status: 200 }
        )
      )
    );

    await expect(resolve(makeEnv())).resolves.toBeNull();
  });

  it('returns null when OpenAI fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{}}', { status: 500 }))
    );

    await expect(resolve(makeEnv())).resolves.toBeNull();
  });

  it('returns null without calling OpenAI when the API key is missing', async () => {
    const fetchMock = stubOpenAi({});

    await expect(resolve(makeEnv({ OPENAI_API_KEY: undefined }))).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without calling OpenAI when the inventory has nothing to ground against', async () => {
    const fetchMock = stubOpenAi({});
    const emptyInventory: CollectionMetadataInventory = {
      artists: [],
      media: [],
      classifications: [],
      minYear: null,
      maxYear: null,
    };

    await expect(
      resolve(makeEnv(), { inventory: emptyInventory })
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a repeat query from the KV intent cache without a second OpenAI call', async () => {
    const fetchMock = stubOpenAi({
      rewrittenQuery: 'oil sketches',
      filters: { artist: 'Jean-Baptiste-Camille Corot' },
      rationale: 'Artist extracted.',
    });
    const env = makeEnv();

    const first = await resolve(env);
    const second = await resolve(env);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores cached intents that do not match the intent shape', async () => {
    const env = makeEnv();
    stubOpenAi({
      rewrittenQuery: 'first',
      filters: {},
      rationale: 'First.',
    });
    await resolve(env);

    const values = (env.CACHE as unknown as { values: Map<string, unknown> })
      .values;
    const intentKey = [...values.keys()].find((key) =>
      key.startsWith('query-intent:v1:')
    );
    values.set(intentKey as string, { nonsense: true });

    const fetchMock = stubOpenAi({
      rewrittenQuery: 'fresh',
      filters: {},
      rationale: 'Fresh.',
    });

    await expect(resolve(env)).resolves.toMatchObject({
      rewrittenQuery: 'fresh',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the resolution exceeds its deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () => new Promise<Response>(() => undefined) // never settles
      )
    );

    await expect(resolve(makeEnv(), { timeoutMs: 20 })).resolves.toBeNull();
  });
});

describe('getCollectionMetadataInventory', () => {
  const makeInventoryDb = () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          queries.push({ sql, params });
          return {
            all: async () => ({
              results: sql.includes('trim(artist)')
                ? [
                    { value: 'Jean-Baptiste-Camille Corot', count: 12 },
                    { value: '   ', count: 3 },
                  ]
                : sql.includes('trim(medium)')
                  ? [{ value: 'oil on canvas', count: 15 }]
                  : [{ value: 'Painting', count: 15 }],
            }),
            first: async () =>
              sql.includes('MIN(year)')
                ? { min_year: 1820, max_year: 1875 }
                : null,
          };
        },
      }),
    } as unknown as D1Database;
    return { db, queries };
  };

  it('builds the inventory from the collection facet queries', async () => {
    const { db, queries } = makeInventoryDb();

    await expect(
      getCollectionMetadataInventory(db, 'collection-1')
    ).resolves.toEqual({
      artists: [{ value: 'Jean-Baptiste-Camille Corot', count: 12 }],
      media: [{ value: 'oil on canvas', count: 15 }],
      classifications: [{ value: 'Painting', count: 15 }],
      minYear: 1820,
      maxYear: 1875,
    });
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.params).toEqual(['collection-1', 'collection-1']);
    }
  });

  it('returns null when the inventory reads fail', async () => {
    const db = {
      prepare: () => {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;

    await expect(
      getCollectionMetadataInventory(db, 'collection-1')
    ).resolves.toBeNull();
  });
});
