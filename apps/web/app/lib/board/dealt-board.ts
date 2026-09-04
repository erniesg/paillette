/**
 * Is a board on the table, and which of its works are nailed down?
 *
 * This used to live inline in `ResultsLayout`, which was fine while the board
 * was the only thing that cared. It is not any more: once a board is dealt the
 * page also has to fold away the hero, the search field and the suggestion
 * rail, so that the agent's sentence, twelve cards and the bar you press Enter
 * in are all inside one 900px screen. Two copies of "is a board dealt" would
 * drift, and the failure is silent and ugly — chrome collapsing around a
 * masonry, or a deal filmed under a full-height search page.
 *
 * So it is one function, exported, with the page and the board both calling it.
 */

interface DealtBoardInput {
  order: readonly string[];
}

interface FlagInput {
  artworkId: string;
  flag: string;
  provisional?: boolean;
}

export interface DealtBoard {
  /** Confirmed human picks that are on screen: the slots that must not move. */
  preservedIds: string[];
}

export const resolveDealtBoard = (
  board: DealtBoardInput | null | undefined,
  flags: readonly FlagInput[],
  results: readonly { id: string }[]
): DealtBoard | null => {
  if (!board?.order.length) return null;

  // The board has to be *these* works, not a board that happens to exist —
  // running a fresh text search after a deal must go back to browsing.
  const onScreen = new Set(results.map((result) => result.id));
  if (board.order.length !== onScreen.size) return null;
  if (!board.order.every((id) => onScreen.has(id))) return null;

  // Only confirmed human picks pin a slot. An agent's proposal is dashed until
  // the human takes it, and a proposal must not be able to nail a card to the
  // board.
  const preservedIds = flags
    .filter((flag) => flag.flag === 'pick' && !flag.provisional)
    .map((flag) => flag.artworkId)
    .filter((id) => onScreen.has(id));

  return { preservedIds };
};
