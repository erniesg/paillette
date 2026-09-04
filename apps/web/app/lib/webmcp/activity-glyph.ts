/**
 * The agent's presence, reduced to five character cells.
 *
 * The page used to carry a list of lines describing what the agent had just
 * done — a transcript with extra steps, holding permanent space to say things
 * that were mostly over. This replaces it with a mark: quiet when nothing is
 * happening, moving while a tool runs, and expandable into the real log.
 *
 * Two decisions worth defending:
 *
 * **The motion is semantic.** There is no single spinner. Which of six motions
 * plays is derived from the tool that is actually running, so searching sweeps,
 * describing blooms, dealing stacks and weighing seesaws. Someone across the
 * room can tell what kind of work is happening without reading a word, which is
 * the only way a glyph earns the space a sentence used to take.
 *
 * **It is text.** Five cells of a monospace face, one string swapped per frame.
 * That matches the house style — one serif for labels, one mono for catalogue
 * data — and it costs one text-node write per frame rather than a compositor
 * layer competing with the board's deal animation.
 *
 * This module is pure: no React, no DOM, no clock. The component owns the
 * ticking; everything here can be asserted directly.
 */

import type { ActivityEntry } from './store';

/**
 * The kinds of work the glyph can distinguish.
 *
 * Not one per tool — twenty-one motions would be noise. These are the six
 * shapes of work a viewer can actually tell apart at 12px across a room.
 */
export type GlyphKind = 'scan' | 'look' | 'deal' | 'mark' | 'build' | 'read';

/**
 * `idle` — nothing running, and the last thing that ran was fine.
 * `running` — at least one tool is in flight.
 * `failed` — nothing running, and the last call came back an error. A settle,
 *   not an alarm: it rests at idle weight in the error tone, so it reports
 *   rather than nags.
 */
export type GlyphPhase = 'idle' | 'running' | 'failed';

export interface GlyphState {
  phase: GlyphPhase;
  /** Which motion to play. Null only when nothing has ever run. */
  kind: GlyphKind | null;
  /** How many calls are in flight. The log shows them; the glyph does not. */
  running: number;
}

/**
 * Tool name to kind of work.
 *
 * Grouped by what the human would see happening, not by the module the tool
 * lives in: `search_by_exemplars` and `search_artworks` reach different
 * backends but both mean "the agent is casting about", and that is what the
 * motion has to say.
 */
const KIND_BY_TOOL: Record<string, GlyphKind> = {
  // Casting about the collection.
  list_collections: 'scan',
  search_artworks: 'scan',
  search_by_image: 'scan',
  search_by_color: 'scan',
  search_by_exemplars: 'scan',
  browse_collection: 'scan',
  lookup_artwork: 'scan',

  // Dwelling on one work.
  describe_artwork: 'look',
  show_artwork: 'look',

  // Putting works on the wall.
  redeal: 'deal',
  set_results: 'deal',
  set_view: 'deal',

  // Weighing one thing against another.
  flag_artworks: 'mark',
  compare_artworks: 'mark',

  // Accumulating something that did not exist before.
  create_collection: 'build',
  add_to_collection: 'build',
  index_zip: 'build',
  index_folder: 'build',
  get_index_status: 'build',

  // Reading the page. The quietest thing the agent does, and the most frequent.
  get_view_context: 'read',
  get_search_quota: 'read',
};

/**
 * An unknown tool reads the page until proven otherwise. A tool this map has
 * never heard of is more likely to be a query than a mutation, and guessing
 * quiet is the cheaper mistake.
 */
export const kindForTool = (toolName: string): GlyphKind =>
  KIND_BY_TOOL[toolName] ?? 'read';

export interface GlyphAnimation {
  /** One string per frame. Every string is `CELLS` characters wide. */
  frames: string[];
  /** Milliseconds a frame holds. Per kind, because pace is part of meaning. */
  ms: number;
}

/** The glyph is always this wide, so nothing reflows when the state changes. */
export const CELLS = 5;

/**
 * The six motions.
 *
 * Each is a different *signature*, not a different decoration:
 *
 * - `scan`  a head with a wake travelling the field, and coming back. Traversal.
 * - `look`  a bloom opening and closing on the spot. Attention, going nowhere.
 * - `deal`  discrete bars arriving left to right and staying. Accretion.
 * - `mark`  a seesaw, slow, tipping one way and then the other. Weighing.
 * - `build` two marks converging on one. Collection.
 * - `read`  a single low breath. Barely there, because it barely is.
 *
 * `mark` is deliberately the slowest: a judgement that strobed would read as
 * panic rather than deliberation.
 */
