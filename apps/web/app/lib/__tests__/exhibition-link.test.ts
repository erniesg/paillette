/**
 * The show, in a URL.
 *
 * The claim this has to keep is the one the submission makes: an exhibition
 * survives being opened cold, in a new browser, by someone who has never used
 * Paillette. Nothing here may depend on a session, a store, or a record
 * somebody has to keep.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeExhibitionLink,
  encodeExhibitionLink,
  exhibitionLinkPath,
  EXHIBITION_LINK_SOFT_LIMIT,
  type ExhibitionLinkPayload,
} from '../exhibition-link';

const show = (
  overrides: Partial<ExhibitionLinkPayload> = {}
): ExhibitionLinkPayload => ({
  collectionId: 'nga',
  title: 'Everything the Light Left Behind',
  titleByAgent: true,
  statement: 'It is not about weather. It is about leaving.',
  statementByAgent: false,
  works: [
    { artworkId: 'a', label: 'The boat is already gone.', labelByAgent: true },
    { artworkId: 'b', label: null, labelByAgent: false },
  ],
  ...overrides,
});

/**
 * A realistic wall of prose: twelve distinct labels and a hundred-word
 * statement. Repeating one label would compress far better than a real show
 * does and would make the length claim meaningless.
 */
const LABELS = [
  'The boat is already gone; what is left is the light on the water where it was.',
  'A road leaving the frame at the right edge, with nothing at the end of it worth drawing.',
  'Constable painted this bay a dozen times. This is the version where nobody is in it.',
  'The doorway is lit from behind, which is how you know somebody has just used it.',
  'Two figures on a quay, both facing the water. Neither is waving.',
  'A harbour emptied by weather rather than by choice.',
  'The horizon sits low enough that the sky does most of the work, and it is doing nothing.',
  'An interior with one chair pushed back from the table.',
  'Etched thirty years after the crossing it records, which is why the coast is wrong.',
  'The last of the evening on a wall that faces east: reflected light, arriving second-hand.',
  'A staircase seen from below, empty, the banister worn smooth on one side only.',
  'Snow across a track that somebody has already walked, going away from the viewer.',
];

/**
 * The same wall, as `write_labels` actually writes it.
 *
 * `LABELS` above average 85 characters, and the length claim used to be
 * checked against them — which flattered the format badly. These twelve are
 * real output captured from three runs against the model
 * (`verify-theme-correction.mjs`), and they average **207**, because "one or
 * two sentences" of museum prose is two hundred characters, not eighty. Every
 * size assertion below uses these.
 */
const REAL_LABELS = [
  'Its quoted promise to sail through “mist or glim” makes uncertain visibility part of companionship, with weather setting the terms of departure. Pen, ink, and scraped corrections keep the image close to a tentative, shifting mark.',
  'Two weather-named figures face one another across separate oval frames, turning “sunny weather” and “good weather” into a paired encounter. The etched hatching gives their enclosed world a dense, unsettled surface rather than an open horizon.',
  "Its quoted line fixes departure in a conditional promise: sailing depends on another person's willingness to go. The scratched and reworked ink leaves the thought feeling tentative, as if held at the edge of leaving.",
  'The promised raft is absent; what remains is a printed description, partly covered by a blunt white patch. Information persists like a record after the thing it names has moved out of sight.',
  "Two faces turn toward one another from separate oval frames, close enough for an exchange but held apart by the print's structure. Their paired likenesses preserve the pressure of a meeting after speech has fallen away.",
  'A coin bank makes saving a small domestic ritual of postponement: something set aside now for a future departure or need. Its drawn, painted form keeps that private preparation present on paper.',
  'Its quoted line makes sailing a condition of companionship, held between mist and a faint “glim.” Pen, graphite, and scratched highlights keep the scene at the edge of visibility.',
  'Two elderly faces confront one another across separate oval frames. The dense etched hatching presses close, turning portraiture into a study of weathered surfaces and narrowed distance.',
  'The sea is absent from this stereoscopic card, replaced by a damaged field of printed information about a rice raft. White tape blocks the account at its center, making interruption and obscured knowledge part of its unsettled surface.',
  'A coin bank enters the exhibition as a small shelter for value: an object made to contain and protect. Its mixed drawn and painted surface offers a domestic counterpoint to the exposure suggested by the surrounding sea.',
  'A question in the title—“do you find this a likeness?”—sets uncertainty at the center of the lithograph. Its printed tones and implied exchange make recognition feel as unstable as a face seen through haze.',
  '“Always Ready to Obey” gives the lithograph a language of command and submission. In this setting, readiness reads as a human posture before conditions that cannot be directed.',
];

const STATEMENT =
  'Twelve works about departure — not the drama of it but the residue: an emptied harbour, a road going out of frame, a doorway with the light behind it. Nothing here shows the moment of leaving. Everything shows the minutes after, when the room has not caught up with the fact that somebody is not in it. The pictures are quiet on purpose.';

