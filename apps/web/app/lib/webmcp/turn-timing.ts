/**
 * Where an agent turn's time goes.
 *
 * A typed instruction took 12 to 33 seconds to produce its note and nothing on
 * the agent path could say why: the route did not time the model, the loop did
 * not time the tools, and nobody counted the nudges. A cut made without these
 * numbers is a guess about which of the three to cut.
 *
 * So every turn the page runs leaves one record: each model call's round trip
 * with what the server says the model itself took and how many tokens it read,
 * each tool's execution time, how many times the page put the turn back to
 * work, and the wall clock from Enter to the note landing and to the loop
 * ending. The breakdown is computed once, here, so the harness and the console
 * cannot disagree about what "model time" means.
 *
 * Kept in `sessionStorage` beside the flags, for the same reason they are: a
 * reload should not be the thing that erases the evidence. Like everything the
 * flags do there, it fails soft — a browser that will not store it still runs
 * the turn.
 */

/** What the route reports for one call. See `AgentCallTiming` in the API. */
export type ServerCallTiming = {
  routeMs?: number;
  modelMs?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  cachedTokens?: number | null;
  systemPromptChars?: number;
  gestureChars?: number;
  toolsChars?: number;
  messagesChars?: number;
};

export type ModelCallTiming = {
  /** Request leaving the page to its JSON being parsed. */
  ms: number;
  /** The route's own figures, or null when an older deploy sent none. */
  server: ServerCallTiming | null;
  /** The tools this reply asked for; empty for a reply that ended the turn. */
  requested: string[];
  /** Made after the page had put the turn back to work at least once. */
  afterNudge: boolean;
};

export type ToolCallTiming = {
  name: string;
  ms: number;
  ok: boolean;
  afterNudge: boolean;
};

export type TurnKind = 'ask' | 'redeal' | 'correction';

export type TurnTiming = {
  v: 1;
  /** Epoch ms when the turn began, for ordering across reloads. */
  at: number;
  kind: TurnKind;
  instruction: string;
  /** Enter to the loop ending. */
  totalMs: number;
  /** Enter to a new note on the wall, or null when the turn wrote none. */
  noteMs: number | null;
  modelCalls: ModelCallTiming[];
  toolCalls: ToolCallTiming[];
  modelCallCount: number;
  nudges: number;
  nudgeKeys: string[];
  /**
   * Model and tools are wall time on the page's own clock and never overlap:
   * the loop waits for one before starting the other. `nudgeMs` is the part of
   * both spent after the first nudge, so it is a subset, not a third bucket.
   */
  breakdown: {
    modelMs: number;
    serverModelMs: number;
    toolsMs: number;
    nudgeMs: number;
    otherMs: number;
    promptTokens: number;
    cachedTokens: number;
  };
  outcome: 'replied' | 'budget' | 'error';
  labelsRefused: boolean;
};

const INSTRUCTION_MAX_CHARS = 160;

/**
 * One turn's clock. `now` is injectable so the arithmetic can be tested
 * without sleeping.
 */
