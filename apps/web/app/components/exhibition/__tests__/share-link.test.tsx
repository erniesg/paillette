/**
 * One control, and the URL it produces.
 *
 * The thing worth checking is that the link is a whole show — prose,
 * provenance and hanging order — and that a work the human rejected is not in
 * it. Sharing a board that still contains something they threw out would be
 * the one bug on this page that a stranger could see and the curator could not.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import { ShareExhibitionLink } from '../share-link';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '~/lib/webmcp/artwork-index';
import { __resetFlagsForTest, setFlag } from '~/lib/webmcp/flags';
import { writeExhibition } from '~/lib/webmcp/exhibition';
import { decodeExhibitionLink } from '~/lib/exhibition-link';
import { __resetWebMcpStateForTest, setBoard } from '~/lib/webmcp/store';

const artwork = (id: string): ArtworkSearchResult =>
  ({
    id,
    title: `Work ${id}`,
    artist: 'A. Painter',
    imageUrl: `https://assets.example/${id}.jpg`,
    thumbnailUrl: null,
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

let copied: string[] = [];

beforeEach(() => {
  copied = [];
  __resetArtworkIndexForTest();
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  rememberArtworks(['a', 'b', 'c'].map(artwork));
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn(async (value: string) => {
        copied.push(value);
      }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/*
 * Copying deflates the payload through a real CompressionStream, so the result
 * lands several ticks after the click resolves rather than on the next
 * microtask. Every assertion here waits on the outcome instead of reading it
 * synchronously: the first version passed alone and lost the race under a
 * loaded suite.
 */
const linkPayload = async () => {
  await waitFor(() => expect(copied).toHaveLength(1));
  const url = new URL(copied[0]!);
  return decodeExhibitionLink(url.searchParams.get('e')!);
};

describe('the link', () => {
  it('is absent when there is nothing hanging', () => {
    render(<ShareExhibitionLink />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('carries the prose, the provenance and the hanging order', async () => {
    board(['a', 'b']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    writeExhibition({ statement: 'It is about leaving.' }, { by: 'human' });
    writeExhibition(
      { works: [{ artworkId: 'a', label: 'The boat is already gone.' }] },
      { by: 'agent' }
    );

    render(<ShareExhibitionLink />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await linkPayload()).toEqual({
      collectionId: 'nga',
      title: 'Leaving',
      titleByAgent: true,
      statement: 'It is about leaving.',
      statementByAgent: false,
      works: [
        {
          artworkId: 'a',
          label: 'The boat is already gone.',
          labelByAgent: true,
        },
        { artworkId: 'b', label: null, labelByAgent: false },
      ],
    });
  });

  it('does not share a work the human rejected', async () => {
    board(['a', 'b', 'c']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    setFlag('b', 'reject', { by: 'human' });

    render(<ShareExhibitionLink />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const payload = await linkPayload();
    expect(payload?.works.map((work) => work.artworkId)).toEqual(['a', 'c']);
  });

  it('says it worked, in the place that caused it', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says so rather than doing nothing when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(
      await screen.findByRole('button', { name: 'Copy failed' })
    ).toBeInTheDocument();
  });
});
