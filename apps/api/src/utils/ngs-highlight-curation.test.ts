import { expect, it } from 'vitest';
import type { PublicSearchSpotlightArtwork } from '@paillette/types/public-search';
import { NGS_HOLIDAY_SPOTLIGHT_DEFINITIONS } from '@paillette/types/public-search-core';
import {
  NGS_CURATED_HIGHLIGHT_IDS,
  QIXI_HIGHLIGHT_QUERY,
  selectNgsPreparedHighlights,
} from './ngs-highlight-curation';
const artwork = (id: string, title: string): PublicSearchSpotlightArtwork => ({
  id,
  title,
  orgId: 'ngs',
  similarity: 0.8,
  thumbnailUrl: `https://paillette-api.berlayar.ai/api/v1/assets/${id}/content`,
  source: { provider: 'ngs', institution: 'National Gallery Singapore' },
  palette: [],
});

it('selects reviewed Hari Raya context rather than substituting mooncakes, retaining the original search array', () => {
  const all = [
    artwork('other-festival', 'Mooncakes'),
    artwork('2016-00151', 'Hari Raya – Gathering at the Ferry'),
    artwork('1994-04157', 'Mosque in Kuala Lumpur'),
  ];
  expect(
    selectNgsPreparedHighlights('hari-raya-puasa', all).map((work) => work.id)
  ).toEqual(['2016-00151', '1994-04157']);
  expect(all).toHaveLength(3);
  expect(all[0]!.id).toBe('other-festival');
});
it('allows one defensible work and never fills a thin observance with another festival', () => {
  const all = [
    artwork('wrong', 'Mooncakes'),
    artwork('2016-00151', 'Hari Raya – Gathering at the Ferry'),
  ];
  expect(selectNgsPreparedHighlights('hari-raya-haji', all)).toHaveLength(1);
  expect(() =>
    selectNgsPreparedHighlights('hari-raya-haji', [all[0]!])
  ).toThrow(/reviewed/);
});
it('bounds every fixed curation and the additional Qixi query to a small thematic selection', () => {
  for (const definition of NGS_HOLIDAY_SPOTLIGHT_DEFINITIONS) {
    expect(
      Boolean(NGS_CURATED_HIGHLIGHT_IDS[definition.id]) ||
        ['qixi-festival', 'christmas-day'].includes(definition.id)
    ).toBe(true);
  }
  for (const ids of Object.values(NGS_CURATED_HIGHLIGHT_IDS)) {
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
  }
  expect(QIXI_HIGHLIGHT_QUERY).toMatch(/romantic couple/);
  expect(QIXI_HIGHLIGHT_QUERY).not.toMatch(/festival/);
});
