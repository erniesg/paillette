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

import { recallArtwork } from './artwork-index';
import {
  drainExhibitionEdits,
  peekExhibitionEdits,
  type ExhibitionEdit,
} from './exhibition';
import { toAgentArtworkSummary } from './artwork-summary';
import {
  drainFlagChanges,
  peekFlagChanges,
  setFlag,
  type FlagChange,
} from './flags';
import { runRedeal, type RedealResult } from './redeal';
import { getWebMcpState, setCompare } from './store';

/**
 * The answer to a two-up.
 *
 * Three doors, not two. Forcing a choice between two works the human does not
 * want is a lie about taste, and the lie is expensive: "neither, they're both
 * too busy" is a stronger signal than either choice would have been, because
 * it names the axis rather than picking a point on it. So the refusal is a
 * real answer that gets flagged, journalled and sent, not a dismissal.
 */
export type CompareChoice =
  | {
      kind: 'winner';
      winnerId: string;
      loserId: string;
      question: string | null;
    }
  | {
      kind: 'neither';
      artworkIds: [string, string];
      /** What they said was wrong with both, if they said. */
      reason: string | null;
      question: string | null;
    };

/** Everything the human's turn carries, whether or not they typed anything. */
export interface HumanTurn {
  text?: string;
  /** Flags laid down since the previous turn. The gesture half of the turn. */
  flagsDelta: FlagChange[];
  selection: string[];
  hovered: string | null;
  compareChoice: CompareChoice | null;
  /**
   * What the human rewrote in the show since the last turn.
   *
   * A correction to the statement is the most consequential gesture on this
   * page and the quietest: it happens by typing into a field. Carrying it in
   * the turn is what makes "it's not about weather, it's about leaving" a
   * thing the agent is *told*, rather than something it finds if it happens to
   * look.
   */
  exhibitionEdits: ExhibitionEdit[];
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
 * Answering "this one or that one?" with a click.
 *
 * The click is worth an order of magnitude more than the sentence someone
 * would have had to write instead, so it is spent properly: the winner becomes
 * a pick, the loser a reject, and both land in the same exemplar set every
 * other gesture feeds.
 *
 * It does **not** fire a turn. Flags never trigger the agent — Enter is the
 * beat — or the board thrashes under the human's hands while they are still
 * deciding. The choice waits in the journal and rides the next turn, which is
 * how the agent finds out either way.
 */
export const resolveCompare = (
  winnerId: string,
  loserId: string,
  question: string | null = null
) => {
  setFlag(winnerId, 'pick', { by: 'human' });
  setFlag(loserId, 'reject', { by: 'human' });
  recordCompareChoice({ kind: 'winner', winnerId, loserId, question });
  setCompare(null);
};

/**
 * Answering "neither".
 *
 * Both works are rejected, in the human's own ink, with whatever they said as
 * the reason — so the refusal reaches the exemplar engine as two negatives on
 * the same axis, which is the strongest single move the culling loop has. The
 * reason is optional: a person who cannot say why still means it, and asking
 * them to justify a refusal before it counts is the mistake the two-up exists
 * to avoid.
 */
export const refuseCompare = (
  artworkIds: [string, string],
  reason: string | null = null,
  question: string | null = null
) => {
  const trimmed = reason?.trim() || null;
  for (const artworkId of artworkIds) {
    setFlag(artworkId, 'reject', {
      by: 'human',
      ...(trimmed ? { reason: trimmed } : {}),
    });
  }
  recordCompareChoice({
    kind: 'neither',
    artworkIds,
    reason: trimmed,
    question,
  });
  setCompare(null);
};

const buildTurn = (
  text: string | undefined,
  flagsDelta: FlagChange[],
  compareChoice: CompareChoice | null,
  exhibitionEdits: ExhibitionEdit[]
): HumanTurn => {
  const state = getWebMcpState();
  const trimmed = text?.trim();
  return {
    ...(trimmed ? { text: trimmed } : {}),
    flagsDelta,
    selection: [...state.selection],
    hovered: state.hovered,
    compareChoice,
    exhibitionEdits,
    board: state.board
      ? {
          order: [...state.board.order],
          note: state.board.note,
          redeals: state.board.redeals,
        }
      : null,
  };
};

/**
 * Assemble the turn and clear the journals, so no gesture is reported twice.
 * Draining is the point: the model should see what changed since it last
 * looked, not the whole history restated every turn.
 *
 * Only for a turn that is actually going to a model. "Since the last turn"
 * means since the last time anyone spoke to it, which is not the same as
 * since the last thing the human did.
 */
export const prepareTurn = (text?: string): HumanTurn => {
  const compareChoice = pendingCompareChoice;
  pendingCompareChoice = null;
  return buildTurn(
    text,
    drainFlagChanges(),
    compareChoice,
    drainExhibitionEdits()
  );
};

/**
 * The same turn, without emptying anything.
 *
 * A deterministic redeal is a turn the human took on the board and no model
 * ever saw. Draining there would silently spend their gestures on nothing:
 * they would flag three works, press Enter, watch the board deal — and the
 * next thing they typed would reach the agent with nothing attached, which is
 * precisely the behaviour the payload exists to prevent.
 */
export const peekTurn = (text?: string): HumanTurn =>
  buildTurn(
    text,
    peekFlagChanges(),
    pendingCompareChoice,
    peekExhibitionEdits()
  );

/** Does this turn have anything in it at all? */
export const isEmptyTurn = (turn: HumanTurn) =>
  !turn.text &&
  turn.flagsDelta.length === 0 &&
  turn.selection.length === 0 &&
  turn.exhibitionEdits.length === 0 &&
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
  if (text?.trim()) return { kind: 'agent', turn: prepareTurn(text) };

