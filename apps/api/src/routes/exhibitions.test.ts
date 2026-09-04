/**
 * Publishing a show, and opening one.
 *
 * The cases worth holding down are the ones a stranger meets rather than the
 * happy path: a code that does not exist, a code that is not a code, a work
 * that is not in the catalogue, and the collision retry — which will never
 * fire in production and would therefore never be noticed if it were broken.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import app, { type Env } from '../index';
import { OPEN_ACCESS_ORG_ID } from '../utils/orgs';
import { MAX_EXHIBITIONS_PER_CLIENT_PER_HOUR } from './exhibitions';

type Stored = {
  code: string;
  collection_id: string;
  title: string | null;
  statement: string | null;
  title_by_agent: number;
  statement_by_agent: number;
  works: string;
  created_at: string;
  view_count: number;
};

/**
 * A D1 stand-in with just enough behaviour to be worth testing against: it
 * holds rows, it enforces the primary key, and it counts views. Anything
 * looser and the collision test would pass against a mock that cannot
 * collide.
 */
const database = () => {
  const rows = new Map<string, Stored>();
  const catalogue = new Set(['nga:1', 'nga:2', 'nga:3']);
  const inserts: string[] = [];

  const db = {
    rows,
    inserts,
    catalogue,
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) {
          params = args;
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM exhibitions')) {
            return (rows.get(params[0] as string) ?? null) as T | null;
          }
          if (sql.includes('FROM orgs')) return { id: OPEN_ACCESS_ORG_ID } as T;
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes('FROM artworks')) {
            const ids = params.slice(1) as string[];
            return {
              results: ids
                .filter((id) => catalogue.has(id))
                .map((id) => ({ id })) as T[],
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO exhibitions')) {
            const [
              code,
              collection_id,
              title,
              statement_text,
              title_by_agent,
              statement_by_agent,
              works,
            ] = params as [string, string, string | null, string | null, number, number, string];
            inserts.push(code);
            if (rows.has(code)) {
              throw new Error('D1_ERROR: UNIQUE constraint failed: exhibitions.code');
            }
            rows.set(code, {
              code,
              collection_id,
              title,
              statement: statement_text,
              title_by_agent,
              statement_by_agent,
              works,
              created_at: '2026-09-04T00:00:00Z',
              view_count: 0,
            });
            return { success: true };
          }
          if (sql.startsWith('UPDATE exhibitions')) {
            const row = rows.get(params[0] as string);
            if (row) row.view_count += 1;
            return { success: true };
          }
          return { success: true };
        },
      };
      return statement;
    },
  };
  return db;
};

const cache = () => {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
};

let db: ReturnType<typeof database>;
let kv: ReturnType<typeof cache>;

const env = (): Env =>
  ({
    DB: db as unknown as D1Database,
    CACHE: kv as unknown as KVNamespace,
    ENVIRONMENT: 'test',
    API_VERSION: 'test',
  }) as Env;

const post = (body: unknown, ip = '203.0.113.7') =>
  app.fetch(
    new Request('http://localhost/api/public-exhibitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify(body),
    }),
    env()
  );

const get = (code: string, { count = false }: { count?: boolean } = {}) =>
  app.fetch(
    new Request(
      `http://localhost/api/public-exhibitions/${code}${count ? '?count=1' : ''}`
    ),
    env()
  );

const aShow = {
  collectionId: 'nga',
  title: 'Leaving',
  titleByAgent: true,
  statement: 'It is about leaving.',
  statementByAgent: false,
  works: [
    { artworkId: 'nga:1', label: 'The boat is already gone.', labelByAgent: true },
    { artworkId: 'nga:2', label: null, labelByAgent: false },
  ],
};

beforeEach(() => {
  db = database();
  kv = cache();
  vi.restoreAllMocks();
});