describe('the round trip', () => {
  it('carries the prose and the provenance of every field', async () => {
    const encoded = await encodeExhibitionLink(show());
    expect(await decodeExhibitionLink(encoded)).toEqual(show());
  });

  it('keeps the hanging order', async () => {
    const payload = show({
      works: ['c', 'a', 'b'].map((artworkId) => ({
        artworkId,
        label: null,
        labelByAgent: false,
      })),
    });
    const decoded = await decodeExhibitionLink(
      await encodeExhibitionLink(payload)
    );
    expect(decoded?.works.map((work) => work.artworkId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('survives a show with no title and no statement', async () => {
    const payload = show({ title: null, statement: null, titleByAgent: false });
    const decoded = await decodeExhibitionLink(
      await encodeExhibitionLink(payload)
    );
    expect(decoded?.title).toBeNull();
    expect(decoded?.statement).toBeNull();
  });

  it('survives punctuation the URL would otherwise eat', async () => {
    const payload = show({
      title: 'Leaving & Left: “after”, 100% / ?#+',
      statement: 'Émigré — naïve, façade; 100% of it. 日本語も。',
    });
    const decoded = await decodeExhibitionLink(
      await encodeExhibitionLink(payload)
    );
    expect(decoded?.title).toBe(payload.title);
    expect(decoded?.statement).toBe(payload.statement);
  });

  it('produces a path that is one query parameter and nothing else', async () => {
    const path = exhibitionLinkPath(await encodeExhibitionLink(show()));
    expect(path.startsWith('/exhibition?e=')).toBe(true);
    expect(new URL(path, 'https://example.test').searchParams.get('e')).toBe(
      path.slice('/exhibition?e='.length)
    );
  });
});

describe('the length claim', () => {
  it('averages the label length this app really produces', () => {
    const mean =
      REAL_LABELS.reduce((sum, label) => sum + label.length, 0) /
      REAL_LABELS.length;
    // Guards the fixture itself. If someone swaps these for shorter prose the
    // two size assertions below quietly stop meaning anything, which is
    // exactly how the old numbers came to be wrong.
    expect(mean).toBeGreaterThan(180);
  });

  it('keeps a twelve-work show with real labels inside a pasteable URL', async () => {
    const encoded = await encodeExhibitionLink(
      show({
        statement: STATEMENT,
        works: REAL_LABELS.map((label, index) => ({
          // Full-length uuids, which is what the catalogue actually hands out.
          artworkId: `b3a4d1e2-8f7c-4a21-9c${String(index).padStart(2, '0')}-1f2e3d4c5b6a`,
          label,
          labelByAgent: true,
        })),
      })
    );
    // Asserted as a band, not just a ceiling: an upper bound alone would keep
    // passing if the format silently stopped compressing.
    expect(encoded.length).toBeGreaterThan(1000);
    expect(encoded.length).toBeLessThan(3000);
    expect(encoded.length).toBeLessThan(EXHIBITION_LINK_SOFT_LIMIT);
  });

  it('keeps a full twenty-four-work hang inside it too', async () => {
    const encoded = await encodeExhibitionLink(
      show({
        statement: STATEMENT,
        works: Array.from({ length: 24 }, (_, index) => ({
          artworkId: `b3a4d1e2-8f7c-4a21-9c${String(index).padStart(2, '0')}-1f2e3d4c5b6a`,
          // Distinct labels, so this is not a compression artefact.
          label: `${REAL_LABELS[index % REAL_LABELS.length]} (${index})`,
          labelByAgent: true,
        })),
      })
    );
    expect(encoded.length).toBeLessThan(4500);
    expect(encoded.length).toBeLessThan(EXHIBITION_LINK_SOFT_LIMIT);
  });

  it('is much shorter than the JSON it stands for', async () => {
    const payload = show({
      statement: STATEMENT,
      works: LABELS.map((label, index) => ({
        artworkId: `work-${index}`,
        label,
        labelByAgent: true,
      })),
    });
    const encoded = await encodeExhibitionLink(payload);
    expect(encoded.length).toBeLessThan(JSON.stringify(payload).length / 2);
  });
});

describe('a link that is not one', () => {
  it('refuses an empty string', async () => {
    expect(await decodeExhibitionLink('')).toBeNull();
  });

  it('refuses an unknown format marker', async () => {
    const encoded = await encodeExhibitionLink(show());
    expect(await decodeExhibitionLink(`9${encoded.slice(1)}`)).toBeNull();
  });

  it('refuses truncated bytes rather than rendering half a show', async () => {
    const encoded = await encodeExhibitionLink(show());
    expect(await decodeExhibitionLink(encoded.slice(0, 12))).toBeNull();
  });

  it('refuses something that is not base64 at all', async () => {
    expect(await decodeExhibitionLink('1not a payload!!')).toBeNull();
  });

  it('refuses a payload with no works', async () => {
    const encoded = await encodeExhibitionLink(show({ works: [] }));
    expect(await decodeExhibitionLink(encoded)).toBeNull();
  });

  it('refuses a version it does not know', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ v: 99, c: 'nga', w: [['a', '', 0]] })
    );
    const base64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await decodeExhibitionLink(`0${base64}`)).toBeNull();
  });

  it('reads an uncompressed link, for a browser with no CompressionStream', async () => {
    const wire = {
      v: 1,
      c: 'nga',
      t: ['Leaving', 1],
      w: [['a', 'One.', 1]],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    const base64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const decoded = await decodeExhibitionLink(`0${base64}`);
    expect(decoded?.title).toBe('Leaving');
    expect(decoded?.works[0]).toEqual({
      artworkId: 'a',
      label: 'One.',
      labelByAgent: true,
    });
  });
});
