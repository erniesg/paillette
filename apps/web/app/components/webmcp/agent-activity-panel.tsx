/**
 * The agent's presence on the page: a glyph, and the log behind it.
 *
 * What was here before was a list of lines — the agent's last few tool calls,
 * the works it pinned, the note it wrote — parked over the lower-left of the
 * board and reopened by every tool call. That is a transcript with extra steps.
 * It held permanent space to say things that were mostly over, it repeated the
 * wall label the board was already showing, and it covered the picks with a
 * list of the calls that produced them.
 *
 * This replaces it with two things:
 *
 *  1. **A glyph.** Five character cells in the agent's ink. Nearly invisible
 *     when nothing is happening, moving while a tool runs, and the motion says
 *     *which kind* of tool — searching sweeps, describing blooms, dealing
 *     stacks, weighing seesaws. See `lib/webmcp/activity-glyph.ts`.
 *
 *  2. **A log, collapsed by default.** Click the glyph and it opens on the real
 *     traffic: every call in order, with its name, the JSON that went in, the
 *     JSON that came back, and how long it took. This is the honest answer to
 *     "how was WebMCP implemented" — tools registered on
 *     `document.modelContext`, called live against the page in front of you. A
 *     paragraph claiming that is worth less than thirty seconds of watching it.
 *
 * One thing survives from the old panel because it is load-bearing rather than
 * decorative: the **consent gate**. `create_collection` and `add_to_collection`
 * park here until the human approves, and `requestConfirmation` returns a
 * promise that `execute` is waiting on. Deleting the surface would hang the
 * tool, so a pending question still forces the log open.
 *
 * Styling is a `<style>` element this component owns rather than page classes.
 * Same reason the old file gave for inline styles — the surface has to render
 * identically regardless of what CSS the route brings — but with selectors, so
 * the log can have hover, focus and reduced-motion states without a wall of
 * style objects. Every colour resolves through the house tokens with a literal
 * fallback, so it takes the agent's ink and flips with the theme, and still
 * renders if the stylesheet has not loaded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityGlyph } from './activity-glyph';
import { useWebMcpState } from './use-webmcp-state';
import { readGlyphState } from '~/lib/webmcp/activity-glyph';
import {
  detailJson,
  formatDuration,
  inlineJson,
} from '~/lib/webmcp/activity-format';
import { getRegisteredToolNames } from '~/lib/webmcp/registry';
import { setPanelOpen } from '~/lib/webmcp/store';
import type { ActivityEntry } from '~/lib/webmcp/store';
import { usePrefersReducedMotion } from '~/components/board/use-prefers-reduced-motion';

/**
 * A quiet gap between two calls means the agent stopped and started again. Ten
 * seconds apart is a different operation, and the log marks it with a rule
 * rather than a heading — the same way a ledger separates entries.
 */
const BURST_GAP_MS = 10_000;

/** How close to the bottom counts as "following the log" for auto-scroll. */
const STICK_SLACK_PX = 40;

