/**
 * The turn where only one hand wrote on the board.
 *
 * §P1: *"the agent flags so it can disagree in the same currency the human
 * uses"*, and §7.2: *"every screenshot shows two hands"*. Across 508
 * model-chosen tool calls that had never once happened — `flag_artworks` 0,
 * `compare_artworks` 0, `search_by_exemplars` 0 — while `search_artworks` ran
 * 192 times. Every demonstration of a proposal in every report was driven
 * through the debug console, which is a back door presented as behaviour.
 *
 * The prompt had told the model it *may* flag since iteration 3 and it never
 * did, because the same prompt also tells it — correctly — to redeal and write
 * a note, and a turn that has redealt and written a note feels finished. A
 * proposal is a register the model can decline forever without ever disobeying
 * anything, and asking harder in prose is the move that has already been tried
 * twice.
 *
 * So this is the same discipline `unfinished-show` uses on the exhibition: a
 * check against the state the tools actually wrote, run at the moment the model
 * thinks it has finished, which can put the turn back to work exactly once.
 * Nothing here composes a flag, chooses a work, or writes a reason — it only
 * refuses to let a turn that answered someone's hands end with a sentence and
 * no mark. The model still makes every judgement in it, and every judgement it
 * makes is provisional and dashed until the human confirms it.
 */

export interface BoardCandidate {
  artworkId: string;
  title: string | null;
  artist: string | null;
  /** null when nothing has been marked on it by either party. */
  flag: 'pick' | 'reject' | null;
}

export interface BoardMarkState {
  /**
   * True when the human's hands moved in the turn being answered — a flag, or
   * an answer to a two-up. Words alone do not owe a proposal: someone who has
   * typed a plain query is asking for pictures, and a dashed mark on a board
   * they have not touched is the agent talking over them.
   */
  humanGestured: boolean;
  /** The works in front of them, in board order. */
  board: BoardCandidate[];
}

/** Enough for a two-up to be a choice rather than a foregone conclusion. */
const MIN_FOR_COMPARE = 2;

/**
 * How many unmarked works to name in the nudge. The model has to pick from
 * these without another search — the proposal turn was starving on turn budget
 * before it ever got here — so the list has to be short enough to read and
 * long enough to choose from.
 */
const NAMED_CANDIDATES = 8;

const describe = (work: BoardCandidate) =>
  [work.artworkId, [work.title, work.artist].filter(Boolean).join(' — ')]
    .filter(Boolean)
    .join(': ');

/**
 * The one sentence the model is not allowed to end the turn without acting on,
 * or null when it already has.
 *
 * `alreadyCalled` is the set of tool names this turn has run. Either tool
 * satisfies it: a mark and a two-up are the same act at different scales — a
 * claim about the board that the human can accept or throw out with one key.
 */
export const findUnmarkedBoard = (
  state: BoardMarkState,
  alreadyCalled: ReadonlySet<string>
): string | null => {
  if (!state.humanGestured) return null;
  if (alreadyCalled.has('flag_artworks')) return null;
  if (alreadyCalled.has('compare_artworks')) return null;

  // Only works neither party has marked. Proposing a pick on something they
  // have already picked is agreeing with them loudly, which is the failure
  // mode one register over from silence.
  const open = state.board.filter((work) => work.flag === null);
  if (open.length === 0) return null;

  const named = open.slice(0, NAMED_CANDIDATES).map(describe).join('\n');
  const twoUp =
    open.length >= MIN_FOR_COMPARE
      ? ' — or compare_artworks on two of them that differ on the one axis you are still unsure about, with the question set between them'
      : '';

  return (
    'They have marked this board and you have not. ' +
    'Their marks and yours are the same currency and land on the same cards, so a turn that answers someone’s hands with only a sentence has left them nothing to agree or disagree with. ' +
    'The board is the transcript, and one hand has written on it.\n\n' +
    `Before you reply, call flag_artworks on at most three of the unmarked works below${twoUp}. ` +
    'Give every flag a reason naming what you can see in that record — the palette, the medium, the thing it has that the picks do not. ' +
    'Your flags arrive provisional, are drawn dashed, and steer nothing until they press P or X on the same work, so a wrong one costs you nothing and tells them more than a hedge would. ' +
    'Disagreeing is the point: if their words and their flags pull apart, mark what you actually think.\n\n' +
    'Keep your note as well. This is in addition to the sentence, not instead of it — a board full of dashed marks and no wall label is the same defect the other way round.\n\n' +
    `Unmarked works on the board:\n${named}\n\n` +
    'Choose from those ids. You have everything you need; do not search again first.'
  );
};
