/**
 * The one way the page asks the in-page agent to take a turn.
 *
 * Almost every turn starts in the prompt bar, where the human typed it. One
 * does not: rewriting the exhibition statement is an instruction — §5c step 4,
 * *"it's not about weather, it's about leaving"* — and it arrives from an
 * editable paragraph three components away from the bar. Before this, that
 * gesture set some state, appended to an edit journal and stopped; the wall
 * only changed if the human afterwards typed something unrelated.
 *
 * Deliberately a channel and not a store field. A request is an event that
 * happens once, and a piece of state that means "please run this" has to be
 * cleared by whoever consumed it, which is the bug where one edit sends two
 * turns.
 */

import type { HumanTurnPayload } from './turn';

export interface AgentTurnRequest {
  /** What the human said, in their words. Goes up verbatim. */
  instruction: string;
  /**
   * The gesture half, already assembled and drained by the caller. Passing it
   * through is what stops the bar draining the journal a second time and
   * reporting an empty set of gestures for a turn that had plenty.
   */
  gestures: HumanTurnPayload;
}

type Listener = (request: AgentTurnRequest) => void;

let listener: Listener | null = null;

/** Mounted by the prompt bar. Last one wins; there is only ever one bar. */
export const onAgentTurnRequest = (next: Listener) => {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
};

/** Returns false when no bar is mounted, so a caller can fall back quietly. */
export const requestAgentTurn = (request: AgentTurnRequest): boolean => {
  if (!listener) return false;
  listener(request);
  return true;
};

export const __resetAgentRequestForTest = () => {
  listener = null;
};
