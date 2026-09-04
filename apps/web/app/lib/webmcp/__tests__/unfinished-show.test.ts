import { describe, expect, it } from 'vitest';
import { findShowGap, type ShowState } from '../unfinished-show';

const none = new Set<string>();

const show = (overrides: Partial<ShowState> = {}): ShowState => ({
  statement: 'Sixty-eight words about weather at sea.',
  title: 'Sea Change',
  titleBy: 'agent',
  titleHeldByHuman: false,
  hung: [
    { artworkId: 'a', label: 'A label.' },
    { artworkId: 'b', label: 'Another label.' },
  ],
  statementCorrected: false,
  ...overrides,
});

describe('findShowGap — labels', () => {
  it('asks for labels when a statement is written and no work carries one', () => {
    const gap = findShowGap(
      show({
        hung: [
          { artworkId: 'a', label: null },
          { artworkId: 'b', label: null },
        ],
      }),
      none
    );

    expect(gap?.gap).toBe('labels');
    expect(gap?.message).toContain('write_labels');
    // The ids go in the message so the model does not have to re-read the board.
    expect(gap?.message).toContain('a, b');
  });

  it('names only the works that are actually missing one', () => {
    const gap = findShowGap(
      show({
        hung: [
          { artworkId: 'a', label: 'Written.' },
          { artworkId: 'b', label: '   ' },
        ],
      }),
      none
    );

    expect(gap?.message).toContain('1 of the 2 works');
    expect(gap?.message).toContain('b');
    expect(gap?.message).not.toContain('a, b');
  });

  it('says nothing when every work is labelled', () => {
    expect(findShowGap(show(), none)).toBeNull();
  });

  it('says nothing before there is a statement to write against', () => {
    // write_labels refuses without one, so nudging for labels here would only
    // spend a turn on a tool call that cannot succeed.
    const gap = findShowGap(
      show({ statement: null, hung: [{ artworkId: 'a', label: null }] }),
      none
    );

    expect(gap).toBeNull();
  });

  it('does not ask twice for the same works', () => {
    const state = show({ hung: [{ artworkId: 'a', label: null }] });
    const first = findShowGap(state, none);

    expect(first?.gap).toBe('labels');
    expect(findShowGap(state, new Set([first!.key]))).toBeNull();
  });

  it('asks again when different works turn up unlabelled', () => {
    // The defect this exists for: a correction turn labels the six works
    // hanging, is satisfied, then drops four and hangs six others — and those
    // six were never labelled, because the gap had already had its go. Four of
    // seven published /e/:code pages carried no wall label at all.
    const labelled = show({ hung: [{ artworkId: 'a', label: null }] });
    const asked = new Set([findShowGap(labelled, none)!.key]);

    const afterTheSwap = findShowGap(
      show({
        hung: [
          { artworkId: 'a', label: 'Written against the new statement.' },
          { artworkId: 'x', label: null },
          { artworkId: 'y', label: null },
        ],
      }),
      asked
    );

    expect(afterTheSwap?.gap).toBe('labels');
    expect(afterTheSwap?.message).toContain('x, y');
  });

  it('keys on which works, not on what order the hang reports them', () => {
    const one = findShowGap(
      show({
        hung: [
          { artworkId: 'b', label: null },
          { artworkId: 'a', label: null },
        ],
      }),
      none
    );
    const other = findShowGap(
      show({
        hung: [
          { artworkId: 'a', label: null },
          { artworkId: 'b', label: null },
        ],
      }),
      none
    );

    expect(one?.key).toBe(other?.key);
  });
});

describe('findShowGap — title', () => {
  const corrected = (overrides: Partial<ShowState> = {}) =>
    show({ statementCorrected: true, ...overrides });

  it('asks for a new title after the human rewrites the statement', () => {
    const gap = findShowGap(corrected(), none);

    expect(gap?.gap).toBe('title');
    expect(gap?.message).toContain('Sea Change');
    expect(gap?.message).toContain('set_exhibition');
  });

  it('leaves a title the human holds alone', () => {
    // §5c: a field the human has edited is theirs. A set_exhibition write onto
    // it would be parked as a proposal anyway; asking for one is noise.
    expect(
      findShowGap(corrected({ titleHeldByHuman: true, titleBy: 'human' }), none)
    ).toBeNull();
  });

  it('stays quiet when no correction happened', () => {
    expect(findShowGap(show({ statementCorrected: false }), none)).toBeNull();
  });

  it('does not ask twice for the same title', () => {
    const first = findShowGap(corrected(), none);

    expect(first?.gap).toBe('title');
    expect(findShowGap(corrected(), new Set([first!.key]))).toBeNull();
  });

  it('takes the labels first — the wall before the name over the door', () => {
    const gap = findShowGap(
      corrected({ hung: [{ artworkId: 'a', label: null }] }),
      none
    );

    expect(gap?.gap).toBe('labels');
  });
});
