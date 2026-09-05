/**
 * §9's first clause, the half that was failing: flags persist per session.
 *
 * Measured on staging before this existed — three flags before a reload, zero
 * after, `get_view_context` reporting no picks and no rejects. The tests here
 * are the unit-level half; `scripts/demo/section-9.mjs` presses the keys and
 * reloads a real page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __FLAG_STORAGE_KEY_FOR_TEST as KEY,
  clearStoredFlags,
  loadFlags,
  saveFlags,
} from '../flag-storage';
import { __resetArtworkIndexForTest, recallArtwork, rememberArtworks } from '../artwork-index';
import {
  __resetFlagsForTest,
  drainFlagChanges,
  getExemplars,
  hydrateFlags,
  listFlags,
  peekFlagChanges,
  setFlag,
} from '../flags';
import { __resetWebMcpStateForTest, getWebMcpState } from '../store';

/** Everything the flag map holds, wiped without touching what is in storage. */
const forgetInMemoryOnly = () => {
  const stored = sessionStorage.getItem(KEY);
  __resetFlagsForTest();
  __resetWebMcpStateForTest();
  if (stored !== null) sessionStorage.setItem(KEY, stored);
};

beforeEach(() => {
  __resetFlagsForTest();
  __resetWebMcpStateForTest();
  __resetArtworkIndexForTest();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('flags across a reload', () => {
  it('restores what was on the board', () => {
    setFlag('nga-1', 'pick', { by: 'human' });
    setFlag('nga-2', 'reject', { by: 'human' });

    forgetInMemoryOnly();
    expect(listFlags()).toHaveLength(0);

    expect(hydrateFlags()).toBe(2);
    expect(getExemplars()).toEqual({
      positive: ['nga-1'],
      negative: ['nga-2'],
    });
    // And the store the page renders from, not only the map.
    expect(getWebMcpState().flags).toHaveLength(2);
  });

  it('keeps whose mark it was, and whether it was provisional', () => {
    setFlag('nga-3', 'reject', { by: 'agent', reason: 'darker' });

    forgetInMemoryOnly();
    hydrateFlags();

    expect(listFlags()[0]).toMatchObject({
      artworkId: 'nga-3',
      flag: 'reject',
      by: 'agent',
      provisional: true,
      reason: 'darker',
    });
    // A provisional mark still steers nothing.
    expect(getExemplars().negative).toEqual([]);
  });

  /**
   * The journal is a delta, not standing state.
   *
   * It is drained into the next agent turn, so restoring it would open the
   * first sentence typed after a reload by telling the agent the human had
   * just flagged everything on the board.
   */
  it('does not restore the journal', () => {
    setFlag('nga-1', 'pick', { by: 'human' });
    setFlag('nga-2', 'reject', { by: 'human' });
    expect(peekFlagChanges()).toHaveLength(2);

    forgetInMemoryOnly();
    hydrateFlags();

    expect(listFlags()).toHaveLength(2);
    expect(peekFlagChanges()).toHaveLength(0);
    expect(drainFlagChanges()).toHaveLength(0);
  });

  /**
   * The half that makes a restored flag worth having.
   *
   * The session index does not survive a reload either, so without this the
   * agent gets a bare id: `get_view_context` renders a flagged work out of that
   * index, and `flag_artworks` refuses ids the page has never loaded. A pick
   * that the model can neither describe nor touch is not really restored.
   */
  it('brings the catalogue record back with the flag', () => {
    rememberArtworks([
      {
        id: 'nga-9',
        title: 'The Resounding Sea',
        artist: 'Thomas Moran',
        similarity: 1,
      },
    ] as unknown as Parameters<typeof rememberArtworks>[0]);
    setFlag('nga-9', 'pick', { by: 'human' });

    forgetInMemoryOnly();
    __resetArtworkIndexForTest();
    expect(recallArtwork('nga-9')).toBeNull();

    hydrateFlags();

    expect(recallArtwork('nga-9')).toMatchObject({
      id: 'nga-9',
      title: 'The Resounding Sea',
      artist: 'Thomas Moran',
    });
  });

  /**
   * The degradation path: the full payload will not fit, the flags alone will.
   *
   * A sparse restored flag is worse than a complete one and enormously better
   * than none, so `saveFlags` drops the catalogue records and tries again.
   */
  it('falls back to the flags alone when the records will not fit', () => {
    rememberArtworks([
      { id: 'nga-9', title: 'The Resounding Sea', similarity: 1 },
    ] as unknown as Parameters<typeof rememberArtworks>[0]);

    const real = Storage.prototype.setItem;
    const attempts: string[] = [];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      attempts.push(value);
      if (value.includes('"works"')) throw new Error('QuotaExceededError');
      real.call(this, key, value);
    });

    setFlag('nga-9', 'pick', { by: 'human' });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toContain('"works"');
    expect(attempts[1]).not.toContain('"works"');

    vi.restoreAllMocks();
    const loaded = loadFlags();
    expect(loaded.records.map((entry) => entry.artworkId)).toEqual(['nga-9']);
    expect(loaded.works).toEqual([]);
  });

  it('does not clobber a flag already set on this page', () => {
    setFlag('nga-1', 'pick', { by: 'human' });
    forgetInMemoryOnly();

    // The human got there first, on the fresh page, before hydration ran.
    setFlag('nga-1', 'reject', { by: 'human' });
    hydrateFlags();

    expect(getExemplars()).toEqual({ positive: [], negative: ['nga-1'] });
  });

  it('forgets everything when the flags are cleared', () => {
    setFlag('nga-1', 'pick', { by: 'human' });
    expect(sessionStorage.getItem(KEY)).not.toBeNull();

    setFlag('nga-1', 'clear', { by: 'human' });

    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(loadFlags().records).toEqual([]);
  });
});