const CSS = `
.pa-activity {
  position: fixed;
  left: 6px;
  bottom: 6px;
  z-index: 65;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;

  --pa-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --pa-ink: var(--ink-agent, #5ec8d8);
  --pa-ink-soft: var(--ink-agent-soft, rgba(94, 200, 216, 0.55));
  --pa-ink-faint: var(--ink-agent-faint, rgba(94, 200, 216, 0.3));
  --pa-ink-wash: var(--ink-agent-wash, rgba(94, 200, 216, 0.1));
  --pa-ground: var(--lt-ground, #1a1a1d);
  --pa-rule: var(--lt-rule, rgba(255, 255, 255, 0.08));
  --pa-rule-strong: var(--lt-rule-strong, rgba(255, 255, 255, 0.22));
  --pa-text: var(--ink-human, #e6e3dc);
  --pa-text-soft: var(--ink-human-soft, rgba(230, 227, 220, 0.7));
  --pa-text-faint: var(--ink-human-faint, rgba(230, 227, 220, 0.58));
  --pa-well: var(--ink-human-wash, rgba(230, 227, 220, 0.07));
  /* Contrast measured against both grounds: 5.2:1 on charcoal, 5.9:1 on paper. */
  --pa-bad: #e0674f;
}
:root[data-theme='light'] .pa-activity { --pa-bad: #9a2f1c; }
.pa-activity > * { pointer-events: auto; }

.pa-activity-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.pa-activity-glyph {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  border: 0;
  border-radius: 2px;
  padding: 10px 12px;
  margin: 0;
  cursor: pointer;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.pa-activity-glyph:focus-visible {
  outline: 1px solid var(--pa-ink);
  outline-offset: 1px;
}

.pa-activity-cells {
  font-family: var(--pa-mono);
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.08em;
  white-space: pre;
  color: var(--pa-ink-faint);
  opacity: 0.5;
  text-shadow: none;
  transition:
    color 420ms ease,
    opacity 420ms ease,
    text-shadow 420ms ease;
}
.pa-activity-cells[data-phase='running'] {
  color: var(--pa-ink);
  opacity: 1;
  text-shadow: 0 0 6px var(--pa-ink-soft), 0 0 16px var(--pa-ink-wash);
  /* Light comes up quickly and dies away slowly; that decay is the settle. */
  transition-duration: 120ms;
}
.pa-activity-cells[data-phase='failed'] {
  color: var(--pa-bad);
  opacity: 0.9;
}
.pa-activity-glyph:hover .pa-activity-cells,
.pa-activity-glyph:focus-visible .pa-activity-cells,
.pa-activity[data-open='true'] .pa-activity-cells {
  opacity: 1;
}

.pa-activity-log {
  width: min(460px, calc(100vw - 24px));
  max-height: min(58vh, 520px);
  display: flex;
  flex-direction: column;
  background: var(--pa-ground);
  border: 1px solid var(--pa-rule);
  border-radius: 2px;
  box-shadow: 0 18px 44px -18px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.pa-activity-scroll {
  overflow-y: auto;
  overscroll-behavior: contain;
}

.pa-activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.pa-activity-item + .pa-activity-item { border-top: 1px solid var(--pa-rule); }
.pa-activity-item[data-gap='true'] {
  border-top: 1px solid var(--pa-rule-strong);
  margin-top: 8px;
}

.pa-activity-row {
  appearance: none;
  -webkit-appearance: none;
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-left: 2px solid transparent;
  padding: 7px 12px 8px 10px;
  cursor: pointer;
  font-family: var(--pa-mono);
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--pa-text-faint);
}
.pa-activity-row:hover { background: var(--pa-well); }
.pa-activity-row:focus-visible {
  outline: 1px solid var(--pa-ink);
  outline-offset: -2px;
}
.pa-activity-row[data-running='true'] { border-left-color: var(--pa-ink); }
.pa-activity-row[data-bad='true'] { border-left-color: var(--pa-bad); }

.pa-activity-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.pa-activity-name {
  font-family: var(--pa-mono);
  font-size: 12px;
  color: var(--pa-ink);
  word-break: break-all;
}
.pa-activity-row[data-bad='true'] .pa-activity-name { color: var(--pa-bad); }
.pa-activity-dur {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: var(--pa-text-faint);
}
.pa-activity-args {
  display: block;
  font-family: var(--pa-mono);
  color: var(--pa-text-faint);
  word-break: break-word;
}
.pa-activity-out {
  display: block;
  margin-top: 2px;
  color: var(--pa-text-soft);
  word-break: break-word;
}
.pa-activity-out[data-bad='true'] { color: var(--pa-bad); }

.pa-activity-detail {
  padding: 8px 12px 10px 12px;
  background: var(--pa-well);
  max-height: 280px;
  overflow: auto;
}
.pa-activity-detail pre {
  margin: 0;
  font-family: var(--pa-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--pa-text-soft);
  white-space: pre-wrap;
  word-break: break-word;
}
/*
 * One character where two words used to be. A wall label gives artist, title,
 * date and medium and never names the fields, because position says which is
 * which; a REPL prints what went in, an arrow, and what came back. Both work
 * on the same principle, and "arguments" / "result" were the labels a legend
 * would carry.
 */
.pa-activity-turn {
  display: block;
  margin: 5px 0;
  font-family: var(--pa-mono);
  font-size: 11px;
  line-height: 1;
  color: var(--pa-ink);
}
.pa-activity-row[data-bad='true'] + .pa-activity-detail .pa-activity-turn {
  color: var(--pa-bad);
}

/*
 * The session is longer than the log can hold. A truncated list that says
 * nothing reads as a complete one, so it says how much is missing — a count,
 * not a sentence about counts.
 */
.pa-activity-earlier {
  padding: 7px 12px 8px 12px;
  border-bottom: 1px solid var(--pa-rule);
  font-family: var(--pa-mono);
  font-size: 11px;
  color: var(--pa-text-faint);
}

.pa-activity-ask {
  padding: 10px 12px;
  border-bottom: 1px solid var(--pa-rule);
  background: var(--pa-ink-wash);
  display: grid;
  gap: 6px;
  font-size: 12.5px;
  color: var(--pa-text);
}
.pa-activity-ask-tool {
  font-family: var(--pa-mono);
  font-size: 11.5px;
  color: var(--pa-ink);
}
.pa-activity-ask-detail { color: var(--pa-text-soft); font-size: 12px; }
.pa-activity-ask-row { display: flex; gap: 8px; margin-top: 2px; }
.pa-activity-ask-row button {
  appearance: none;
  -webkit-appearance: none;
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--pa-rule-strong);
  border-radius: 2px;
  background: transparent;
  color: var(--pa-text);
  font-family: var(--pa-mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.pa-activity-ask-row button[data-approve='true'] {
  border-color: var(--pa-ink);
  color: var(--pa-ink);
}
.pa-activity-ask-row button:hover { background: var(--pa-well); }

.pa-activity-surface {
  padding: 10px 12px 12px;
  font-family: var(--pa-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--pa-text-faint);
}
.pa-activity-surface-head {
  color: var(--pa-ink);
  margin-bottom: 6px;
  word-break: break-all;
}
.pa-activity-surface ul {
  list-style: none;
  margin: 0;
  padding: 0;
  columns: 2;
  column-gap: 14px;
}

@media (prefers-reduced-motion: reduce) {
  .pa-activity-cells { transition: none; }
}
`;

