/**
 * The loop that needs no agent.
 *
 * Two things are load-bearing and both are tested here directly rather than
 * through the tool layer: a confirmed pick survives a redeal no matter what
 * the caller asked for, and Enter on an empty bar reaches the exemplar route
 * without ever touching the agent route.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '../artwork-index';
import { __resetFlagsForTest, setFlag } from '../flags';
import {
  __resetRedealForTest,
  placeKeptInOrder,
  runRedeal,
} from '../redeal';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setBoard,
  setDealError,
} from '../store';
import { __resetTurnStateForTest, submitHumanTurn } from '../turn';

const artwork = (id: string): ArtworkSearchResult =>
  ({
    id,
    title: `Work ${id}`,
    artist: 'A Painter',
    similarity: 0.5,
  }) as unknown as ArtworkSearchResult;

/** Every call the page makes, so a test can assert what was *not* called. */
let calls: { url: string; body: Record<string, unknown> }[] = [];

const stubExemplarRoute = (dealt: string[]) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const body = init.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });

      if (url.includes('/exemplars')) {
        const results = dealt.map(artwork);
        rememberArtworks(results);
        return Response.json({
          success: true,
          data: { results, count: results.length, queryTime: 1 },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
};

beforeEach(() => {
  calls = [];
  __resetRedealForTest();
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  __resetArtworkIndexForTest();
  __resetTurnStateForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('placeKeptInOrder', () => {
  it('leaves a survivor in the seat it was already in', () => {
    const order = placeKeptInOrder(
      ['a', 'b', 'c', 'd'],
      ['c'],
      ['x', 'y', 'z'],
      4
    );

    expect(order[2]).toBe('c');
    expect(order).toEqual(['x', 'y', 'c', 'z']);
  });

  it('keeps two survivors in their relative positions', () => {
    const order = placeKeptInOrder(
      ['a', 'b', 'c', 'd'],
      ['a', 'd'],
      ['x', 'y'],
      4
    );

    expect(order).toEqual(['a', 'x', 'y', 'd']);
  });

  it('never drops a pick, even when the board shrank under it', () => {
    const order = placeKeptInOrder(['a', 'b', 'c'], ['a', 'b', 'c'], [], 2);

    expect(order).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('reseats a pick whose old index is off the end of a smaller board', () => {
    const order = placeKeptInOrder(['a', 'b', 'c', 'd'], ['d'], ['x'], 2);

    expect(order).toContain('d');
    expect(order).toHaveLength(2);
  });
});

describe('runRedeal', () => {
  it('refuses to deal with nothing picked, and says what to do instead', async () => {
    stubExemplarRoute([]);

    const result = await runRedeal({ by: 'human' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'NO_EXEMPLARS' },
    });
    expect(calls).toHaveLength(0);
  });

  it('holds the picks and replaces everything else', async () => {
    rememberArtworks(['a', 'b', 'c'].map(artwork));
    setBoard({
      order: ['a', 'b', 'c'],
      dealt: ['a', 'b', 'c'],
      note: null,
      lastChangeBy: 'human',
      redeals: 1,
      at: 1,
    });
    setFlag('b', 'pick', { by: 'human' });
    setFlag('c', 'reject', { by: 'human' });
    stubExemplarRoute(['n1', 'n2']);

    const result = await runRedeal({ by: 'human', count: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kept).toEqual(['b']);
    expect(result.removed).toEqual(['a', 'c']);
    expect(result.added).toEqual(['n1', 'n2']);
    // b was second, and it is still second.
    expect(result.order).toEqual(['n1', 'b', 'n2']);
  });

  it('hangs a pick made before there was a board, rather than discarding it', async () => {
    // The first redeal of a session: the human picked from their own search
    // grid, so nothing is on the board yet. The pick is still the instruction.
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute(['n1']);

    const result = await runRedeal({ by: 'human', count: 2 });

    expect(result.ok && result.kept).toEqual(['keep']);
    expect(result.ok && result.order).toContain('keep');
  });

  it('sends the confirmed picks and rejects as the query', async () => {
    rememberArtworks([artwork('keep'), artwork('drop')]);
    setFlag('keep', 'pick', { by: 'human' });
    setFlag('drop', 'reject', { by: 'human' });
    setFlag('proposed', 'pick', { by: 'agent', reason: 'a guess' });
    stubExemplarRoute(['n1']);

    await runRedeal({ by: 'human', count: 2 });

    expect(calls[0]?.body).toMatchObject({
      positiveIds: ['keep'],
      negativeIds: ['drop'],
    });
    // The agent's provisional pick is not in the query.
    expect(calls[0]?.body.positiveIds).not.toContain('proposed');
  });

  it('excludes everything already dealt, so the loop keeps moving', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    setBoard({
      order: ['keep', 'seen-now'],
      dealt: ['seen-earlier', 'keep', 'seen-now'],
      note: null,
      lastChangeBy: 'human',
      redeals: 1,
      at: 1,
    });
    stubExemplarRoute(['n1']);

    await runRedeal({ by: 'human', count: 2 });

    expect(calls[0]?.body.excludeIds).toEqual(
      expect.arrayContaining(['seen-earlier', 'seen-now', 'keep'])
    );
  });

  it('weights the negatives harder when asked to tighten', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute(['n1']);

    await runRedeal({ by: 'human', strategy: 'tighten', count: 2 });

    expect(calls[0]?.body).toMatchObject({ negativeWeight: 0.8 });
  });

  it('skips the nearest band when asked to widen', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    // Six to skip, then the one that should land.
    stubExemplarRoute(['s1', 's2', 's3', 's4', 's5', 's6', 'wanted']);

    const result = await runRedeal({
      by: 'human',
      strategy: 'widen',
      count: 2,
    });

    expect(calls[0]?.body).toMatchObject({ negativeWeight: 0.25, topK: 7 });
    expect(result.ok && result.added).toEqual(['wanted']);
  });

  it('puts the board on the canvas, labelled with whose move it was', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute(['n1']);

    await runRedeal({ by: 'human', count: 2, note: 'following your picks' });

    const state = getWebMcpState();
    expect(state.board).toMatchObject({
      lastChangeBy: 'human',
      note: 'following your picks',
      redeals: 1,
    });
    expect(state.agentResults).toMatchObject({
      origin: 'human',
      note: 'following your picks',
    });
    expect(state.agentResults?.items.map((item) => item.id)).toEqual([
      'keep',
      'n1',
    ]);
  });

  it('deals twelve by default', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute([]);

    await runRedeal({ by: 'human' });

    expect(calls[0]?.body).toMatchObject({ topK: 11 });
  });
});

describe('Enter on an empty bar', () => {
  it('redeals from the flags without calling the agent at all', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute(['n1', 'n2']);

    const outcome = await submitHumanTurn();

    expect(outcome.kind).toBe('redeal');
    expect(outcome.kind === 'redeal' && outcome.result.ok).toBe(true);

    const urls = calls.map((call) => call.url);
    expect(urls.some((url) => url.includes('/exemplars'))).toBe(true);
    expect(urls.some((url) => url.includes('public-agent'))).toBe(false);
  });

  it('does nothing at all when there is nothing to deal from', async () => {
    stubExemplarRoute([]);

    const outcome = await submitHumanTurn();

    expect(outcome.kind).toBe('noop');
    expect(calls).toHaveLength(0);
  });

  it('hands a typed turn to the agent instead of redealing', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute(['n1']);

    const outcome = await submitHumanTurn('something warmer');

    expect(outcome.kind).toBe('agent');
    expect(outcome.turn.text).toBe('something warmer');
    // The gestures ride along with the words.
    expect(outcome.turn.flagsDelta).toMatchObject([
      { artworkId: 'keep', to: 'pick' },
    ]);
    expect(calls).toHaveLength(0);
  });
});

