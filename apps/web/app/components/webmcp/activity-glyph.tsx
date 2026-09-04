/**
 * The glyph itself: five character cells that move while the agent works.
 *
 * The frames are swapped by writing to the text node directly rather than
 * through React state. A running tool call means a frame every 110–340ms, and
 * the deal animation — the one visual in this build worth filming — is a 420ms
 * FLIP happening at the same moment. Re-rendering a subtree on a timer next to
 * that is a way to lose frames from the shot for no gain: nothing else on the
 * page reads the current frame, so nothing else needs to know it changed.
 *
 * The span is keyed on the state it belongs to, so React remounts it whenever
 * the phase or the kind changes. That is not cosmetic: without it React would
 * compare the *last value it rendered* against the new one, agree they match,
 * and leave whatever the interval last wrote sitting in the DOM.
 */

import { useEffect, useRef } from 'react';
import {
  GLYPH_ANNOUNCEMENT,
  LIVE_ANNOUNCEMENT,
  glyphAnimationFor,
  stillFrameFor,
  type GlyphState,
} from '~/lib/webmcp/activity-glyph';

export function ActivityGlyph({
  state,
  reducedMotion,
}: {
  state: GlyphState;
  /**
   * Passed in rather than read here so the panel and the glyph cannot disagree,
   * and so a test can drive both paths without touching `matchMedia`.
   */
  reducedMotion: boolean;
}) {
  const cellsRef = useRef<HTMLSpanElement>(null);
  const { phase, kind, live } = state;
  const still = stillFrameFor(state);
  const motion = glyphAnimationFor(state);
  const animated = motion !== null && !reducedMotion;

  useEffect(() => {
    if (!animated || !motion) return;
    const node = cellsRef.current;
    if (!node) return;

    const { frames, ms } = motion;
    let index = 0;
    node.textContent = frames[0]!;
    const timer = window.setInterval(() => {
      index = (index + 1) % frames.length;
      node.textContent = frames[index]!;
    }, ms);

    return () => window.clearInterval(timer);
    // `motion` is one of a handful of module-level constants, so its identity
    // is stable per state and this is a real dependency rather than a new
    // object every render.
  }, [animated, motion]);

  return (
    <>
      <span
        // Remount on every state change; see the note at the top of the file.
        key={`${phase}:${kind ?? 'none'}:${live}:${animated}`}
        ref={cellsRef}
        className="pa-activity-cells"
        data-phase={phase}
        data-kind={kind ?? 'none'}
        // The connection as an attribute rather than as a word. Styling can
        // give a live glyph its own weight without anything on the page
        // acquiring a label that says "live mode".
        data-live={live}
        aria-hidden="true"
      >
        {still}
      </span>
      {/*
        The accessible rendering of a signal that is otherwise only a picture.
        Never painted: a state you can only perceive through motion, or only
        through colour, is a state some people do not have.

        Tool work is announced ahead of connection state for the same reason it
        animates ahead of it — one is what you are waiting on, the other is a
        standing fact.
      */}
      <span className="pa-activity-sr" role="status">
        {phase === 'running' && kind
          ? GLYPH_ANNOUNCEMENT[kind]
          : phase === 'failed'
            ? 'last tool call failed'
            : LIVE_ANNOUNCEMENT[live]}
      </span>
    </>
  );
}
