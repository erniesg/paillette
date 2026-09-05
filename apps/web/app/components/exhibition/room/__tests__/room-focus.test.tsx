/**
 * The two rules that arrived after the room was built, as assertions.
 *
 * **Text first.** Nothing in this panel may need a voice. On a browser with no
 * speech synthesis the read-aloud is absent — not disabled, not a control that
 * silently fails — and every other word on the label is still there. Typing and
 * clicking is the whole path.
 *
 * **Cut the words.** The read-aloud used to be a bordered button captioned
 * READ ALOUD, which is a second visual layer and a sentence about a mechanism
 * on a panel whose other four lines are all the catalogue's or the curator's.
 * It is a glyph now, and the assertion is that the panel renders *no* string
 * the room invented for itself.
 */

import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FocusedLabel, type FocusedWork } from '../room-focus';

const WORK: FocusedWork = {
  artworkId: 'open-access-art:nga:138648',
  title: 'Avalanche in an Alpine Landscape',
  artist: 'Pierre Puvis de Chavannes',
  date: 'c. 1870',
  medium: 'black and white chalk on blue paper',
  accession: '2007.66.1.b',
  sourceUrl: 'https://www.nga.gov/collection/art-object-page.138648.html',
  imageUrl: 'https://api.nga.gov/iiif/abc/full/843,/0/default.jpg',
  label: 'The valley empties of light before anyone has decided to go.',
  labelByAgent: true,
  dimensions: null,
};

const withSpeech = () => {
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    }
  );
};

afterEach(() => vi.unstubAllGlobals());

describe('the focused wall label', () => {
  it('shows the catalogue line, the label and the accession', () => {
    render(<FocusedLabel work={WORK} />);
    expect(screen.getByText(WORK.title)).toBeInTheDocument();
    expect(screen.getByText(WORK.artist!)).toBeInTheDocument();
    expect(screen.getByText(WORK.label!)).toBeInTheDocument();
    expect(screen.getByText(WORK.accession!)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catalogue record' })).toHaveAttribute(
      'href',
      WORK.sourceUrl
    );
  });

  it('carries who wrote the label as ink rather than as a word', () => {
    const { rerender } = render(<FocusedLabel work={WORK} />);
    expect(screen.getByText(WORK.label!)).toHaveAttribute('data-provenance', 'agent');
    rerender(<FocusedLabel work={{ ...WORK, labelByAgent: false }} />);
    expect(screen.getByText(WORK.label!)).toHaveAttribute('data-provenance', 'human');
    // And no sentence anywhere saying who wrote it.
    expect(screen.queryByText(/agent|written by/i)).toBeNull();
  });

  /** Text first: the panel is complete without speech being available at all. */
  it('renders no read-aloud control when the browser cannot speak', () => {
    render(<FocusedLabel work={WORK} />);
    expect(screen.queryByRole('button')).toBeNull();
    // Everything a visitor came for is still on the label.
    expect(screen.getByText(WORK.label!)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catalogue record' })).toBeInTheDocument();
  });

  it('reads the label and the catalogue line, not one without the other', () => {
    withSpeech();
    render(<FocusedLabel work={WORK} />);
    const speak = screen.getByRole('button', { name: 'Read aloud' });
    expect(speak).toBeInTheDocument();
    expect(speak).not.toHaveTextContent(/read aloud/i);
  });

  /** Cut the words: nothing on this panel is a string the room made up. */
  it('says nothing the catalogue or the curator did not', () => {
    withSpeech();
    const { container } = render(<FocusedLabel work={WORK} />);
    const own = new Set([
      WORK.title,
      WORK.artist,
      WORK.date,
      WORK.medium,
      WORK.label,
      WORK.accession,
      // The one borrowed string, and it is the flat page's word for the same
      // link rather than a new one invented here.
      'Catalogue record',
      '▶',
    ]);
    const strings = (container.textContent ?? '')
      .split(/(?=Catalogue record)|(?=▶)/)
      .flatMap((chunk) => chunk.split('\n'))
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    for (const string of strings) {
      expect([...own].some((allowed) => allowed && string.includes(allowed))).toBe(
        true
      );
    }
  });

  it('drops a line the record does not have rather than printing a placeholder', () => {
    render(
      <FocusedLabel
        work={{ ...WORK, artist: null, date: null, medium: null, accession: null }}
      />
    );
    const panel = screen.getByText(WORK.title).closest('aside')!;
    expect(within(panel).queryByText(/unknown|untitled|n\/a|—/i)).toBeNull();
    expect(screen.getByText(WORK.label!)).toBeInTheDocument();
  });

  it('renders a work with no label at all without an empty rule', () => {
    const { container } = render(<FocusedLabel work={{ ...WORK, label: null }} />);
    expect(container.querySelector('.exhibition-label')).toBeNull();
    expect(screen.getByText(WORK.title)).toBeInTheDocument();
  });
});