describe('widening when the collection runs out', () => {
  it('fills from the band it skipped rather than dealing a short board', async () => {
    // "widen" skips the six nearest results. Ask for twelve against a corner
    // of the index that can only offer eight, and a naive slice deals two —
    // which reads on screen as a broken loop rather than as an answer.
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    stubExemplarRoute(Array.from({ length: 8 }, (_, index) => `n${index}`));

    const result = await runRedeal({ by: 'human', strategy: 'widen' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Eleven dealt plus the pick: everything the collection had.
    expect(result.order).toHaveLength(9);
    // The far band first, then the near one it fell back on.
    expect(result.added.slice(0, 2)).toEqual(['n6', 'n7']);
    expect(result.added).toContain('n0');
  });
});

describe('when the deal cannot run', () => {
  it('refuses a second deal while one is in flight, rather than racing it', async () => {
    // Enter is cheap to press and a slow deal is not fast. Two in flight write
    // the board twice from two reads of the same state — the later wins and
    // the earlier one's newcomers simply vanish.
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });

    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        const results = [artwork('n1')];
        rememberArtworks(results);
        return Response.json({
          success: true,
          data: { results, count: 1, queryTime: 1 },
        });
      })
    );

    const first = runRedeal({ by: 'human' });
    const second = await runRedeal({ by: 'human' });

    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.code).toBe('REDEAL_IN_FLIGHT');

    release(null);
    expect((await first).ok).toBe(true);
    // And the latch is released, so the next press works.
    expect(getWebMcpState().dealing).toBe(false);
  });

  it('leaves the board exactly as it was when the route fails', async () => {
    rememberArtworks([artwork('keep'), artwork('old')]);
    setFlag('keep', 'pick', { by: 'human' });
    setBoard({
      order: ['keep', 'old'],
      dealt: ['keep', 'old'],
      note: 'the quiet ones',
      lastChangeBy: 'human',
      redeals: 1,
      at: 1,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch');
      })
    );

    const result = await runRedeal({ by: 'human' });

    expect(!result.ok && result.error.code).toBe('REDEAL_FAILED');
    // Half-applying a deal is worse than not dealing at all.
    expect(getWebMcpState().board?.order).toEqual(['keep', 'old']);
    expect(getWebMcpState().board?.redeals).toBe(1);
    // And it is recorded, so pressing Enter is not a dead key.
    expect(getWebMcpState().dealError).toMatchObject({ code: 'REDEAL_FAILED' });
    expect(getWebMcpState().dealing).toBe(false);
  });

  it('reports the failure to the agent through the view context', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch');
      })
    );
    await runRedeal({ by: 'human' });

    expect(getWebMcpState().dealError?.message).toContain('Failed to fetch');
  });

  it('clears a previous failure once a deal succeeds', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    setDealError({ code: 'REDEAL_FAILED', message: 'earlier' });
    stubExemplarRoute(['n1']);

    await runRedeal({ by: 'human' });

    expect(getWebMcpState().dealError).toBeNull();
  });
});