describe('when the session store is hostile', () => {
  it('ignores a payload that is not JSON', () => {
    sessionStorage.setItem(KEY, 'not json {{{');
    expect(loadFlags().records).toEqual([]);
    expect(() => hydrateFlags()).not.toThrow();
  });

  it('ignores a payload from a version it does not know', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 99, records: [{}] }));
    expect(loadFlags().records).toEqual([]);
  });

  /**
   * A tab left open across a deploy is the realistic case: the old page wrote
   * v1, the new one reads it. Ignored rather than misread, which is the entire
   * job of the version.
   */
  it('ignores the shape that shipped before the records travelled with it', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        records: [
          { artworkId: 'old', flag: 'pick', by: 'human', provisional: false, at: 1 },
        ],
      })
    );

    expect(loadFlags().records).toEqual([]);
    expect(hydrateFlags()).toBe(0);
  });

  /** One corrupt row costs that row, not the other eleven. */
  it('drops individual records that are not flags', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        v: 2,
        records: [
          { artworkId: 'good', flag: 'pick', by: 'human', provisional: false, at: 1 },
          { artworkId: '', flag: 'pick', by: 'human', provisional: false, at: 1 },
          { artworkId: 'bad-flag', flag: 'maybe', by: 'human', provisional: false, at: 1 },
          { artworkId: 'bad-by', flag: 'pick', by: 'ghost', provisional: false, at: 1 },
          { artworkId: 'no-at', flag: 'pick', by: 'human', provisional: false },
          'a string',
          null,
        ],
      })
    );

    const loaded = loadFlags().records;
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.artworkId).toBe('good');
  });

  it('survives a storage that throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => setFlag('nga-1', 'pick', { by: 'human' })).not.toThrow();
    // The flag is still correct in memory; it just will not outlive the page.
    expect(getExemplars().positive).toEqual(['nga-1']);
  });

  it('survives a storage that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(loadFlags().records).toEqual([]);
    expect(() => hydrateFlags()).not.toThrow();
  });

  it('does not write an entry for an empty set', () => {
    saveFlags([]);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('clears without complaint when there is nothing to clear', () => {
    expect(() => clearStoredFlags()).not.toThrow();
  });
});
