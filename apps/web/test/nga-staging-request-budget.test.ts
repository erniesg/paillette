import { describe, expect, it } from 'vitest';
import { NgaStagingRequestBudget } from '../e2e/support/nga-staging-request-budget';

describe('NGA staging browser request accounting', () => {
  it('counts routed requests while separating mocked from live traffic', () => {
    const budget = new NgaStagingRequestBudget<object>(6);
    const live = {};
    const mocked = {};

    budget.observe(live);
    budget.observe(mocked);
    budget.markMocked(mocked);

    expect(budget.summary()).toEqual({ total: 2, live: 1, mocked: 1 });
    expect(() => budget.assertLiveWithinBudget()).not.toThrow();
  });

  it('rejects an unexpected seventh live request', () => {
    const budget = new NgaStagingRequestBudget<object>(6);
    for (let index = 0; index < 7; index += 1) {
      budget.observe({ index });
    }

    expect(() => budget.assertLiveWithinBudget()).toThrow(
      /7 live NGA public-search requests exceeds budget 6/
    );
  });
});