export const startTurnTiming = (
  instruction: string,
  now: () => number = () => performance.now(),
  epoch: () => number = () => Date.now()
) => {
  const startedAt = now();
  const at = epoch();
  // Known only once the gestures have been read, a moment after Enter.
  let kind: TurnKind = 'ask';
  const modelCalls: ModelCallTiming[] = [];
  const toolCalls: ToolCallTiming[] = [];
  const nudgeKeys: string[] = [];
  let toolsMs = 0;
  let nudgedAt: number | null = null;
  let noteAt: number | null = null;
  let labelsRefused = false;

  return {
    classify: (value: TurnKind) => {
      kind = value;
    },
    /** Marks a start; pass the result back to the matching `end` call. */
    mark: () => now(),
    modelCall: (
      since: number,
      server: ServerCallTiming | null,
      requested: string[]
    ) => {
      modelCalls.push({
        ms: Math.round(now() - since),
        server,
        requested,
        afterNudge: nudgedAt !== null,
      });
    },
    tool: (name: string, since: number, ok: boolean) => {
      toolCalls.push({
        name,
        ms: Math.round(now() - since),
        ok,
        afterNudge: nudgedAt !== null,
      });
    },
    /** One batch of tools, parallel or not: wall time, not the sum. */
    toolPhase: (since: number) => {
      toolsMs += now() - since;
    },
    nudge: (key: string) => {
      nudgeKeys.push(key);
      if (nudgedAt === null) nudgedAt = now();
    },
    noteLanded: () => {
      if (noteAt === null) noteAt = now();
    },
    labelsRefused: () => {
      labelsRefused = true;
    },
    finish: (outcome: TurnTiming['outcome']): TurnTiming => {
      const end = now();
      const totalMs = end - startedAt;
      const modelMs = modelCalls.reduce((sum, call) => sum + call.ms, 0);
      const sumServer = (pick: (s: ServerCallTiming) => number | null | undefined) =>
        modelCalls.reduce((sum, call) => sum + (call.server ? pick(call.server) ?? 0 : 0), 0);
      return {
        v: 1,
        at,
        kind,
        instruction: instruction.slice(0, INSTRUCTION_MAX_CHARS),
        totalMs: Math.round(totalMs),
        noteMs: noteAt === null ? null : Math.round(noteAt - startedAt),
        modelCalls,
        toolCalls,
        modelCallCount: modelCalls.length,
        nudges: nudgeKeys.length,
        nudgeKeys,
        breakdown: {
          modelMs: Math.round(modelMs),
          serverModelMs: Math.round(sumServer((s) => s.modelMs)),
          toolsMs: Math.round(toolsMs),
          nudgeMs: nudgedAt === null ? 0 : Math.round(end - nudgedAt),
          otherMs: Math.max(0, Math.round(totalMs - modelMs - toolsMs)),
          promptTokens: sumServer((s) => s.promptTokens),
          cachedTokens: sumServer((s) => s.cachedTokens),
        },
        outcome,
        labelsRefused,
      };
    },
  };
};

export type TurnTimer = ReturnType<typeof startTurnTiming>;

// --- storage --------------------------------------------------------------

const STORAGE_KEY = 'paillette:agent-timing:v1';
/** A session of rehearsal is dozens of turns, not thousands. */
const MAX_KEPT = 60;

const storage = (): Storage | null => {
  try {
    const candidate = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
};

const isTurnTiming = (value: unknown): value is TurnTiming =>
  Boolean(value) &&
  typeof value === 'object' &&
  (value as { v?: unknown }).v === 1 &&
  typeof (value as { totalMs?: unknown }).totalMs === 'number' &&
  Array.isArray((value as { modelCalls?: unknown }).modelCalls);

export const loadTurnTimings = (): TurnTiming[] => {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isTurnTiming) : [];
  } catch {
    return [];
  }
};

export const saveTurnTiming = (timing: TurnTiming): void => {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify([...loadTurnTimings(), timing].slice(-MAX_KEPT))
    );
  } catch {
    // Out of quota or refused. The turn ran; only its receipt is lost.
  }
};

export const clearTurnTimings = (): void => {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
};

export const __TURN_TIMING_STORAGE_KEY_FOR_TEST = STORAGE_KEY;

// --- reading them back -----------------------------------------------------

/** Nearest-rank percentile: every reported value is one that was measured. */
export const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
};

/** One row per turn, flat enough for `console.table`. */
export const timingRows = (timings: TurnTiming[]) =>
  timings.map((timing) => ({
    kind: timing.kind,
    totalMs: timing.totalMs,
    noteMs: timing.noteMs,
    modelCalls: timing.modelCallCount,
    nudges: timing.nudges,
    modelMs: timing.breakdown.modelMs,
    toolsMs: timing.breakdown.toolsMs,
    nudgeMs: timing.breakdown.nudgeMs,
    otherMs: timing.breakdown.otherMs,
    promptTokens: timing.breakdown.promptTokens,
    instruction: timing.instruction.slice(0, 48),
  }));
