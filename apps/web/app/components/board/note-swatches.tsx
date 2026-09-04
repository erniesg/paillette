/**
 * The evidence for the note, set beside the note.
 *
 * The wall label makes a claim about what the human's flags had in common —
 * "you rejected the two darkest palettes". That sentence is only worth
 * printing if a viewer can check it without leaving the sentence, so the
 * swatches the agent was actually given are drawn next to it: one strip per
 * flagged work, in the order picks then rejects, and nothing else.
 *
 * No words, deliberately. Which strip is a pick and which is a reject is a
 * position and a mark — picks sit whole on the baseline, rejects are struck
 * through — because a legend under a wall label is the thing §5b forbids. The
 * titles ride along in `title`/`aria-label` for anyone who cannot see the
 * colours, and nowhere on screen.
 */

import { useMemo } from 'react';
import { recallArtwork } from '~/lib/webmcp/artwork-index';
import {
  toAgentArtworkSummary,
  toAgentVisualFacts,
} from '~/lib/webmcp/artwork-summary';
import { useWebMcpState } from '~/components/webmcp/use-webmcp-state';

interface Strip {
  id: string;
  flag: 'pick' | 'reject';
  title: string;
  palette: string[];
}

/** More than this and the strip is a chart rather than a piece of evidence. */
const MAX_STRIPS = 6;

const stripsFrom = (
  records: readonly { artworkId: string; flag: string; provisional?: boolean }[]
): Strip[] => {
  const confirmed = records.filter((record) => !record.provisional);
  const build = (want: 'pick' | 'reject') =>
    confirmed
      .filter((record) => record.flag === want)
      .map((record): Strip | null => {
        const artwork = recallArtwork(record.artworkId);
        if (!artwork) return null;
        const summary = toAgentArtworkSummary(artwork);
        const { palette } = toAgentVisualFacts(summary);
        if (!palette.length) return null;
        return {
          id: record.artworkId,
          flag: want,
          title: summary.title ?? record.artworkId,
          palette,
        };
      })
      .filter((strip): strip is Strip => strip !== null);

  return [...build('pick'), ...build('reject')].slice(0, MAX_STRIPS);
};

export function NoteSwatches() {
  const { flags } = useWebMcpState();
  const strips = useMemo(() => stripsFrom(flags), [flags]);
  if (!strips.length) return null;

  return (
    <div className="lt-note-swatches" data-testid="note-swatches">
      {strips.map((strip) => (
        <span
          key={strip.id}
          className="lt-note-swatch"
          data-flag={strip.flag}
          data-artwork-id={strip.id}
          title={strip.title}
          aria-label={`${strip.title}: ${strip.flag === 'pick' ? 'picked' : 'rejected'}`}
        >
          {strip.palette.map((colour, index) => (
            <i
              key={`${strip.id}-${colour}-${index}`}
              style={{ background: colour }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}