describe('publishing', () => {
  it('stores the show and hands back a short code', async () => {
    const response = await post(aShow);
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      data: { code: string; path: string; works: number; dropped: number };
    };
    expect(body.data.code).toMatch(/^[^0O1lI]{7}$/);
    expect(body.data.path).toBe(`/e/${body.data.code}`);
    expect(body.data.works).toBe(2);
    expect(body.data.dropped).toBe(0);
  });

  it('keeps the prose, the provenance and the hanging order', async () => {
    const response = await post(aShow);
    const { data } = (await response.json()) as { data: { code: string } };
    const row = db.rows.get(data.code)!;

    expect(row.title).toBe('Leaving');
    expect(row.title_by_agent).toBe(1);
    expect(row.statement_by_agent).toBe(0);
    expect(JSON.parse(row.works)).toEqual([
      { artworkId: 'nga:1', label: 'The boat is already gone.', labelByAgent: true },
      { artworkId: 'nga:2', label: null, labelByAgent: false },
    ]);
  });

  it('drops a work the catalogue does not have, and says how many', async () => {
    const response = await post({
      ...aShow,
      works: [
        { artworkId: 'nga:1', label: null, labelByAgent: false },
        { artworkId: 'nga:404', label: null, labelByAgent: false },
      ],
    });
    const body = (await response.json()) as { data: { works: number; dropped: number } };
    expect(body.data.works).toBe(1);
    expect(body.data.dropped).toBe(1);
  });

  it('refuses a show where nothing resolves', async () => {
    const response = await post({
      ...aShow,
      works: [{ artworkId: 'nga:404', label: null, labelByAgent: false }],
    });
    expect(response.status).toBe(404);
  });

  it('refuses a collection that is not the open-access one', async () => {
    const response = await post({ ...aShow, collectionId: 'ngs' });
    expect(response.status).toBe(404);
  });

  it.each([
    ['no works', { ...aShow, works: [] }],
    ['not an array', { ...aShow, works: 'nga:1' }],
  ])('refuses a show with %s', async (_name, body) => {
    expect((await post(body)).status).toBe(400);
  });

  it('refuses more works than a hang holds', async () => {
    const response = await post({
      ...aShow,
      works: Array.from({ length: 25 }, (_, index) => ({
        artworkId: `nga:${index}`,
        label: null,
        labelByAgent: false,
      })),
    });
    expect(response.status).toBe(400);
  });

  it('clips prose to museum length rather than refusing it', async () => {
    const response = await post({
      ...aShow,
      title: 'T'.repeat(200),
      statement: 'S'.repeat(2000),
    });
    const { data } = (await response.json()) as { data: { code: string } };
    const row = db.rows.get(data.code)!;
    expect(row.title).toHaveLength(90);
    expect(row.statement).toHaveLength(800);
  });

  /*
   * The retry exists for an event with probability ~10^-12, which is exactly
   * why it needs a test: nothing in production will ever exercise it, so a
   * broken loop would sit here indefinitely and then fail on the one night it
   * mattered. Forcing the first two draws to collide is the only way to see it.
   */
  it('draws again when a code is already taken', async () => {
    const first = await post(aShow);
    const { data } = (await first.json()) as { data: { code: string } };

    const taken = data.code;
    const real = crypto.getRandomValues.bind(crypto);
    let draws = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((
      buffer: Uint8Array
    ) => {
      draws += 1;
      // First draw reproduces the taken code; after that, back to real entropy.
      if (draws === 1) {
        const alphabet =
          '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
        const size = alphabet.length;
        const ceiling = Math.floor(256 / size) * size;
        for (let index = 0; index < taken.length; index += 1) {
          // Any byte below the ceiling that maps to the wanted character.
          let byte = alphabet.indexOf(taken[index]!);
          while (byte >= ceiling) byte -= size;
          buffer[index] = byte;
        }
        for (let index = taken.length; index < buffer.length; index += 1) {
          buffer[index] = 255; // rejected by the sampler, so ignored
        }
        return buffer;
      }
      return real(buffer);
    }) as typeof crypto.getRandomValues);

    const second = await post(aShow);
    expect(second.status).toBe(201);

    const body = (await second.json()) as { data: { code: string } };
    expect(body.data.code).not.toBe(taken);
    // The collision really happened: the taken code was attempted again.
    expect(db.inserts.filter((code) => code === taken)).toHaveLength(2);
  });

  it('stops publishing once the hourly budget is spent', async () => {
    for (let attempt = 0; attempt < MAX_EXHIBITIONS_PER_CLIENT_PER_HOUR; attempt += 1) {
      expect((await post(aShow)).status).toBe(201);
    }
    const blocked = await post(aShow);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('600');
  });

  it('budgets per caller, not globally', async () => {
    for (let attempt = 0; attempt < MAX_EXHIBITIONS_PER_CLIENT_PER_HOUR; attempt += 1) {
      await post(aShow, '203.0.113.7');
    }
    expect((await post(aShow, '198.51.100.4')).status).toBe(201);
  });
});

