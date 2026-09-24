import { afterEach, describe, expect, it, vi } from 'vitest';

import labels, { MAX_LABEL_CALLS_PER_CLIENT_PER_HOUR, labelCallsPerHour } from './labels';

const memoryKv = () => {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
};

/** Just enough D1 for the route: the one artwork it looks up. */
const fakeDb = () =>
  ({
    prepare: () => ({
      bind: () => ({
        all: async () => ({
          results: [
            {
              id: 'open-access-art:nga:1',
              title: 'Gale',
              artist: 'A',
              year: 1880,
              date_text: '1880',
              medium: 'oil',
              classification: 'painting',
              custom_metadata: null,
            },
          ],
        }),
        first: async () => null,
      }),
    }),
  }) as unknown as D1Database;

const env = (extra: Record<string, unknown> = {}) => ({
  OPENAI_API_KEY: 'test-key',
  CACHE: memoryKv(),
  DB: fakeDb(),
  ...extra,
});

const label = (bindings: Record<string, unknown>) =>
  labels.request(
    '/public-labels',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({
        collectionId: 'nga',
        artworkIds: ['open-access-art:nga:1'],
        statement: 'Leaving.',
      }),
    },
    bindings
  );

const openAiAnswers = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                labels: [{ artworkId: 'open-access-art:nga:1', label: 'A boat, leaving.' }],
              }),
            },
          },
        ],
      })
    )
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /public-labels — the hourly window', () => {
  it('does not reset at the top of the clock hour', async () => {
    openAiAnswers();
    const bindings = env();
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(new Date('2026-09-24T12:59:00Z'));
    for (let i = 0; i < MAX_LABEL_CALLS_PER_CLIENT_PER_HOUR; i += 1) {
      expect((await label(bindings)).status).toBe(200);
    }

    // Two minutes later and in a new clock hour. The old bucket was named for
    // the hour, so this call used to find it empty.
    vi.setSystemTime(new Date('2026-09-24T13:01:00Z'));
    const refused = await label(bindings);
    const body = (await refused.json()) as {
      error: { code: string; details: { budget: { nextAt: number } } };
    };
    expect(refused.status).toBe(429);
    expect(body.error.code).toBe('LABELS_RATE_LIMITED');
    expect(body.error.details.budget.nextAt).toBe(Date.parse('2026-09-24T13:59:00Z'));
    // The real wait, not a guess: 58 minutes.
    expect(refused.headers.get('Retry-After')).toBe(String(58 * 60));

    vi.setSystemTime(new Date('2026-09-24T13:59:01Z'));
    expect((await label(bindings)).status).toBe(200);
  });

  it('takes its limit from LABEL_CALLS_PER_HOUR', async () => {
    openAiAnswers();
    const bindings = env({ LABEL_CALLS_PER_HOUR: '2' });
    expect((await label(bindings)).status).toBe(200);
    expect((await label(bindings)).status).toBe(200);
    expect((await label(bindings)).status).toBe(429);
  });

  it('counts each visitor behind the web proxy separately', async () => {
    openAiAnswers();
    const bindings = env({ LABEL_CALLS_PER_HOUR: '1', PAILLETTE_PUBLIC_SEARCH_API_KEY: 'server-key' });
    const viaProxy = (visitor: string) =>
      labels.request(
        '/public-labels',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // What Cloudflare puts here on the proxy's subrequest: the proxy.
            'CF-Connecting-IP': '2a06:98c0:3600::103',
            'X-API-Key': 'server-key',
            'X-Paillette-Visitor-Ip': visitor,
          },
          body: JSON.stringify({
            collectionId: 'nga',
            artworkIds: ['open-access-art:nga:1'],
            statement: 'Leaving.',
          }),
        },
        bindings
      );
    expect((await viaProxy('203.0.113.9')).status).toBe(200);
    expect((await viaProxy('203.0.113.9')).status).toBe(429);
    expect((await viaProxy('198.51.100.4')).status).toBe(200);
  });

  it('keeps the old ceiling where nothing is set', () => {
    expect(labelCallsPerHour({})).toBe(10);
    expect(labelCallsPerHour({ LABEL_CALLS_PER_HOUR: '60' })).toBe(60);
  });
});
