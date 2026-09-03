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
  exemplars: { positive: string[]; negative: string[] };
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
 * Run one deal. Identical whether the human pressed Enter or the agent called
 * the tool; only `by` differs, and it only affects what the board is labelled.
 */
export const runRedeal = async (
  request: RedealRequest
): Promise<RedealResult> => {
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
  if (exemplars.positive.length === 0) {
    return fail(
      'NO_EXEMPLARS',
      'Nothing has been picked yet, so there is no direction to deal in.',
      'Press P on a work worth keeping — or call flag_artworks — and redeal again.'
    );
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

  if (need > 0) {
    const alreadyDealt = state.board?.dealt ?? [];
    const response = await searchByExemplarsPublic({
      collectionId: target.collectionId,
      positiveIds: exemplars.positive,
      negativeIds: exemplars.negative,
      // Everything this session has already put in front of the human is out.
      // Without this a redeal hands back the same twelve and the loop stalls.
      excludeIds: [...new Set([...alreadyDealt, ...previousOrder])],
      topK: need + offset,
      negativeWeight,
      signal: request.signal,
    });
    dealtRecords = response.results.slice(offset, offset + need);
    rememberArtworks(dealtRecords);
    added = dealtRecords.map((result) => result.id);
  }

  const order = placeKeptInOrder(previousOrder, kept, added, size);
  const note = request.note?.trim() || null;

  setBoard({
    order,
    dealt: [...new Set([...(state.board?.dealt ?? []), ...previousOrder, ...added])],
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
    label: note || `${order.length} works, dealt from ${exemplars.positive.length} pick${exemplars.positive.length === 1 ? '' : 's'}`,
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
    strategy,
    note,
  };
};
