/**
 * Reads the visitor's budgets from `GET /api/public-usage/nga`.
 *
 * Never throws: a budget that cannot be read is simply not shown, and nothing
 * on the page waits on this.
 */

import { setSpent } from './store';
import { spentFromBudgets, type CallerBudgets } from './spent-budget';

export const readBudgets = async (
  collectionId = 'nga',
  signal?: AbortSignal
): Promise<CallerBudgets | null> => {
  try {
    const response = await fetch(
      `/api/public-usage/${encodeURIComponent(collectionId)}`,
      { method: 'GET', signal }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { success?: boolean; data?: unknown };
    return body?.success && body.data && typeof body.data === 'object'
      ? (body.data as CallerBudgets)
      : null;
  } catch {
    return null;
  }
};

/**
 * Put the glyph in step with the server: spent if a budget has nothing left,
 * clear if every budget has room. A read that failed changes nothing.
 */
export const syncSpentFromBudgets = async (
  collectionId = 'nga',
  signal?: AbortSignal
): Promise<CallerBudgets | null> => {
  const budgets = await readBudgets(collectionId, signal);
  if (budgets) setSpent(spentFromBudgets(budgets));
  return budgets;
};
