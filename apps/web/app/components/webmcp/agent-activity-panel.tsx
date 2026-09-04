/**
 * The agent activity panel — the human-visible half of the shared canvas.
 *
 * Three jobs, in priority order:
 *  1. Consent. A mutating tool parks here until the human approves it, so the
 *     gate is something they can see and click, not a promise in a docstring.
 *  2. Legibility. Every tool call shows its name, its arguments, and a one-line
 *     summary of what came back. On a screen recording a viewer can read what
 *     the agent did without narration.
 *  3. Convergence. What the agent pinned or opened renders here, in the page,
 *     next to what the human is browsing — one window, two operators.
 *
 * Styling is inline rather than Tailwind classes so the panel is guaranteed to
 * render identically regardless of the page's CSS, and readable at video
 * bitrates: high contrast, generous type, no hairlines.
 */

import { useWebMcpState } from './use-webmcp-state';
import { setFocusedArtwork, setPanelOpen } from '~/lib/webmcp/store';
import type { ActivityEntry } from '~/lib/webmcp/store';

const SURFACE = '#101216';
const SURFACE_RAISED = '#181b21';
const LINE = '#2c313a';
const TEXT = '#f2f4f7';
const MUTED = '#9aa3b0';
const ACCENT = '#fbbf24';
const RUNNING = '#a855f7';
const OK = '#4ade80';
const ERROR = '#ef6a6a';

const STATUS_COLOR: Record<ActivityEntry['status'], string> = {
  running: RUNNING,
  ok: OK,
  error: ERROR,
  aborted: MUTED,
};

const STATUS_LABEL: Record<ActivityEntry['status'], string> = {
  running: 'running',
  ok: 'ok',
  error: 'error',
  aborted: 'cancelled',
};

/**
 * The burst the viewer should read as one operation: the contiguous run of
 * back-to-back tool calls a single agent turn produces. `activity` is
 * newest-first, so two adjacent entries belong to the same burst when the newer
 * call began within `BURST_GAP_MS` of the older one ending. A longer gap means
 * the agent went quiet and the next call is a new operation, which is what
 * resets the step counter — no extra store state is needed to derive it.
 */
const BURST_GAP_MS = 10_000;

const currentBurst = (activity: ActivityEntry[]): ActivityEntry[] => {
  const burst: ActivityEntry[] = [];
  for (const entry of activity) {
    const newer = burst[burst.length - 1];
    if (
      newer &&
      entry.endedAt !== null &&
      newer.startedAt - entry.endedAt > BURST_GAP_MS
    ) {
      break;
    }
    burst.push(entry);
  }
  return burst;
};

const MONO =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** One-line argument rendering; long values are elided, not wrapped. */
const formatInput = (input: unknown): string => {
  if (input === null || input === undefined) return '{}';
  if (typeof input !== 'object') return String(input);
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length) return '{}';
  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? `[${value.length}]`
        : typeof value === 'string'
          ? `"${value.length > 42 ? `${value.slice(0, 42)}…` : value}"`
          : String(value);
      return `${key}: ${rendered}`;
    })
    .join('  ');
};

const Pill = ({
  children,
  color,
  pulse = false,
}: {
  children: React.ReactNode;
  color: string;
  pulse?: boolean;
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      fontFamily: MONO,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color,
    }}
  >
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        display: 'inline-block',
        animation: pulse ? 'webmcpPulse 1.2s ease-in-out infinite' : undefined,
      }}
    />
    {children}
  </span>
);

