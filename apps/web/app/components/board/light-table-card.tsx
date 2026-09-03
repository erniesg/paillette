import { useState } from 'react';
import {
  markGlyph,
  markLabel,
  provenanceAttributes,
  type BoardMark,
} from './provenance';

/**
 * The minimum a card needs to know about a work.
 *
 * Deliberately not `ArtworkSearchResult`: the board is a presentation and
 * should be renderable from a fixture, a ledger snapshot, or the live search
 * without any of them having to agree on a wider type.
 */
export interface LightTableWork {
  id: string;
  title?: string | null;
  artist?: string | null;
  dateText?: string | null;
  accession?: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
}

export interface LightTableCardProps {
  work: LightTableWork;
  /** Position on the board, 1-based. Shown as catalogue data. */
  rank?: number;
  mark?: BoardMark;
  /** True while the agent is working on this specific card. Drives the pulse. */
  agentActive?: boolean;
  onSelect?: (work: LightTableWork) => void;
  /** Rendered under the caption — flag buttons, restore, and so on. */
  actions?: React.ReactNode;
  className?: string;
}

const UNTITLED = 'Untitled';

/**
 * One work, mounted like a slide on a light table: a pale mount, a dark well
 * so the work has an edge to sit against, and enough shadow to look like an
 * object rather than a rectangle of the page.
 *
 * The image is `object-contain`, never cropped. On a board where the human is
 * being asked to judge pictures, cropping to a tidy grid would be editing the
 * evidence.
 */
export function LightTableCard({
  work,
  rank,
  mark,
  agentActive,
  onSelect,
  actions,
  className,
}: LightTableCardProps) {
  const [failed, setFailed] = useState(false);
  const title = work.title?.trim() || UNTITLED;
  const artist = work.artist?.trim() || 'Unattributed';
  const source = work.thumbnailUrl || work.imageUrl || null;
  const catalogue =
    work.accession?.trim() ||
    (typeof rank === 'number' ? `#${rank.toString().padStart(2, '0')}` : '');

  return (
    // `h-full` with the grid's `auto-rows-fr`: every slide is the same size, so
    // a held pick cannot be nudged vertically by a neighbour with a longer
    // title changing underneath it. Uniform slots are what make "it did not
    // move" a fact rather than an approximation.
    <article
      className={`lt-slide flex h-full flex-col ${className ?? ''}`}
      {...provenanceAttributes(mark, { agentActive })}
    >
      {mark && (
        <span className="lt-mark" {...(mark.provisional && mark.hand === 'agent' ? { 'data-provisional': '' } : {})}>
          <span aria-hidden="true">{markGlyph(mark)}</span>
          <span className="sr-only">{markLabel(mark)}</span>
        </span>
      )}

      <button
        type="button"
        onClick={onSelect ? () => onSelect(work) : undefined}
        disabled={!onSelect}
        className="lt-slide-well lt-focusable block w-full flex-1 appearance-none border-0 p-0 disabled:cursor-default"
        aria-label={onSelect ? `Open ${title}` : undefined}
      >
        {source && !failed ? (
          <img
            src={source}
            alt={title}
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="lt-catalogue flex h-full w-full items-center justify-center">
            No image
          </span>
        )}
      </button>

      {/* The label block is a fixed height so the wells all line up. A long
        * title truncates rather than pushing its own card taller than the rest
        * of the row. */}
      <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-1.5 pt-1.5">
        <h3
          className="truncate font-wall text-[0.875rem] leading-tight"
          style={{ color: 'var(--ink-human)' }}
          title={title}
        >
          {title}
        </h3>
        <p className="flex items-baseline justify-between gap-2">
          <span
            className="truncate text-[0.625rem] leading-tight"
            style={{ color: 'var(--ink-human-soft)' }}
            title={artist}
          >
            {artist}
          </span>
          <span className="lt-catalogue shrink-0">
            {work.dateText || catalogue}
          </span>
        </p>
        {actions}
      </div>
    </article>
  );
}
