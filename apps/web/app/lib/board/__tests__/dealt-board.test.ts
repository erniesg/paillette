import { describe, expect, it } from 'vitest';
import { resolveDealtBoard } from '../dealt-board';

const works = (...ids: string[]) => ids.map((id) => ({ id }));

describe('resolveDealtBoard', () => {
  it('is null with no board', () => {
    expect(resolveDealtBoard(null, [], works('a'))).toBeNull();
    expect(resolveDealtBoard({ order: [] }, [], works('a'))).toBeNull();
  });

  it('is null when the board is not the works on screen', () => {
    // A fresh text search after a deal has to go back to browsing, or the
    // page folds its chrome away around a masonry.
    expect(
      resolveDealtBoard({ order: ['a', 'b'] }, [], works('a', 'c'))
    ).toBeNull();
    expect(
      resolveDealtBoard({ order: ['a', 'b'] }, [], works('a', 'b', 'c'))
    ).toBeNull();
  });

  it('resolves when the board is exactly these works', () => {
    expect(resolveDealtBoard({ order: ['a', 'b'] }, [], works('a', 'b')))
      .toEqual({ preservedIds: [] });
  });

  it('pins confirmed human picks and nothing else', () => {
    const flags = [
      { artworkId: 'a', flag: 'pick' },
      { artworkId: 'b', flag: 'pick', provisional: true },
      { artworkId: 'c', flag: 'reject' },
    ];

    expect(
      resolveDealtBoard({ order: ['a', 'b', 'c'] }, flags, works('a', 'b', 'c'))
    ).toEqual({ preservedIds: ['a'] });
  });

  it('ignores a pick that is not on the board', () => {
    const flags = [{ artworkId: 'z', flag: 'pick' }];

    expect(
      resolveDealtBoard({ order: ['a', 'b'] }, flags, works('a', 'b'))
    ).toEqual({ preservedIds: [] });
  });
});
