/**
 * One control, and the URL it produces.
 *
 * Two things are worth checking. That the link is a whole show — prose,
 * provenance and hanging order — and that a work the human rejected is not in
 * it; sharing a board that still contains something they threw out would be
 * the one bug on this page that a stranger could see and the curator could
 * not. And that every path out of the click *says something*, because the bug
 * this control was rewritten for was silence: the clipboard threw, the button
 * never changed, and the human had no way to tell a copied link from a dead
 * one.
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
import { setRegions, writeExhibition } from '~/lib/webmcp/exhibition';
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

const SHORT_URL = 'https://paillette-stg.berlayar.ai/e/aB3xk9m';

let copied: string[] = [];
/** What the browser POSTed to `/api/exhibitions`, parsed. */
let published: Record<string, unknown>[] = [];

/** Publishing succeeds and returns a short link. Overridden per test. */
const publishes = (response: { ok: boolean; url?: string }) =>
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    published.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (!response.ok) return new Response('{}', { status: 503 });
    return new Response(
      JSON.stringify({ success: true, data: { code: 'aB3xk9m', url: response.url } }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

const withClipboard = () =>
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn(async (value: string) => {
        copied.push(value);
      }),
    },
  });

beforeEach(() => {
  copied = [];
  published = [];
  __resetArtworkIndexForTest();
  __resetWebMcpStateForTest();
  __resetFlagsForTest();
  rememberArtworks(['a', 'b', 'c'].map(artwork));
  withClipboard();
  vi.stubGlobal('fetch', publishes({ ok: true, url: SHORT_URL }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const aShow = () => {
  board(['a', 'b']);
  writeExhibition({ title: 'Leaving' }, { by: 'agent' });
  writeExhibition({ statement: 'It is about leaving.' }, { by: 'human' });
  writeExhibition(
    { works: [{ artworkId: 'a', label: 'The boat is already gone.' }] },
    { by: 'agent' }
  );
};

const click = () =>
  userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

describe('the link', () => {
  it('is absent when there is nothing hanging', () => {
    render(<ShareExhibitionLink />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('publishes the prose, the provenance and the hanging order', async () => {
    aShow();
    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toEqual({
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

  it('copies the short link, not the wall of characters', async () => {
    aShow();
    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toBe(SHORT_URL);
  });

  it('does not share a work the human rejected', async () => {
    board(['a', 'b', 'c']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    setFlag('b', 'reject', { by: 'human' });

    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(published).toHaveLength(1));
    const works = published[0]!.works as { artworkId: string }[];
    expect(works.map((work) => work.artworkId)).toEqual(['a', 'c']);
  });

  it('says it worked, in the place that caused it', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await click();
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

/*
 * A short link that does not exist is worse than a long one that does, so
 * every failure to publish falls back to the self-contained URL rather than
 * telling the curator to try again later.
 */
describe('when the show cannot be published', () => {
  it('falls back to a link that carries the whole show', async () => {
    aShow();
    vi.stubGlobal('fetch', publishes({ ok: false }));
    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(copied).toHaveLength(1));
    const url = new URL(copied[0]!);
    expect(url.pathname).toBe('/exhibition');

    const payload = await decodeExhibitionLink(url.searchParams.get('e')!);
    expect(payload?.title).toBe('Leaving');
    expect(payload?.works.map((work) => work.artworkId)).toEqual(['a', 'b']);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('falls back when the network is gone entirely', async () => {
    aShow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(new URL(copied[0]!).pathname).toBe('/exhibition');
  });
});

/*
 * The original bug, and the reason for the field. `navigator.clipboard` is
 * undefined outside a secure context; the write threw; the button text never
 * updated. From the human's side the control simply did nothing.
 */
describe('when the clipboard is unavailable', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', publishes({ ok: true, url: SHORT_URL }));
  });

  it('says so rather than doing nothing', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await click();
    expect(
      await screen.findByRole('button', { name: 'Copy failed' })
    ).toBeInTheDocument();
  });

  it('puts the link on screen so it can be copied by hand', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await click();

    const field = (await screen.findByLabelText(
      'Exhibition link'
    )) as HTMLInputElement;
    expect(field.value).toBe(SHORT_URL);
    expect(field.readOnly).toBe(true);
  });

  it('selects it, so the next keystroke is the copy', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await click();

    const field = (await screen.findByLabelText(
      'Exhibition link'
    )) as HTMLInputElement;
    await waitFor(() => {
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(SHORT_URL.length);
    });
  });

  it('leaves the field up rather than clearing it out from under them', async () => {
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await click();
    await screen.findByLabelText('Exhibition link');

    // The success path resets after 2.4s. The failure path must not: the link
    // is only reachable while it is on screen.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByLabelText('Exhibition link')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows no field at all when the copy worked', async () => {
    withClipboard();
    board(['a']);
    writeExhibition({ title: 'Leaving' }, { by: 'agent' });
    render(<ShareExhibitionLink />);

    await click();
    await screen.findByRole('button', { name: 'Copied' });
    expect(screen.queryByLabelText('Exhibition link')).toBeNull();
  });
});

/**
 * Named groupings, which the walkable view turns into separate rooms.
 *
 * They used to die with the tab: the board knew them, the share payload did
 * not carry them, and a grouped show opened from its own link as if it had
 * never said how it was grouped. The pair below is the whole contract — a
 * grouped show sends them, and a show with no groupings sends a payload that
 * is byte-for-byte what it was before regions existed, which is the half a
 * first attempt got wrong.
 */
describe('named groupings in the published show', () => {
  it('publishes the regions the board named', async () => {
    aShow();
    setRegions(
      [
        { label: 'The Working Harbor', artworkIds: ['a'] },
        { label: 'The Empty Shore', artworkIds: ['b'] },
      ],
      { by: 'agent' }
    );
    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(published).toHaveLength(1));
    expect((published[0] as { regions?: unknown }).regions).toEqual([
      { label: 'The Working Harbor', artworkIds: ['a'] },
      { label: 'The Empty Shore', artworkIds: ['b'] },
    ]);
  });

  it('sends no regions key at all for a show that has none', async () => {
    aShow();
    render(<ShareExhibitionLink />);
    await click();

    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).not.toHaveProperty('regions');
  });
});
