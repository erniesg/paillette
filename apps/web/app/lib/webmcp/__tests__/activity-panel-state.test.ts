/**
 * Whether the agent activity panel stays where the human put it.
 *
 * The panel is a fixed overlay across the lower-left of the board, which is
 * where the picks sit. Every tool call reopened it, and a single turn is five
 * or six tool calls, so closing it lasted until the next one — on camera, the
 * list of calls that produced the board sat on top of the board.
 *
 * These are state assertions rather than rendering ones on purpose: the panel
 * component belongs to someone else, and the behaviour being fixed is in the
 * store either way.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setPanelOpen,
  startActivity,
  requestConfirmation,
} from '../store';

beforeEach(() => __resetWebMcpStateForTest());

describe('the agent activity panel', () => {
  it('opens itself the first time a tool runs', () => {
    expect(getWebMcpState().panelOpen).toBe(false);
    startActivity('search_artworks', { query: 'storm' });
    expect(getWebMcpState().panelOpen).toBe(true);
  });

  it('stays closed for the rest of a turn once the human closes it', () => {
    startActivity('get_view_context', {});
    setPanelOpen(false);

    // The rest of a single agentic turn.
    startActivity('search_artworks', { query: 'storm' });
    startActivity('search_by_exemplars', { positiveIds: ['a'] });
    startActivity('set_results', { artworkIds: ['a', 'b'] });

    expect(getWebMcpState().panelOpen).toBe(false);
  });

  it('reopens on request, and forgets the dismissal', () => {
    startActivity('get_view_context', {});
    setPanelOpen(false);
    setPanelOpen(true);

    startActivity('redeal', { keep: 'picks' });

    expect(getWebMcpState().panelOpen).toBe(true);
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
});
