import { useCallback, useMemo, useState } from 'react';
import type { MetaFunction } from '@remix-run/cloudflare';
import {
  DealBoard,
  DEFAULT_BOARD_SIZE,
} from '~/components/board/deal-board';
import { LightTableCard } from '~/components/board/light-table-card';
import type { BoardMark } from '~/components/board/provenance';
import { DEMO_WORKS, type DemoWork } from '~/lib/board/demo-works';

export const meta: MetaFunction = () => [
  { title: 'The deal — Paillette' },
  { name: 'robots', content: 'noindex' },
];

/**
 * A harness for the board, not a product page.
 *
 * The deal animation is the single most important visual in the submission and
 * it needs to be judged at twelve cards, by hand, without a search backend, an
 * API key, or a network round trip in the way. This route supplies a fixed set
 * of real NGA works and the two buttons needed to drive the loop: flag some,
 * then redeal.
 *
 * The redeal here is deterministic and has no model in it — it scores the pool
 * by how many picks share its motif, minus how many rejects do. That is a
 * stand-in for Rocchio over CLIP, and it is enough to prove the *interaction*
 * without pretending to the retrieval quality of the real thing.
 */

type Flag = 'pick' | 'reject';

interface FlagState {
  flag: Flag;
  hand: 'human' | 'agent';
  provisional?: boolean;
  reason?: string;
}

const REJECT_WEIGHT = 0.5;

/** Rocchio's shape, with motif membership standing in for a CLIP embedding. */
function scoreAgainstFlags(
  work: DemoWork,
  positives: DemoWork[],
  negatives: DemoWork[]
) {
  const near = (pool: DemoWork[]) =>
    pool.filter((other) => other.motif === work.motif).length /
    Math.max(1, pool.length);

  // `max` on the negatives, so one strong reject actually pushes things away
  // rather than being averaged into irrelevance.
  const negative = negatives.length
    ? Math.max(...negatives.map((n) => (n.motif === work.motif ? 1 : 0)))
    : 0;

  return near(positives) - REJECT_WEIGHT * negative;
}

