/**
 * The shared canvas: one observable store that both the human's page and the
 * agent's tools read and write.
 *
 * `get_view_context` reads this. `set_results` and `show_artwork` write it.
 * The agent activity panel renders it. Because it is a plain external store
 * (consumed with `useSyncExternalStore`) it works identically whether the
 * writer is a React event handler or a WebMCP `execute` call arriving from
 * outside React entirely.
 */

import type {
  AgentArtworkDetail,
  AgentArtworkSummary,
} from './artwork-summary';

export type ResultSetOrigin = 'human' | 'agent';

export interface AgentResultSet {
  origin: ResultSetOrigin;
  /** Short human-readable label, e.g. `text search "stormy sea at night"`. */
  label: string;
  /** Optional agent-supplied rationale shown to the human on the canvas. */
  note?: string;
  items: AgentArtworkSummary[];
  /** Total matches upstream, when larger than `items`. */
  total?: number;
  at: number;
}

export interface FocusedArtwork {
  origin: ResultSetOrigin;
  artwork: AgentArtworkDetail;
  note?: string;
  at: number;
}

/**
 * A collection built on this page from someone's own files — by the human on
 * `/try`, or by the agent through `index_zip` / `index_folder`. Recording it
 * here is what makes the two paths one canvas: whoever started the job, the
 * other party can read it back out of `get_view_context` and poll or search it.
 */
export interface IndexJobHandleState {
  jobId: string;
  collectionId: string;
  collectionName: string;
  origin: ResultSetOrigin;
  source: 'zip' | 'files';
  at: number;
}

export interface PageContext {
  pathname: string;
  search: string;
  /** Public collection the human is currently scoped to, if any. */
  collectionId: string | null;
  /** `q` in the URL — the query the human's own grid is showing. */
  query: string;
  /** `field` in the URL: a facet restriction. */
  facet: string | null;
  /** `colour` in the URL: a palette-ordered search. */
  colour: string | null;
}

export type ActivityStatus = 'running' | 'ok' | 'error' | 'aborted';

export interface ActivityEntry {
  id: string;
  toolName: string;
  input: unknown;
  status: ActivityStatus;
  /** One line describing what came back, for the on-camera panel. */
  summary: string | null;
  /**
   * The result itself, as clipped JSON.
   *
   * A summary says how many works came back; this says which, with the fields
   * the tool actually returned. It is what makes the log an answer to "how was
   * WebMCP implemented" rather than a claim about it — the payload is there to
   * read, in the shape it crossed the boundary in.
   */
  detail: string | null;
  /**
   * The failure, if there was one, in the words the tool used.
   *
   * Set both when `execute` threw and when a tool answered
   * `{ok:false,error:{…}}` — the second is by far the more common way this
   * codebase fails, and a log that styled only thrown errors as errors would
   * show a stale id as a successful call.
   */
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  title: string;
  detail: string;
  resolve: (approved: boolean) => void;
}

/** How the human's grid is laid out. Mirrors `ViewMode` on the search page. */
export type CanvasView = 'masonry' | 'salon' | 'atlas' | 'table';

/**
 * A flag on one work, in Lightroom's vocabulary: keep it, throw it out.
 *
 * Flags are the currency both parties spend. The human presses `P`/`X`; the
 * agent calls `flag_artworks`. The record says which, so the page can draw the
 * two hands differently and so the deterministic redeal can count only the
 * human's — an agent must be able to *propose* a judgement without silently
 * making it.
 */
export type FlagValue = 'pick' | 'reject';

export interface FlagRecord {
  artworkId: string;
  flag: FlagValue;
  by: ResultSetOrigin;
  /** An agent's flag stays provisional until the human confirms it. */
  provisional: boolean;
  /** Why, when the flagger said. The agent is required to; the human is not. */
  reason?: string;
  at: number;
}

/**
 * The twelve works currently hung, and the memory of everything already dealt.
 *
 * `dealt` only grows: it is what stops a redeal from handing back a work the
 * human has already looked at and moved past. `lastChangeBy` is what lets the
 * page show whose move the current arrangement was.
 */
