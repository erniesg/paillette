/**
 * The check that stops a turn ending with one hand on the board.
 *
 * Written against the census, not against a transcript: what matters is that
 * the turn is refused when the model has run neither `flag_artworks` nor
 * `compare_artworks`, and let through the instant it has run either.
 */

import { describe, expect, it } from 'vitest';
import {
  findUnmarkedBoard,
  type BoardMarkState,
} from '../unmarked-board';

const nothing = new Set<string>();

const board = (overrides: Partial<BoardMarkState> = {}): BoardMarkState => ({
  humanGestured: true,
  board: [
    { artworkId: 'a', title: 'A Storm at Sea', artist: 'Turner', flag: 'pick' },
    { artworkId: 'b', title: 'Evening', artist: 'Inness', flag: null },
    { artworkId: 'c', title: 'The Window', artist: 'Hopper', flag: null },
  ],
  ...overrides,
});

describe('findUnmarkedBoard', () => {
  it('puts the turn back to work when it answered gestures with only words', () => {
    const nudge = findUnmarkedBoard(board(), nothing);

    expect(nudge).toContain('flag_artworks');
    expect(nudge).toContain('compare_artworks');
  });

  it('names the unmarked ids so the model need not search again', () => {
    const nudge = findUnmarkedBoard(board(), nothing);

    expect(nudge).toContain('b: Evening — Inness');
    expect(nudge).toContain('c: The Window — Hopper');
    // Proposing a pick on something they already picked is agreeing loudly.
    expect(nudge).not.toContain('A Storm at Sea');
  });

  it('says the note stays', () => {
    // Iteration 4 hit the opposite failure: six flags landed and the note came
    // back null. A board of dashed marks with no wall label is the same defect
    // the other way round.
    expect(findUnmarkedBoard(board(), nothing)).toContain(
      'in addition to the sentence'
    );
  });

  it('is satisfied by a flag', () => {
    expect(findUnmarkedBoard(board(), new Set(['flag_artworks']))).toBeNull();
  });

  it('is satisfied by a two-up', () => {
    expect(findUnmarkedBoard(board(), new Set(['compare_artworks']))).toBeNull();
  });

  it('is not satisfied by having searched and redealt', () => {
    // The exact shape of every one of the 508 tool calls that had never
    // produced a proposal.
    expect(
      findUnmarkedBoard(
        board(),
        new Set(['get_view_context', 'search_artworks', 'redeal'])
      )
    ).toContain('flag_artworks');
  });

  it('asks nothing of a turn that was only words', () => {
    // Someone who typed a plain query is asking for pictures. A dashed mark on
    // a board they have not touched is the agent talking over them.
    expect(findUnmarkedBoard(board({ humanGestured: false }), nothing)).toBeNull();
  });

  it('asks nothing when every work on the board is already marked', () => {
    expect(
      findUnmarkedBoard(
        board({
          board: [
            { artworkId: 'a', title: 'A', artist: null, flag: 'pick' },
            { artworkId: 'b', title: 'B', artist: null, flag: 'reject' },
          ],
        }),
        nothing
      )
    ).toBeNull();
  });

  it('does not offer a two-up when there is only one work left to point at', () => {
    const nudge = findUnmarkedBoard(
      board({
        board: [
          { artworkId: 'a', title: 'A', artist: null, flag: 'pick' },
          { artworkId: 'b', title: 'B', artist: null, flag: null },
        ],
      }),
      nothing
    );

    expect(nudge).toContain('flag_artworks');
    expect(nudge).not.toContain('compare_artworks');
  });

  it('names at most a readable handful', () => {
    const nudge = findUnmarkedBoard(
      board({
        board: Array.from({ length: 12 }, (_, index) => ({
          artworkId: `w${index}`,
          title: `Work ${index}`,
          artist: null,
          flag: null,
        })),
      }),
      nothing
    );

    expect(nudge).toContain('w7: Work 7');
    expect(nudge).not.toContain('w8: Work 8');
  });
});
