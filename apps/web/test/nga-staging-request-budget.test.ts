import { describe, expect, it } from 'vitest';
import {
  NGA_STAGING_EXPECTED_TEST_COUNT,
  NGA_STAGING_LIVE_REQUEST_BUDGET,
  NgaStagingRequestBudget,
} from '../e2e/support/nga-staging-request-budget';

describe('NGA staging browser request accounting', () => {
  it('declares the exact nine-test, eight-live-request release contract', () => {
    expect(NGA_STAGING_EXPECTED_TEST_COUNT).toBe(9);
    expect(NGA_STAGING_LIVE_REQUEST_BUDGET).toBe(8);
  });

  it('counts routed requests while separating mocked from live traffic', () => {
    const budget = new NgaStagingRequestBudget<object>(
      NGA_STAGING_LIVE_REQUEST_BUDGET
    );
    const live = {};
    const mocked = {};

    budget.observe(live);
    budget.observe(mocked);
    budget.markMocked(mocked);

    expect(budget.summary()).toEqual({ total: 2, live: 1, mocked: 1 });
    expect(() => budget.assertLiveWithinBudget()).not.toThrow();
  });

  it('accepts exactly eight live requests and rejects an unexpected ninth', () => {
    const budget = new NgaStagingRequestBudget<object>(
      NGA_STAGING_LIVE_REQUEST_BUDGET
    );
    for (let index = 0; index < 8; index += 1) {
      budget.observe({ index });
    }

    expect(budget.summary()).toEqual({ total: 8, live: 8, mocked: 0 });
    expect(() => budget.assertLiveWithinBudget()).not.toThrow();

    budget.observe({ index: 8 });

    expect(() => budget.assertLiveWithinBudget()).toThrow(
      /9 live NGA public-search requests exceeds budget 8/
    );
  });
});
