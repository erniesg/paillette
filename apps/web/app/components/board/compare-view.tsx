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

import { useSyncExternalStore } from 'react';
import { ImageWithFallback } from '~/components/artwork/image-with-fallback';
import { NoImagePlaceholder } from '~/components/artwork/no-image-placeholder';
import { recallArtwork } from '~/lib/webmcp/artwork-index';
import {
  getWebMcpServerState,
  getWebMcpState,
  setCompare,
  subscribeWebMcpState,
  type CompareState,
} from '~/lib/webmcp/store';
import { resolveCompare } from '~/lib/webmcp/turn';
import { toAgentArtworkSummary } from '~/lib/webmcp/artwork-summary';

const useCompare = (): CompareState | null =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().compare,
    () => getWebMcpServerState().compare
  );

export const CompareView = () => {
  const compare = useCompare();
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

  return (
    <div
      className="paillette-compare fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-neutral-950/95 p-8"
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
          worth a control is the answer neither picture offers. */}
      <button
        type="button"
        onClick={() => setCompare(null)}
        className="border border-white/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50 hover:text-white/80"
      >
        Neither
      </button>
    </div>
  );
};
