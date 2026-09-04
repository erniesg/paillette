/**
 * The gesture half of a turn, and the rule that goes with it.
 *
 * `describeHumanTurn` is where "a click is a turn even with no text" becomes
 * something a model can act on. It is pure, so it is tested directly rather
 * than through a mocked completion.
 */

import { describe, expect, it } from 'vitest';
import {
  describeHumanTurn,
  agentCallsPerHour,
  MAX_AGENT_MODEL_CALLS_PER_CLIENT_PER_HOUR,
} from '../../src/routes/agent';

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

  it('rewords itself as standing state once the loop has been round', () => {
    const turn = {
      flagsDelta: [
        { artworkId: 'x1', title: 'Environs de Cremieu', to: 'reject' as const },
      ],
    };

    const first = describeHumanTurn(turn);
    const later = describeHumanTurn(turn, { continued: true });

    // Same facts either way — the flags do not change mid-turn, and dropping
    // them is what left the model writing a wall label it could not ground.
    expect(first).toContain('rejected Environs de Cremieu');
    expect(later).toContain('rejected Environs de Cremieu');
    // But five requests deep, "since the last turn" would read as the human
    // having done it all again.
    expect(first).toContain('Since the last turn');
    expect(later).not.toContain('Since the last turn');
    expect(later).toContain('Still standing on the board');
  });

  it('asks for a note grounded in the works, not one that fits any board', () => {
    const described = describeHumanTurn({
      flagsDelta: [{ artworkId: 'x1', title: 'A', to: 'reject' }],
    });

    expect(described).toContain('name what was actually flagged');
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
    expect(described).toContain('First, write_labels over the works already hanging');

    // The other two thirds of §5c step 4, each measured missing on staging
    // under the previous wording:
    //
    //  - the title stayed "Sea Change" under a statement about leaving, so it
    //    is a numbered instruction now rather than a closing aside;
    //  - the board did not move at all — KEPT 6 / RELABELLED 6 — because the
    //    old wording deferred searching to "only if the show is still short",
    //    and a six-work show is never short enough to trigger it.
    expect(described).toContain('Second, set_exhibition with a new title');
    expect(described).toContain('Third, change what is hanging');
    expect(described).toContain('a text edit, not a re-curation');
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

describe('agent hourly ceiling', () => {
  // Filming a demo is not abuse, but it spends the counter the same way. The
  // ceiling is configurable so staging can be raised for a shoot without
  // loosening production, which keeps the original default.
  it('falls back to the built-in default when unset', () => {
    expect(agentCallsPerHour({} as never)).toBe(MAX_AGENT_MODEL_CALLS_PER_CLIENT_PER_HOUR);
  });

  it('honours a configured ceiling', () => {
    expect(agentCallsPerHour({ AGENT_MODEL_CALLS_PER_HOUR: '600' } as never)).toBe(600);
  });

  it('ignores values that are not a usable number', () => {
    for (const bad of ['', 'lots', '0', '-5', 'NaN']) {
      expect(agentCallsPerHour({ AGENT_MODEL_CALLS_PER_HOUR: bad } as never)).toBe(
        MAX_AGENT_MODEL_CALLS_PER_CLIENT_PER_HOUR
      );
    }
  });

  it('floors a fractional ceiling rather than comparing against a fraction', () => {
    expect(agentCallsPerHour({ AGENT_MODEL_CALLS_PER_HOUR: '99.7' } as never)).toBe(99);
  });
});
