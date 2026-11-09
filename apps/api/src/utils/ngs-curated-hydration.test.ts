import { expect, it, vi } from 'vitest';
import { loadNgsCuratedHighlightArtworks } from '../routes/search';
import { NGS_ORG_ID } from './orgs';

it('bounds trusted exact-ID loading to NGS and four unique IDs before database access', async () => {
  const prepare = vi.fn();
  const env = { DB: { prepare } as unknown as D1Database };
  await expect(
    loadNgsCuratedHighlightArtworks(env, 'other-org', ['work'])
  ).rejects.toThrow(/scope/);
  await expect(
    loadNgsCuratedHighlightArtworks(env, NGS_ORG_ID, ['a', 'b', 'c', 'd', 'e'])
  ).rejects.toThrow(/scope/);
  expect(await loadNgsCuratedHighlightArtworks(env, NGS_ORG_ID, [])).toEqual(
    []
  );
  expect(prepare).not.toHaveBeenCalled();
});

it('reuses org/provider/deleted/backable hydration and actual row metadata without inference', async () => {
  const bind = vi.fn(() => ({
    all: async () => ({
      results: [
        {
          id: '2012-00268',
          org_id: NGS_ORG_ID,
          title: 'The Funeral',
          artist: 'Le Quoc Viet',
          year: 2009,
          source_institution: 'National Gallery Singapore',
          thumbnail_url:
            'https://paillette-api.berlayar.ai/api/v1/assets/thumb/content',
          dominant_colors: '["#aabbcc"]',
        },
      ],
    }),
  }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  const result = await loadNgsCuratedHighlightArtworks(
    { DB: { prepare } as unknown as D1Database },
    NGS_ORG_ID,
    ['2012-00268', '2012-00268']
  );
  expect(prepare.mock.calls[0]![0]).toContain('deleted_at IS NULL');
  expect(prepare.mock.calls[0]![0]).toContain('AND org_id = ?');
  expect(bind).toHaveBeenCalledWith('2012-00268', NGS_ORG_ID, 'ngs');
  expect(result).toMatchObject([
    {
      id: '2012-00268',
      orgId: NGS_ORG_ID,
      title: 'The Funeral',
      artist: 'Le Quoc Viet',
      year: 2009,
      similarity: 1,
      metadata: {
        sourceInstitution: 'National Gallery Singapore',
        dominantColors: ['#aabbcc'],
      },
    },
  ]);
});