export interface BoardState {
  /** Ids in the order they are hung. Picks hold their index across a redeal. */
  order: string[];
  /** Every id dealt onto this board since the page loaded. */
  dealt: string[];
  note: string | null;
  lastChangeBy: ResultSetOrigin;
  /** How many redeals this session has run. */
  redeals: number;
  at: number;
}

/** Two works side by side, and the question being asked of them. */
export interface CompareState {
  artworkIds: [string, string];
  question: string | null;
  askedBy: ResultSetOrigin;
  at: number;
}

export interface WebMcpState {
  page: PageContext;
  /**
   * The layout the agent asked for, or null while the human's own choice
   * stands. Presentation is part of the answer: a cross-section assembled from
   * four searches reads as a constellation in atlas view and as a list in
   * table view, and only the agent knows which it meant.
   */
  view: CanvasView | null;
  /** The result set the human's own grid is showing (observed, not guessed). */
  humanResults: AgentResultSet | null;
  /** The result set the agent last pushed onto the canvas. */
  agentResults: AgentResultSet | null;
  focused: FocusedArtwork | null;
  /**
   * Every flag laid down this page session, by either party, in the order they
   * were laid. Deliberately not cleared by a redeal: a judgement about a work
   * outlives the arrangement it was made in.
   */
  flags: FlagRecord[];
  /** The dealt board, once a redeal has run. Null before the first deal. */
  board: BoardState | null;
  /**
   * A deal in flight, and the last one that failed.
   *
   * Both exist so that pressing Enter is never a dead key. A slow deal has to
   * be visibly in progress rather than look ignored, and a failed one has to
   * say so — silence is the one response a person cannot act on.
   */
  dealing: boolean;
  dealError: { code: string; message: string } | null;
  /** The two-up currently on screen, if any. */
  compare: CompareState | null;
  /** The card under the cursor or keyboard focus — the deictic anchor. */
  hovered: string | null;
  /** Shift-clicked ids. What "these" means. */
  selection: string[];
  /** The most recent indexing job started on this page, by either party. */
  indexJob: IndexJobHandleState | null;
  activity: ActivityEntry[];
  pendingConfirmations: PendingConfirmation[];
  /** True once the bridge has registered tools with a real host. */
  bridgeAttached: boolean;
  /**
   * Whether the tool-call log is expanded.
   *
   * Collapsed is the resting state and nothing the agent does opens it. The
   * glyph carries the presence; the log is what you open when you want to know
   * exactly what happened, and it keeps its history while closed.
   *
   * One thing still forces it open: a mutating tool waiting on consent. The
   * panel is the only place that answer can be given, so it cannot be allowed
   * to hide.
   */
  panelOpen: boolean;
}

/**
 * How much of the session the log can show.
 *
 * A single agentic turn is five or six tool calls, so forty was about seven
 * turns — less than one rehearsal, and the log is meant to be scrollable
 * history rather than a recent-items list. The ceiling stays because each entry
 * now carries a clipped copy of the result it got back.
 */
const MAX_ACTIVITY = 120;

const initialState: WebMcpState = {
  page: {
    pathname: '/',
    search: '',
    collectionId: null,
    query: '',
    facet: null,
    colour: null,
  },
  view: null,
  humanResults: null,
  agentResults: null,
  focused: null,
  flags: [],
  board: null,
  dealing: false,
  dealError: null,
  compare: null,
  hovered: null,
  selection: [],
  indexJob: null,
  activity: [],
  pendingConfirmations: [],
  bridgeAttached: false,
  panelOpen: false,
};

let state: WebMcpState = initialState;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of [...listeners]) listener();
};

const update = (next: Partial<WebMcpState>) => {
  state = { ...state, ...next };
  emit();
};

export const subscribeWebMcpState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getWebMcpState = () => state;

/** Server snapshot for `useSyncExternalStore` — always the pristine initial. */
export const getWebMcpServerState = () => initialState;

