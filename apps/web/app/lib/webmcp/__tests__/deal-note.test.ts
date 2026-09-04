/**
 * The sentence the board writes for itself.
 *
 * The claim it exists to make is that the board still speaks with the model
 * switched off, so what is tested here is that every branch produces a line and
 * that the line names something a person could check against the cards — not
 * that it is well-phrased, which is a matter of taste, and not that a model
 * approves of it, because no model is involved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtworkSearchResult } from '~/types';
import {
  __resetArtworkIndexForTest,
  rememberArtworks,
} from '../artwork-index';
import { composeDealNote } from '../deal-note';

const work = (
  id: string,
  options: { title?: string; palette?: string[] } = {}
): ArtworkSearchResult =>
  ({
    id,
    title: options.title ?? `Work ${id}`,
    artist: 'A Painter',
    similarity: 0.5,
    ...(options.palette
      ? { metadata: { dominantColors: options.palette } }
      : {}),
  }) as unknown as ArtworkSearchResult;

beforeEach(() => {
  __resetArtworkIndexForTest();
});

afterEach(() => {
  __resetArtworkIndexForTest();
});

describe('composeDealNote', () => {
  it('names the palette the picks share, in the swatch vocabulary', () => {
    // Both near #bf5631, which the human's own colour rail calls rust — so the
    // word in the sentence and the word under their cursor are the same word.
    rememberArtworks([
      work('p1', { palette: ['#bd5732', '#221e1a'] }),
      work('p2', { palette: ['#c25a30'] }),
    ]);

    const note = composeDealNote({
      exemplars: { positive: ['p1', 'p2'], negative: [] },
      added: ['n1', 'n2'],
    });

    expect(note).toBe('Two picks hold — rust. Two works dealt to sit with them.');
  });

  it('names what was thrown out when nothing was picked', () => {
    rememberArtworks([work('r1', { palette: ['#1a2f52'] })]);

    expect(
      composeDealNote({
        exemplars: { positive: [], negative: ['r1'] },
        added: ['n1'],
      })
    ).toBe('One reject out — navy. One work dealt away from it.');
  });

  it('falls back to the titles when nothing has an extracted palette', () => {
    // An engraving, a drawing, a record the colour pass never reached. Naming a
    // colour nobody can see in the work would be worse than naming none.
    rememberArtworks([work('p1', { title: 'The Wave' })]);

    expect(
      composeDealNote({
        exemplars: { positive: ['p1'], negative: [] },
        added: ['n1', 'n2'],
      })
    ).toBe('One pick holds — “The Wave”. Two works dealt to sit with it.');
  });

  it('still writes a line when the works are not in the session index', () => {
    // The row must never collapse, whatever the index does or does not hold.
    expect(
      composeDealNote({
        exemplars: { positive: ['unknown'], negative: [] },
        added: ['n1'],
      })
    ).toBe('One pick holds. One work dealt to sit with it.');
  });

  it('describes the board when nothing is flagged at all', () => {
    // Enter with no flags still deals — the works left alone are the direction
    // — so this is the state a board is in before the first pick. Without a
    // line here the sentence arrives on the first flag and the cards move then.
    rememberArtworks([work('n1', { palette: ['#cda636'] })]);

    expect(
      composeDealNote({
        exemplars: { positive: [], negative: [] },
        added: ['n1'],
      })
    ).toBe('One work dealt — gold.');
  });

  it('says nothing when nothing was dealt and nothing is flagged', () => {
    expect(
      composeDealNote({ exemplars: { positive: [], negative: [] }, added: [] })
    ).toBeNull();
  });

  it('refuses a colour name that is not close enough to be true', () => {
    // A saturated magenta is nowhere near any swatch on the rail. The nearest
    // one is still a wrong description, and a wall label that names a colour
    // the picture does not have is the one failure worse than silence.
    rememberArtworks([work('p1', { title: 'Untitled', palette: ['#ff00ff'] })]);

    expect(
      composeDealNote({
        exemplars: { positive: ['p1'], negative: [] },
        added: ['n1'],
      })
    ).toBe('One pick holds — “Untitled”. One work dealt to sit with it.');
  });
});
