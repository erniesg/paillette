import { useEffect, useRef } from 'react';
import type { LightTableWork } from './light-table-card';
import type { ProvenanceHand } from './provenance';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * The ledger — version history reused as the conversation record.
 *
 * A chat transcript of this session would be a list of sentences about
 * pictures. The session *was* pictures, so the record is too: one frame per
 * turn, each a six-thumbnail miniature of the board as it stood, captioned with
 * whatever was said. Clicking a frame puts that board back.
 *
 * That gets two things a transcript cannot. You can see the drift — six frames
 * along, the boards look nothing like frame one, and no sentence had to claim
 * that. And it is navigable: a transcript is something you read, whereas this
 * is something you can go back to.
 *
 * The caption takes the ink of whoever took the turn, so the strip shows both
 * hands at a glance and never needs a "you:" / "agent:" prefix — which is
 * exactly the thing that would make it look like a chat again.
 *
 * Frames are data, not screenshots: a snapshot is a handful of ids and a
 * string, and the thumbnails are the same URLs the board already loaded.
 */

export interface LedgerFrame {
  id: string;
  /** Who took this turn. Decides the caption's ink. */
  hand: ProvenanceHand;
  /**
   * What was said — the human's utterance, or the agent's note.
   *
   * One line. It is a wall label for a turn, not a message, and the strip
   * truncates rather than wrapping so every frame stays the same height.
   */
  caption?: string;
  /** The board as it stood after this turn. The first six are drawn. */
  works: readonly LightTableWork[];
  /** Which of them were picks at the time. Drawn with the hairline frame. */
  pickIds?: readonly string[];
}

export interface LedgerFilmstripProps {
  frames: readonly LedgerFrame[];
  /** The frame whose board is currently on the table. */
  activeId?: string;
  /** Clicking a frame restores that board. */
  onRestore?: (frame: LedgerFrame) => void;
  className?: string;
}

/** Six is a board you can still read at 100px wide. Twelve is a texture. */
const THUMBS_PER_FRAME = 6;

export function LedgerFilmstrip({
  frames,
  activeId,
  onRestore,
  className,
}: LedgerFilmstripProps) {
  const reduceMotion = usePrefersReducedMotion();
  const stripRef = useRef<HTMLDivElement | null>(null);

  /*
   * The newest turn is the one you want to see, and it is off the right edge
   * as soon as there are more than a few. Scrolling the container rather than
   * calling `scrollIntoView` keeps the page itself still — `scrollIntoView` on
   * a fixed strip will happily scroll the whole document to reach it.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollTo({
      left: strip.scrollWidth,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [frames.length, reduceMotion]);

  if (!frames.length) return null;

  return (
    <nav
      aria-label="Ledger"
      className={`lt-ledger ${className ?? ''}`}
      data-reduced-motion={reduceMotion ? '' : undefined}
    >
      <div className="lt-ledger-strip" ref={stripRef}>
        {frames.map((frame, index) => (
          <LedgerFrameButton
            key={frame.id}
            frame={frame}
            turn={index + 1}
            active={frame.id === activeId}
            onRestore={onRestore}
          />
        ))}
      </div>
    </nav>
  );
}

function LedgerFrameButton({
  frame,
  turn,
  active,
  onRestore,
}: {
  frame: LedgerFrame;
  turn: number;
  active: boolean;
  onRestore?: (frame: LedgerFrame) => void;
}) {
  const picks = new Set(frame.pickIds ?? []);
  const thumbs = frame.works.slice(0, THUMBS_PER_FRAME);
  const hidden = frame.works.length - thumbs.length;

  return (
    <button
      type="button"
      onClick={onRestore ? () => onRestore(frame) : undefined}
      disabled={!onRestore}
      data-hand={frame.hand}
      data-active={active ? '' : undefined}
      aria-current={active ? 'true' : undefined}
      className="lt-ledger-frame lt-focusable"
      /*
       * The count is in the accessible name because the strip shows only six
       * thumbnails, and a keyboard user restoring a board should know it is
       * restoring twelve works rather than the six they can hear listed.
       */
      aria-label={`Turn ${turn}${frame.caption ? ` — ${frame.caption}` : ''} — restore ${frame.works.length} works`}
    >
      <span className="lt-ledger-board" aria-hidden="true">
        {thumbs.map((work) => (
          <span
            key={work.id}
            className="lt-ledger-thumb"
            data-flag={picks.has(work.id) ? 'pick' : undefined}
          >
            {work.thumbnailUrl || work.imageUrl ? (
              <img
                src={work.thumbnailUrl || work.imageUrl || undefined}
                alt=""
                loading="lazy"
                draggable={false}
              />
            ) : null}
          </span>
        ))}
      </span>

      <span className="lt-ledger-caption" aria-hidden="true">
        <span className="lt-catalogue lt-ledger-turn">
          {turn}
          {hidden > 0 ? ` · +${hidden}` : ''}
        </span>
        {frame.caption && (
          <span className="lt-ledger-said">{frame.caption}</span>
        )}
      </span>
    </button>
  );
}
