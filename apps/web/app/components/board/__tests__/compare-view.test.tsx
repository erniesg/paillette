/**
 * Two-up: the click has to be worth what it cost the human to make.
 *
 * One click must resolve both sides — a pick and a reject — and land in the
 * exemplars, because that is the entire argument for asking with pictures
 * instead of words.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import { CompareView } from '../compare-view';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '~/lib/webmcp/artwork-index';
import { __resetFlagsForTest, getExemplars, getFlag } from '~/lib/webmcp/flags';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setCompare,
} from '~/lib/webmcp/store';
import { __resetTurnStateForTest, prepareTurn } from '~/lib/webmcp/turn';

const artwork = (id: string, title: string): ArtworkSearchResult =>
  ({
    id,
    title,
    artist: 'A. Painter',
    imageUrl: `https://assets.example/${id}.jpg`,
    thumbnailUrl: `https://assets.example/${id}-thumb.jpg`,
    similarity: 0.5,
    metadata: {},
  }) as unknown as ArtworkSearchResult;

const openCompare = (question: string | null = 'Which one?') => {
  rememberArtworks([artwork('a', 'Estuary'), artwork('b', 'Fallen Tree')]);
  setCompare({
    artworkIds: ['a', 'b'],
    question,
    askedBy: 'agent',
    at: 1,
  });
};

beforeEach(() => {
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  __resetArtworkIndexForTest();
  __resetTurnStateForTest();
});

describe('CompareView', () => {
  it('renders nothing until there is a comparison to make', () => {
    const { container } = render(<CompareView />);
    expect(container.firstChild).toBeNull();
  });

  it('shows both works with the question set between them', () => {
    openCompare('Which one belongs above a sofa?');
    render(<CompareView />);

    expect(screen.getByText('Which one belongs above a sofa?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose Estuary' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Choose Fallen Tree' })
    ).toBeTruthy();
  });

  it('asks a plain question when the agent supplied none', () => {
    openCompare(null);
    render(<CompareView />);

    expect(screen.getByText('Which one?')).toBeTruthy();
  });

  it('resolves one click into a pick, a reject, and a closed overlay', async () => {
    openCompare();
    render(<CompareView />);

    await userEvent.click(screen.getByRole('button', { name: 'Choose Estuary' }));

    expect(getFlag('a')).toMatchObject({ flag: 'pick', by: 'human' });
    expect(getFlag('b')).toMatchObject({ flag: 'reject', by: 'human' });
    expect(getExemplars()).toEqual({ positive: ['a'], negative: ['b'] });
    expect(getWebMcpState().compare).toBeNull();
  });

  it('sends the choice on the next turn rather than firing one itself', async () => {
    // Flags never trigger the agent — Enter is the beat — or the board
    // thrashes while someone is still deciding.
    openCompare('Which reads from further away?');
    render(<CompareView />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Choose Fallen Tree' })
    );

    const turn = prepareTurn();
    expect(turn.compareChoice).toEqual({
      kind: 'winner',
      winnerId: 'b',
      loserId: 'a',
      question: 'Which reads from further away?',
    });
    expect(turn.flagsDelta).toHaveLength(2);
  });

  /*
   * The third door. Forcing a choice between two works someone does not want
   * is a lie about taste, and an expensive one: "neither, they're both too
   * busy" names the axis instead of picking a point on it, so it is the
   * strongest answer a two-up can get. It is treated as one.
   */
  it('turns Neither into a line to write on, and sends the reason', async () => {
    openCompare('Which reads from further away?');
    render(<CompareView />);

    await userEvent.click(screen.getByRole('button', { name: /Neither/ }));
    const reason = screen.getByLabelText('Why neither?');
    await userEvent.type(reason, 'they’re both too busy{Enter}');

    expect(getWebMcpState().compare).toBeNull();
    // Both refused, in the human's own ink, with what they said.
    expect(getExemplars()).toEqual({ positive: [], negative: ['a', 'b'] });
    expect(getFlag('a')).toMatchObject({
      flag: 'reject',
      by: 'human',
      provisional: false,
      reason: 'they’re both too busy',
    });

    const turn = prepareTurn();
    expect(turn.compareChoice).toEqual({
      kind: 'neither',
      artworkIds: ['a', 'b'],
      reason: 'they’re both too busy',
      question: 'Which reads from further away?',
    });
    expect(turn.flagsDelta).toHaveLength(2);
  });

  it('accepts a refusal with no reason at all', async () => {
    openCompare();
    render(<CompareView />);

    await userEvent.click(screen.getByRole('button', { name: /Neither/ }));
    await userEvent.keyboard('{Enter}');

    expect(getWebMcpState().compare).toBeNull();
    expect(getExemplars().negative).toEqual(['a', 'b']);
    expect(prepareTurn().compareChoice).toMatchObject({
      kind: 'neither',
      reason: null,
    });
  });

  it('Escape puts the word back rather than answering', async () => {
    openCompare();
    render(<CompareView />);

    await userEvent.click(screen.getByRole('button', { name: /Neither/ }));
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: /Neither/ })).toBeInTheDocument();
    expect(getWebMcpState().compare).not.toBeNull();
    expect(getExemplars()).toEqual({ positive: [], negative: [] });
  });

  it('shows nothing rather than half a question when a work has been evicted', () => {
    setCompare({
      artworkIds: ['a', 'gone'],
      question: 'Which one?',
      askedBy: 'agent',
      at: 1,
    });
    rememberArtworks([artwork('a', 'Estuary')]);

    const { container } = render(<CompareView />);
    expect(container.firstChild).toBeNull();
  });
});
