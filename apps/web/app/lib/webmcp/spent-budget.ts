/**
 * When a cap is spent, say so once, tersely, and say what did not happen.
 *
 * Four server-side budgets can run out under a person curating a show: write_labels
 * calls and agent model calls (each per caller, over any hour), NGA searches (per
 * caller, over any day) and the site's daily model budget (everyone's). Each
 * refused on its own terms and none of them reached the page as a state: a
 * labelling budget spent mid-correction published a show with blank walls
 * (`/e/kaxeFU4`), and the only trace was a line in a log nobody opens.
 *
 * So a refusal carrying one of these codes becomes one fact on the store —
 * which budget, and when it comes back if the server said — and that fact is
 * what the activity glyph shows and what the agent's note is written from.
 */

export type BudgetName = 'labels' | 'agentCalls' | 'search' | 'dailySite';

export type Budget = {
  limit: number;
  used: number;
  remaining: number;
  nextAt: number | null;
};

/** The shape `GET /api/public-usage/nga` returns. */
export type CallerBudgets = Record<BudgetName, Budget | null>;

export type SpentBudget = {
  budget: BudgetName;
  /** When one more call becomes available, if the server said. */
  nextAt: number | null;
  at: number;
};

/** The refusal codes that mean a budget is spent, and which one. */
export const SPENT_CODES: Readonly<Record<string, BudgetName>> = {
  LABELS_RATE_LIMITED: 'labels',
  AGENT_CALLS_SPENT: 'agentCalls',
  AGENT_BUDGET_SPENT: 'dailySite',
  NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED: 'search',
};

/** Which budget a tool spends, so a success can clear a spent state. */
export const BUDGET_BY_TOOL: Readonly<Record<string, BudgetName>> = {
  write_labels: 'labels',
  search_artworks: 'search',
  search_by_color: 'search',
  search_by_image: 'search',
};

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Read a tool result or a route's error envelope. Both carry
 * `{error: {code, details?: {budget?: {nextAt}}}}` when a cap refused them.
 */
export const spentFromResult = (
  result: unknown,
  now: number = Date.now()
): SpentBudget | null => {
  const error = (result as { error?: unknown } | null)?.error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  const budget = typeof code === 'string' ? SPENT_CODES[code] : undefined;
  if (!budget) return null;
  const details = (error as { details?: { budget?: { nextAt?: unknown } } }).details;
  return { budget, nextAt: asNumber(details?.budget?.nextAt), at: now };
};

/** The first budget with nothing left, from a budgets read. */
export const spentFromBudgets = (
  budgets: Partial<CallerBudgets> | null | undefined,
  now: number = Date.now()
): SpentBudget | null => {
  if (!budgets) return null;
  // Most consequential first: the site's budget stops everything.
  for (const budget of ['dailySite', 'agentCalls', 'labels', 'search'] as const) {
    const state = budgets[budget];
    if (state && state.remaining <= 0) {
      return { budget, nextAt: asNumber(state.nextAt), at: now };
    }
  }
  return null;
};

/** Spent until it says it comes back; a state with no return time stands. */
export const isStillSpent = (spent: SpentBudget | null, now: number = Date.now()) =>
  Boolean(spent && (spent.nextAt === null || spent.nextAt > now));

const WORD: Record<BudgetName, string> = {
  labels: 'labels',
  agentCalls: 'agent',
  search: 'search',
  dailySite: 'site',
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The glyph's one line: `labels spent · 14:32`. No sentence, no advice — the
 * glyph is a mark, and the note is where the explanation goes.
 */
export const spentLine = (spent: SpentBudget) =>
  `${WORD[spent.budget]} spent${spent.nextAt ? ` · ${clock(spent.nextAt)}` : ''}`;

/**
 * What the turn did not do, as the note the human reads.
 *
 * Built from what the page can see — how many hung works have no label, whether
 * the turn was cut off — not from what the model said it meant to do. One
 * sentence where one will do.
 */
export const whatWasNotDone = (input: {
  spent: SpentBudget;
  /** Hung works with no wall label, read from the show. */
  unlabelled: number;
}): string => {
  const { spent, unlabelled } = input;
  const back = spent.nextAt ? ` until ${clock(spent.nextAt)}` : '';
  const walls =
    unlabelled > 0
      ? ` ${unlabelled} ${unlabelled === 1 ? 'work is' : 'works are'} still without a label.`
      : '';
  switch (spent.budget) {
    case 'labels':
      return `Labels not written: the labelling budget is spent${back}.${walls}`;
    case 'agentCalls':
      return `Stopped before finishing: this hour's agent budget is spent${back}.${walls}`;
    case 'dailySite':
      return `Stopped before finishing: the site's daily model budget is spent${back}.${walls}`;
    case 'search':
      return `No new searches: today's search budget is spent. Browsing still works.${walls}`;
  }
};
