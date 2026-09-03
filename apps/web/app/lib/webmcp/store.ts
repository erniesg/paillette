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
  /** The most recent indexing job started on this page, by either party. */
  indexJob: IndexJobHandleState | null;
  activity: ActivityEntry[];
  pendingConfirmations: PendingConfirmation[];
  /** True once the bridge has registered tools with a real host. */
  bridgeAttached: boolean;
  panelOpen: boolean;
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

export const setBridgeAttached = (bridgeAttached: boolean) =>
  update({ bridgeAttached });

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
        startedAt: Date.now(),
        endedAt: null,
      },
      ...state.activity,
    ].slice(0, MAX_ACTIVITY),
    // A tool firing is the moment the panel earns its space on screen.
    panelOpen: true,
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
