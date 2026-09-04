/**
 * A named grouping only earns a name if the atlas can show it.
 *
 * The condition the brief put on this feature is the one thing worth testing:
 * a label over nothing is worse than no label. So a region with none of its
 * works on screen draws nothing, and the works that *are* in it are drawn
 * together rather than annotated where they happened to land.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import { RegionedAtlas } from '../atlas-regions';
import { setRegions } from '~/lib/webmcp/exhibition';
import { __resetWebMcpStateForTest, getWebMcpState } from '~/lib/webmcp/store';

const artwork = (id: string): ArtworkSearchResult =>
  ({
    id,
    title: `Work ${id}`,
    artist: 'A. Painter',
    imageUrl: null,
    thumbnailUrl: null,
    similarity: 0.5,
    metadata: {},
  }) as unknown as ArtworkSearchResult;

const renderAtlas = (ids: string[]) =>
  render(
    <RegionedAtlas
      results={ids.map(artwork)}
      onSelectArtwork={vi.fn()}
      renderWork={(work) => <span>{work.title}</span>}
    />
  );

beforeEach(() => {
  __resetWebMcpStateForTest();
});

describe('the regioned atlas', () => {
  it('draws nothing when nothing has been named', () => {
    const { container } = renderAtlas(['a', 'b']);
    expect(container.firstChild).toBeNull();
  });

  it('draws each region’s works together, under its name', () => {
    setRegions(
      [
        { label: 'The ones about leaving', artworkIds: ['a', 'b'] },
        { label: 'The ones about arriving', artworkIds: ['c'] },
      ],
      { by: 'agent' }
    );
    renderAtlas(['a', 'b', 'c']);

    const leaving = screen
      .getByRole('button', { name: 'Rename “The ones about leaving”' })
      .closest('section') as HTMLElement;
    expect(within(leaving).getByText('Work a')).toBeInTheDocument();
    expect(within(leaving).getByText('Work b')).toBeInTheDocument();
    expect(within(leaving).queryByText('Work c')).toBeNull();
  });

  it('never draws a name over nothing', () => {
    setRegions(
      [
        { label: 'On screen', artworkIds: ['a'] },
        // Every work in this one has been redealt off the board.
        { label: 'Gone', artworkIds: ['x', 'y'] },
      ],
      { by: 'agent' }
    );
    renderAtlas(['a']);

    expect(screen.getByText('On screen')).toBeInTheDocument();
    expect(screen.queryByText('Gone')).toBeNull();
  });

  it('draws nothing at all when no region has a work on screen', () => {
    setRegions([{ label: 'Gone', artworkIds: ['x'] }], { by: 'agent' });
    const { container } = renderAtlas(['a', 'b']);
    expect(container.firstChild).toBeNull();
  });

  it('keeps unassigned works on the atlas, with no name over them', () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    const { container } = renderAtlas(['a', 'b', 'c']);

    const rest = container.querySelector('[data-unassigned="true"]');
    expect(rest).not.toBeNull();
    expect(within(rest as HTMLElement).getByText('Work b')).toBeInTheDocument();
    expect(within(rest as HTMLElement).getByText('Work c')).toBeInTheDocument();
  });

  it('wears the ink of whoever named it', () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    const { container } = renderAtlas(['a']);
    expect(
      container.querySelector('.paillette-region-head')
    ).toHaveAttribute('data-provenance', 'agent');
  });

  it('renames in place, and renaming makes it the human’s', async () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    const { container } = renderAtlas(['a']);

    await userEvent.click(
      screen.getByRole('button', { name: 'Rename “Leaving”' })
    );
    const field = screen.getByLabelText('Rename “Leaving”');
    await userEvent.clear(field);
    await userEvent.type(field, 'Departures{Enter}');

    expect(getWebMcpState().exhibition.regions[0]).toMatchObject({
      label: 'Departures',
      by: 'human',
    });
    expect(
      container.querySelector('.paillette-region-head')
    ).toHaveAttribute('data-provenance', 'human');
  });

  it('Escape abandons a rename', async () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    renderAtlas(['a']);

    await userEvent.click(
      screen.getByRole('button', { name: 'Rename “Leaving”' })
    );
    await userEvent.type(
      screen.getByLabelText('Rename “Leaving”'),
      'Something else{Escape}'
    );

    expect(getWebMcpState().exhibition.regions[0]?.label).toBe('Leaving');
  });

  it('dissolving leaves the works on the atlas rather than removing them', async () => {
    setRegions([{ label: 'Leaving', artworkIds: ['a'] }], { by: 'agent' });
    const { container } = renderAtlas(['a', 'b']);

    await userEvent.click(
      screen.getByRole('button', { name: 'Dissolve “Leaving”' })
    );

    expect(getWebMcpState().exhibition.regions).toHaveLength(0);
    // With nothing named, the regioned atlas hands the board back to the
    // plain one rather than drawing an unnamed band on its own.
    expect(container.firstChild).toBeNull();
  });
});
