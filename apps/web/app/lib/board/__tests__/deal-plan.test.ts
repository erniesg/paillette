import { describe, expect, it } from 'vitest';
import { planDeal } from '../deal-plan';

const board = (n: number, prefix = 'a') =>
  Array.from({ length: n }, (_, index) => `${prefix}${index + 1}`);

describe('planDeal', () => {
  it('deals a fresh board with everything entering', () => {
    const plan = planDeal({ previous: [], next: board(12), size: 12 });

    expect(plan.order).toEqual(board(12));
    expect(plan.entering).toEqual(board(12));
    expect(plan.held).toEqual([]);
    expect(plan.leaving).toEqual([]);
  });

  it('keeps a preserved id in the exact slot it already occupied', () => {
    // a3 sits in slot 2 before the deal and must still sit in slot 2 after,
    // even though the search ranked it last.
    const plan = planDeal({
      previous: ['a1', 'a2', 'a3', 'a4'],
      next: ['b1', 'b2', 'b3', 'a3'],
      preservedIds: ['a3'],
      size: 4,
    });

    expect(plan.order[2]).toBe('a3');
    expect(plan.order).toEqual(['b1', 'b2', 'a3', 'b3']);
    expect(plan.held).toEqual(['a3']);
  });

  it('keeps several preserved ids in place at once', () => {
    const plan = planDeal({
      previous: board(12),
      next: ['a2', 'a7', ...board(10, 'b')],
      preservedIds: ['a2', 'a7'],
      size: 12,
    });

    expect(plan.order[1]).toBe('a2');
    expect(plan.order[6]).toBe('a7');
    expect(plan.held).toEqual(['a2', 'a7']);
    expect(plan.order).toHaveLength(12);
  });

  it('reports newcomers as entering and departures as leaving', () => {
    const plan = planDeal({
      previous: ['a1', 'a2', 'a3'],
      next: ['a2', 'b1', 'b2'],
      preservedIds: ['a2'],
      size: 3,
    });

    expect(plan.entering).toEqual(['b1', 'b2']);
    expect(plan.leaving).toEqual(['a1', 'a3']);
    // a2 was held, so it is neither entering nor leaving.
    expect(plan.entering).not.toContain('a2');
    expect(plan.leaving).not.toContain('a2');
  });

  it('staggers newcomers in board order, not search order', () => {
    // b2 is ranked after b1 by the search but lands in an earlier slot, so it
    // should arrive first.
    const plan = planDeal({
      previous: ['a1', 'a2', 'a3'],
      next: ['a2', 'b1', 'b2'],
      preservedIds: ['a2'],
      size: 3,
      staggerMs: 15,
    });

    expect(plan.order).toEqual(['b1', 'a2', 'b2']);
    expect(plan.stagger.b1).toBe(0);
    expect(plan.stagger.b2).toBe(15);
    expect(plan.stagger.a2).toBeUndefined();
  });

  it('will not hold an id the deal dropped', () => {
    // The human picked a1, but this deal does not return it. There is nothing
    // to hold, so it leaves like anything else rather than being conjured back.
    const plan = planDeal({
      previous: ['a1', 'a2'],
      next: ['b1', 'b2'],
      preservedIds: ['a1'],
      size: 2,
    });

    expect(plan.held).toEqual([]);
    expect(plan.order).toEqual(['b1', 'b2']);
    expect(plan.leaving).toEqual(['a1', 'a2']);
  });

  it('re-seats a preserved id whose old slot is off the board', () => {
    // a9 was preserved but sat in slot 8 of a board that is now 4 slots wide.
    // It keeps its place on the board but not its position.
    const plan = planDeal({
      previous: board(12),
      next: ['a9', 'b1', 'b2', 'b3'],
      preservedIds: ['a9'],
      size: 4,
    });

    expect(plan.order).toContain('a9');
    expect(plan.order).toHaveLength(4);
    expect(plan.held).toEqual([]);
  });

  it('collects held ids at the front under the reduced-motion placement', () => {
    const plan = planDeal({
      previous: board(12),
      next: ['a4', 'a9', ...board(10, 'b')],
      preservedIds: ['a4', 'a9'],
      size: 12,
      placement: 'front',
    });

    expect(plan.order.slice(0, 2)).toEqual(['a4', 'a9']);
    expect(plan.held).toEqual(['a4', 'a9']);
    expect(plan.order).toHaveLength(12);
  });

  it('never repeats an id, even if the caller does', () => {
    const plan = planDeal({
      previous: ['a1', 'a1', 'a2'],
      next: ['a2', 'a2', 'b1'],
      preservedIds: ['a2'],
      size: 3,
    });

    expect(new Set(plan.order).size).toBe(plan.order.length);
  });

  it('does not overfill the board when the deal returns more than fits', () => {
    const plan = planDeal({
      previous: board(12),
      next: board(40, 'b'),
      size: 12,
    });

    expect(plan.order).toHaveLength(12);
    expect(plan.order).toEqual(board(12, 'b'));
  });

  it('holds every slot when nothing changed', () => {
    const plan = planDeal({
      previous: board(12),
      next: board(12),
      preservedIds: board(12),
      size: 12,
    });

    expect(plan.order).toEqual(board(12));
    expect(plan.entering).toEqual([]);
    expect(plan.leaving).toEqual([]);
    expect(plan.held).toHaveLength(12);
  });

  it('handles an empty deal', () => {
    const plan = planDeal({ previous: board(12), next: [], size: 12 });

    expect(plan.order).toEqual([]);
    expect(plan.leaving).toEqual(board(12));
  });
});
