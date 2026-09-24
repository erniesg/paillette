import { describe, expect, it } from 'vitest';
import {
  isStillSpent,
  spentFromBudgets,
  spentFromResult,
  spentLine,
  whatWasNotDone,
} from '../spent-budget';

const NOW = Date.parse('2026-09-24T14:00:00Z');

describe('spentFromResult', () => {
  it('reads each cap the server can refuse with', () => {
    const at = (code: string, nextAt?: number) =>
      spentFromResult(
        { ok: false, error: { code, ...(nextAt ? { details: { budget: { nextAt } } } : {}) } },
        NOW
      );
    expect(at('LABELS_RATE_LIMITED', NOW + 5)).toEqual({ budget: 'labels', nextAt: NOW + 5, at: NOW });
    expect(at('AGENT_CALLS_SPENT')?.budget).toBe('agentCalls');
    expect(at('AGENT_BUDGET_SPENT')?.budget).toBe('dailySite');
    expect(at('NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED')?.budget).toBe('search');
  });

  it('ignores every other failure, and success', () => {
    expect(spentFromResult({ ok: false, error: { code: 'ARTWORK_NOT_FOUND' } })).toBeNull();
    // The provider throttling us is not one of our budgets.
    expect(spentFromResult({ success: false, error: { code: 'AGENT_RATE_LIMITED' } })).toBeNull();
    expect(spentFromResult({ ok: true })).toBeNull();
    expect(spentFromResult(null)).toBeNull();
  });
});

describe('spentFromBudgets', () => {
  const room = { limit: 10, used: 1, remaining: 9, nextAt: null };
  it('finds the budget with nothing left, the site first', () => {
    expect(
      spentFromBudgets(
        {
          labels: { limit: 10, used: 10, remaining: 0, nextAt: NOW + 9 },
          agentCalls: room,
          search: room,
          dailySite: { limit: 500, used: 500, remaining: 0, nextAt: NOW + 99 },
        },
        NOW
      )
    ).toEqual({ budget: 'dailySite', nextAt: NOW + 99, at: NOW });
  });

  it('says nothing is spent when everything has room, or nothing could be read', () => {
    expect(spentFromBudgets({ labels: room, agentCalls: null, search: room, dailySite: room })).toBeNull();
    expect(spentFromBudgets(null)).toBeNull();
  });
});

describe('the words', () => {
  const labels = { budget: 'labels' as const, nextAt: NOW + 32 * 60_000, at: NOW };

  it('gives the glyph one terse line', () => {
    expect(spentLine(labels)).toMatch(/^labels spent · \d{1,2}:\d{2}/);
    expect(spentLine({ budget: 'search', nextAt: null, at: NOW })).toBe('search spent');
  });

  it('says what the turn did not do, counted from the wall', () => {
    expect(whatWasNotDone({ spent: labels, unlabelled: 3 })).toMatch(
      /^Labels not written: the labelling budget is spent until \d{1,2}:\d{2}( ?[AP]M)?\. 3 works are still without a label\.$/
    );
    expect(
      whatWasNotDone({ spent: { budget: 'agentCalls', nextAt: null, at: NOW }, unlabelled: 0 })
    ).toBe("Stopped before finishing: this hour's agent budget is spent.");
    expect(
      whatWasNotDone({ spent: { budget: 'search', nextAt: null, at: NOW }, unlabelled: 1 })
    ).toBe("No new searches: today's search budget is spent. Browsing still works. 1 work is still without a label.");
  });

  it('knows when a spent budget has come back', () => {
    expect(isStillSpent(labels, NOW)).toBe(true);
    expect(isStillSpent(labels, NOW + 33 * 60_000)).toBe(false);
    expect(isStillSpent(null)).toBe(false);
  });
});
