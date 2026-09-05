/**
 * The rooms the agent described and never built.
 *
 * §10 of the room report claims that *"the groups an agent names on the board
 * become the rooms a stranger walks through"*, and refuses — correctly — to
 * claim that a language model chooses to name them: every demonstration of
 * `annotate_atlas` went through `window.__paillette_webmcp.call`.
 *
 * Typed at instead, on staging, it does — but not every time. Asked *"split
 * these into two rooms: the working harbour and the empty shore"*, two runs out
 * of three called `set_view` with "atlas" and then `annotate_atlas`, and
 * published two named rooms a stranger could walk.
 *
 * The third is what this exists for. It understood the request completely and
 * answered it in the wrong medium: it retitled the show *"The Working Harbour /
 * The Empty Shore"*, wrote a statement opening *"This exhibition is divided
 * into two rooms at the edge of land"*, and wrote twelve labels beginning *"In
 * the Working Harbour…"* — calling `set_exhibition` and `write_labels` and
 * never `annotate_atlas`. It published with `regions: []`. The division was
 * perfect and entirely in prose, and a stranger who opened that link walked one
 * room.
 *
 * A thing that works two times in three is not something to put in front of
 * anyone, and the failure is invisible from inside the turn — every sentence
 * the model wrote was about two rooms. This is the same defect `unmarked-board`
 * was written for and the same discipline answers it: not more prose in the
 * prompt — the prompt does not mention `annotate_atlas` at all, and asking
 * harder in prose is the move that already failed twice on `flag_artworks` —
 * but a check against the state the tools actually wrote, run when the model
 * thinks it has finished, which can put the turn back to work.
 *
 * **What this does not do.** It does not choose the groups, name them, decide
 * how many there are, or put any work in any of them. It cannot: it never sees
 * a title or a subject, only which ids are hanging and whether `regions` is
 * empty. A page that composed the regions itself would have faked the claim
 * rather than proved it. All this refuses is a turn that was asked to divide a
 * show and divided it only in a sentence.
 */

export interface RoomsState {
  /** What the human typed in the turn being answered. Their ask, not a guess. */
  said: string | null;
  /** The named groups the tools actually wrote, whoever wrote them. */
  regions: { label: string; artworkIds: string[] }[];
  /** The works available to be grouped, in board order. */
  hung: { artworkId: string; title: string | null; artist: string | null }[];
}

export interface RoomsNudge {
  key: string;
  message: string;
}

/**
 * Below this there is nothing to divide, and a nudge would be asking for two
 * rooms out of three pictures. `annotate_atlas` itself says two to four regions
 * reads, so a show has to be able to fill them.
 */
const MIN_WORKS_TO_DIVIDE = 4;

/** How many works to name, so the model can group without searching again. */
const NAMED_WORKS = 12;

/**
 * Did they ask for the show to be divided?
 *
 * Deliberately narrow, because the cost of the two errors is not the same. A
 * missed ask leaves things exactly as they are today; a false one interrupts a
 * turn that was never about grouping, and the sentence that would trigger it
 * most easily is the commonest sentence on this page — *"build me a room about
 * storms at sea"*. So a bare "room" never counts. What counts is a division
 * actually expressed: a dividing verb aimed at something, or a plural count of
 * groups.
 */
/*
 * Stems, not bare forms, and two lists rather than one.
 *
 * A boundary probe over thirty-one phrasings found both halves of this. Bare
 * forms missed "I want these *separated* into halves", which is the same ask as
 * "separate these into halves" — so these match stems. But widening to stems
 * and keeping one list then fired on "Breaking waves *by* the shore", because
 * "by" is a grouping preposition after "group" and a preposition of place after
 * almost anything else.
 *
 * So a verb that groups may take either "into" or "by"; a verb that merely
 * divides has to land on "into". `\b` before each stem is what keeps
 * "groundbreaking" from reading as "break".
 */
const GROUPING_VERB = /\b(group|cluster)\w*\b/;
const DIVIDING_VERB = /\b(split|divid|separat|break|partition)\w*\b/;
const DIVIDE_VERB = new RegExp(
  `${GROUPING_VERB.source}|${DIVIDING_VERB.source}`
);
/** The thing a division produces, always plural — "a room" is a whole show. */
const GROUP_NOUN =
  /\b(rooms|groups|groupings|sections|clusters|halves|parts|wings)\b/;
/** "two rooms", "three groups", "separate sections". */
const COUNTED_GROUPS =
  /\b(two|three|four|five|six|2|3|4|5|6|several|separate|different|distinct)\s+(rooms|groups|groupings|sections|clusters|halves|parts|wings)\b/;

export const asksForRooms = (said: string | null): boolean => {
  const text = (said ?? '').toLowerCase();
  if (!text.trim()) return false;
  // "split these into two rooms", "break it into sections" — a division that
  // lands on something.
  if (DIVIDE_VERB.test(text) && /\b(into|in ?to)\b/.test(text)) return true;
  // "group them by subject", "cluster them by mood" — "by" only for the verbs
  // where it names an axis rather than a place.
  if (GROUPING_VERB.test(text) && /\bby\b/.test(text)) return true;
  if (DIVIDE_VERB.test(text) && GROUP_NOUN.test(text)) return true;
  // "hang these as two rooms" — the count does the work without a verb.
  return COUNTED_GROUPS.test(text);
};

/**
 * The one thing a turn asked to divide a show may not walk away without, or
 * null when it already has.
 *
 * Satisfied by regions on the board rather than by having called the tool, for
 * the reason `unmarked-board` learned the hard way: a tool that was called and
 * refused has left the human looking at exactly what they were looking at
 * before. Whoever wrote the regions satisfies it — if the human grouped the
 * works themselves, the job is done and being asked again is noise.
 */
export const findUnnamedRooms = (
  state: RoomsState,
  already: ReadonlySet<string>
): RoomsNudge | null => {
  if (!asksForRooms(state.said)) return null;
  if (state.regions.length > 0) return null;
  if (state.hung.length < MIN_WORKS_TO_DIVIDE) return null;

  // Keyed on the works, like the labels gap: a different set of works is a
  // different job. The ids are sorted because "which works" is the question,
  // not the order the hang happens to report them in.
  const key = `rooms:${state.hung
    .map((work) => work.artworkId)
    .sort()
    .join(',')}`;
  if (already.has(key)) return null;

  const named = state.hung
    .slice(0, NAMED_WORKS)
    .map((work) =>
      [work.artworkId, [work.title, work.artist].filter(Boolean).join(' — ')]
        .filter(Boolean)
        .join(': ')
    )
    .join('\n');

  return {
    key,
    message:
      'They asked you to divide this show, and the show is not divided. ' +
      'Naming the groups in your statement or your labels does not divide it — the statement is one block of prose to every reader, ' +
      'and the page has no idea which work you meant to put where. ' +
      'annotate_atlas is the only thing that makes a group real: it is what draws the works together under a name on the atlas, ' +
      'it is what travels in a shared link, and it is what becomes a separate room for someone walking the show.\n\n' +
      'Call annotate_atlas before you reply, with every region in one call — it replaces the arrangement rather than merging into it. ' +
      'The groups are yours to choose: how many, what they are called, and which work belongs in which. ' +
      'Use the division you have already decided on rather than inventing a second one, and give each region a name that says what those works share.\n\n' +
      `The works on the board:\n${named}\n\n` +
      'Choose from those ids; you have everything you need and do not need to search again. ' +
      'Anything that genuinely belongs in no group can be left out, and sits unlabelled below the named ones.',
  };
};
