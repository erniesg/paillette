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
  panelOpen: boolean;
  /**
   * The human closed the panel and meant it.
   *
   * A turn is five or six tool calls, and each one used to reopen the panel, so
   * closing it lasted about 300ms. The panel is a fixed overlay across the
   * lower-left of the board, which is where the picks sit — so on camera the
   * one thing the interface exists to show was being covered up by a list of
   * the calls that produced it, and there was no way to stop it.
   *
   * A confirmation still overrides this: something waiting on an answer cannot
   * be allowed to hide.
   */
  panelDismissed: boolean;
}

const MAX_ACTIVITY = 40;

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
  panelDismissed: false,
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

/**
 * Closing the panel is a decision, not a gesture that lasts until the next
 * tool call. Reopening it clears the decision, so nothing is one-way.
 */
export const setPanelOpen = (panelOpen: boolean) =>
  update({ panelOpen, panelDismissed: !panelOpen });

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
        startedAt: Date.now(),
        endedAt: null,
      },
      ...state.activity,
    ].slice(0, MAX_ACTIVITY),
    // A tool firing is the moment the panel earns its space on screen — but
    // only if the human has not already said they do not want it there.
    panelOpen: state.panelDismissed ? state.panelOpen : true,
  });
  return id;
};

export const settleActivity = (
  id: string,
  status: Exclude<ActivityStatus, 'running'>,
  summary: string | null
) =>
  update({
    activity: state.activity.map((entry) =>
      entry.id === id
        ? { ...entry, status, summary, endedAt: Date.now() }
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
      // A question waiting on the human overrides their dismissal: the panel
      // is the only place the answer can be given.
      panelOpen: true,
      panelDismissed: false,
    });
  });
};

export const __resetWebMcpStateForTest = () => {
  state = initialState;
  activitySequence = 0;
  confirmationSequence = 0;
  listeners.clear();
};
