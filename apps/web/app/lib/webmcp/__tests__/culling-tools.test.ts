/**
 * The agent's half of the culling loop: flag_artworks, search_by_exemplars,
 * redeal and compare_artworks.
 *
 * The property worth protecting here is not that the tools work — it is that
 * the agent cannot use them to lose the human's work. A model that forgets a
 * pick, or decides it knows better, must not be able to drop one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '../artwork-index';
import { __resetFlagsForTest, getExemplars, getFlag, setFlag } from '../flags';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setBoard,
} from '../store';
import { __resetTurnStateForTest } from '../turn';
import { createPailletteTools, type ToolContext } from '../tools';
import type { WebMcpTool } from '../registry';

const artwork = (id: string): ArtworkSearchResult =>
  ({
    id,
    galleryId: 'nga',
    orgId: 'nga',
    title: `Work ${id}`,
    artist: 'A. Painter',
    year: 1888,
    imageUrl: `https://assets.example/${id}.jpg`,
    thumbnailUrl: `https://assets.example/${id}-thumb.jpg`,
    similarity: 0.7,
    metadata: {},
  }) as unknown as ArtworkSearchResult;

const context: ToolContext = {
  navigate: vi.fn(),
  getPageContext: () => ({
    pathname: '/nga/search',
    search: '',
    collectionId: 'nga',
    query: '',
    facet: null,
    colour: null,
  }),
};

let tools: Map<string, WebMcpTool>;
let requests: { url: string; body: Record<string, unknown> }[] = [];

const call = (name: string, input: Record<string, unknown> = {}) => {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute(input, {}) as Promise<Record<string, any>>;
};

const stubExemplars = (
  dealt: string[],
  { status = 200 }: { status?: number } = {}
) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({
        url,
        body: init.body ? JSON.parse(String(init.body)) : {},
      });
      if (status !== 200) {
        return Response.json(
          {
            success: false,
            error: { code: 'EXEMPLARS_NOT_INDEXED', message: 'No embeddings.' },
          },
          { status }
        );
      }
      const results = dealt.map(artwork);
      rememberArtworks(results);
      return Response.json({
        success: true,
        data: { results, count: results.length, queryTime: 3 },
      });
    })
  );
};

beforeEach(() => {
  requests = [];
  __resetArtworkIndexForTest();
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  __resetTurnStateForTest();
  tools = new Map(
    createPailletteTools(context).map((tool) => [tool.name, tool])
  );
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('flag_artworks', () => {
  beforeEach(() => rememberArtworks(['a', 'b', 'c', 'd'].map(artwork)));

  it('flags with reasons and reports them as provisional', async () => {
    const result = await call('flag_artworks', {
      flags: [
        { artworkId: 'a', flag: 'pick', reason: 'the only wide horizon' },
        { artworkId: 'b', flag: 'reject', reason: 'too busy for a wall' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.provisional).toBe(true);
    expect(result.applied).toMatchObject([
      { artworkId: 'a', flag: 'pick', reason: 'the only wide horizon' },
      { artworkId: 'b', flag: 'reject', reason: 'too busy for a wall' },
    ]);
    // Named, not just identified — the human sees these on their cards.
    expect(result.applied[0].work).toContain('Work a');
  });

  it('reports the confirmed exemplars back, which its own flags are not in', async () => {
    setFlag('d', 'pick', { by: 'human' });

    const result = await call('flag_artworks', {
      flags: [{ artworkId: 'a', flag: 'pick', reason: 'a guess' }],
    });

    expect(result.confirmedExemplars).toEqual({
      positive: ['d'],
      negative: [],
    });
  });

  it('refuses more than three at a time', async () => {
    const result = await call('flag_artworks', {
      flags: ['a', 'b', 'c', 'd'].map((artworkId) => ({
        artworkId,
        flag: 'pick',
      })),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'TOO_MANY_FLAGS' },
    });
  });

  it('rejects an empty list', async () => {
    expect(await call('flag_artworks', { flags: [] })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('rejects a flag value it does not have', async () => {
    const result = await call('flag_artworks', {
      flags: [{ artworkId: 'a', flag: 'maybe' }],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('says so when none of the ids were ever on this page', async () => {
    const result = await call('flag_artworks', {
      flags: [{ artworkId: 'ghost', flag: 'pick' }],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ARTWORK_NOT_IN_SESSION' },
    });
  });

  it('applies what it can and names what it could not', async () => {
    const result = await call('flag_artworks', {
      flags: [
        { artworkId: 'a', flag: 'pick' },
        { artworkId: 'ghost', flag: 'pick' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.unresolved).toEqual(['ghost']);
    expect(getFlag('a')?.provisional).toBe(true);
  });
});

describe('search_by_exemplars', () => {
  beforeEach(() => rememberArtworks(['a', 'b'].map(artwork)));

  it('queries the exemplar route and documents its own scoring', async () => {
    stubExemplars(['n1', 'n2']);

    const result = await call('search_by_exemplars', {
      positiveIds: ['a'],
      negativeIds: ['b'],
      topK: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.scoring).toContain('max over negatives');
    expect(requests[0]?.url).toContain('/api/public-search/nga/exemplars');
    expect(requests[0]?.body).toMatchObject({
      positiveIds: ['a'],
      negativeIds: ['b'],
      topK: 5,
    });
  });

  it('needs at least one positive, and says what to read instead', async () => {
    const result = await call('search_by_exemplars', { positiveIds: [] });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(result.error.hint).toContain('get_view_context');
  });

  it('returns an upstream failure as data rather than throwing', async () => {
    stubExemplars([], { status: 422 });

    const result = await call('search_by_exemplars', { positiveIds: ['a'] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'EXEMPLARS_NOT_INDEXED' },
    });
  });
});

describe('redeal', () => {
  beforeEach(() => rememberArtworks(['a', 'b', 'c'].map(artwork)));

  it('cannot drop a confirmed pick, whatever it asks for', async () => {
    setBoard({
      order: ['a', 'b', 'c'],
      dealt: ['a', 'b', 'c'],
      note: null,
      lastChangeBy: 'human',
      redeals: 1,
      at: 1,
    });
    setFlag('b', 'pick', { by: 'human' });
    stubExemplars(['n1', 'n2']);

    const result = await call('redeal', { count: 3, keep: 'picks' });

    expect(result.ok).toBe(true);
    expect(result.kept).toMatchObject([{ id: 'b' }]);
    expect(result.order).toContain('b');
    expect(getWebMcpState().board?.order).toContain('b');
  });

  it('has no argument that can turn pin survival off', async () => {
    setBoard({
      order: ['a', 'b'],
      dealt: ['a', 'b'],
      note: null,
      lastChangeBy: 'agent',
      redeals: 1,
      at: 1,
    });
    setFlag('b', 'pick', { by: 'human' });
    stubExemplars(['n1']);

    // `keep` has exactly one legal value, and omitting it changes nothing.
    const omitted = await call('redeal', { count: 2 });
    expect(omitted.order).toContain('b');

    const schema = tools.get('redeal')?.inputSchema as {
      properties: { keep: { enum: string[] } };
    };
    expect(schema.properties.keep.enum).toEqual(['picks']);
  });

  it('labels the board as the agent’s move', async () => {
    setFlag('a', 'pick', { by: 'human' });
    stubExemplars(['n1']);

    await call('redeal', { note: 'Following the picks, not the words.' });

    expect(getWebMcpState().board).toMatchObject({
      lastChangeBy: 'agent',
      note: 'Following the picks, not the words.',
    });
  });

  it('refuses when nothing has been picked, and says what to do', async () => {
    const result = await call('redeal', {});

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NO_EXEMPLARS' },
    });
    expect(result.error.hint).toContain('flag_artworks');
  });

  it('will not deal from its own unconfirmed suggestions', async () => {
    await call('flag_artworks', {
      flags: [{ artworkId: 'a', flag: 'pick', reason: 'I like it' }],
    });

    const result = await call('redeal', {});

    expect(result).toMatchObject({ ok: false, error: { code: 'NO_EXEMPLARS' } });
    expect(getExemplars().positive).toEqual([]);
  });

  it('deals twelve unless told otherwise', async () => {
    setFlag('a', 'pick', { by: 'human' });
    stubExemplars([]);

    await call('redeal', {});

    expect(requests[0]?.body.topK).toBe(11);
  });
});

describe('compare_artworks', () => {
  beforeEach(() => rememberArtworks(['a', 'b'].map(artwork)));

  it('puts two works up with the question between them', async () => {
    const result = await call('compare_artworks', {
      artworkIds: ['a', 'b'],
      question: 'Which one belongs above a sofa?',
    });

    expect(result.ok).toBe(true);
    expect(getWebMcpState().compare).toMatchObject({
      artworkIds: ['a', 'b'],
      question: 'Which one belongs above a sofa?',
      askedBy: 'agent',
    });
  });

  it('insists on exactly two', async () => {
    for (const artworkIds of [[], ['a'], ['a', 'b', 'c']]) {
      expect(await call('compare_artworks', { artworkIds })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
    }
    expect(getWebMcpState().compare).toBeNull();
  });

  it('refuses to compare a work with itself', async () => {
    // The deduplicating reader collapses this to one id, which is the same
    // failure by a different route — either way there is no question here.
    const result = await call('compare_artworks', { artworkIds: ['a', 'a'] });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(getWebMcpState().compare).toBeNull();
  });

  it('recovers a repeated id rather than failing on a typo', async () => {
    const result = await call('compare_artworks', {
      artworkIds: ['a', 'b', 'a'],
    });

    expect(result.ok).toBe(true);
    expect(getWebMcpState().compare?.artworkIds).toEqual(['a', 'b']);
  });

  it('names the ids it could not resolve', async () => {
    const result = await call('compare_artworks', {
      artworkIds: ['a', 'ghost'],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ARTWORK_NOT_IN_SESSION' },
    });
    expect(result.error.message).toContain('ghost');
  });
});

describe('get_view_context reports the gestures', () => {
  beforeEach(() => rememberArtworks(['a', 'b', 'c'].map(artwork)));

  it('separates confirmed judgements from the agent’s proposals', async () => {
    setFlag('a', 'pick', { by: 'human' });
    setFlag('b', 'reject', { by: 'human' });
    setFlag('c', 'pick', { by: 'agent', reason: 'a guess' });

    const result = await call('get_view_context');

    expect(result.flags.picks).toMatchObject([
      { id: 'a', title: 'Work a', artist: 'A. Painter', by: 'human' },
    ]);
    expect(result.flags.rejects).toMatchObject([{ id: 'b', by: 'human' }]);
    expect(result.flags.provisional).toMatchObject([
      { id: 'c', by: 'agent', reason: 'a guess' },
    ]);
    expect(result.flags.exemplars).toEqual({
      positive: ['a'],
      negative: ['b'],
    });
  });

  it('reports the board, whose move it was, and what is used up', async () => {
    setBoard({
      order: ['a', 'b'],
      dealt: ['a', 'b', 'gone'],
      note: 'following your picks',
      lastChangeBy: 'human',
      redeals: 2,
      at: 5,
    });

    const result = await call('get_view_context');

    expect(result.board).toMatchObject({
      order: ['a', 'b'],
      note: 'following your picks',
      lastChangeBy: 'human',
      redeals: 2,
      dealtThisSession: 3,
    });
  });

  it('says nothing about a board that has never been dealt', async () => {
    expect((await call('get_view_context')).board).toBeNull();
  });

  it('reports what "this one" and "these" refer to', async () => {
    const { setHoveredArtwork, setSelection } = await import('../store');
    setHoveredArtwork('a');
    setSelection(['b', 'c']);

    const result = await call('get_view_context');

    expect(result.hovered).toMatchObject({ id: 'a' });
    expect(result.hovered.work).toContain('Work a');
    expect(result.selection.map((entry: any) => entry.id)).toEqual(['b', 'c']);
  });

  it('reports an open two-up', async () => {
    await call('compare_artworks', {
      artworkIds: ['a', 'b'],
      question: 'Which reads from further away?',
    });

    const result = await call('get_view_context');

    expect(result.compare).toMatchObject({
      artworkIds: ['a', 'b'],
      question: 'Which reads from further away?',
      askedBy: 'agent',
    });
  });

  it('marks a flag as off the board once it is no longer hung', async () => {
    setBoard({
      order: ['a'],
      dealt: ['a', 'b'],
      note: null,
      lastChangeBy: 'human',
      redeals: 1,
      at: 1,
    });
    setFlag('a', 'pick', { by: 'human' });
    setFlag('b', 'reject', { by: 'human' });

    const result = await call('get_view_context');

    expect(result.flags.picks[0]).toMatchObject({ id: 'a', onBoard: true });
    expect(result.flags.rejects[0]).toMatchObject({ id: 'b', onBoard: false });
  });
});

describe('set_results cannot lose a pick either', () => {
  beforeEach(() => rememberArtworks(['a', 'b', 'c', 'd'].map(artwork)));

  it('puts back a confirmed pick the agent left out, and says it did', async () => {
    // redeal has no argument that can drop a pick. Assembling a board by hand
    // is the other way in, and a curated set that quietly discards a work the
    // human kept is the same failure wearing a different tool name.
    setFlag('a', 'pick', { by: 'human' });

    const result = await call('set_results', { artworkIds: ['b', 'c'] });

    expect(getWebMcpState().board?.order).toEqual(['b', 'c', 'a']);
    expect(result.heldPicks).toEqual([
      { id: 'a', work: 'Work a — A. Painter' },
    ]);
  });

  it('leaves the agent’s order alone when it kept the picks itself', async () => {
    setFlag('c', 'pick', { by: 'human' });

    const result = await call('set_results', { artworkIds: ['c', 'b'] });

    expect(getWebMcpState().board?.order).toEqual(['c', 'b']);
    expect(result.heldPicks).toBeUndefined();
  });

  it('ignores the agent’s own provisional pick — that is not the human’s work', async () => {
    setFlag('a', 'pick', { by: 'agent', reason: 'proposed' });

    await call('set_results', { artworkIds: ['b'] });

    expect(getWebMcpState().board?.order).toEqual(['b']);
  });

  it('makes what is on the canvas the board, so a redeal after it has ground to stand on', async () => {
    await call('set_results', { artworkIds: ['a', 'b'], note: 'Two quiet ones.' });

    expect(getWebMcpState().board).toMatchObject({
      order: ['a', 'b'],
      note: 'Two quiet ones.',
      lastChangeBy: 'agent',
    });
    // Dealt-this-session must include them, or the next redeal offers the
    // same works straight back.
    expect(getWebMcpState().board?.dealt).toEqual(['a', 'b']);
  });
});

describe('search_by_exemplars and ids that are not real', () => {
  it('refuses when no positive is on this page, without a round trip', async () => {
    stubExemplars(['n1']);

    const result = await call('search_by_exemplars', { positiveIds: ['ghost'] });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ARTWORK_NOT_IN_SESSION');
    // The point of failing here is not spending the request.
    expect(requests).toHaveLength(0);
  });

  it('drops an invented id, keeps the real ones, and says which it dropped', async () => {
    rememberArtworks([artwork('a')]);
    stubExemplars(['n1']);

    const result = await call('search_by_exemplars', {
      positiveIds: ['a', 'ghost'],
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.body).toMatchObject({ positiveIds: ['a'] });
    expect(result.unresolved).toEqual(['ghost']);
  });
});
