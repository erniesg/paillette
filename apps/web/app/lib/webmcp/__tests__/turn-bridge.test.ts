/**
 * The gestures have to arrive, exactly once, and only on the request that is
 * actually a human turn.
 *
 * Draining twice is the failure that matters: the journal is emptied when a
 * turn is assembled, so if the shim fired on every request in the agent's
 * loop, the second one would report an empty set of gestures and overwrite
 * nothing — but the *first* tool call in the next turn would have already
 * eaten the flags the human laid down for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTurnBridge, withGestures } from '../turn-bridge';
import { __resetFlagsForTest, setFlag } from '../flags';
import { __resetWebMcpStateForTest, setHoveredArtwork } from '../store';
import { __resetTurnStateForTest } from '../turn';

const body = (messages: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ messages, tools: [], ...extra });

const user = (content: string) => ({ role: 'user', content });
const toolResult = { role: 'tool', tool_call_id: 'call_1', content: '{}' };

const parse = (value: string) => JSON.parse(value) as { turn?: unknown };

beforeEach(() => {
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  __resetTurnStateForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withGestures', () => {
  it('attaches what the human did to their own message', () => {
    setFlag('a', 'pick', { by: 'human' });
    setFlag('b', 'reject', { by: 'human' });
    setHoveredArtwork('c');

    const turn = parse(withGestures(body([user('something warm')]))).turn as {
      text?: string;
      flagsDelta: { artworkId: string; to: string | null }[];
      hovered: { id: string } | null;
    };

    expect(turn.text).toBe('something warm');
    expect(turn.flagsDelta).toEqual([
      { artworkId: 'a', to: 'pick' },
      { artworkId: 'b', to: 'reject' },
    ]);
    expect(turn.hovered).toEqual({ id: 'c' });
  });

  it('sends an empty gesture set rather than nothing when no flags were laid', () => {
    // The route treats a turn with nothing in it as nothing to say, so this
    // costs no prompt tokens — but the field being present is what tells the
    // page the bar is wired at all.
    const turn = parse(withGestures(body([user('rembrandt')]))).turn as {
      flagsDelta: unknown[];
    };
    expect(turn.flagsDelta).toEqual([]);
  });

  it('leaves a mid-loop request alone, so one turn drains the journal once', () => {
    setFlag('a', 'pick', { by: 'human' });

    const first = parse(withGestures(body([user('warm')])));
    expect((first.turn as { flagsDelta: unknown[] }).flagsDelta).toHaveLength(1);

    // The loop's next request appends the assistant's call and the result.
    const second = withGestures(
      body([user('warm'), { role: 'assistant', tool_calls: [] }, toolResult])
    );
    expect(parse(second).turn).toBeUndefined();
  });

  it('stands aside once the bar sends its own turn', () => {
    setFlag('a', 'pick', { by: 'human' });
    const already = body([user('warm')], { turn: { flagsDelta: [] } });

    expect(withGestures(already)).toBe(already);
  });

  it('forwards anything it cannot read untouched', () => {
    expect(withGestures('not json')).toBe('not json');
    expect(withGestures('[]')).toBe('[]');
    expect(withGestures(body([]))).toBe(body([]));
  });
});

describe('installTurnBridge', () => {
  const stubFetch = () => {
    const spy = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', spy);
    window.fetch = spy;
    return spy;
  };

  const sentBody = (
    spy: ReturnType<typeof stubFetch>,
    call: number
  ): string => String((spy.mock.calls[call]?.[1] as RequestInit)?.body);

  it('rewrites only the agent turn route', async () => {
    const spy = stubFetch();
    const dispose = installTurnBridge();
    setFlag('a', 'pick', { by: 'human' });

    await window.fetch('/api/public-search/nga/search', {
      method: 'POST',
      body: body([user('warm')]),
    });
    expect(parse(sentBody(spy, 0)).turn).toBeUndefined();

    await window.fetch('/api/public-agent/turn', {
      method: 'POST',
      body: body([user('warm')]),
    });
    expect(parse(sentBody(spy, 1)).turn).toBeDefined();

    dispose();
    expect(window.fetch).toBe(spy);
  });

  it('ignores a GET to the same path', async () => {
    const spy = stubFetch();
    const dispose = installTurnBridge();

    await window.fetch('/api/public-agent/turn');
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();

    dispose();
  });
});