export default function NightDealRoute() {
  const [flags, setFlags] = useState<Record<string, FlagState>>({});
  const [boardIds, setBoardIds] = useState<string[]>(() =>
    DEMO_WORKS.slice(0, DEFAULT_BOARD_SIZE).map((work) => work.id)
  );
  const [note, setNote] = useState<string | null>(null);
  const [agentActiveIds, setAgentActiveIds] = useState<string[]>([]);
  const [dealCount, setDealCount] = useState(0);

  const byId = useMemo(() => {
    const map = new Map<string, DemoWork>();
    for (const work of DEMO_WORKS) map.set(work.id, work);
    return map;
  }, []);

  const boardItems = useMemo(
    () =>
      boardIds
        .map((id) => byId.get(id))
        .filter((work): work is DemoWork => Boolean(work)),
    [boardIds, byId]
  );

  const pickIds = useMemo(
    () =>
      Object.entries(flags)
        .filter(([, state]) => state.flag === 'pick')
        .map(([id]) => id),
    [flags]
  );

  /**
   * The tray holds rejects that have *left* the board.
   *
   * A flag does not redeal — Enter on an empty bar is the beat — so a work the
   * human has just rejected stays in its slot wearing its mark until the next
   * deal takes it away. Showing it greyed on the board and in the tray at the
   * same time would say it is in two places at once.
   */
  const onBoard = useMemo(() => new Set(boardIds), [boardIds]);
  const trayItems = useMemo(
    () =>
      Object.entries(flags)
        .filter(([id, state]) => state.flag === 'reject' && !onBoard.has(id))
        .map(([id]) => byId.get(id))
        .filter((work): work is DemoWork => Boolean(work)),
    [flags, byId, onBoard]
  );

  /** Every reject, wherever it currently is — this is what steers the redeal. */
  const rejectedWorks = useMemo(
    () =>
      Object.entries(flags)
        .filter(([, state]) => state.flag === 'reject')
        .map(([id]) => byId.get(id))
        .filter((work): work is DemoWork => Boolean(work)),
    [flags, byId]
  );

  const setFlag = useCallback((id: string, flag: Flag | null) => {
    setFlags((current) => {
      const next = { ...current };
      if (flag === null) {
        delete next[id];
      } else {
        next[id] = { flag, hand: 'human' };
      }
      return next;
    });
  }, []);

  /** What the agent would do: propose three marks, dashed, with reasons. */
  const proposeAsAgent = useCallback(() => {
    const candidates = boardIds.filter((id) => !flags[id]).slice(0, 3);
    if (!candidates.length) return;

    setAgentActiveIds(candidates);
    setFlags((current) => {
      const next = { ...current };
      candidates.forEach((id, index) => {
        const work = byId.get(id);
        next[id] = {
          flag: index === 0 ? 'reject' : 'pick',
          hand: 'agent',
          provisional: true,
          reason: work ? `the ${work.motif} run` : 'shares the run',
        };
      });
      return next;
    });
    setNote(
      'Three provisional marks, dashed until you confirm them. The reject is the one that broke the run.'
    );
  }, [boardIds, flags, byId]);

  const confirmAgentMarks = useCallback(() => {
    setFlags((current) => {
      const next: Record<string, FlagState> = {};
      for (const [id, state] of Object.entries(current)) {
        next[id] = { ...state, provisional: false };
      }
      return next;
    });
    setAgentActiveIds([]);
    setNote('Confirmed. The dashed marks are solid now, still in the agent’s ink.');
  }, []);

  const redeal = useCallback(() => {
    const positives = pickIds
      .map((id) => byId.get(id))
      .filter((work): work is DemoWork => Boolean(work));
    const negatives = rejectedWorks;

    const rejectedIds = new Set(negatives.map((work) => work.id));
    const pool = DEMO_WORKS.filter((work) => !rejectedIds.has(work.id));

    const ranked = positives.length
      ? [...pool].sort(
          (a, b) =>
            scoreAgainstFlags(b, positives, negatives) -
            scoreAgainstFlags(a, positives, negatives)
        )
      : // With no picks to steer from, rotate the pool so a redeal still visibly
        // deals rather than doing nothing.
        [...pool.slice(dealCount + 1), ...pool.slice(0, dealCount + 1)];

    // Picks are kept regardless of where the ranking put them: the human
    // already decided, and a redeal is not allowed to overrule that.
    const kept = pickIds.filter((id) => !rejectedIds.has(id));
    const filler = ranked
      .filter((work) => !kept.includes(work.id))
      .slice(0, DEFAULT_BOARD_SIZE - kept.length)
      .map((work) => work.id);

    setBoardIds([...kept, ...filler]);
    setDealCount((count) => count + 1);
    setNote(
      positives.length
        ? `Following ${positives.length} pick${positives.length === 1 ? '' : 's'}${
            negatives.length
              ? ` and ${negatives.length} reject${negatives.length === 1 ? '' : 's'}`
              : ''
          }. Picks held their places.`
        : 'No flags yet, so this is just a fresh deal. Flag a few and redeal again.'
    );
  }, [pickIds, rejectedWorks, byId, dealCount]);

  const reset = useCallback(() => {
    setFlags({});
    setBoardIds(DEMO_WORKS.slice(0, DEFAULT_BOARD_SIZE).map((work) => work.id));
    setNote(null);
    setAgentActiveIds([]);
    setDealCount(0);
  }, []);

  const marks = useMemo(() => {
    const out: Record<string, BoardMark> = {};
    for (const [id, state] of Object.entries(flags)) out[id] = state;
    return out;
  }, [flags]);

  return (
    // Twelve cards, all on one screen. The point of dealing twelve rather than
    // sixty is that every move is readable, and that only holds if you never
    // have to scroll to see the move.
    <main className="lt-ground flex h-screen flex-col overflow-hidden px-6 py-5">
      <header className="mx-auto mb-4 flex w-full max-w-[1500px] flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="font-wall text-2xl"
            style={{ color: 'var(--ink-human)' }}
          >
            The deal
          </h1>
          <p className="lt-catalogue mt-1">
            {DEFAULT_BOARD_SIZE} works · deal {dealCount} · {pickIds.length} picked ·{' '}
            {rejectedWorks.length} rejected · {trayItems.length} in the tray
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BoardButton onClick={redeal}>Redeal</BoardButton>
          <BoardButton onClick={proposeAsAgent} hand="agent">
            Agent proposes
          </BoardButton>
          <BoardButton onClick={confirmAgentMarks}>Confirm marks</BoardButton>
          <BoardButton onClick={reset}>Reset</BoardButton>
        </div>
      </header>

      {/* The agent's note is a wall label above the board, not a chat bubble. */}
      {note && (
        <p
          className="lt-wall-label mx-auto mb-3 w-full max-w-[1500px] shrink-0 border-l pl-3 text-[0.9375rem]"
          style={{
            borderColor: 'var(--ink-agent)',
            color: 'var(--ink-agent)',
          }}
        >
          {note}
        </p>
      )}

      <div className="mx-auto w-full min-h-0 max-w-[1500px] flex-1">
        <DealBoard
          className="h-full"
          items={boardItems}
          preservedIds={pickIds}
          tray={trayItems}
          marks={marks}
          agentActiveIds={agentActiveIds}
          size={DEFAULT_BOARD_SIZE}
          renderCard={(work, context) => (
            <LightTableCard
              work={work}
              rank={context.rank}
              mark={context.mark}
              agentActive={context.agentActive}
              actions={
                <FlagRow
                  current={flags[work.id]?.flag ?? null}
                  onFlag={(flag) => setFlag(work.id, flag)}
                />
              }
            />
          )}
          renderTrayCard={(work) => (
            <button
              type="button"
              onClick={() => setFlag(work.id, null)}
              className="lt-slide lt-focusable block w-full appearance-none border-0 p-0"
              data-flag="reject"
              data-hand="human"
              title={`Restore ${work.title ?? 'work'}`}
            >
              <span className="lt-slide-well block aspect-square">
                {work.thumbnailUrl && (
                  <img
                    src={work.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                )}
              </span>
              <span className="sr-only">Restore {work.title ?? work.id}</span>
            </button>
          )}
        />
      </div>
    </main>
  );
}

function BoardButton({
  onClick,
  children,
  hand = 'human',
}: {
  onClick: () => void;
  children: React.ReactNode;
  hand?: 'human' | 'agent';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-hand={hand}
      className="lt-focusable border px-3 py-1.5 text-xs transition-colors"
      style={{
        borderColor: 'var(--ink)',
        color: 'var(--ink)',
        background: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

/**
 * The flag controls.
 *
 * These are harness chrome, and the mark itself is already carried by the
 * card's frame and corner badge, so they stay hairline and near-silent. On the
 * real board these are `P` and `X` on the hovered card — Lightroom's keys — and
 * the buttons only exist here so the deal can be driven by a click in a
 * headless capture.
 */
function FlagRow({
  current,
  onFlag,
}: {
  current: Flag | null;
  onFlag: (flag: Flag | null) => void;
}) {
  return (
    <div className="mt-1 flex gap-px">
      <FlagButton
        active={current === 'pick'}
        label="Pick"
        glyph="P"
        onClick={() => onFlag(current === 'pick' ? null : 'pick')}
      />
      <FlagButton
        active={current === 'reject'}
        label="Reject"
        glyph="X"
        onClick={() => onFlag(current === 'reject' ? null : 'reject')}
      />
    </div>
  );
}

function FlagButton({
  active,
  label,
  glyph,
  onClick,
}: {
  active: boolean;
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className="lt-catalogue lt-focusable flex-1 border py-0.5 text-[0.5625rem] transition-colors"
      style={{
        borderColor: active ? 'var(--ink-human)' : 'transparent',
        color: active ? 'var(--ink-human)' : 'var(--ink-human-faint)',
        background: 'transparent',
      }}
    >
      {glyph}
    </button>
  );
}
