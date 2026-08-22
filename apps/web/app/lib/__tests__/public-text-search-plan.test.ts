import { describe, expect, it } from 'vitest';

import { buildPublicTextSearchPlan } from '../public-text-search-plan';

const baseInput = {
  orgId: 'nga',
  facet: null,
  committedTextQuery: 'angels',
  colourQuery: null,
  topK: 30,
  minScore: 0.2,
} as const;

describe('buildPublicTextSearchPlan', () => {
  it('keeps colour out of a committed text request and its cache identity', () => {
    const base = buildPublicTextSearchPlan(baseInput);
    const navy = buildPublicTextSearchPlan({
      ...baseInput,
      colourQuery: 'dark navy blue',
    });
    const red = buildPublicTextSearchPlan({
      ...baseInput,
      colourQuery: 'rich red',
    });

    expect(navy).toEqual(base);
    expect(red).toEqual(base);
    expect(navy?.request).toEqual({
      query: 'angels',
      topK: 30,
      minScore: 0.2,
    });
    expect(navy?.request).not.toHaveProperty('visualRefinement');
  });

  it('uses the colour descriptor only when there is no committed text query', () => {
    expect(
      buildPublicTextSearchPlan({
        ...baseInput,
        committedTextQuery: '   ',
        colourQuery: 'dark navy blue',
      })
    ).toMatchObject({
      request: {
        query: 'dark navy blue',
        topK: 30,
        minScore: 0.2,
      },
    });
  });

  it('normalizes text once and preserves a metadata facet in the base plan', () => {
    const plan = buildPublicTextSearchPlan({
      ...baseInput,
      committedTextQuery: '  Cafe\u0301\n angels  ',
      facet: 'classification',
    });

    expect(plan?.request).toEqual({
      query: 'Café angels',
      topK: 30,
      minScore: 0.2,
      facet: 'classification',
    });
    expect(plan?.queryKey).toContain('Café angels');
  });

  it('returns null when neither text nor colour provides a query', () => {
    expect(
      buildPublicTextSearchPlan({
        ...baseInput,
        committedTextQuery: ' ',
        colourQuery: ' ',
      })
    ).toBeNull();
  });

  it('includes explicit removable constraints in the request and cache identity', () => {
    const constraints = { dateRange: { startYear: 1700, endYear: 1799 }, classifications: ['Painting'] };
    const plan = buildPublicTextSearchPlan({ ...baseInput, committedTextQuery: 'landscape', constraints });
    expect(plan?.request).toMatchObject({ query: 'landscape', constraints });
    expect(plan?.queryKey.join(':')).toContain('Painting');
  });

  it('versions browser text-search identity with public contract 28', () => {
    const plan = buildPublicTextSearchPlan(baseInput);

    expect(plan?.queryKey[2]).toBe('28');
  });
});
