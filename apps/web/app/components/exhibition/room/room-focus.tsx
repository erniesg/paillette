/**
 * The wall label of whatever the visitor is standing in front of.
 *
 * The one part of the room that is not a texture. Rendering it as real DOM type
 * is not a shortcut — it is why it is legible at any resolution, selectable,
 * translatable, and reachable by a screen reader, none of which a canvas gets.
 *
 * The displayed label is published text or a committed local edit. AI
 * suggestions remain inside the optional editor until explicitly accepted.
 * Authorship uses the same data-provenance attribute as the flat page.
 *
 * Terse on purpose, and split out from `room-view` so that can be asserted:
 * every string below is either the catalogue's or the curator's. Nothing here
 * explains the room, and the read-aloud is a mark rather than a sentence.
 */

import type { ReactNode } from 'react';
import { SpeakButton } from '~/components/artwork/speak-button';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';

export type FocusedWork = ExhibitionPage['works'][number];

/**
 * The catalogue's own words, in the order a wall label sets them.
 *
 * Shared by the panel and the read-aloud, so the two cannot drift into saying
 * different things about the same picture.
 */
export const catalogueLine = (work: FocusedWork) =>
  [work.title, work.artist, work.date, work.medium].filter(Boolean).join(', ');

export const FocusedLabel = ({
  work,
  labelEditor,
}: {
  work: FocusedWork;
  labelEditor?: ReactNode;
}) => (
  <aside className="exhibition-room-focus">
    <p className="exhibition-line">
      <span className="exhibition-work-title">{work.title}</span>
      {work.artist && <span>{work.artist}</span>}
      {work.date && <span>{work.date}</span>}
      {work.medium && <span>{work.medium}</span>}
    </p>

    {labelEditor ??
      (work.label && (
        <p
          className="exhibition-label"
          data-provenance={work.labelByAgent ? 'agent' : 'human'}
        >
          {work.label}
        </p>
      ))}

    {/*
      The catalogue line, the accession and the mark that reads the label
      aloud — one row, in one ink, because they are the same kind of thing: the
      apparatus around the work rather than the work. The read-aloud is the
      page's own `SpeakButton` in its mark form, not a second one built for the
      room, and it is absent entirely on a browser with no speech synthesis
      rather than being a control that does nothing.
    */}
    <p className="exhibition-accession lt-catalogue">
      {work.accession && <span>{work.accession}</span>}
      {work.sourceUrl && (
        <a
          href={work.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Catalogue record (opens in a new tab)"
        >
          Catalogue record
        </a>
      )}
      <SpeakButton
        mark
        className="exhibition-room-speak"
        text={[catalogueLine(work), work.label].filter(Boolean).join('. ')}
      />
    </p>
  </aside>
);
