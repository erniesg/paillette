/**
 * Lightroom's keys, and the one binding the submission rests on: Enter on an
 * empty prompt bar redeals, with no model call in the path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '../artwork-index';
import {
  handleBoardKey,
  isEmptyUtteranceBar,
  resolveComparePair,
} from '../board-keyboard';
import { __resetFlagsForTest, getFlag, setFlag } from '../flags';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setHoveredArtwork,
  setSelection,
} from '../store';
import { __resetTurnStateForTest } from '../turn';

const artwork = (id: string): ArtworkSearchResult =>
  ({ id, title: `Work ${id}`, artist: 'A Painter', similarity: 0.5 }) as unknown as ArtworkSearchResult;

let fetched: string[] = [];

const press = (key: string, target?: EventTarget) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return { event, handled: handleBoardKey(event) };
};

/** The prompt bar, identified the way the real one is: by accessible name. */
const utteranceBar = (value = '') => {
  const input = document.createElement('input');
  input.setAttribute('aria-label', 'Ask the agent');
  input.value = value;
  document.body.appendChild(input);
  return input;
};

beforeEach(() => {
  fetched = [];
  document.body.innerHTML = '';
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  __resetArtworkIndexForTest();
  __resetTurnStateForTest();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return Response.json({
        success: true,
        data: { results: [], count: 0, queryTime: 1 },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P / X / U on the card under the cursor', () => {
  beforeEach(() => {
    rememberArtworks([artwork('a')]);
    setHoveredArtwork('a');
  });

  it('picks with P', () => {
    expect(press('p').handled).toBe(true);
    expect(getFlag('a')).toMatchObject({ flag: 'pick', by: 'human' });
  });

  it('rejects with X', () => {
    press('x');
    expect(getFlag('a')?.flag).toBe('reject');
  });

  it('clears with U', () => {
    press('p');
    press('u');
    expect(getFlag('a')).toBeNull();
  });

  it('accepts the shifted key too, so caps lock is not a trap', () => {
    press('P');
    expect(getFlag('a')?.flag).toBe('pick');
  });

  it('does nothing when nothing is under the cursor', () => {
    setHoveredArtwork(null);
    expect(press('p').handled).toBe(false);
  });

  it('stays out of the way while someone is typing', () => {
    const input = utteranceBar('a picture of a pier');
    input.focus();

    expect(press('p', input).handled).toBe(false);
    expect(getFlag('a')).toBeNull();
  });

  it('ignores a browser shortcut that happens to share the letter', () => {
    const { handled } = (() => {
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        metaKey: true,
        cancelable: true,
      });
      return { handled: handleBoardKey(event) };
    })();

    expect(handled).toBe(false);
    expect(getFlag('a')).toBeNull();
  });
});

describe('Enter on an empty prompt bar', () => {
  it('recognises the bar by its accessible name', () => {
    expect(isEmptyUtteranceBar(utteranceBar(''))).toBe(true);
    expect(isEmptyUtteranceBar(utteranceBar('warm'))).toBe(false);
    expect(isEmptyUtteranceBar(utteranceBar('   '))).toBe(true);
    expect(isEmptyUtteranceBar(document.createElement('input'))).toBe(false);
  });

  it('honours an explicit data-utterance-bar opt-in as well', () => {
    const input = document.createElement('input');
    input.setAttribute('data-utterance-bar', '');
    expect(isEmptyUtteranceBar(input)).toBe(true);
  });

  it('redeals through the exemplar route and never the agent route', async () => {
    rememberArtworks([artwork('keep')]);
    setFlag('keep', 'pick', { by: 'human' });
    const bar = utteranceBar('');
    bar.focus();

    const { event, handled } = press('Enter', bar);
    expect(handled).toBe(true);
    // Claimed, so the prompt bar's form never submits.
    expect(event.defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(fetched).not.toHaveLength(0));
    expect(fetched.some((url) => url.includes('/exemplars'))).toBe(true);
    expect(fetched.some((url) => url.includes('public-agent'))).toBe(false);
  });

  it('leaves a bar with words in it alone, so the agent still gets the turn', () => {
    const bar = utteranceBar('something warmer');
    bar.focus();

    const { event, handled } = press('Enter', bar);

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(fetched).toHaveLength(0);
  });

  it('ignores Enter pressed anywhere that is not the prompt bar', () => {
    expect(press('Enter', document.createElement('input')).handled).toBe(false);
  });
});

describe('C opens a two-up', () => {
  beforeEach(() => rememberArtworks(['a', 'b', 'c'].map(artwork)));

  it('compares two selected works when the human said which', () => {
    setSelection(['a', 'b']);
    setHoveredArtwork('c');

    expect(resolveComparePair()).toEqual(['a', 'b']);
    press('c');
    expect(getWebMcpState().compare).toMatchObject({
      artworkIds: ['a', 'b'],
      askedBy: 'human',
    });
  });

  it('otherwise weighs the hovered work against one already kept', () => {
    setFlag('a', 'pick', { by: 'human' });
    setHoveredArtwork('c');

    expect(resolveComparePair()).toEqual(['a', 'c']);
  });

  it('does not count the agent’s provisional pick as something kept', () => {
    setFlag('a', 'pick', { by: 'agent', reason: 'proposed' });
    setHoveredArtwork('c');

    expect(resolveComparePair()).toBeNull();
  });

  it('does nothing when there is nothing to weigh against', () => {
    setHoveredArtwork('c');
    expect(press('c').handled).toBe(false);
  });
});
