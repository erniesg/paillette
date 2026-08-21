import { describe, expect, it } from 'vitest';
import * as publicSearchCore from '@paillette/types/public-search-core';

import {
  buildPublicImageSearchPlan,
  normalizePublicImageSearchConstraints,
} from '../public-image-search-plan';

const file = (bytes: number[], name: string) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

const baseInput = {
  orgId: 'nga',
  image: file([1, 2, 3, 4], 'query.png'),
  topK: 30,
  minScore: 0,
  constraints: {
    dateRange: { startYear: 1700, endYear: 1799 },
    classifications: ['Painting'],
    mediumFamilies: ['oil'],
    artistIds: ['artist-1'],
  },
};

describe('buildPublicImageSearchPlan', () => {
  it('uses image bytes rather than filename metadata as client identity', async () => {
    const first = await buildPublicImageSearchPlan(baseInput);
    const renamed = await buildPublicImageSearchPlan({
      ...baseInput,
      image: file([1, 2, 3, 4], 'renamed-with-new-time.png'),
    });
    const changedBytes = await buildPublicImageSearchPlan({
      ...baseInput,
      image: file([4, 3, 2, 1], 'query.png'),
    });

    expect(renamed.queryKey).toEqual(first.queryKey);
    expect(changedBytes.queryKey).not.toEqual(first.queryKey);
    expect(first.queryKey.join(':')).not.toContain('query.png');
  });

  it('gives reordered and duplicated canonical-equivalent constraints one identity', async () => {
    const first = await buildPublicImageSearchPlan(baseInput);
    const equivalent = await buildPublicImageSearchPlan({
      ...baseInput,
      constraints: {
        artistIds: ['artist-1', 'artist-1'],
        mediumFamilies: ['oil', 'oil'],
        classifications: ['Painting', 'Painting'],
        dateRange: { startYear: 1700, endYear: 1799 },
      },
    });

    expect(equivalent.queryKey).toEqual(first.queryKey);
    expect(equivalent.request.constraints).toEqual({
      dateRange: { startYear: 1700, endYear: 1799 },
      classifications: ['Painting'],
      mediumFamilies: ['oil'],
      artistIds: ['artist-1'],
    });
  });

  it('gives reversed nested date keys the same canonical identity', async () => {
    const first = await buildPublicImageSearchPlan(baseInput);
    const reversedDateRange = Object.fromEntries([
      ['endYear', 1799],
      ['startYear', 1700],
    ]) as { startYear: number; endYear: number };
    const equivalent = await buildPublicImageSearchPlan({
      ...baseInput,
      constraints: {
        ...baseInput.constraints,
        dateRange: reversedDateRange,
      },
    });

    expect(equivalent.queryKey).toEqual(first.queryKey);
  });

  it('uses the shared public constraint normalizer as its source of truth', () => {
    const sharedNormalize = (
      publicSearchCore as Record<string, unknown>
    ).normalizePublicSearchConstraints;

    expect(typeof sharedNormalize).toBe('function');
    expect(normalizePublicImageSearchConstraints).toBe(sharedNormalize);
  });

  it.each([
    ['date', { constraints: { ...baseInput.constraints, dateRange: { startYear: 1800, endYear: 1899 } } }],
    ['classification', { constraints: { ...baseInput.constraints, classifications: ['Drawing'] } }],
    ['medium', { constraints: { ...baseInput.constraints, mediumFamilies: ['ink'] } }],
    ['artist', { constraints: { ...baseInput.constraints, artistIds: ['artist-2'] } }],
    ['topK', { topK: 31 }],
    ['minScore', { minScore: 0.1 }],
  ])('does not collide when %s changes', async (_label, change) => {
    const first = await buildPublicImageSearchPlan(baseInput);
    const changed = await buildPublicImageSearchPlan({
      ...baseInput,
      ...change,
    });

    expect(changed.queryKey).not.toEqual(first.queryKey);
  });

  it('preserves explicit empty constraints and numeric minScore zero', async () => {
    const plan = await buildPublicImageSearchPlan({
      ...baseInput,
      constraints: {},
      minScore: 0,
    });

    expect(plan.request).toMatchObject({ constraints: {}, minScore: 0 });
  });
});
