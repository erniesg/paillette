/**
 * Planning one deal of the board.
 *
 * The board is a fixed number of slots. A redeal replaces most of them, but the
 * works the human has picked must not move: continuity is the whole point of
 * the animation, because a card that stays still while its neighbours are
 * replaced is a visible record of a decision the human made.
 *
 * So the order a redeal renders in is not the order the search returned. It is:
 * held ids pinned to the slot index they already occupied, and everything else
 * poured into the gaps in the order the search gave them. Getting that right is
 * a list problem, not an animation problem, which is why it lives here as a
 * pure function with no React in it.
 */

/** How held ids are positioned. */
export type DealPlacement =
  /** Pin each held id to the slot index it already occupied. */
  | 'in-place'
  /**
   * Move held ids to the front of the board instead. This is the
   * `prefers-reduced-motion` path: with no animation to carry the continuity,
   * collecting the picks at the front is the legible way to show they survived.
   */
  | 'front';

export interface PlanDealInput {
  /** Ids on the board before this deal, in board order. */
  previous: readonly string[];
  /** Ids the deal wants on the board, in relevance order. */
  next: readonly string[];
  /** Ids that must survive the deal in place — in practice, the human's picks. */
  preservedIds?: readonly string[];
  /** Slots on the board. Defaults to however many ids `next` supplies. */
  size?: number;
  /** Per-card arrival delay, in ms. */
  staggerMs?: number;
  placement?: DealPlacement;
}

export interface DealPlan {
  /** Ids in the order the board should render them. */
  order: string[];
  /** Ids that survived the deal and kept their position. */
  held: string[];
  /** Ids new to the board this deal — these animate in. */
  entering: string[];
  /** Ids that were on the board and no longer are — these animate out to the tray. */
  leaving: string[];
  /** Arrival delay in ms, keyed by id. Only entering ids appear here. */
  stagger: Record<string, number>;
}

const dedupe = (ids: readonly string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

/**
 * Work out what each id on the board is doing this deal.
 *
 * An id is only ever *held* if it is in `preservedIds` and present both before
 * and after. A preserved id the deal dropped cannot be held — there is nothing
 * to hold — and pretending otherwise would put a card on the board that the
 * search no longer backs.
 */
export function planDeal({
  previous,
  next,
  preservedIds = [],
  size,
  staggerMs = 15,
  placement = 'in-place',
}: PlanDealInput): DealPlan {
  const previousIds = dedupe(previous);
  const nextIds = dedupe(next);
  const slotCount = Math.max(0, size ?? nextIds.length);

  const previousSet = new Set(previousIds);
  const nextSet = new Set(nextIds);
  const preservedSet = new Set(preservedIds);

  // Held in previous-board order, so 'front' placement keeps their relative
  // arrangement rather than reshuffling picks against each other.
  const held = previousIds.filter(
    (id) => preservedSet.has(id) && nextSet.has(id)
  );
  const heldSet = new Set(held);

  const incoming = nextIds.filter((id) => !heldSet.has(id));

  let order: string[];
  let placedHeld: string[];

  if (placement === 'front') {
    placedHeld = held.slice(0, slotCount);
    order = [...placedHeld, ...incoming].slice(0, slotCount);
  } else {
    const slots: (string | null)[] = Array.from({ length: slotCount }, () => null);
    placedHeld = [];

    for (const id of held) {
      const slot = previousIds.indexOf(id);
      // A pick that used to sit past the end of the board has no slot to keep.
      // It re-enters as an ordinary card rather than displacing someone.
      if (slot < 0 || slot >= slotCount || slots[slot] !== null) continue;
      slots[slot] = id;
      placedHeld.push(id);
    }

    const placedSet = new Set(placedHeld);
    const queue = [
      // A held-but-unplaceable id still belongs on the board; it just does not
      // get to keep a position. It goes back in at its search rank.
      ...nextIds.filter((id) => !placedSet.has(id)),
    ];

    let cursor = 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      if (slots[slot] !== null) continue;
      if (cursor >= queue.length) break;
      slots[slot] = queue[cursor]!;
      cursor += 1;
    }

    order = slots.filter((id): id is string => id !== null);
  }

  const orderSet = new Set(order);
  const entering = order.filter((id) => !previousSet.has(id));
  const leaving = previousIds.filter((id) => !orderSet.has(id));

  // Stagger runs in board order, not search order, so the eye reads the
  // newcomers arriving left-to-right across the gaps.
  const stagger: Record<string, number> = {};
  entering.forEach((id, index) => {
    stagger[id] = index * staggerMs;
  });

  return {
    order,
    held: placedHeld.filter((id) => orderSet.has(id)),
    entering,
    leaving,
    stagger,
  };
}
