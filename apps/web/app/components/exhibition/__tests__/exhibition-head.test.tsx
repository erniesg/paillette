/**
 * The theme, edited on the page.
 *
 * The beat this whole surface exists for is step three of the loop: the agent
 * drafts a statement, the human types over it, and the human's words are still
 * there after the agent's next turn. Everything below is that, plus the
 * proposal being one click rather than a negotiation.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import { ExhibitionHead } from '../exhibition-head';
import { WallLabel } from '../wall-label';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '~/lib/webmcp/artwork-index';
import { __resetFlagsForTest, setFlag } from '~/lib/webmcp/flags';
import { writeExhibition } from '~/lib/webmcp/exhibition';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setBoard,
} from '~/lib/webmcp/store';

const artwork = (id: string): ArtworkSearchResult =>
  ({
    id,
    title: `Work ${id}`,
    artist: 'A. Painter',
    imageUrl: `https://assets.example/${id}.jpg`,
    thumbnailUrl: `https://assets.example/${id}-thumb.jpg`,
    similarity: 0.5,
    metadata: {},
  }) as unknown as ArtworkSearchResult;

const board = (ids: string[]) =>
  setBoard({
    order: ids,
    dealt: ids,
    note: null,
    lastChangeBy: 'agent',
    redeals: 1,
    at: 1,
  });

beforeEach(() => {
  __resetArtworkIndexForTest();
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  rememberArtworks(['a', 'b'].map(artwork));
});

describe('the exhibition head', () => {
  it('stays off a plain search', () => {
    board(['a', 'b']);
    render(<ExhibitionHead />);
    expect(screen.queryByLabelText('Exhibition title')).toBeNull();
  });

  it('appears once the human picks something', () => {
    board(['a', 'b']);
    setFlag('a', 'pick', { by: 'human' });
    render(<ExhibitionHead />);
    expect(screen.getByLabelText('Exhibition title')).toBeInTheDocument();
  });

  it('appears once the agent has drafted', () => {
    board(['a', 'b']);
    writeExhibition({ title: 'Weather' }, { by: 'agent' });
    render(<ExhibitionHead />);
    expect(screen.getByLabelText('Exhibition title')).toHaveValue('Weather');
  });

  it('draws the agent’s draft in the agent’s ink and the human’s in theirs', async () => {
    board(['a']);
    writeExhibition({ statement: 'It is about weather.' }, { by: 'agent' });
    render(<ExhibitionHead />);

    const statement = screen.getByLabelText('Exhibition statement');
    expect(statement).toHaveAttribute('data-provenance', 'agent');

    await userEvent.click(statement);
    await userEvent.clear(statement);
    await userEvent.type(statement, 'It is about leaving.');
    await userEvent.tab();

    expect(
      screen.getByLabelText('Exhibition statement')
    ).toHaveAttribute('data-provenance', 'human');
  });

  it('keeps the human’s words when the agent writes over them', async () => {
    board(['a']);
    setFlag('a', 'pick', { by: 'human' });
    render(<ExhibitionHead />);

    const statement = screen.getByLabelText('Exhibition statement');
    await userEvent.click(statement);
    await userEvent.type(statement, 'It is about leaving.');
    await userEvent.tab();

    act(() => {
      writeExhibition(
        { statement: 'A survey of coastal weather.' },
        { by: 'agent' }
      );
    });

    expect(screen.getByLabelText('Exhibition statement')).toHaveValue(
      'It is about leaving.'
    );
    // The agent's wording is on screen as an unaccepted proposal, not on the wall.
    expect(
      screen.getByRole('button', {
        name: /Use the agent’s exhibition statement/,
      })
    ).toHaveTextContent('A survey of coastal weather.');
  });

  it('takes the agent’s wording on one click', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'human' });
    writeExhibition({ title: 'Departures' }, { by: 'agent' });
    render(<ExhibitionHead />);

    await userEvent.click(
      screen.getByRole('button', { name: /Use the agent’s exhibition title/ })
    );

    expect(screen.getByLabelText('Exhibition title')).toHaveValue('Departures');
    expect(getWebMcpState().exhibition.title.current?.by).toBe('agent');
    expect(getWebMcpState().exhibition.title.current?.heldByHuman).toBe(true);
  });

  it('discards the agent’s wording on the other click', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'human' });
    writeExhibition({ title: 'Departures' }, { by: 'agent' });
    render(<ExhibitionHead />);

    await userEvent.click(
      screen.getByRole('button', { name: /Discard the agent’s exhibition title/ })
    );

    expect(screen.getByLabelText('Exhibition title')).toHaveValue('Leaving');
    expect(screen.queryByRole('button', { name: /Use the agent’s/ })).toBeNull();
  });

  it('Escape restores what was there', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ExhibitionHead />);

    const title = screen.getByLabelText('Exhibition title');
    await userEvent.click(title);
    await userEvent.clear(title);
    await userEvent.type(title, 'Something else{Escape}');

    expect(screen.getByLabelText('Exhibition title')).toHaveValue('Leaving');
    expect(getWebMcpState().exhibition.title.current?.by).toBe('agent');
  });

  it('counts the hang without narrating it', () => {
    board(['a', 'b']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ExhibitionHead />);
    expect(screen.getByText('2 works')).toBeInTheDocument();
  });
});

describe('the wall label', () => {
  it('is absent until someone writes one', () => {
    render(<WallLabel artworkId="a" title="Work a" />);
    expect(screen.queryByLabelText(/Wall label/)).toBeNull();
  });

  it('is editable in place and becomes the human’s', async () => {
    writeExhibition(
      { works: [{ artworkId: 'a', label: 'The agent’s reading.' }] },
      { by: 'agent' }
    );
    render(<WallLabel artworkId="a" title="Work a" />);

    const label = screen.getByLabelText('Wall label for Work a');
    expect(label).toHaveAttribute('data-provenance', 'agent');

    await userEvent.click(label);
    await userEvent.clear(label);
    await userEvent.type(label, 'Mine.');
    await userEvent.tab();

    expect(getWebMcpState().exhibition.labels.a?.current).toMatchObject({
      value: 'Mine.',
      by: 'human',
      heldByHuman: true,
    });
  });

  it('keeps the culling keys out of a sentence being typed', async () => {
    let sawKey = false;
    writeExhibition({ works: [{ artworkId: 'a', label: 'x' }] }, { by: 'agent' });
    render(
      <div onKeyDown={() => { sawKey = true; }}>
        <WallLabel artworkId="a" title="Work a" />
      </div>
    );

    await userEvent.click(screen.getByLabelText('Wall label for Work a'));
    await userEvent.keyboard('pxu');
    expect(sawKey).toBe(false);
  });
});
