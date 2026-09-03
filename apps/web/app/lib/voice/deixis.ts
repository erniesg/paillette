/**
 * "More like this one, but brighter and without people."
 *
 * Nobody says *Lumber Schooners at Evening on Penobscot Bay*. Voice is good at
 * intent, feeling and negation, and bad at proper nouns; the cursor is the exact
 * inverse. So the cursor says which and the voice says why — which only works if
 * *this one* actually resolves to a record before the turn leaves the page.
 *
 * Two rules govern everything here:
 *
 * 1. **Resolve what you can, and say what you could not.** A referent that
 *    silently binds to the wrong painting is worse than one that admits it does
 *    not know, because the human cannot see the mistake until the board is
 *    already wrong.
 * 2. **This is a courtesy, not a dependency.** The agent receives `hovered` and
 *    `selection` from `get_view_context` whether or not any of this runs. Every
 *    function below can return nothing and the turn still works.
 */

export interface SceneWork {
  id: string;
  title: string | null;
  artist: string | null;
  thumbnailUrl: string | null;
}

/**
 * What is pointed at, ordered by how deliberate the gesture is: a selection is
 * a click, a hover is a wrist, an open dialog is a decision already taken.
 */
export interface DeicticScene {
  hovered: SceneWork | null;
  focused: SceneWork | null;
  selection: SceneWork[];
  /** The board, left to right, as it is laid out on screen. */
  visible: SceneWork[];
}

export const emptyScene = (): DeicticScene => ({
  hovered: null,
  focused: null,
  selection: [],
  visible: [],
});

export type ReferentSource = 'hovered' | 'focused' | 'selection' | 'position';

export interface Referent {
  /** The words the human actually used, verbatim. */
  phrase: string;
  /** Offsets into the utterance, for rendering the phrase as a chip. */
  start: number;
  end: number;
  works: SceneWork[];
  source: ReferentSource;
}

export interface UnresolvedReferent {
  phrase: string;
  start: number;
  end: number;
  /** Written for the human, not the log. */
  reason: string;
}

export interface Resolution {
  referents: Referent[];
  unresolved: UnresolvedReferent[];
}

export const emptyResolution = (): Resolution => ({
  referents: [],
  unresolved: [],
});

// ---------------------------------------------------------------------------
// Reading the scene
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const toWork = (value: unknown): SceneWork | null => {
  if (!isRecord(value)) return null;
  // Some payloads wrap the record one level down (`{ openedBy, artwork }`).
  const record = isRecord(value.artwork) ? value.artwork : value;
  const id = asText(record.id);
  if (!id) return null;
  return {
    id,
    title: asText(record.title),
    artist: asText(record.artist),
    thumbnailUrl: asText(record.thumbnailUrl) ?? asText(record.imageUrl),
  };
};

const toWorks = (value: unknown): SceneWork[] =>
  Array.isArray(value)
    ? value.map(toWork).filter((work): work is SceneWork => work !== null)
    : [];

const firstNonEmpty = (...candidates: SceneWork[][]): SceneWork[] =>
  candidates.find((list) => list.length > 0) ?? [];

/**
 * Read a scene out of whatever the page can hand over.
 *
 * Deliberately loose. Two shapes describe the same screen — the WebMCP store
 * (`focused.artwork`, `agentResults.items`) and a `get_view_context` payload
 * (`openArtwork.artwork`, `agentResults.visible`) — and `hovered` / `selection`
 * are being added to both by another lane as this is written. Reading every
 * spelling defensively means this lights up when they land instead of needing a
 * second edit, and resolves what it can meanwhile.
 */
export const readScene = (source: unknown): DeicticScene => {
  if (!isRecord(source)) return emptyScene();

  const agent = isRecord(source.agentResults) ? source.agentResults : null;
  const human = isRecord(source.humanResults) ? source.humanResults : null;

  return {
    hovered: toWork(source.hovered) ?? toWork(source.hoveredArtwork),
    focused:
      toWork(source.openArtwork) ??
      toWork(source.focused) ??
      toWork(source.focusedArtwork),
    selection: firstNonEmpty(
      toWorks(source.selection),
      toWorks(source.selected),
      toWorks(source.selectedArtworks)
    ),
    // The agent's board takes over the canvas when there is one, so it is what
    // the human is looking at and therefore what "the left one" counts across.
    visible: firstNonEmpty(
      toWorks(agent?.items),
      toWorks(agent?.visible),
      toWorks(human?.items),
      toWorks(human?.visible),
      toWorks(source.visible),
      toWorks(source.board)
    ),
  };
};

// ---------------------------------------------------------------------------
// Finding the phrases
// ---------------------------------------------------------------------------

const NOUNS = 'one|ones|work|works|piece|pieces|painting|paintings|picture|pictures|image|images';
const ORDINALS: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
};
const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };

/**
 * Ordered longest-first so that "these two" wins over "these", and matched in a
 * single alternation so the offsets stay honest for chip rendering.
 *
 * `it` and `them` are deliberately absent. "Make it brighter" is not pointing
 * at anything, and a resolver that guesses there would be wrong far more often
 * than it was right.
 */
const DEICTIC = new RegExp(
  [
    `\\bthe (left|right|middle|centre|center|first|second|third|fourth|fifth|last) (?:${NOUNS})\\b`,
    `\\bboth of (?:these|those|them)\\b`,
    `\\b(?:these|those) (two|three|four|five)(?: (?:${NOUNS}))?\\b`,
    `\\b(?:these|those) (?:${NOUNS})\\b`,
    `\\b(?:this|that) (?:${NOUNS})\\b`,
    `\\b(?:these|those)\\b`,
    `\\b(?:this|that)\\b`,
  ].join('|'),
  'gi'
);