export const GLYPH_ANIMATIONS: Record<GlyphKind, GlyphAnimation> = {
  scan: {
    ms: 110,
    frames: [
      '▅▃▁··',
      '·▅▃▁·',
      '··▅▃▁',
      '···▅▃',
      '····▅',
      '···▅▃',
      '··▅▃▁',
      '·▅▃▁·',
    ],
  },
  look: {
    ms: 150,
    frames: ['··▁··', '·▄█▄·', '█████', '·▄█▄·', '··▁··', '·····'],
  },
  deal: {
    ms: 130,
    frames: ['·····', '▌····', '▌▌···', '▌▌▌··', '▌▌▌▌·', '▌▌▌▌▌', '▌▌▌▌▌'],
  },
  mark: {
    ms: 260,
    frames: ['█···▁', '▄···▄', '▁···█', '▄···▄'],
  },
  build: {
    ms: 150,
    frames: ['█···█', '·█·█·', '··█··', '··▄··', '··▁··'],
  },
  read: {
    ms: 340,
    frames: ['·▁▁▁·', '·····'],
  },
};

/**
 * What the glyph shows when it must not move.
 *
 * `prefers-reduced-motion` is honoured by changing the *mark*, not by freezing
 * one frame of the animation — a frozen frame of a sweep and a frozen frame of
 * a bloom can be the same picture. These six are distinguishable as symbols:
 * a directional wake, a wide steady block, five separate cards, two poles, one
 * converged point, a low flat rule. A state you can only perceive through
 * motion is a state some people simply do not have.
 */
export const GLYPH_STILLS: Record<GlyphKind, string> = {
  scan: '▅▃▁··',
  look: '·███·',
  deal: '▌▌▌▌▌',
  mark: '█···█',
  build: '··█··',
  read: '·▁▁▁·',
};

/** Nothing is happening. Five dim dots — the field the marks move through. */
export const IDLE_FRAME = '·····';

/** The last call came back an error, and nothing has run since. */
export const FAILED_FRAME = '··×··';

/**
 * One word per kind, for a reader who is not looking at the screen.
 *
 * These exist only inside a visually-hidden `role="status"`. They are the
 * accessible rendering of a purely visual signal, not caption text — nothing
 * here is ever painted.
 */
export const GLYPH_ANNOUNCEMENT: Record<GlyphKind, string> = {
  scan: 'searching',
  look: 'looking',
  deal: 'dealing',
  mark: 'weighing',
  build: 'collecting',
  read: 'reading the page',
};

/**
 * Reduce the activity list to what the glyph should be doing.
 *
 * `activity` is newest-first, which is the store's ordering, and the rules are
 * deliberately shallow so the answer is obvious from a screenshot:
 *
 * - Anything running wins. With several in flight the *most recently started*
 *   call chooses the motion, because that is the one whose result has not
 *   landed yet and therefore the one the viewer is waiting on. The count comes
 *   out too, but the glyph does not draw it — the log does. A number stamped on
 *   a five-cell mark is a caption, and captions are what this replaced.
 * - Otherwise the newest settled call decides between resting quietly and
 *   resting as a cross.
 * - An aborted call is not a failure. Someone cancelled; nothing is wrong.
 */
export const readGlyphState = (activity: ActivityEntry[]): GlyphState => {
  let newestRunning: ActivityEntry | null = null;
  let running = 0;

  for (const entry of activity) {
    if (entry.status !== 'running') continue;
    running += 1;
    if (!newestRunning || entry.startedAt > newestRunning.startedAt) {
      newestRunning = entry;
    }
  }

  if (newestRunning) {
    return {
      phase: 'running',
      kind: kindForTool(newestRunning.toolName),
      running,
    };
  }

  const newest = activity[0];
  if (!newest) return { phase: 'idle', kind: null, running: 0 };

  const failed = newest.status === 'error' || newest.error !== null;
  return {
    phase: failed ? 'failed' : 'idle',
    kind: kindForTool(newest.toolName),
    running: 0,
  };
};

/** The single frame to paint given a state and whether motion is allowed. */
export const stillFrameFor = (state: GlyphState): string => {
  if (state.phase === 'failed') return FAILED_FRAME;
  if (state.phase === 'running' && state.kind) return GLYPH_STILLS[state.kind];
  return IDLE_FRAME;
};
