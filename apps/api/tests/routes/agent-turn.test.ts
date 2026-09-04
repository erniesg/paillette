/**
 * The gesture half of a turn, and the rule that goes with it.
 *
 * `describeHumanTurn` is where "a click is a turn even with no text" becomes
 * something a model can act on. It is pure, so it is tested directly rather
 * than through a mocked completion.
 */

import { describe, expect, it } from 'vitest';
import { describeHumanTurn } from '../../src/routes/agent';

describe('describeHumanTurn', () => {
  it('says nothing when nothing was done', () => {
    expect(describeHumanTurn({})).toBeNull();
    expect(describeHumanTurn({ flagsDelta: [], selection: [] })).toBeNull();
  });

  it('names what was picked, using the title rather than the id', () => {
    const described = describeHumanTurn({
      flagsDelta: [
        { artworkId: 'x1', title: 'Lumber Schooners at Evening', to: 'pick' },
      ],
    });

    expect(described).toContain('picked Lumber Schooners at Evening');
    expect(described).not.toContain('x1');
  });

  it('falls back to the id when the page could not resolve a title', () => {
    const described = describeHumanTurn({
      flagsDelta: [{ artworkId: 'x1', to: 'pick' }],
    });

    expect(described).toContain('x1');
  });

  it('separates picks, rejects and clears', () => {
    const described = describeHumanTurn({
      flagsDelta: [
        { artworkId: 'a', title: 'A', to: 'pick' },
        { artworkId: 'b', title: 'B', to: 'reject' },
        { artworkId: 'c', title: 'C', to: null },
      ],
    });

    expect(described).toContain('picked A');
    expect(described).toContain('rejected B');
    expect(described).toContain('unflagged C');
  });

  it('carries a compare click, including the question it answered', () => {
    const described = describeHumanTurn({
      compareChoice: {
        winner: { id: 'a', title: 'A' },
        loser: { id: 'b', title: 'B' },
        question: 'Which one belongs above a sofa?',
      },
    });

    expect(described).toContain('chose A over B');
    expect(described).toContain('Which one belongs above a sofa?');
  });

  it('reports what is selected and what is being pointed at', () => {
    const described = describeHumanTurn({
      selection: [{ id: 'a', title: 'A' }],
      hovered: { id: 'b', title: 'B' },
    });

    expect(described).toContain('selected A');
    expect(described).toContain('pointing at B');
  });

  it('always restates the rule, so the gestures cannot read as background', () => {
    const described = describeHumanTurn({
      flagsDelta: [{ artworkId: 'a', title: 'A', to: 'pick' }],
    });

    expect(described).toContain('follow the gestures');
    expect(described).toContain('These are gestures, not words.');
  });

  it('describes a turn with gestures and no text at all', () => {
    // The whole premise: a click is a turn. Nothing here mentions text.
    const described = describeHumanTurn({
      flagsDelta: [
        { artworkId: 'a', title: 'A', to: 'reject' },
        { artworkId: 'b', title: 'B', to: 'reject' },
      ],
    });

    expect(described).toContain('rejected A; B');
  });
  it('carries a rewritten statement as the brief, not as one gesture among many', () => {
    const described = describeHumanTurn({
      exhibitionEdits: [
        { field: 'statement', value: 'It is not about weather. It is about leaving.' },
      ],
    });

    expect(described).toContain('the exhibition statement now reads');
    expect(described).toContain('It is about leaving.');
    expect(described).toContain('they are now the brief');
    // Naming the tool, and naming it first, is the part that matters. Three
    // by-hand runs against the real model on a softer wording ("re-select the
    // works and rewrite the labels") had two of them re-select and never
    // relabel, leaving every label written against the theme the human had
    // just rejected.
    expect(described).toContain('first tool call now is write_labels');
    expect(described).toContain('before you search, redeal or set_results');
  });

  it('names the work a rewritten label belongs to', () => {
    const described = describeHumanTurn({
      exhibitionEdits: [
        { field: 'label', work: 'Storm at Sea', value: 'Nobody is coming back.' },
      ],
    });

    expect(described).toContain('the label on Storm at Sea now reads');
  });

  it('keeps the correction separate from the gestures', () => {
    const described = describeHumanTurn({
      flagsDelta: [{ artworkId: 'a', title: 'A', to: 'reject' }],
      exhibitionEdits: [{ field: 'statement', value: 'About leaving.' }],
    });

    expect(described).toContain('rejected A');
    expect(described).toContain('These are gestures, not words.');
    // The correction is its own sentence, after the gestures, and carries its
    // own rule.
    expect(described!.indexOf('rewritten the show')).toBeGreaterThan(
      described!.indexOf('These are gestures')
    );
  });

  it('ignores an edit that cleared a field', () => {
    expect(
      describeHumanTurn({ exhibitionEdits: [{ field: 'title', value: '' }] })
    ).toBeNull();
  });
  it('reads a refusal as the strongest answer, not as a non-answer', () => {
    const described = describeHumanTurn({
      compareChoice: {
        neither: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
        ],
        reason: 'they are both too busy',
        question: 'Which reads from further away?',
      },
    });

    expect(described).toContain('refused both A and B');
    expect(described).toContain('they are both too busy');
    expect(described).toContain('stronger signal than either choice');
    expect(described).toContain('both are now rejected');
  });

  it('carries a refusal with no reason', () => {
    const described = describeHumanTurn({
      compareChoice: {
        neither: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
        ],
        reason: null,
      },
    });

    expect(described).toContain('refused both A and B');
    expect(described).not.toContain('saying');
  });
});