  // No words. If anything is picked, the picks are the whole instruction, and
  // no model is involved — so the gestures are only reported, not spent.
  const result = await runRedeal({
    by: 'human',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const turn = peekTurn();
  if (!result.ok && result.error.code === 'NO_EXEMPLARS') {
    return { kind: 'noop', turn };
  }
  return { kind: 'redeal', turn, result };
};

/**
 * The turn as `POST /api/public-agent/turn` wants it, with titles resolved.
 *
 * Resolving them here is not a nicety: the session index lives in this tab and
 * the agent route is stateless, so if the page does not name the works it
 * flagged, the model receives a list of opaque ids and cannot say anything
 * about *what* was rejected. The whole point is that it can.
 */
export interface HumanTurnPayload {
  text?: string;
  flagsDelta: {
    artworkId: string;
    title?: string;
    to: 'pick' | 'reject' | null;
  }[];
  selection: { id: string; title?: string }[];
  hovered: { id: string; title?: string } | null;
  compareChoice:
    | {
        winner: { id: string; title?: string };
        loser: { id: string; title?: string };
        question?: string | null;
      }
    | {
        neither: { id: string; title?: string }[];
        reason?: string | null;
        question?: string | null;
      }
    | null;
  exhibitionEdits: {
    field: 'title' | 'statement' | 'label';
    work?: string;
    value: string;
  }[];
}

const titleOf = (id: string): string | undefined => {
  const artwork = recallArtwork(id);
  if (!artwork) return undefined;
  const summary = toAgentArtworkSummary(artwork);
  if (!summary.title) return undefined;
  return summary.artist ? `${summary.title} (${summary.artist})` : summary.title;
};

const namedId = (id: string) => {
  const title = titleOf(id);
  return title ? { id, title } : { id };
};

export const toTurnPayload = (turn: HumanTurn): HumanTurnPayload => ({
  ...(turn.text ? { text: turn.text } : {}),
  flagsDelta: turn.flagsDelta.map((change) => {
    const title = titleOf(change.artworkId);
    return {
      artworkId: change.artworkId,
      ...(title ? { title } : {}),
      to: change.to,
    };
  }),
  selection: turn.selection.map(namedId),
  hovered: turn.hovered ? namedId(turn.hovered) : null,
  compareChoice: !turn.compareChoice
    ? null
    : turn.compareChoice.kind === 'winner'
      ? {
          winner: namedId(turn.compareChoice.winnerId),
          loser: namedId(turn.compareChoice.loserId),
          question: turn.compareChoice.question,
        }
      : {
          neither: turn.compareChoice.artworkIds.map(namedId),
          reason: turn.compareChoice.reason,
          question: turn.compareChoice.question,
        },
  exhibitionEdits: turn.exhibitionEdits.map((edit) => {
    const title = edit.artworkId ? titleOf(edit.artworkId) : undefined;
    return {
      field: edit.field,
      ...(title ? { work: title } : edit.artworkId ? { work: edit.artworkId } : {}),
      value: edit.value,
    };
  }),
});

export const __resetTurnStateForTest = () => {
  pendingCompareChoice = null;
};
