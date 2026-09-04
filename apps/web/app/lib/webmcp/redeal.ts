/**
 * Redeal — the loop that works with no agent in it.
 *
 * Flag a few works, press Enter on an empty bar, and the board rearranges
 * itself from your flags: Rocchio relevance feedback over the same vectors the
 * search box already queries, no model call anywhere in the path. The agent
 * calls the *same function* through the `redeal` tool. That symmetry is the
 * whole argument — there is no agent-only API here, there is one workspace
 * with two operators.
 *
 * Two rules make it a loop rather than a mess:
 *
 *  - **Twelve cards, not sixty.** Each flag is then a deliberate act and each
 *    redeal is legible on screen, and on video.
 *  - **Picks stay where they are.** Enforced here, in the implementation, not
 *    by asking a model nicely. A model that forgets a pick must not be able to
 *    lose the human's work, so `kept` is computed from the confirmed flags and
 *    the caller has no argument that can override it.
 */

import type { ArtworkSearchResult } from '~/types';
import { recallArtworks, rememberArtworks } from './artwork-index';
import { toAgentArtworkSummary } from './artwork-summary';
import { searchByExemplarsPublic } from './client';
import { getExemplars } from './flags';
import { resolveSearchTarget } from './search-target';
import {
  getWebMcpState,
  setAgentResults,
  setBoard,
  setDealError,
  setDealing,
  type ResultSetOrigin,
} from './store';

/** The deal. Small enough that every move reads on screen. */
export const BOARD_SIZE = 12;

/**
 * How a strategy bends the score. Documented constants, tuned by hand, not
 * learned from anything.
 *
 * `negativeWeight` is Rocchio's `w` in
 * `cos(x, mean(pos)) − w · max_j cos(x, neg_j)`.
 *
 * `offset` skips that many of the nearest results before filling the board.
 * "Widen" therefore means what the word means — move further from what is
 * already hung — rather than quietly returning the same neighbours.
 */
export const REDEAL_STRATEGIES = {
  tighten: { negativeWeight: 0.8, offset: 0 },
  steady: { negativeWeight: 0.5, offset: 0 },
  widen: { negativeWeight: 0.25, offset: 6 },
} as const;

export type RedealStrategy = keyof typeof REDEAL_STRATEGIES;

/** Matches the per-side cap the exemplar route enforces. */
const MAX_EXEMPLARS_PER_SIDE = 32;

/**
 * The works in front of the human right now: the dealt board once there is
 * one, and otherwise their own search grid. Before the first deal `board` is
 * null, which is exactly the moment someone is most likely to start throwing
 * things out, so reading only the board would miss the case that matters.
 */
export const worksOnScreen = (state: {
  board?: { order: string[] } | null;
  humanResults?: { items: { id: string }[] } | null;
}): string[] =>
  state.board?.order?.length
    ? [...state.board.order]
    : (state.humanResults?.items ?? []).map((item) => item.id);

/**
 * What the positive half of the deal is computed from.
 *
 * "I can tell you what I don't want, but not what I do" is the most common
 * thing a person can say about pictures, and it used to be a dead key here:
 * with nothing picked, the deal refused and the board did not move. But a cull
 * has an answer for it, and it is the obvious one — **the works you left alone
 * are the direction**. So when there are no picks, the unrejected works on
 * screen seed the centroid and the rejects push against it:
 *
 *     cos(x, mean(screen \ rejects)) − w · max_j cos(x, neg_j)
 *
 * Same scoring function, same route, same weights; only where the positives
 * came from differs. They are seeds, not picks: they set the direction and
 * then leave the board, because nothing was chosen and nothing has earned a
 * seat. Only confirmed picks hold their position.
 */
export type SeedSource = 'picks' | 'unrejected';

export const seedPositives = (
  exemplars: { positive: string[]; negative: string[] },
  onScreen: readonly string[]
): { positive: string[]; from: SeedSource } => {
  if (exemplars.positive.length) {
    return { positive: exemplars.positive, from: 'picks' };
  }
  const rejected = new Set(exemplars.negative);
  return {
    positive: onScreen
      .filter((id) => !rejected.has(id))
      .slice(0, MAX_EXEMPLARS_PER_SIDE),
    from: 'unrejected',
  };
};

export interface RedealRequest {
  strategy?: RedealStrategy;
  count?: number;
  note?: string;
  /** Whose move this was. Decides the ink the board is drawn in. */
  by: ResultSetOrigin;
  collection?: unknown;
  signal?: AbortSignal;
}

