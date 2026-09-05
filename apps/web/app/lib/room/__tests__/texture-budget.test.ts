import { describe, expect, it } from 'vitest';
import {
  BASE_WIDTH,
  MAX_NEAR_TEXTURES,
  NEAR_WIDTH,
  TEXTURE_BUDGET_BYTES,
  TextureBudget,
  nearestIds,
  textureBytes,
} from '~/lib/room/texture-budget';

/** A 4:3 work, the commonest shape in the demo set. */
const at = (width: number) => textureBytes(width, Math.round((width * 3) / 4));

describe('textureBytes', () => {
  it('counts what the GPU takes, not what the JPEG weighs', () => {
    // 384 × 288 × 4 bytes × 4/3 for the mip chain.
    expect(at(BASE_WIDTH)).toBe(589824);
    expect(at(NEAR_WIDTH)).toBe(10240000);
  });

  it('leaves the base tier of a thirty-work show far inside the ceiling', () => {
    expect(at(BASE_WIDTH) * 30).toBeLessThan(TEXTURE_BUDGET_BYTES / 4);
  });

  /**
   * The number the whole module exists for, and it is smaller than the first
   * version of this comment claimed: thirty works at the width the flat page
   * serves is 224 MiB of video memory, not 300. Still more than twice the
   * ceiling, and still enough to lose a tab on a phone.
   */
  it('shows why the flat page width cannot be used on a wall', () => {
    expect(at(1400) * 30).toBeGreaterThan(TEXTURE_BUDGET_BYTES * 2);
    expect(at(1400) * 30).toBeCloseTo(224 * 1024 * 1024, -6);
  });

  /** Both caps satisfied at once, which is the state the scene actually runs in. */
  it('fits every base texture and a full set of near ones inside the ceiling', () => {
    expect(at(BASE_WIDTH) * 30 + at(NEAR_WIDTH) * MAX_NEAR_TEXTURES).toBeLessThan(
      TEXTURE_BUDGET_BYTES
    );
  });
});

describe('TextureBudget', () => {
  it('holds no more high-resolution textures than the cap', () => {
    const budget = new TextureBudget();
    for (let index = 0; index < MAX_NEAR_TEXTURES + 4; index += 1) {
      budget.admit(`w${index}`, 'near', at(NEAR_WIDTH));
    }
    expect(budget.nearCount).toBe(MAX_NEAR_TEXTURES);
    expect(budget.bytes).toBeLessThanOrEqual(TEXTURE_BUDGET_BYTES);
  });

  it('evicts the work the visitor walked away from first', () => {
    const budget = new TextureBudget(TEXTURE_BUDGET_BYTES, 2);
    budget.admit('a', 'near', at(NEAR_WIDTH));
    budget.admit('b', 'near', at(NEAR_WIDTH));
    // Standing in front of `a` again puts `b` at the back of the queue.
    budget.touch('a');
    expect(budget.admit('c', 'near', at(NEAR_WIDTH))).toEqual(['b']);
    expect(budget.has('a', 'near')).toBe(true);
    expect(budget.has('b', 'near')).toBe(false);
  });

  /**
   * The first version of this asserted nothing. It admitted thirty base
   * textures under the full ceiling and then one near texture, which needed no
   * eviction at all — so it passed unchanged after the eviction loop was
   * deliberately altered to consider the base tier. It has to squeeze.
   */
  it('never evicts the small texture that keeps a wall from being blank', () => {
    // A ceiling the base tier alone very nearly fills, so admitting anything
    // more forces the loop to look for something to throw away.
    const budget = new TextureBudget(at(BASE_WIDTH) * 32, 4);
    for (let index = 0; index < 30; index += 1) {
      budget.admit(`w${index}`, 'base', at(BASE_WIDTH));
    }
    budget.admit('a', 'near', at(NEAR_WIDTH));
    const evicted = budget.admit('b', 'near', at(NEAR_WIDTH));

    // Something had to go, and it was the high-resolution one.
    expect(evicted).toEqual(['a']);
    for (let index = 0; index < 30; index += 1) {
      expect(budget.has(`w${index}`, 'base')).toBe(true);
    }
  });

  it('stays under a byte ceiling even when the count would allow more', () => {
    // A ceiling small enough that two high textures will not both fit.
    const budget = new TextureBudget(at(NEAR_WIDTH) * 1.5, 8);
    budget.admit('a', 'near', at(NEAR_WIDTH));
    expect(budget.admit('b', 'near', at(NEAR_WIDTH))).toEqual(['a']);
    expect(budget.bytes).toBeLessThanOrEqual(at(NEAR_WIDTH) * 1.5);
  });

  it('charges an upgrade the difference rather than counting it twice', () => {
    const budget = new TextureBudget();
    budget.admit('a', 'base', at(BASE_WIDTH));
    budget.admit('a', 'near', at(NEAR_WIDTH));
    expect(budget.bytes).toBe(at(NEAR_WIDTH));
    expect(budget.nearCount).toBe(1);
  });

  it('re-admitting the same tier is free and does not evict anything', () => {
    const budget = new TextureBudget(TEXTURE_BUDGET_BYTES, 1);
    budget.admit('a', 'near', at(NEAR_WIDTH));
    expect(budget.admit('a', 'near', at(NEAR_WIDTH))).toEqual([]);
    expect(budget.nearCount).toBe(1);
  });

  it('gives the memory back when a work is released', () => {
    const budget = new TextureBudget();
    budget.admit('a', 'near', at(NEAR_WIDTH));
    budget.release('a');
    expect(budget.bytes).toBe(0);
    expect(budget.snapshot()).toEqual([]);
  });
});

describe('nearestIds', () => {
  const positions = [
    { id: 'far', x: 0, z: -20 },
    { id: 'near', x: 0, z: -1 },
    { id: 'middle', x: 0, z: -5 },
  ];

  it('ranks by how close the visitor is standing', () => {
    expect(nearestIds(positions, { x: 0, z: 0 }, 2)).toEqual(['near', 'middle']);
  });

  it('puts the focused work first however far away it is', () => {
    expect(nearestIds(positions, { x: 0, z: 0 }, 2, 'far')).toEqual(['far', 'near']);
  });
});
