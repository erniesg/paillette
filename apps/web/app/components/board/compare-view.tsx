/**
 * Two-up — the optometrist's "better one, or two?".
 *
 * This is the cheapest question anyone can ask a person who has taste and no
 * vocabulary for it. "Do you want a softer tonal range?" costs them an essay
 * they may not be able to write; "which of these two?" costs them a glance.
 * So the agent asks with pictures and gets a real answer.
 *
 * Built plain on purpose — the two works, the question between them, and
 * nothing else. The structure is here; the room is not, and belongs to
 * whoever is doing the visual pass. The hooks they need are
 * `.paillette-compare`, `.paillette-compare-work` and `data-side`.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ImageWithFallback } from '~/components/artwork/image-with-fallback';
import { NoImagePlaceholder } from '~/components/artwork/no-image-placeholder';
import { recallArtwork } from '~/lib/webmcp/artwork-index';
import {
  getWebMcpServerState,
  getWebMcpState,
  subscribeWebMcpState,
  type CompareState,
} from '~/lib/webmcp/store';
import { refuseCompare, resolveCompare } from '~/lib/webmcp/turn';
import { toAgentArtworkSummary } from '~/lib/webmcp/artwork-summary';

const useCompare = (): CompareState | null =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().compare,
    () => getWebMcpServerState().compare
  );

/**
 * "Neither", and the reason.
 *
 * The word turns into a line you can write on, in the same place and the same
 * serif. Nothing is added to the screen and nothing explains itself: you
 * clicked "Neither" and there is now a caret, which is the whole instruction.
 * Enter sends it with or without words, because a person who cannot say why
 * still means it — asking them to justify a refusal before it counts is the
 * mistake the two-up exists to avoid.
 */
const NeitherControl = ({
  artworkIds,
  question,
}: {
  artworkIds: [string, string];
  question: string | null;
}) => {
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (writing) inputRef.current?.focus();
  }, [writing]);

  if (!writing) {
    return (
      <button
        type="button"
        onClick={() => setWriting(true)}
        className="paillette-compare-neither border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
      >
        Neither
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={reason}
      aria-label="Why neither?"
      onChange={(event) => setReason(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          refuseCompare(artworkIds, reason, question);
          return;
        }
        if (event.key === 'Escape') setWriting(false);
      }}
      // Clicking away is an answer too, not a retraction: they already said
      // neither by opening this.
      onBlur={() => refuseCompare(artworkIds, reason, question)}
      className="paillette-compare-reason w-full max-w-md border-0 bg-transparent p-0 text-center outline-none"
    />
  );
};

export const CompareView = () => {
  const compare = useCompare();
  /*
   * Portalled to <body>, and the page marked while it is open.
   *
   * `position: fixed` is relative to the viewport only until an ancestor has a
   * transform on it, at which point that ancestor becomes the containing
   * block. The results section carries a finished GSAP tween, and a completed
   * tween leaves `transform: matrix(1,0,0,1,0,0)` behind — an identity
   * transform, visually nothing, and enough to move this room 2,500px down a
   * 900px window. Measured 1216×4566 inside a 1440×900 viewport, with both
   * works below the fold and a question in serif floating over an empty page.
   *
   * Portalling is the fix rather than clearing the transform, because it
   * survives the next person adding one. `data-compare-open` on the root is
   * what takes the nav, the sticky bar and the utterance field off screen, so
   * this really is "nothing else on screen" and not "an opaque rectangle with
   * the interface still above it".
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!compare || !mounted) return;
    const root = document.documentElement;
    root.dataset.compareOpen = 'true';
    return () => {
      delete root.dataset.compareOpen;
    };
  }, [compare, mounted]);

  if (!compare) return null;

  const [leftId, rightId] = compare.artworkIds;
  const left = recallArtwork(leftId);
  const right = recallArtwork(rightId);
  // Either work can have fallen out of the session index; a half-empty
  // two-up is not a question, so close rather than show one.
  if (!left || !right) return null;

  const works = [
    {
      side: 'left' as const,
      summary: toAgentArtworkSummary(left),
      id: leftId,
      otherId: rightId,
    },
    {
      side: 'right' as const,
      summary: toAgentArtworkSummary(right),
      id: rightId,
      otherId: leftId,
    },
  ];

  const room = (
    <div
      className="paillette-compare fixed inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-neutral-950/95 p-8"
      /* The one body child the "hide everything" rule spares. */
      data-compare-room=""
      role="dialog"
      aria-modal="true"
      aria-label={compare.question ?? 'Compare two works'}
      data-asked-by={compare.askedBy}
    >
      <p className="max-w-2xl text-center font-display text-xl text-white">
        {compare.question ?? 'Which one?'}
      </p>

      <div className="flex w-full max-w-6xl flex-1 items-center justify-center gap-8">
        {works.map(({ side, summary, id, otherId }) => {
          const title = summary.title ?? 'Untitled';
          return (
            <button
              key={id}
              type="button"
              data-side={side}
              data-artwork-id={id}
              // The whole work is the target: answering should not require
              // finding a control.
              onClick={() => resolveCompare(id, otherId, compare.question)}
              aria-label={`Choose ${title}`}
              className="paillette-compare-work flex min-w-0 flex-1 flex-col items-center gap-3 border border-white/10 p-4 text-center hover:border-white/40"
            >
              <ImageWithFallback
                src={summary.imageUrl ?? summary.thumbnailUrl ?? ''}
                {...(summary.thumbnailUrl
                  ? { fallbackSrc: summary.thumbnailUrl }
                  : {})}
                alt={title}
                protectFromDownload
                className="max-h-[55vh] w-auto object-contain"
                fallback={<NoImagePlaceholder className="text-white/25" />}
              />
              <span className="font-display text-sm text-white">{title}</span>
              <span className="text-xs text-white/50">{summary.artist}</span>
            </button>
          );
        })}
      </div>

      {/* Two pictures and a question need no instructions. The only thing
          worth a control is the answer neither picture offers — and it is a
          real answer, not a dismissal: both works are refused, in the human's
          own ink, with whatever they say about why. */}
      <NeitherControl
        artworkIds={compare.artworkIds}
        question={compare.question}
      />
    </div>
  );

  // Rendered in place until the first client effect runs, so a test or a
  // server render still sees the room rather than nothing at all.
  return mounted ? createPortal(room, document.body) : room;
};
