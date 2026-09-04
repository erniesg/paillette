/**
 * POST /api/public-labels — the wall labels.
 *
 * Two claims are worth pinning, and they are the ones the feature is fake
 * without:
 *
 *  1. **The statement reaches the model.** A label written without the theme
 *     is a caption, and the whole argument for this half of the app is that
 *     the same painting gets a different label in a different show.
 *  2. **No vision call is made.** The caption `describe_artwork` already paid
 *     for is read out of the record; nothing here fetches an image.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import labelRoutes from '../../src/routes/labels';
import type { Env } from '../../src/index';

const OPEN_ACCESS_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const row = (
  id: string,
  { caption }: { caption?: string } = {}
) => ({
  id,
  title: `Work ${id}`,
  artist: 'A. Painter',
  year: 1888,
  date_text: '1888',
  medium: 'oil on canvas',
  classification: 'painting',
  custom_metadata: caption
    ? JSON.stringify({ generated_caption: { text: caption } })
    : null,
});

let bound: unknown[] = [];

const makeDb = (rows: ReturnType<typeof row>[]) =>
  ({
    prepare: (sql: string) => {
      const statement: Record<string, unknown> = {
        bind: (...args: unknown[]) => {
          if (sql.includes('FROM artworks')) bound = args;
          return statement;
        },
        first: async () => (sql.includes('index_jobs') ? null : null),
        all: async () => ({ results: rows }),
        run: async () => ({ success: true }),
      };
      return statement;
    },
  }) as unknown as D1Database;

const makeEnv = (rows: ReturnType<typeof row>[]): Env =>
  ({
    DB: makeDb(rows),
    OPENAI_API_KEY: 'sk-test',
    CACHE: undefined,
  }) as unknown as Env;

const app = new Hono<{ Bindings: Env }>();
app.route('/api', labelRoutes);

let openaiCalls: Record<string, any>[] = [];

const stubOpenAi = (
  labels: { artworkId: string; label: string }[] | 'malformed',
  { status = 200 }: { status?: number } = {}
) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (!url.includes('openai.com')) {
        throw new Error(`unexpected outbound request to ${url}`);
      }
      openaiCalls.push(JSON.parse(String(init.body)));
      if (status !== 200) {
        return new Response('nope', { status });
      }
      return Response.json({
        choices: [
          {
            message: {
              content:
                labels === 'malformed'
                  ? '{"labels": "not a list"}'
                  : JSON.stringify({ labels }),
            },
          },
        ],
      });
    })
  );

const post = (body: Record<string, unknown>, env: Env) =>
  app.request(
    '/api/public-labels',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env
  );

beforeEach(() => {
  openaiCalls = [];
  bound = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the theme reaches the model', () => {
  it('sends the statement, the title and the works in hanging order', async () => {
    stubOpenAi([
      { artworkId: 'a', label: 'One.' },
      { artworkId: 'b', label: 'Two.' },
    ]);
    const response = await post(
      {
        collectionId: 'nga',
        artworkIds: ['b', 'a'],
        title: 'Leaving',
        statement: 'A show about departure and the light that is left behind.',
      },
      makeEnv([row('a'), row('b')])
    );

    expect(response.status).toBe(200);
    const brief = String(openaiCalls[0]?.messages?.[1]?.content);
    expect(brief).toContain('A show about departure');
    expect(brief).toContain('Exhibition title: Leaving');
    // The caller's order is the hang, and the hang is part of the brief.
    expect(brief.indexOf('"artworkId": "b"')).toBeLessThan(
      brief.indexOf('"artworkId": "a"')
    );
  });

  it('refuses without a statement, because a label needs a theme', async () => {
    stubOpenAi([]);
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'] },
      makeEnv([row('a')])
    );
    expect(response.status).toBe(400);
    expect((await response.json<any>()).error.code).toBe('NO_STATEMENT');
    expect(openaiCalls).toHaveLength(0);
  });

  it('carries an optional voice steer', async () => {
    stubOpenAi([{ artworkId: 'a', label: 'One.' }]);
    await post(
      {
        collectionId: 'nga',
        artworkIds: ['a'],
        statement: 'About leaving.',
        voice: 'plainer, for someone who has never been to a museum',
      },
      makeEnv([row('a')])
    );
    expect(String(openaiCalls[0]?.messages?.[1]?.content)).toContain(
      'Voice: plainer'
    );
  });
});

describe('the caption is reused, not re-earned', () => {
  it('passes a stored caption as evidence and never fetches an image', async () => {
    stubOpenAi([{ artworkId: 'a', label: 'One.' }]);
    const response = await post(
      {
        collectionId: 'nga',
        artworkIds: ['a'],
        statement: 'About leaving.',
      },
      makeEnv([row('a', { caption: 'A harbour at dusk with one boat leaving.' })])
    );

    const brief = String(openaiCalls[0]?.messages?.[1]?.content);
    expect(brief).toContain('A harbour at dusk with one boat leaving.');
    // One outbound request, to the completion endpoint. No image bytes.
    expect(openaiCalls).toHaveLength(1);
    expect(openaiCalls[0]?.messages?.[1]?.content).toBeTypeOf('string');

    const payload = await response.json<any>();
    expect(payload.data.labels[0].source).toBe('caption');
  });

  it('still labels a work with no caption, and says so', async () => {
    stubOpenAi([{ artworkId: 'a', label: 'One.' }]);
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      makeEnv([row('a')])
    );
    const payload = await response.json<any>();
    expect(payload.data.labels[0].source).toBe('catalogue');
  });
});

describe('failure paths', () => {
  it('refuses an empty artworkIds', async () => {
    const response = await post(
      { collectionId: 'nga', artworkIds: [], statement: 'About leaving.' },
      makeEnv([])
    );
    expect(response.status).toBe(400);
    expect((await response.json<any>()).error.code).toBe('INVALID_INPUT');
  });

  it('refuses more than a board at a time', async () => {
    const response = await post(
      {
        collectionId: 'nga',
        artworkIds: Array.from({ length: 13 }, (_, index) => `w${index}`),
        statement: 'About leaving.',
      },
      makeEnv([])
    );
    expect(response.status).toBe(400);
    expect((await response.json<any>()).error.code).toBe('TOO_MANY_WORKS');
  });

  it('refuses a collection it does not serve', async () => {
    const response = await post(
      { collectionId: 'somebody-elses', artworkIds: ['a'], statement: 'x' },
      makeEnv([row('a')])
    );
    expect(response.status).toBe(404);
    expect((await response.json<any>()).error.code).toBe('NOT_FOUND');
  });

  it('reports works that are not in the collection', async () => {
    const response = await post(
      { collectionId: 'nga', artworkIds: ['ghost'], statement: 'About leaving.' },
      makeEnv([])
    );
    expect(response.status).toBe(404);
    expect((await response.json<any>()).error.code).toBe('ARTWORK_NOT_FOUND');
  });

  it('reports an unconfigured deployment rather than pretending', async () => {
    const env = { ...makeEnv([row('a')]), OPENAI_API_KEY: undefined } as Env;
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      env
    );
    expect(response.status).toBe(503);
    expect((await response.json<any>()).error.code).toBe('LABELS_UNAVAILABLE');
  });

  it('shapes an upstream failure rather than throwing', async () => {
    stubOpenAi([], { status: 500 });
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      makeEnv([row('a')])
    );
    expect(response.status).toBe(502);
    expect((await response.json<any>()).error.code).toBe('LABELS_FAILED');
  });

  it('shapes a malformed completion rather than returning nonsense', async () => {
    stubOpenAi('malformed');
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      makeEnv([row('a')])
    );
    expect(response.status).toBe(502);
    expect((await response.json<any>()).error.code).toBe('LABELS_FAILED');
  });

  it('drops a label for a work nobody asked about', async () => {
    stubOpenAi([
      { artworkId: 'a', label: 'One.' },
      { artworkId: 'hallucinated', label: 'Two.' },
    ]);
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      makeEnv([row('a')])
    );
    const payload = await response.json<any>();
    expect(payload.data.labels.map((entry: any) => entry.artworkId)).toEqual(['a']);
  });

  it('clips a label that ran long', async () => {
    stubOpenAi([{ artworkId: 'a', label: 'x'.repeat(900) }]);
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      makeEnv([row('a')])
    );
    const payload = await response.json<any>();
    expect(payload.data.labels[0].label).toHaveLength(320);
  });

  it('names the works it could not label', async () => {
    stubOpenAi([{ artworkId: 'a', label: 'One.' }]);
    const response = await post(
      { collectionId: 'nga', artworkIds: ['a', 'b'], statement: 'About leaving.' },
      makeEnv([row('a'), row('b')])
    );
    const payload = await response.json<any>();
    expect(payload.data.missing).toEqual(['b']);
  });

  it('reads only the works asked for, scoped to the open-access org', async () => {
    stubOpenAi([{ artworkId: 'a', label: 'One.' }]);
    await post(
      { collectionId: 'nga', artworkIds: ['a'], statement: 'About leaving.' },
      makeEnv([row('a')])
    );
    expect(bound[0]).toBe(OPEN_ACCESS_ORG_ID);
    expect(bound.slice(1)).toEqual(['a']);
  });
});
