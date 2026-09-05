/**
 * The rooms that were only ever described.
 *
 * Every case below was written against behaviour measured on staging rather
 * than imagined. Three typed runs asking for two rooms: two called
 * `annotate_atlas` of their own accord, and the third published twelve works
 * under the title "The Working Harbour / The Empty Shore", with a statement
 * opening "This exhibition is divided into two rooms", and `regions: []`.
 *
 * The phrasings in `asksForRooms` come from a boundary probe over thirty-one
 * sentences, not from reading the regex — which is how the inflection miss and
 * the "by the shore" false positive were both found.
 */

import { describe, expect, it } from 'vitest';

import {
  asksForRooms,
  findUnnamedRooms,
  type RoomsState,
} from '../unnamed-rooms';

const work = (id: string) => ({ artworkId: id, title: `Work ${id}`, artist: 'A' });

const state = (over: Partial<RoomsState> = {}): RoomsState => ({
  said: 'Split these into two rooms: the working harbour and the empty shore.',
  regions: [],
  hung: ['a', 'b', 'c', 'd', 'e', 'f'].map(work),
  ...over,
});

const none = new Set<string>();

describe('asksForRooms', () => {
  it.each([
    'Split these into two rooms: the working harbour and the empty shore.',
    'Divide the show into groups.',
    'Group them by subject.',
    'Break it into sections.',
    'Hang these as two rooms.',
    'Can you separate the harbours from the shores into two groups?',
    'I want three groups here.',
    // Inflections. Bare stems missed this one, which a boundary probe over
    // thirty-one phrasings caught and reading the regex did not.
    'I want these separated into halves.',
    'Try splitting these into two rooms.',
    'These should be grouped by subject.',
    'Cluster them by mood.',
    'Put them in two groups please.',
    'Make this two rooms.',
  ])('hears a division in %j', (said) => {
    expect(asksForRooms(said)).toBe(true);
  });

  /*
   * The false positive that matters. "Build me a room about storms at sea" is
   * the commonest sentence typed at this page, it is a whole show and not a
   * division, and a check that fires on it would interrupt every ordinary turn.
   */
  it.each([
    'Build me a room about storms at sea.',
    'A room about leaving.',
    'Find me some seascapes.',
    'Something warm for above the sofa.',
    'Write me a title and a statement.',
    'Show me more like this one.',
    'Warmer.',
    'Rembrandt etchings from the 1640s.',
    'Give this room a better name.',
    // A dividing verb that divides nothing on this page.
    'Separate the wheat from the chaff.',
    'Can you break down what these have in common?',
    'Sort these by date.',
    'A group portrait.',
    // "by" is a grouping preposition after "group" and a preposition of place
    // after almost anything else; matching stems made both of these fire once.
    'Breaking waves by the shore.',
    'A groundbreaking painting by Turner.',
    'A broken column by a ruined temple.',
    // The two sentences `e2e-correction.mjs` types, so the §5c rate below is a
    // measurement of §5c and not of this check.
    'Build me a room about storms at sea — pick a dozen works, and write me a title and a statement for it.',
    'It is not about weather. It is about leaving — the hour before someone goes, and the room that keeps their shape after they have gone.',
    null,
    '',
  ])('hears no division in %j', (said) => {
    expect(asksForRooms(said)).toBe(false);
  });
});

describe('findUnnamedRooms', () => {
  it('puts a turn back to work when the show was to be divided and is not', () => {
    const nudge = findUnnamedRooms(state(), none);
    expect(nudge?.message).toContain('annotate_atlas');
  });

  it('names the works so the model need not search again', () => {
    const nudge = findUnnamedRooms(state(), none);
    expect(nudge?.message).toContain('Work a');
    expect(nudge?.message).toContain('f:');
  });

  /*
   * The page may not choose the grouping. If this ever fails, the check has
   * started composing the thing it exists to ask for, and the claim it was
   * written to support would be faked rather than proved.
   */
  it('chooses no group, no name and no membership', () => {
    const nudge = findUnnamedRooms(state(), none);
    expect(nudge?.message).toContain('The groups are yours to choose');
    expect(nudge?.message).not.toContain('working harbour');
    expect(nudge?.message).not.toContain('empty shore');
  });

  it('asks nothing of a turn that was never about dividing anything', () => {
    expect(findUnnamedRooms(state({ said: 'Build me a room about storms' }), none))
      .toBeNull();
  });

  /*
   * Satisfied by regions on the board, not by the tool having been called —
   * the lesson `unmarked-board` learned from a flag that was dealt away.
   */
  it('lets the turn end once the groups are actually on the board', () => {
    const named = state({
      regions: [
        { label: 'The Working Harbour', artworkIds: ['a', 'b', 'c'] },
        { label: 'The Empty Shore', artworkIds: ['d', 'e', 'f'] },
      ],
    });
    expect(findUnnamedRooms(named, none)).toBeNull();
  });

  it('is satisfied by regions the human grouped themselves', () => {
    const theirs = state({
      regions: [{ label: 'Mine', artworkIds: ['a', 'b'] }],
    });
    expect(findUnnamedRooms(theirs, none)).toBeNull();
  });

  it('does not ask for two rooms out of three pictures', () => {
    expect(findUnnamedRooms(state({ hung: [work('a'), work('b')] }), none)).toBeNull();
  });

  it('asks once for the same works and not twice', () => {
    const first = findUnnamedRooms(state(), none);
    expect(first).not.toBeNull();
    expect(findUnnamedRooms(state(), new Set([first!.key]))).toBeNull();
  });

  it('treats a different set of works as a different job', () => {
    const first = findUnnamedRooms(state(), none);
    const later = state({ hung: ['a', 'b', 'c', 'd', 'e', 'z'].map(work) });
    expect(findUnnamedRooms(later, new Set([first!.key]))).not.toBeNull();
  });

  it('keys on which works, not on the order they are reported in', () => {
    const first = findUnnamedRooms(state(), none);
    const reordered = state({ hung: ['f', 'e', 'd', 'c', 'b', 'a'].map(work) });
    expect(findUnnamedRooms(reordered, new Set([first!.key]))).toBeNull();
  });
});
