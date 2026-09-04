import { useCallback, useEffect, useRef, useState } from 'react';
import type { LightTableWork } from './light-table-card';
import type { ProvenanceHand } from './provenance';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * Two-up, as a room rather than a dialog.
 *
 * The optometrist's "better one, or two?". This is the moment where the agent
 * asks a question *with pictures* and the human answers with one click, which
 * is an order of magnitude cheaper for a human than articulating why. It only
 * works if the two works are big enough to actually judge, so everything else
 * leaves the screen: no toolbar, no title bar, no close button, no card chrome.
 * Two works on the wall ground and a label between them.
 *
 * The question is set in the serif in the asking hand's ink, so it reads as a
 * wall label written by somebody rather than as a system prompt. Nothing says
 * "the agent asked this" in words; the colour already did.
 *
 * This component is presentation only. It does not know what `compare_artworks`
 * is, does not decide who won, and does not touch flag state — it reports which
 * side was chosen and lets whoever owns flags turn that into a pick and a
 * reject. That keeps it separable from the lane building the tool.
 */

export interface TwoUpCompareProps {
  /**
   * The pair on the wall. `null` closes the room.
   *
   * A tuple rather than an array, because "compare" with one work is a detail
   * view and with three is a grid; both already exist elsewhere.
   */
  works: readonly [LightTableWork, LightTableWork] | null;
  /** The agent's question. One sentence — it is a wall label, not a prompt. */
  question?: string;
  /** Who asked. Decides the ink. The human can ask too, by pressing `C`. */
  hand?: ProvenanceHand;
  /**
   * A side was chosen. The winner is what the human clicked.
   *
   * Deliberately not "onPick": this component reports a *gesture*, and the
   * caller decides that a win means a pick and a loss means a reject.
   */
  onChoose?: (
    winner: LightTableWork,
    loser: LightTableWork,
    index: 0 | 1
  ) => void;
  /** Escape, or a click on the ground. No answer was given. */
  onDismiss?: () => void;
}

export function TwoUpCompare({
  works,
  question,
  hand = 'agent',
  onChoose,
  onDismiss,
}: TwoUpCompareProps) {
  const reduceMotion = usePrefersReducedMotion();
  const roomRef = useRef<HTMLDivElement | null>(null);

  const choose = useCallback(
    (index: 0 | 1) => {
      if (!works) return;
      const winner = works[index];
      const loser = works[index === 0 ? 1 : 0];
      onChoose?.(winner, loser, index);
    },
    [works, onChoose]
  );

  /*
   * The keyboard is the whole interface here, because there is no visible
   * chrome to click. Left and right answer, Escape leaves. Nothing on screen
   * says so — the two pictures are obviously the two answers, and Escape is
   * what Escape has meant since before any of this.
   */
  useEffect(() => {
    if (!works) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss?.();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        choose(0);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        choose(1);
        return;
      }

      /*
       * Keep Tab inside the room.
       *
       * `aria-modal="true"` is a promise that nothing behind this is
       * reachable, and without a trap it is simply false: tabbing walks
       * straight out into the search grid underneath, which is still there,
       * still focusable, and now invisible. A screen reader user would be
       * reading a page they cannot see.
       */
      if (event.key === 'Tab') {
        const room = roomRef.current;
        if (!room) return;

        const focusable = Array.from(
          room.querySelectorAll<HTMLElement>('button:not([disabled])')
        );
        if (!focusable.length) return;

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;

        // Shift-Tab off the front wraps to the back, and vice versa. Focus
        // sitting on the room itself counts as "before the first".
        if (event.shiftKey && (active === first || active === room)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [works, choose, onDismiss]);

  /*
   * Move focus into the room, and put it back where it came from on the way
   * out. Dropping focus to the top of the document after a compare is how a
   * keyboard user loses their place on the board they were culling.
   */
  useEffect(() => {
    if (!works) return undefined;

    const returnTo = document.activeElement as HTMLElement | null;
    roomRef.current?.focus();

    return () => {
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, [works]);

  if (!works) return null;

  const [left, right] = works;

  return (
    <div
      ref={roomRef}
      role="dialog"
      aria-modal="true"
      aria-label={question ?? 'Compare two works'}
      tabIndex={-1}
      data-hand={hand}
      data-reduced-motion={reduceMotion ? '' : undefined}
      className="lt-two-up"
      /*
       * A click on the ground leaves without answering. It is the one piece of
       * behaviour here with nothing on screen to announce it, which is the
       * usual bargain for a lightbox and is why Escape does the same thing.
       */
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      {/*
       * A real close control, for anyone who cannot click the ground or guess
       * at Escape. It is invisible until focused, so the room stays empty for
       * the camera and stays operable for a keyboard.
       */}
      <button
        type="button"
        onClick={onDismiss}
        className="lt-two-up-escape lt-focusable"
      >
        Close compare
      </button>

      <TwoUpSide work={left} onChoose={() => choose(0)} side="left" />

      {/*
       * The label hangs between the two works, the way it would on a wall
       * between two hung pictures — and when there is no question there is no
       * label, rather than an empty column holding the two works apart for a
       * caption that never came.
       */}
      {question && (
        <div className="lt-two-up-label">
          <p className="lt-wall-label lt-two-up-question">{question}</p>
        </div>
      )}

      <TwoUpSide work={right} onChoose={() => choose(1)} side="right" />
    </div>
  );
}

function TwoUpSide({
  work,
  onChoose,
  side,
}: {
  work: LightTableWork;
  onChoose: () => void;
  side: 'left' | 'right';
}) {
  const [failed, setFailed] = useState(false);
  const title = work.title?.trim() || 'Untitled';
  const artist = work.artist?.trim() || 'Unattributed';
  const source = work.imageUrl || work.thumbnailUrl || null;

  return (
    <div className="lt-two-up-side" data-side={side}>
      <button
        type="button"
        onClick={onChoose}
        className="lt-two-up-choice lt-focusable"
        /*
         * The accessible name carries what the click means, because on screen
         * that is carried by the picture being the only thing to click.
         */
        aria-label={`Choose ${title} by ${artist}`}
      >
        {source && !failed ? (
          <img
            src={source}
            alt={title}
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="lt-catalogue">No image</span>
        )}
      </button>

      {/* The wall label proper: serif for the work, mono for the catalogue. */}
      <div className="lt-two-up-caption">
        <p className="font-wall">{title}</p>
        <p className="lt-catalogue">
          {artist}
          {work.dateText ? ` · ${work.dateText}` : ''}
        </p>
      </div>
    </div>
  );
}