type Shape =
  | { kind: 'position'; index: number }
  | { kind: 'plural'; count: number | null }
  | { kind: 'singular' };

const shapeOf = (phrase: string, boardSize: number): Shape => {
  const lower = phrase.toLowerCase();

  const positional = /\bthe (left|right|middle|centre|center|first|second|third|fourth|fifth|last)\b/.exec(
    lower
  );
  if (positional) {
    const word = positional[1] as string;
    if (word === 'left') return { kind: 'position', index: 0 };
    if (word === 'right' || word === 'last') {
      return { kind: 'position', index: boardSize - 1 };
    }
    if (word === 'middle' || word === 'centre' || word === 'center') {
      return { kind: 'position', index: Math.floor((boardSize - 1) / 2) };
    }
    return { kind: 'position', index: ORDINALS[word] ?? 0 };
  }

  if (/\bboth\b/.test(lower)) return { kind: 'plural', count: 2 };

  if (/\b(these|those)\b/.test(lower)) {
    const counted = /\b(two|three|four|five)\b/.exec(lower);
    return { kind: 'plural', count: counted ? (COUNTS[counted[1] as string] ?? null) : null };
  }

  return { kind: 'singular' };
};

const ordinalWord = (index: number) =>
  ['first', 'second', 'third', 'fourth', 'fifth'][index] ?? `${index + 1}th`;

/**
 * Bind every deictic phrase in an utterance to records on screen.
 *
 * Precedence for a bare "this one" is selection → hover → open dialog, on the
 * grounds that the more deliberate the gesture, the more likely it is the thing
 * being talked about. A hover is a wrist; a click is a decision.
 */
export const resolveDeixis = (text: string, scene: DeicticScene): Resolution => {
  const referents: Referent[] = [];
  const unresolved: UnresolvedReferent[] = [];

  DEICTIC.lastIndex = 0;
  for (
    let match = DEICTIC.exec(text);
    match !== null;
    match = DEICTIC.exec(text)
  ) {
    const phrase = match[0];
    const start = match.index;
    const end = start + phrase.length;
    const shape = shapeOf(phrase, scene.visible.length);

    const miss = (reason: string) =>
      unresolved.push({ phrase, start, end, reason });

    if (shape.kind === 'position') {
      if (!scene.visible.length) {
        miss('nothing is on the board yet');
        continue;
      }
      const work = scene.visible[shape.index];
      if (!work) {
        miss(`there is no ${ordinalWord(shape.index)} work on the board`);
        continue;
      }
      referents.push({ phrase, start, end, works: [work], source: 'position' });
      continue;
    }

    if (shape.kind === 'plural') {
      if (scene.selection.length < 2) {
        miss(
          scene.selection.length === 0
            ? 'nothing is selected'
            : 'only one work is selected'
        );
        continue;
      }
      const wanted = shape.count ?? scene.selection.length;
      if (shape.count && scene.selection.length < shape.count) {
        miss(`${scene.selection.length} works are selected, not ${shape.count}`);
        continue;
      }
      referents.push({
        phrase,
        start,
        end,
        works: scene.selection.slice(0, wanted),
        source: 'selection',
      });
      continue;
    }

    if (scene.selection.length === 1) {
      const work = scene.selection[0] as SceneWork;
      referents.push({ phrase, start, end, works: [work], source: 'selection' });
      continue;
    }
    if (scene.selection.length > 1) {
      miss(`${scene.selection.length} works are selected — which one?`);
      continue;
    }
    if (scene.hovered) {
      referents.push({
        phrase,
        start,
        end,
        works: [scene.hovered],
        source: 'hovered',
      });
      continue;
    }
    if (scene.focused) {
      referents.push({
        phrase,
        start,
        end,
        works: [scene.focused],
        source: 'focused',
      });
      continue;
    }
    miss('nothing is hovered, selected or open');
  }

  return { referents, unresolved };
};

// ---------------------------------------------------------------------------
// Handing it on
// ---------------------------------------------------------------------------

const describe = (work: SceneWork) => {
  const name = work.title ?? 'Untitled';
  return work.artist ? `${name} — ${work.artist} (${work.id})` : `${name} (${work.id})`;
};

/**
 * What the model is told. The human's sentence is left exactly as spoken —
 * rewriting someone's words and then acting on the rewrite is how an agent
 * ends up confidently answering a question nobody asked — and the bindings are
 * appended underneath, ids included so the next tool call can use them.
 */
export const annotateForAgent = (text: string, resolution: Resolution): string => {
  const lines: string[] = [];

  for (const referent of resolution.referents) {
    lines.push(
      `"${referent.phrase}" = ${referent.works.map(describe).join('; ')}`
    );
  }
  for (const gap of resolution.unresolved) {
    lines.push(`"${gap.phrase}" could not be resolved (${gap.reason})`);
  }

  if (!lines.length) return text;
  return `${text}\n\nOn screen, the human is pointing at:\n${lines
    .map((line) => `- ${line}`)
    .join('\n')}`;
};

export type UtteranceSegment =
  | { kind: 'text'; text: string }
  | { kind: 'referent'; referent: Referent };

/**
 * The utterance broken into runs of plain text and runs that are pictures, so
 * the sentence can be rendered with the paintings inside it rather than with a
 * list of ids underneath.
 */
export const segmentUtterance = (
  text: string,
  referents: Referent[]
): UtteranceSegment[] => {
  const segments: UtteranceSegment[] = [];
  let cursor = 0;

  for (const referent of [...referents].sort((a, b) => a.start - b.start)) {
    if (referent.start < cursor) continue;
    if (referent.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, referent.start) });
    }
    segments.push({ kind: 'referent', referent });
    cursor = referent.end;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
};