export function AgentActivityPanel() {
  const state = useWebMcpState();
  const {
    activity,
    agentResults,
    focused,
    pendingConfirmations,
    panelOpen,
    bridgeAttached,
  } = state;

  const hasAnything =
    activity.length > 0 ||
    agentResults !== null ||
    focused !== null ||
    pendingConfirmations.length > 0;

  // Newest-first burst; step 1 is the oldest call still in the current
  // operation. Only entries inside the burst carry a step number.
  const burst = currentBurst(activity);
  const stepByEntryId = new Map<string, number>();
  for (let index = 0; index < burst.length; index += 1) {
    const entry = burst[index];
    if (entry) stepByEntryId.set(entry.id, burst.length - index);
  }

  // Nothing has happened and no host is present: stay completely out of the
  // way. The page must look untouched without WebMCP.
  if (!bridgeAttached && !hasAnything) return null;

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          zIndex: 65,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderRadius: 999,
          border: `1px solid ${LINE}`,
          background: SURFACE,
          color: TEXT,
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: '0.04em',
          cursor: 'pointer',
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: ACCENT,
            display: 'inline-block',
          }}
        />
        WebMCP · {activity.length} call{activity.length === 1 ? '' : 's'}
      </button>
    );
  }

  return (
    <aside
      aria-label="Agent activity"
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 65,
        width: 'min(420px, calc(100vw - 32px))',
        maxHeight: 'min(72vh, 720px)',
        display: 'flex',
        flexDirection: 'column',
        background: SURFACE,
        color: TEXT,
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
        fontFamily:
          'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          borderBottom: `1px solid ${LINE}`,
          background: SURFACE_RAISED,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: ACCENT,
            }}
          >
            Agent activity
          </span>
          <Pill color={bridgeAttached ? '#5ec48a' : MUTED}>
            {bridgeAttached ? 'WebMCP connected' : 'no host'}
          </Pill>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          aria-label="Collapse agent activity"
          style={{
            background: 'transparent',
            border: 'none',
            color: MUTED,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ×
        </button>
      </header>

      <div style={{ overflowY: 'auto', padding: 12, display: 'grid', gap: 12 }}>
        {pendingConfirmations.map((confirmation) => (
          <div
            key={confirmation.id}
            role="alertdialog"
            aria-label={confirmation.title}
            style={{
              border: `1px solid ${ACCENT}`,
              borderRadius: 10,
              padding: 12,
              background: 'rgba(205,166,54,0.10)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: ACCENT,
              }}
            >
              {confirmation.toolName} needs your approval
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {confirmation.title}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>
              {confirmation.detail}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => confirmation.resolve(true)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: ACCENT,
                  color: '#1a1710',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => confirmation.resolve(false)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${LINE}`,
                  background: 'transparent',
                  color: TEXT,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Decline
              </button>
            </div>
          </div>
        ))}

        {focused && (
          <figure
            style={{
              margin: 0,
              border: `1px solid ${LINE}`,
              borderRadius: 10,
              overflow: 'hidden',
              background: SURFACE_RAISED,
            }}
          >
            {focused.artwork.imageUrl && (
              <img
                src={focused.artwork.imageUrl}
                alt={focused.artwork.title ?? 'Artwork opened by the agent'}
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 220,
                  objectFit: 'contain',
                  background: '#07080a',
                }}
              />
            )}
            <figcaption style={{ padding: 10, display: 'grid', gap: 4 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: ACCENT,
                }}
              >
                Opened by the {focused.origin}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {focused.artwork.title ?? focused.artwork.id}
              </div>
              <div style={{ fontSize: 12.5, color: MUTED }}>
                {[focused.artwork.artist, focused.artwork.dateText]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {focused.note && (
                <div style={{ fontSize: 12.5, color: TEXT, marginTop: 2 }}>
                  “{focused.note}”
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {focused.artwork.palette.map((hex) => (
                  <span
                    key={hex}
                    title={hex}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: hex,
                      border: `1px solid ${LINE}`,
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFocusedArtwork(null)}
                style={{
                  marginTop: 6,
                  justifySelf: 'start',
                  background: 'transparent',
                  border: `1px solid ${LINE}`,
                  borderRadius: 6,
                  color: MUTED,
                  fontSize: 11.5,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </figcaption>
          </figure>
        )}

        {agentResults && agentResults.items.length > 0 && (
          <section style={{ display: 'grid', gap: 8 }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: ACCENT,
              }}
            >
              Pinned by the agent · {agentResults.items.length}
            </div>
            {agentResults.note && (
              <div style={{ fontSize: 12.5, color: TEXT }}>
                “{agentResults.note}”
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))',
                gap: 6,
              }}
            >
              {agentResults.items.slice(0, 12).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={`${item.title ?? item.id}${item.artist ? ` — ${item.artist}` : ''}`}
                  onClick={() =>
                    setFocusedArtwork({
                      origin: 'human',
                      artwork: {
                        ...item,
                        description: null,
                        creditLine: null,
                        accessionNumber: null,
                        sourceCollection: null,
                        sourceRecordId: null,
                        rights: null,
                        openAccess: null,
                        dominantColors: item.palette.map((color) => ({
                          color,
                          percentage: null,
                        })),
                      },
                      at: Date.now(),
                    })
                  }
                  style={{
                    padding: 0,
                    border: `1px solid ${LINE}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#07080a',
                    cursor: 'pointer',
                    aspectRatio: '1 / 1',
                  }}
                >
                  {item.thumbnailUrl || item.imageUrl ? (
                    <img
                      src={item.thumbnailUrl ?? item.imageUrl ?? ''}
                      alt={item.title ?? ''}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 10, color: MUTED }}>no image</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        <section style={{ display: 'grid', gap: 8 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: MUTED,
            }}
          >
            Tool calls
          </div>
          {activity.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: MUTED }}>
              No tool calls yet. Ask your agent to search this collection.
            </p>
          ) : (
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: 8,
              }}
            >
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  style={{
                    border: `1px solid ${LINE}`,
                    borderRadius: 8,
                    padding: 10,
                    background: SURFACE_RAISED,
                    display: 'grid',
                    gap: 5,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <code
                      style={{
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 600,
                        color: TEXT,
                      }}
                    >
                      {entry.toolName}
                    </code>
                    <Pill color={STATUS_COLOR[entry.status]}>
                      {STATUS_LABEL[entry.status]}
                      {entry.endedAt
                        ? ` ${entry.endedAt - entry.startedAt}ms`
                        : ''}
                    </Pill>
                  </div>
                  <code
                    style={{
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: MUTED,
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatInput(entry.input)}
                  </code>
                  {entry.summary && (
                    <div style={{ fontSize: 12.5, color: TEXT }}>
                      {entry.summary}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  );
}