export interface RedealOutcome {
  ok: true;
  /** Ids that survived, in their new positions. Confirmed picks, always. */
  kept: string[];
  /** Ids that left the board. */
  removed: string[];
  /** Ids dealt in this round. */
  added: string[];
  order: string[];
  /** The human's confirmed flags — always the flags, never the seeds. */
  exemplars: { positive: string[]; negative: string[] };
  /**
   * Where the positive half came from. `'unrejected'` means they rejected
   * without picking and the works they left alone set the direction. Worth
   * reporting rather than hiding: an agent narrating this board must not say
   * they picked anything, because they did not.
   */
  seededBy: SeedSource;
  strategy: RedealStrategy;
  note: string | null;
}

export interface RedealFailure {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

export type RedealResult = RedealOutcome | RedealFailure;

const fail = (code: string, message: string, hint?: string): RedealFailure => ({
  ok: false,
  error: { code, message, ...(hint ? { hint } : {}) },
});

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What the board is called when the agent did not name it. Says which gesture
 * dealt it, in the fewest words that stay true.
 */
const dealLabel = (
  size: number,
  from: SeedSource,
  exemplars: { positive: string[]; negative: string[] }
): string =>
  from === 'picks'
    ? `${plural(size, 'work')}, dealt from ${plural(exemplars.positive.length, 'pick')}`
    : `${plural(size, 'work')}, dealt away from ${plural(exemplars.negative.length, 'reject')}`;

/**
 * Lay the survivors back down where they were, and let the newcomers fill the
 * gaps around them.
 *
 * Position is meaning on a board: if a pick jumped to the front on every
 * redeal the human would lose track of what they had already decided about,
 * and the deal animation would have nothing continuous to animate. So a kept
 * work holds the index it had, and only slides when the board shrank under it.
 */
export const placeKeptInOrder = (
  previousOrder: readonly string[],
  kept: readonly string[],
  added: readonly string[],
  size: number
): string[] => {
  const slots = new Array<string | null>(size).fill(null);
  const overflow: string[] = [];

  for (const id of kept) {
    const previousIndex = previousOrder.indexOf(id);
    const wanted =
      previousIndex >= 0 && previousIndex < size ? previousIndex : -1;
    if (wanted >= 0 && slots[wanted] === null) {
      slots[wanted] = id;
    } else {
      overflow.push(id);
    }
  }

  // A pick whose old seat is gone takes the first free one — it is never
  // dropped, whatever the requested size.
  const queue = [...overflow, ...added];
  for (let index = 0; index < size && queue.length; index += 1) {
    if (slots[index] === null) slots[index] = queue.shift() ?? null;
  }

  const order = slots.filter((id): id is string => id !== null);
  // Anything still queued is a pick that could not fit. Keep it: losing a
  // human's pick to an arithmetic edge case is the one failure this must not
  // have.
  for (const id of queue) {
    if (kept.includes(id)) order.push(id);
  }
  return order;
};

/**
 * One deal at a time.
 *
 * Enter is cheap to press and a deal over a slow connection is not fast, so a
 * person will press it again — and two deals in flight write the board twice
 * from two different reads of the same state. The later write wins, the
 * earlier one's newcomers vanish, and in the worst interleaving a pick is
 * placed against an order that no longer exists. Refusing the second press is
 * the only version of this with one outcome.
 */
let dealInFlight = false;

/**
 * Run one deal. Identical whether the human pressed Enter or the agent called
 * the tool; only `by` differs, and it only affects what the board is labelled.
 */
export const runRedeal = async (
  request: RedealRequest
): Promise<RedealResult> => {
  if (dealInFlight) {
    return fail(
      'REDEAL_IN_FLIGHT',
      'A deal is already running.',
      'Wait for the board to settle; the flags are unchanged and the next deal will read them.'
    );
  }
  const state = getWebMcpState();
  const target = resolveSearchTarget(request.collection);
  if (target.kind === 'indexed') {
    return fail(
      'REDEAL_UNAVAILABLE_HERE',
      'Relevance feedback needs the published vector index, and this page is scoped to a collection built in this tab.',
      'Name a public collection to redeal against it, or search the indexed collection directly.'
    );
  }

  const exemplars = getExemplars();
  const onScreen = worksOnScreen(state);
  const seeds = seedPositives(exemplars, onScreen);
  if (seeds.positive.length === 0) {
    // Genuinely nothing to deal from: no picks, and every work on screen has
    // been thrown out — or there is no screen yet. This is the only remaining
    // way Enter can decline, and it now says so. A refusal that draws nothing
    // is indistinguishable from a broken key.
    const failure = fail(
      'NO_EXEMPLARS',
      exemplars.negative.length
        ? 'Everything on screen has been rejected, so there is nothing left to deal from.'
        : 'Nothing is on the board yet, so there is no direction to deal in.',
      'Run a search, or press P on a work worth keeping, and redeal again.'
    );
    setDealError(failure.error);
    return failure;
  }

  const size = Math.min(
    Math.max(Math.round(request.count ?? BOARD_SIZE), 1),
    60
  );
  const strategy: RedealStrategy = request.strategy ?? 'steady';
  const { negativeWeight, offset } = REDEAL_STRATEGIES[strategy];

  const previousOrder = state.board?.order ?? [];
  const pinned = new Set(exemplars.positive);
  // Pin survival: computed from the flags, not from anything the caller said.
  //
  // Every confirmed pick ends up on the board, not just the ones already
  // hanging on it. The first redeal of a session is the case that matters —
  // the human picked from their own search grid, there is no board yet, and
  // dropping those picks would silently discard the only instruction they gave.
  const kept = [
    ...previousOrder.filter((id) => pinned.has(id)),
    ...exemplars.positive.filter((id) => !previousOrder.includes(id)),
  ];
  const removed = previousOrder.filter((id) => !pinned.has(id));
  const need = Math.max(size - kept.length, 0);

  let added: string[] = [];
  let dealtRecords: ArtworkSearchResult[] = [];

  dealInFlight = true;
  setDealing(true);
  setDealError(null);
  try {
    if (need > 0) {
      const alreadyDealt = state.board?.dealt ?? [];
      const response = await searchByExemplarsPublic({
        collectionId: target.collectionId,
        positiveIds: seeds.positive,
        negativeIds: exemplars.negative,
        // Everything this session has already put in front of the human is out.
        // Without this a redeal hands back the same twelve and the loop stalls.
        // `onScreen` matters on the rejects-only path: the seeds came off the
        // human's own grid, which the board does not yet know about, and
        // dealing them straight back would read as nothing having happened.
        excludeIds: [
          ...new Set([...alreadyDealt, ...previousOrder, ...onScreen]),
        ],
        topK: need + offset,
        negativeWeight,
        signal: request.signal,
      });
      const widened = response.results.slice(offset, offset + need);
      // Widening skips the nearest band on purpose. If the collection could not
      // supply enough past it — a narrow corner of the index, or a session that
      // has already dealt most of what matches — fill from the band we skipped
      // rather than dealing a short board. A half-empty board reads as a
      // failure; a slightly nearer one reads as an answer.
      const shortfall = need - widened.length;
      dealtRecords =
        shortfall > 0
          ? [...widened, ...response.results.slice(0, offset).slice(0, shortfall)]
          : widened;
      rememberArtworks(dealtRecords);
      added = dealtRecords.map((result) => result.id);
    }

    const order = placeKeptInOrder(previousOrder, kept, added, size);
    const note = request.note?.trim() || null;

    setBoard({
      order,
      dealt: [
        ...new Set([
          ...(state.board?.dealt ?? []),
          ...previousOrder,
          ...onScreen,
          ...added,
        ]),
      ],
      note,
      lastChangeBy: request.by,
      redeals: (state.board?.redeals ?? 0) + 1,
      at: Date.now(),
    });

    // Mirror onto the canvas channel the search page already renders, so the
    // board is on screen rather than only in the tool result.
    const { found } = recallArtworks(order);
    setAgentResults({
      origin: request.by,
      label: note || dealLabel(order.length, seeds.from, exemplars),
      ...(note ? { note } : {}),
      items: found.map(toAgentArtworkSummary),
      at: Date.now(),
    });

    return {
      ok: true,
      kept,
      removed,
      added,
      order,
      exemplars,
      seededBy: seeds.from,
      strategy,
      note,
    };
  } catch (error) {
    // The board is left exactly as it was: a failed deal must not half-apply.
    // Recording it is what stops Enter being a dead key when the network is
    // down — get_view_context reports it, so the agent can say so, and the
    // page has something to mark without anyone writing a sentence.
    const failure = fail(
      'REDEAL_FAILED',
      error instanceof Error ? error.message : 'The deal could not be run.',
      'The flags are unchanged. Press Enter again once the connection is back.'
    );
    setDealError(failure.error);
    return failure;
  } finally {
    dealInFlight = false;
    setDealing(false);
  }
};

/** Test-only: clears the in-flight latch a rejected deal would otherwise hold. */
export const __resetRedealForTest = () => {
  dealInFlight = false;
};
