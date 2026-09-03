/**
 * The flag store, and the one property everything else depends on: an agent
 * cannot move the human's exemplars.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetFlagsForTest,
  drainFlagChanges,
  getExemplars,
  getFlag,
  getPinnedIds,
  listFlags,
  partitionFlags,
  peekFlagChanges,
  setFlag,
  toggleFlag,
} from '../flags';
import { __resetWebMcpStateForTest, getWebMcpState } from '../store';

beforeEach(() => {
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
});

describe('flags', () => {
  it('records a human pick and mirrors it onto the shared store', () => {
    setFlag('a', 'pick', { by: 'human' });

    expect(getFlag('a')).toMatchObject({
      artworkId: 'a',
      flag: 'pick',
      by: 'human',
      provisional: false,
    });
    expect(getWebMcpState().flags).toHaveLength(1);
  });

  it('ignores a blank id rather than storing an unreachable flag', () => {
    expect(setFlag('   ', 'pick', { by: 'human' })).toBeNull();
    expect(listFlags()).toHaveLength(0);
  });

  it('toggles off when the same key is pressed twice, as Lightroom does', () => {
    toggleFlag('a', 'pick', { by: 'human' });
    toggleFlag('a', 'pick', { by: 'human' });

    expect(getFlag('a')).toBeNull();
  });

  it('flips straight from reject to pick without needing a clear first', () => {
    toggleFlag('a', 'reject', { by: 'human' });
    toggleFlag('a', 'pick', { by: 'human' });

    expect(getFlag('a')?.flag).toBe('pick');
  });

  it('clearing something unflagged is a no-op, not an event', () => {
    expect(setFlag('a', 'clear', { by: 'human' })).toBeNull();
    expect(peekFlagChanges()).toHaveLength(0);
  });

  describe('an agent flag is a proposal, not a decision', () => {
    it('lands provisional and carries its reason', () => {
      setFlag('a', 'pick', { by: 'agent', reason: 'the only wide horizon' });

      expect(getFlag('a')).toMatchObject({
        by: 'agent',
        provisional: true,
        reason: 'the only wide horizon',
      });
    });

    it('is excluded from the exemplars the redeal runs on', () => {
      setFlag('human-pick', 'pick', { by: 'human' });
      setFlag('agent-pick', 'pick', { by: 'agent', reason: 'proposed' });
      setFlag('agent-reject', 'reject', { by: 'agent', reason: 'proposed' });

      expect(getExemplars()).toEqual({
        positive: ['human-pick'],
        negative: [],
      });
    });

    it('cannot overwrite a human judgement into its own', () => {
      setFlag('a', 'pick', { by: 'human' });
      setFlag('a', 'reject', { by: 'agent', reason: 'I disagree' });

      // The agent may disagree, but the disagreement is provisional and so it
      // drops out of the exemplars entirely rather than flipping them.
      expect(getFlag('a')?.provisional).toBe(true);
      expect(getExemplars().positive).toEqual([]);
      expect(getExemplars().negative).toEqual([]);
    });

    it('is promoted when the human presses the same key on it', () => {
      setFlag('a', 'pick', { by: 'agent', reason: 'proposed' });
      expect(getPinnedIds()).toEqual([]);

      toggleFlag('a', 'pick', { by: 'human' });

      expect(getFlag('a')).toMatchObject({ by: 'human', provisional: false });
      expect(getPinnedIds()).toEqual(['a']);
    });
  });

  describe('the journal', () => {
    it('records what changed, including what it changed from', () => {
      setFlag('a', 'pick', { by: 'human' });
      setFlag('a', 'reject', { by: 'human' });

      expect(peekFlagChanges()).toMatchObject([
        { artworkId: 'a', from: null, to: 'pick' },
        { artworkId: 'a', from: 'pick', to: 'reject' },
      ]);
    });

    it('reports a clear as a change to null', () => {
      setFlag('a', 'pick', { by: 'human' });
      setFlag('a', 'clear', { by: 'human' });

      expect(peekFlagChanges().at(-1)).toMatchObject({
        from: 'pick',
        to: null,
      });
    });

    it('drains, so a gesture is never reported to the agent twice', () => {
      setFlag('a', 'pick', { by: 'human' });

      expect(drainFlagChanges()).toHaveLength(1);
      expect(drainFlagChanges()).toHaveLength(0);
    });

    it('leaves the flags themselves alone when drained', () => {
      setFlag('a', 'pick', { by: 'human' });
      drainFlagChanges();

      expect(getPinnedIds()).toEqual(['a']);
    });
  });

  it('splits the works still hung from the pile already considered', () => {
    setFlag('on-board', 'pick', { by: 'human' });
    setFlag('filed', 'reject', { by: 'human' });

    const { hung, filed } = partitionFlags(['on-board', 'unflagged']);

    expect(hung.map((flag) => flag.artworkId)).toEqual(['on-board']);
    expect(filed.map((flag) => flag.artworkId)).toEqual(['filed']);
  });
});
