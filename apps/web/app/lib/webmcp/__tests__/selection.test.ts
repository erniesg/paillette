/**
 * "These" has to resolve, and it has to stay a different thing from "I like
 * these".
 *
 * Pointing is not an opinion: a selection must never reach the exemplar set,
 * or a human gesturing at two works while they think about them would find the
 * board dealing towards both.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { handleBoardKey, resolveComparePair } from '../board-keyboard';
import { __resetFlagsForTest, getExemplars, setFlag } from '../flags';
import {
  clearSelection,
  getSelection,
  isSelected,
  toggleSelection,
} from '../selection';
import {
  __resetWebMcpStateForTest,
  setHoveredArtwork,
  setSelection,
} from '../store';

const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  const handled = handleBoardKey(event);
  return { handled, prevented: event.defaultPrevented };
};

beforeEach(() => {
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
});

describe('selection', () => {
  it('accumulates and removes, in the order they were pointed at', () => {
    expect(toggleSelection('a')).toEqual(['a']);
    expect(toggleSelection('b')).toEqual(['a', 'b']);
    expect(isSelected('a')).toBe(true);

    expect(toggleSelection('a')).toEqual(['b']);
    expect(isSelected('a')).toBe(false);
  });

  it('ignores an empty id rather than selecting nothing', () => {
    expect(toggleSelection('  ')).toEqual([]);
    expect(getSelection()).toEqual([]);
  });

  it('never becomes an exemplar', () => {
    toggleSelection('a');
    toggleSelection('b');
    expect(getExemplars()).toEqual({ positive: [], negative: [] });
  });

  it('hands the caller a copy, so the store cannot be edited from outside', () => {
    toggleSelection('a');
    getSelection().push('b');
    expect(getSelection()).toEqual(['a']);
  });
});

describe('Escape', () => {
  it('drops the selection and leaves every flag alone', () => {
    setFlag('a', 'pick', { by: 'human' });
    toggleSelection('a');

    expect(press('Escape')).toEqual({ handled: true, prevented: true });
    expect(getSelection()).toEqual([]);
    expect(getExemplars().positive).toEqual(['a']);
  });

  it('stays out of the way when nothing is selected, so Esc still closes dialogs', () => {
    expect(press('Escape')).toEqual({ handled: false, prevented: false });
  });

  it('is a no-op when the selection is already empty', () => {
    clearSelection();
    expect(getSelection()).toEqual([]);
  });
});

describe('what C compares', () => {
  it('prefers two explicitly selected works over anything inferred', () => {
    setFlag('pinned', 'pick', { by: 'human' });
    setSelection(['a', 'b']);
    setHoveredArtwork('c');

    expect(resolveComparePair()).toEqual(['a', 'b']);
  });

  it('pairs one selected work with whatever is under the cursor', () => {
    setSelection(['a']);
    setHoveredArtwork('c');

    expect(resolveComparePair()).toEqual(['a', 'c']);
  });
});