describe('opening', () => {
  it('returns the show a code was published under', async () => {
    const created = await post(aShow);
    const { data } = (await created.json()) as { data: { code: string } };

    const response = await get(data.code);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        title: string;
        titleByAgent: boolean;
        statement: string;
        works: { artworkId: string; label: string | null; labelByAgent: boolean }[];
      };
    };
    expect(body.data.title).toBe('Leaving');
    expect(body.data.titleByAgent).toBe(true);
    expect(body.data.statement).toBe('It is about leaving.');
    expect(body.data.works).toHaveLength(2);
    expect(body.data.works[0]!.label).toBe('The boat is already gone.');
  });

  it('counts a visit when the caller says it is one', async () => {
    const created = await post(aShow);
    const { data } = (await created.json()) as { data: { code: string } };

    await get(data.code, { count: true });
    await get(data.code, { count: true });
    expect(db.rows.get(data.code)!.view_count).toBe(2);
  });

  /*
   * A crawler building an unfurl card and a probe reading the JSON both
   * resolve the code, and neither is somebody looking at the show. Counting
   * them meant pasting a link into Slack registered as a visit.
   */
  it('does not count a resolve that nobody asked to count', async () => {
    const created = await post(aShow);
    const { data } = (await created.json()) as { data: { code: string } };

    await get(data.code);
    await get(data.code);
    expect(db.rows.get(data.code)!.view_count).toBe(0);
  });

  /*
   * These two cannot both be had: an edge-cached response never reaches the
   * Worker, so every cache hit would be an uncounted visit. The header
   * follows the flag rather than being the same for both and wrong for one.
   */
  it('is cacheable only when nobody is counting', async () => {
    const created = await post(aShow);
    const { data } = (await created.json()) as { data: { code: string } };

    expect((await get(data.code)).headers.get('Cache-Control')).toContain('s-maxage');
    expect(
      (await get(data.code, { count: true })).headers.get('Cache-Control')
    ).toBe('no-store');
  });

  it('404s a code nobody published', async () => {
    expect((await get('aB3xk9m')).status).toBe(404);
  });

  /*
   * Malformed and unknown answer identically, deliberately. A 400 for "that is
   * not a code" and a 404 for "that code is free" would tell an enumerator
   * which shapes are worth trying.
   */
  it.each([
    ['too short', 'abc'],
    ['too long', 'abcdefghij'],
    ['an ambiguous glyph', 'abcdef0'],
    ['a path segment', '..'],
    ['an injection attempt', "a'OR'1"],
  ])('gives the same 404 for %s', async (_name, code) => {
    const response = await get(encodeURIComponent(code));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('never reaches storage with a code it has not validated', async () => {
    const spy = vi.spyOn(db, 'prepare');
    await get('abcdef0');
    expect(
      spy.mock.calls.filter(([sql]) => sql.includes('FROM exhibitions'))
    ).toHaveLength(0);
  });
});

describe('the boundary', () => {
  it('needs no authentication, like the rest of the open-access surface', async () => {
    // No API key, no session header, no user id — and still 201/200.
    expect((await post(aShow)).status).toBe(201);
  });
});
