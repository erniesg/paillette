import { describe, expect, it, vi } from 'vitest';

import {
  __getLocalColourRefinementCacheStatsForTest,
  __resetLocalColourRefinementCachesForTest,
  getCachedCandidatePaletteColourDistance,
  getNearestPaletteColourDistance,
  rankByPaletteColour,
} from '../local-colour-refinement';

type Candidate = {
  id: string;
  palette: string[];
};

describe('rankByPaletteColour', () => {
  it('matches known CIEDE2000 reference distances for sRGB hex colours', () => {
    // Reference values from Color.js / CSS Color's D50 CIELAB conversion.
    expect(
      getNearestPaletteColourDistance(['#ff0000'], ['#00ff00'])
    ).toBeCloseTo(84.306863290959, 10);
    expect(
      getNearestPaletteColourDistance(['#ff0000'], ['#0000ff'])
    ).toBeCloseTo(55.799773390198, 10);
    expect(getNearestPaletteColourDistance(['#ffffff'], ['#000000'])).toBe(100);
  });

  it('exposes the same nearest CIEDE2000 distance used for ranking and display', () => {
    expect(
      getNearestPaletteColourDistance(['#001f54'], ['#001f54', '#ffffff'])
    ).toBe(0);
    expect(
      getNearestPaletteColourDistance(['#ff0000', '#001f54'], ['#001f54'])
    ).toBe(0);
    expect(getNearestPaletteColourDistance(['#001f54'], [])).toBe(Infinity);
  });

  it('orders fetched candidates by their nearest stored palette colour', () => {
    const candidates: Candidate[] = [
      { id: 'blue', palette: ['#162d68', '#ffffff'] },
      { id: 'red', palette: ['#ee1111'] },
      { id: 'navy', palette: ['#001f54'] },
    ];

    expect(
      rankByPaletteColour(candidates, ['#001f54'], (item) => item.palette).map(
        (item) => item.id
      )
    ).toEqual(['navy', 'blue', 'red']);
  });

  it('reads each candidate palette once, keeps ties stable, and does not mutate input', () => {
    const candidates: Candidate[] = [
      { id: 'first-red', palette: ['#ff0000'] },
      { id: 'second-red', palette: ['#ff0000'] },
      { id: 'missing', palette: [] },
    ];
    const original = [...candidates];
    const getPalette = vi.fn((item: Candidate) => item.palette);

    const ranked = rankByPaletteColour(candidates, ['#ff0000'], getPalette);

    expect(ranked.map((item) => item.id)).toEqual([
      'first-red',
      'second-red',
      'missing',
    ]);
    expect(getPalette).toHaveBeenCalledTimes(candidates.length);
    expect(candidates).toEqual(original);
    expect(ranked).not.toBe(candidates);
  });

  it('puts missing or invalid palettes last and returns a copy without a colour', () => {
    const candidates: Candidate[] = [
      { id: 'missing', palette: [] },
      { id: 'invalid', palette: ['not-a-colour'] },
      { id: 'green', palette: ['#00aa55'] },
    ];

    expect(
      rankByPaletteColour(candidates, ['#00aa55'], (item) => item.palette).map(
        (item) => item.id
      )
    ).toEqual(['green', 'missing', 'invalid']);

    const unranked = rankByPaletteColour(
      candidates,
      [],
      (item) => item.palette
    );
    expect(unranked).toEqual(candidates);
    expect(unranked).not.toBe(candidates);
  });

  it('reuses candidate distances for an equivalent selected-colour set', () => {
    const candidate = { id: 'navy' };
    const first = getCachedCandidatePaletteColourDistance(
      candidate,
      ['#ff0000', '#001f54'],
      ['#001f54']
    );
    const reused = getCachedCandidatePaletteColourDistance(
      candidate,
      ['#001F54', '#ff0000', '#ff0000'],
      ['#ffffff']
    );

    expect(first).toBe(0);
    expect(reused).toBe(first);
  });

  it('bounds cached parsed Lab values while normalising hex case', () => {
    __resetLocalColourRefinementCachesForTest();
    getNearestPaletteColourDistance(['#001F54'], ['#162d68']);
    expect(__getLocalColourRefinementCacheStatsForTest()).toEqual({
      labEntries: 2,
    });

    for (let index = 0; index < 2_049; index++) {
      const hex = `#${index.toString(16).padStart(6, '0')}`;
      getNearestPaletteColourDistance([hex], [hex]);
    }

    expect(__getLocalColourRefinementCacheStatsForTest()).toEqual({
      labEntries: 2_048,
    });
  });
});