/** Whether this entry starts a new operation, given the one logged before it. */
const startsBurst = (
  entry: ActivityEntry,
  previous: ActivityEntry | undefined
): boolean => {
  if (!previous) return false;
  const previousEnd = previous.endedAt ?? previous.startedAt;
  return entry.startedAt - previousEnd > BURST_GAP_MS;
};

export function AgentActivityPanel() {
  const {
    activity,
    activityDropped,
    pendingConfirmations,
    panelOpen,
    bridgeAttached,
  } = useWebMcpState();
  const reducedMotion = usePrefersReducedMotion();
  const glyph = readGlyphState(activity);

  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);

  const toggleRow = useCallback((id: string) => {
    setExpanded((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : [...current, id]
    );
  }, []);

  // Escape closes the log. The glyph is the only other control, so there is no
  // separate close button to explain.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  /**
   * Reaching for anything else closes it.
   *
   * The log is an opaque panel over the lower-left of the board, and that is
   * where the cards are. Driving it in a browser found the obvious consequence:
   * with the log open, `P` on a card is unreachable and a click on one is
   * swallowed — the same complaint the voice lane filed against the panel this
   * replaced, surviving into its replacement.
   *
   * Listening on `pointerdown` in the capture phase without preventing anything
   * means the click still lands on whatever was actually clicked; the log just
   * gets out of the way at the same moment. So nothing is ever lost, and there
   * is one less control to find.
   *
   * A pending confirmation is exempt. Something waiting on an answer cannot be
   * dismissed by looking away from it.
   */
  useEffect(() => {
    if (!panelOpen || pendingConfirmations.length > 0) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setPanelOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      window.removeEventListener('pointerdown', onPointerDown, true);
  }, [panelOpen, pendingConfirmations.length]);

  // Follow the tail the way a terminal does — but only while the reader is
  // already at the tail. Someone scrolled up to read an earlier call is reading
  // it, and yanking them back down when the next tool fires would be worse than
  // not following at all.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !followingRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [activity, panelOpen]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    followingRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight <= STICK_SLACK_PX;
  }, []);

  // Oldest at the top: this is a log, and a log reads downwards. The store
  // keeps it newest-first because that is what a bounded buffer wants.
  const rows = useMemo(() => [...activity].reverse(), [activity]);

  // Read once per opening. The registry is populated synchronously when the
  // bridge mounts, so this is the true set of names on `document.modelContext`
  // rather than a list copied out of the source.
  const registered = useMemo(
    () => (panelOpen && bridgeAttached ? getRegisteredToolNames() : []),
    [panelOpen, bridgeAttached]
  );

  const hasAnything = activity.length > 0 || pendingConfirmations.length > 0;
  // Nothing has happened and no host is present: stay completely out of the
  // way. The page must look untouched without WebMCP.
  if (!bridgeAttached && !hasAnything) return null;

  return (
    <div
      className="pa-activity"
      ref={rootRef}
      data-open={panelOpen ? 'true' : 'false'}
    >
      <style>{CSS}</style>

      {panelOpen && (
        <section className="pa-activity-log" aria-label="Agent tool calls">
          {pendingConfirmations.map((confirmation) => (
            <div
              key={confirmation.id}
              className="pa-activity-ask"
              role="alertdialog"
              aria-label={confirmation.title}
            >
              <div className="pa-activity-ask-tool">{confirmation.toolName}</div>
              <div>{confirmation.title}</div>
              <div className="pa-activity-ask-detail">{confirmation.detail}</div>
              <div className="pa-activity-ask-row">
                <button
                  type="button"
                  data-approve="true"
                  onClick={() => confirmation.resolve(true)}
                >
                  Approve
                </button>
                <button type="button" onClick={() => confirmation.resolve(false)}>
                  Decline
                </button>
              </div>
            </div>
          ))}

          <div
            className="pa-activity-scroll"
            ref={scrollRef}
            onScroll={onScroll}
          >
            {rows.length === 0 ? (
              // Nothing has run yet, so the log shows the contract instead of
              // an empty box explaining that it is empty: the names actually
              // registered on `document.modelContext` right now.
              <div className="pa-activity-surface">
                <div className="pa-activity-surface-head">
                  document.modelContext · {registered.length}
                </div>
                <ul>
                  {registered.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="pa-activity-list">
                {activityDropped > 0 && (
                  <li className="pa-activity-earlier">
                    … {activityDropped} earlier
                  </li>
                )}
                {rows.map((entry, index) => {
                  const running = entry.status === 'running';
                  const bad = entry.error !== null;
                  const open = expanded.includes(entry.id);
                  const duration =
                    entry.endedAt === null
                      ? null
                      : formatDuration(entry.endedAt - entry.startedAt);

                  return (
                    <li
                      key={entry.id}
                      className="pa-activity-item"
                      data-gap={
                        startsBurst(entry, rows[index - 1]) ? 'true' : 'false'
                      }
                    >
                      <button
                        type="button"
                        className="pa-activity-row"
                        data-tool={entry.toolName}
                        data-status={entry.status}
                        data-running={running ? 'true' : 'false'}
                        data-bad={bad ? 'true' : 'false'}
                        aria-expanded={open}
                        onClick={() => toggleRow(entry.id)}
                      >
                        <span className="pa-activity-head">
                          <code className="pa-activity-name">
                            {entry.toolName}
                          </code>
                          <span className="pa-activity-dur">
                            {/*
                              A running call has no duration yet. Three dots
                              rather than a timer: the glyph is already saying
                              that something is in flight, and a second clock
                              on screen is a second thing to read.
                            */}
                            {duration ?? '···'}
                          </span>
                        </span>
                        <code className="pa-activity-args">
                          {inlineJson(entry.input)}
                        </code>
                        {(entry.error ?? entry.summary) && (
                          <span
                            className="pa-activity-out"
                            data-bad={bad ? 'true' : 'false'}
                          >
                            {entry.error ?? entry.summary}
                          </span>
                        )}
                      </button>
                      {open && (
                        <div className="pa-activity-detail">
                          <pre>
                            <span className="pa-activity-sr">arguments </span>
                            {detailJson(entry.input)}
                          </pre>
                          {entry.detail !== null && (
                            <>
                              <span
                                className="pa-activity-turn"
                                aria-hidden="true"
                              >
                                →
                              </span>
                              <pre>
                                <span className="pa-activity-sr">result </span>
                                {entry.detail}
                              </pre>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      )}

      <button
        type="button"
        className="pa-activity-glyph"
        aria-label="Agent activity"
        aria-expanded={panelOpen}
        data-phase={glyph.phase}
        data-kind={glyph.kind ?? 'none'}
        data-running={glyph.running}
        onClick={() => setPanelOpen(!panelOpen)}
      >
        <ActivityGlyph state={glyph} reducedMotion={reducedMotion} />
      </button>
    </div>
  );
}
