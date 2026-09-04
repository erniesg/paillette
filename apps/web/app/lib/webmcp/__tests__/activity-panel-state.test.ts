/**
 * Whether the log stays where the human put it.
 *
 * This file used to assert the opposite of what it asserts now, and the change
 * is deliberate. The panel was a fixed overlay across the lower-left of the
 * board — which is where the picks sit — and every tool call reopened it. A
 * turn is five or six tool calls, so closing it lasted about 300ms: on camera,
 * the list of calls that produced the board sat on top of the board. The first
 * fix was to remember the dismissal. The real fix is that a tool call should
 * never have opened a panel in the first place, because there is now a glyph
 * saying the same thing in five characters.
 *
 * State assertions rather than rendering ones, because the behaviour lives in
 * the store either way and the component has its own suite.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setPanelOpen,
  startActivity,
  settleActivity,
  requestConfirmation,
} from '../store';

beforeEach(() => __resetWebMcpStateForTest());

describe('the tool-call log', () => {
  it('stays collapsed when the agent works', () => {
    expect(getWebMcpState().panelOpen).toBe(false);

    // A whole turn.
    startActivity('get_view_context', {});
    startActivity('search_artworks', { query: 'storm' });
    startActivity('search_by_exemplars', { positiveIds: ['a'] });
    startActivity('set_results', { artworkIds: ['a', 'b'] });

    expect(getWebMcpState().panelOpen).toBe(false);
  });

  it('opens and closes only when asked', () => {
    setPanelOpen(true);
    expect(getWebMcpState().panelOpen).toBe(true);

    startActivity('redeal', { keep: 'picks' });
    expect(getWebMcpState().panelOpen).toBe(true);

    setPanelOpen(false);
    expect(getWebMcpState().panelOpen).toBe(false);
  });

  it('still opens for a question the human has to answer', async () => {
    setPanelOpen(false);

    const pending = requestConfirmation({
      toolName: 'create_collection',
      title: 'Storm-lit seascapes',
      detail: '2 works',
    });
    await Promise.resolve();

    expect(getWebMcpState().panelOpen).toBe(true);
    getWebMcpState().pendingConfirmations[0]!.resolve(false);
    await pending;
  });

  it('keeps its history while collapsed', () => {
    const id = startActivity('search_artworks', { query: 'storm' });
    settleActivity(id, 'ok', '12 results', { detail: '{"count":12}' });

    setPanelOpen(true);
    setPanelOpen(false);
    setPanelOpen(true);

    const [entry] = getWebMcpState().activity;
    expect(entry?.summary).toBe('12 results');
    expect(entry?.detail).toBe('{"count":12}');
  });

  it('records a failure in the words the tool used', () => {
    const id = startActivity('flag_artworks', { flags: [] });
    settleActivity(id, 'ok', 'UNKNOWN_ARTWORK: no such work on this board', {
      error: 'UNKNOWN_ARTWORK: no such work on this board',
    });

    expect(getWebMcpState().activity[0]?.error).toBe(
      'UNKNOWN_ARTWORK: no such work on this board'
    );
  });
});
