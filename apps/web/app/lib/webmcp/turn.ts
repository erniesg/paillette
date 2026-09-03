/**
 * Gestures as utterances.
 *
 * A search box has words and no gestures. A chat has words and no board. This
 * page has both, so a turn is not a string — it is
 * `{ text?, flagsDelta, selection, hovered, compareChoice }`, and **a click is
 * a turn even with no text**. That is the payload the model needs in order to
 * notice the gap between what someone said and what they actually chose, and
 * to say so: *"You said warm; you've picked three cool ones. I'm following the
 * picks."*
 *
 * Two entry points, and the important one has no model in it:
 *
 *  - `prepareTurn` builds the payload and drains the gesture journal.
 *  - `submitHumanTurn` decides whether a turn even needs the model. Enter on an
 *    empty bar with flags on the board is a **redeal**, run locally, no network
 *    call to the agent route at all. The agent is a second operator of this
 *    mechanism, not the mechanism.
 */

import { drainFlagChanges, type FlagChange } from './flags';
import { runRedeal, type RedealResult } from './redeal';
import { getWebMcpState } from './store';

export interface CompareChoice {
  winnerId: string;
  loserId: string;
  question: string | null;
}

/** Everything the human's turn carries, whether or not they typed anything. */
export interface HumanTurn {
  text?: string;
  /** Flags laid down since the previous turn. The gesture half of the turn. */
  flagsDelta: FlagChange[];
  selection: string[];
  hovered: string | null;
  compareChoice: CompareChoice | null;
  board: {
    order: string[];
    note: string | null;
    redeals: number;
  } | null;
}

let pendingCompareChoice: CompareChoice | null = null;

/** Recorded when a compare is resolved, and carried by the next turn. */
export const recordCompareChoice = (choice: CompareChoice) => {
  pendingCompareChoice = choice;
};

/**
 * Assemble the turn and clear the journals, so no gesture is reported twice.
 * Draining is the point: the model should see what changed since it last
 * looked, not the whole history restated every turn.
 */
export const prepareTurn = (text?: string): HumanTurn => {
  const state = getWebMcpState();
  const compareChoice = pendingCompareChoice;
  pendingCompareChoice = null;

  const trimmed = text?.trim();
  return {
    ...(trimmed ? { text: trimmed } : {}),
    flagsDelta: drainFlagChanges(),
    selection: [...state.selection],
    hovered: state.hovered,
    compareChoice,
    board: state.board
      ? {
          order: [...state.board.order],
          note: state.board.note,
          redeals: state.board.redeals,
        }
      : null,
  };
};

/** Does this turn have anything in it at all? */
export const isEmptyTurn = (turn: HumanTurn) =>
  !turn.text &&
  turn.flagsDelta.length === 0 &&
  turn.selection.length === 0 &&
  !turn.compareChoice;

export type HumanTurnOutcome =
  | { kind: 'redeal'; turn: HumanTurn; result: RedealResult }
  | { kind: 'agent'; turn: HumanTurn }
  | { kind: 'noop'; turn: HumanTurn };

/**
 * The beat. Called when the human commits — Enter, or a compare click.
 *
 * With text, the agent gets the turn. Without text, the flags on the board are
 * the whole instruction and the deterministic redeal runs on its own. The
 * caller never has to decide; it just reports what happened.
 */
export const submitHumanTurn = async (
  text?: string,
  options: { signal?: AbortSignal } = {}
): Promise<HumanTurnOutcome> => {
  const turn = prepareTurn(text);

  if (turn.text) return { kind: 'agent', turn };

  // No words. If anything is picked, the picks are the instruction.
  const result = await runRedeal({
    by: 'human',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result.ok && result.error.code === 'NO_EXEMPLARS') {
    return { kind: 'noop', turn };
  }
  return { kind: 'redeal', turn, result };
};

/**
 * How the gesture half of a turn reads to the model. Rendered as a plain
 * sentence rather than JSON because the rule it has to follow — gestures
 * outrank words — is a judgement, and judgements survive prose better than
 * they survive schemas.
 */
export const describeTurnForAgent = (
  turn: HumanTurn,
  titleOf: (id: string) => string
): string => {
  const lines: string[] = [];

  const picks = turn.flagsDelta.filter((change) => change.to === 'pick');
  const rejects = turn.flagsDelta.filter((change) => change.to === 'reject');
  const cleared = turn.flagsDelta.filter((change) => change.to === null);

  if (picks.length) {
    lines.push(`Picked: ${picks.map((c) => titleOf(c.artworkId)).join('; ')}.`);
  }
  if (rejects.length) {
    lines.push(
      `Rejected: ${rejects.map((c) => titleOf(c.artworkId)).join('; ')}.`
    );
  }
  if (cleared.length) {
    lines.push(
      `Unflagged: ${cleared.map((c) => titleOf(c.artworkId)).join('; ')}.`
    );
  }
  if (turn.compareChoice) {
    lines.push(
      `Chose ${titleOf(turn.compareChoice.winnerId)} over ${titleOf(turn.compareChoice.loserId)}${turn.compareChoice.question ? ` when asked: ${turn.compareChoice.question}` : ''}.`
    );
  }
  if (turn.selection.length) {
    lines.push(`Selected: ${turn.selection.map(titleOf).join('; ')}.`);
  }
  if (turn.hovered) {
    lines.push(`Pointing at: ${titleOf(turn.hovered)}.`);
  }

  return lines.join(' ');
};

export const __resetTurnStateForTest = () => {
  pendingCompareChoice = null;
};