export const setPageContext = (page: PageContext) => {
  const current = state.page;
  if (
    current.pathname === page.pathname &&
    current.search === page.search &&
    current.collectionId === page.collectionId
  ) {
    return;
  }
  update({ page });
};

export const setHumanResults = (results: AgentResultSet | null) =>
  update({ humanResults: results });

export const setAgentResults = (results: AgentResultSet | null) =>
  update({ agentResults: results });

export const setCanvasView = (view: CanvasView | null) => update({ view });

export const setFocusedArtwork = (focused: FocusedArtwork | null) =>
  update({ focused });

export const setIndexJob = (indexJob: IndexJobHandleState | null) =>
  update({ indexJob });

/**
 * Raw setters for the gesture state. The semantics live in `flags.ts` and
 * `redeal.ts`; this file stays the dumb, observable place the values sit so
 * that React re-renders for free whoever wrote them.
 */
export const setFlagRecords = (flags: FlagRecord[]) => update({ flags });

export const setBoard = (board: BoardState | null) => update({ board });

export const setDealing = (dealing: boolean) => update({ dealing });

export const setDealError = (dealError: WebMcpState['dealError']) =>
  update({ dealError });

export const setCompare = (compare: CompareState | null) => update({ compare });

export const setHoveredArtwork = (hovered: string | null) => {
  if (state.hovered === hovered) return;
  update({ hovered });
};

export const setSelection = (selection: string[]) => update({ selection });

export const setBridgeAttached = (bridgeAttached: boolean) =>
  update({ bridgeAttached });

/** Expand or collapse the log. Only ever called by the human, or by consent. */
export const setPanelOpen = (panelOpen: boolean) => update({ panelOpen });

let activitySequence = 0;

export const startActivity = (toolName: string, input: unknown): string => {
  activitySequence += 1;
  const id = `activity-${activitySequence}`;
  update({
    activity: [
      {
        id,
        toolName,
        input,
        status: 'running' as const,
        summary: null,
        detail: null,
        error: null,
        startedAt: Date.now(),
        endedAt: null,
      },
      ...state.activity,
    ].slice(0, MAX_ACTIVITY),
    // Deliberately does not open the log. The glyph is what a tool call earns:
    // it is already animating, in the agent's ink, in the corner. Throwing a
    // panel over the board every time a tool fires — five or six times a turn —
    // covered the picks with a list of the calls that produced them.
  });
  return id;
};

export const settleActivity = (
  id: string,
  status: Exclude<ActivityStatus, 'running'>,
  summary: string | null,
  captured: { detail?: string | null; error?: string | null } = {}
) =>
  update({
    activity: state.activity.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status,
            summary,
            detail: captured.detail ?? null,
            error: captured.error ?? null,
            endedAt: Date.now(),
          }
        : entry
    ),
  });

let confirmationSequence = 0;

/**
 * Parks a mutating tool call until the human clicks Approve or Decline in the
 * activity panel. The promise is what makes the gate real: `execute` cannot
 * proceed without an answer from the page.
 */
export const requestConfirmation = (request: {
  toolName: string;
  title: string;
  detail: string;
  signal?: AbortSignal;
}): Promise<boolean> => {
  confirmationSequence += 1;
  const id = `confirm-${confirmationSequence}`;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      update({
        pendingConfirmations: state.pendingConfirmations.filter(
          (pending) => pending.id !== id
        ),
      });
      resolve(approved);
    };

    request.signal?.addEventListener('abort', () => finish(false), {
      once: true,
    });

    update({
      pendingConfirmations: [
        ...state.pendingConfirmations,
        {
          id,
          toolName: request.toolName,
          title: request.title,
          detail: request.detail,
          resolve: finish,
        },
      ],
      // The one thing that opens the log by itself: a question waiting on the
      // human, which has nowhere else to be asked.
      panelOpen: true,
    });
  });
};

export const __resetWebMcpStateForTest = () => {
  state = initialState;
  activitySequence = 0;
  confirmationSequence = 0;
  listeners.clear();
};
