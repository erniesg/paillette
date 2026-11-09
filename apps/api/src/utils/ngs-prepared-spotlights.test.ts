import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NGS_PREPARED_SPOTLIGHT_CACHE_KEY,
  NGS_PREPARED_SPOTLIGHT_DEFINITIONS,
  NGS_PREPARED_SPOTLIGHT_REVISION,
  NGS_SPOTLIGHT_DEFINITIONS,
  PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES,
  NGS_SEARCH_SPOTLIGHT_MAX_BYTES,
} from '@paillette/types/public-search-core';
import {
  readNgsPreparedBundle,
  refreshNgsPreparedSpotlights,
  validateNgsPreparedBundle,
} from './ngs-prepared-spotlights';
import { searchArtworksHybrid } from '../routes/search';
import { NGS_ORG_ID } from './orgs';
import type { Env } from '../index';
import type { ArtworkSearchResult } from '../types';

vi.mock('../routes/search', () => ({ searchArtworksHybrid: vi.fn() }));
const search = vi.mocked(searchArtworksHybrid);
const result = (index: number): ArtworkSearchResult => ({
  id: `art-${index}`,
  orgId: NGS_ORG_ID,
  galleryId: NGS_ORG_ID,
  title: `Real result ${index}`,
  similarity: 0.8,
  thumbnailUrl: `https://paillette-api.berlayar.ai/api/v1/assets/thumb-${index}/content`,
  imageUrl: null,
  metadata: { sourceInstitution: 'National Gallery Singapore' },
});
const makeEnv = () => {
  const entries = new Map<string, string>([
    [NGS_PREPARED_SPOTLIGHT_CACHE_KEY, 'last-good'],
  ]);
  const get = vi.fn(async (key: string) => entries.get(key) ?? null);
  const put = vi.fn(async (key: string, value: string) => {
    entries.set(key, value);
  });
  const first = vi.fn(async (sql: string, id: string) =>
    sql.includes('FROM orgs')
      ? { id: NGS_ORG_ID }
      : { object_key: id, storage_provider: 'r2', org_id: NGS_ORG_ID }
  );
  const head = vi.fn(async () => ({
    size: 100,
    httpMetadata: { contentType: 'image/webp' },
  }));
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (id: string) => ({ first: () => first(sql, id) }),
      }),
    },
    CACHE: { get, put },
    IMAGES: { head },
  } as unknown as Env;
  return { env, entries, first, head, get, put };
};
beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue(
    Array.from({ length: 30 }, (_, index) => result(index))
  );
});

describe('NGS prepared catalogue and trusted refresh', () => {
  it('keeps the ten evergreen definitions and covers every fixed occasion without dates', () => {
    expect(NGS_SPOTLIGHT_DEFINITIONS).toHaveLength(10);
    expect(NGS_PREPARED_SPOTLIGHT_DEFINITIONS).toHaveLength(25);
    expect(
      new Set(NGS_PREPARED_SPOTLIGHT_DEFINITIONS.map(({ id }) => id)).size
    ).toBe(25);
    expect(
      NGS_PREPARED_SPOTLIGHT_DEFINITIONS.filter(
        ({ type }) => type === 'occasion'
      ).map(({ query }) => query)
    ).toEqual([
      "New Year's Day",
      'Chinese New Year',
      'Lantern Festival',
      'Qing Ming Festival',
      'Dragon Boat Festival',
      'Qixi Festival',
      'Mid-Autumn Festival',
      'Hari Raya Puasa',
      'Good Friday',
      'Labour Day',
      'Hari Raya Haji',
      'Vesak Day',
      'National Day',
      'Deepavali',
      'Christmas Day',
    ]);
    expect(
      NGS_PREPARED_SPOTLIGHT_DEFINITIONS.every(
        (definition) => !('date' in definition)
      )
    ).toBe(true);
    expect(PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES).toBe(256 * 1024);
    expect(NGS_SEARCH_SPOTLIGHT_MAX_BYTES).toBe(1024 * 1024);
  });

  it('retrieves sequentially and atomically publishes only after all 25 terms and objects are ready', async () => {
    const { env, put, head, entries } = makeEnv();
    search.mockImplementation(async () => {
      expect(put).not.toHaveBeenCalled();
      expect(entries.get(NGS_PREPARED_SPOTLIGHT_CACHE_KEY)).toBe('last-good');
      return Array.from({ length: 30 }, (_, index) => result(index));
    });
    const refreshed = await refreshNgsPreparedSpotlights(env);
    expect(refreshed.published).toBe(true);
    expect(search).toHaveBeenCalledTimes(25);
    expect(
      search.mock.calls.every(
        (args) => args[1] === NGS_ORG_ID && args[4] === 30
      )
    ).toBe(true);
    expect(refreshed.bundle.requestDefaults).toEqual({
      topK: 30,
      minScore: 0.2,
    });
    expect(
      refreshed.bundle.suggestions.every(
        ({ artworks }) => artworks.length === 30
      )
    ).toBe(true);
    expect(head).toHaveBeenCalledTimes(4); // shared source assets checked once, not copied
    expect(put).toHaveBeenCalledTimes(1);
    expect(await readNgsPreparedBundle(env.CACHE)).toEqual(refreshed.bundle);
  });

  it('runs a three-term pilot including Christmas but never publishes partial data', async () => {
    const { env, put } = makeEnv();
    const refreshed = await refreshNgsPreparedSpotlights(env, {
      definitionIds: [
        'tropical-fruit-flowers',
        'mid-autumn-festival',
        'christmas-day',
      ],
    });
    expect(refreshed.published).toBe(false);
    expect(refreshed.searchRequestCount).toBe(3);
    expect(refreshed.bundle.suggestions).toHaveLength(3);
    expect(put).not.toHaveBeenCalled();
  });

  it('can prepare a genuine single-result term instead of requiring or inventing four works', async () => {
    const { env, head } = makeEnv();
    search.mockResolvedValue([result(0)]);
    const refreshed = await refreshNgsPreparedSpotlights(env);
    expect(refreshed.published).toBe(true);
    expect(
      refreshed.bundle.suggestions.every(
        (suggestion) => suggestion.artworks.length === 1
      )
    ).toBe(true);
    expect(head).toHaveBeenCalledOnce();
  });

  it('supports a full dry run without modifying last good', async () => {
    const { env, put } = makeEnv();
    expect(
      (await refreshNgsPreparedSpotlights(env, { dryRun: true })).published
    ).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    'empty',
    'missing-object',
    'external',
    'wrong-org',
    'same-object',
    'degraded',
    'timeout',
  ])('fails closed and retains last good on %s', async (failure) => {
    const { env, put, entries, head, first } = makeEnv();
    if (failure === 'empty') search.mockResolvedValueOnce([]);
    if (failure === 'missing-object') head.mockResolvedValueOnce(null as never);
    if (
      failure === 'external' ||
      failure === 'wrong-org' ||
      failure === 'same-object'
    ) {
      first.mockImplementation(async (sql, id) =>
        sql.includes('FROM orgs')
          ? ({ id: NGS_ORG_ID } as never)
          : ({
              object_key: failure === 'same-object' ? 'duplicate' : id,
              storage_provider: failure === 'external' ? 'external' : 'r2',
              org_id: failure === 'wrong-org' ? 'another-org' : NGS_ORG_ID,
            } as never)
      );
    }
    if (failure === 'degraded')
      search.mockImplementationOnce(async (...args) => {
        args[7]?.add('image_embedding');
        return [result(0)];
      });
    if (failure === 'timeout')
      search.mockImplementationOnce(() => new Promise(() => {}));
    await expect(
      refreshNgsPreparedSpotlights(env, {
        timeoutMs: failure === 'timeout' ? 5 : 1000,
      })
    ).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
    expect(entries.get(NGS_PREPARED_SPOTLIGHT_CACHE_KEY)).toBe('last-good');
  });

  it('deduplicates IDs and asset URLs before choosing the top four', async () => {
    const { env } = makeEnv();
    search.mockResolvedValueOnce([
      result(0),
      result(0),
      { ...result(0), id: 'duplicate-url' },
      result(1),
      result(2),
      result(3),
    ]);
    const refreshed = await refreshNgsPreparedSpotlights(env, {
      definitionIds: ['christmas-day'],
    });
    expect(
      refreshed.bundle.suggestions[0]!.artworks.map(({ id }) => id)
    ).toEqual(['art-0', 'art-1', 'art-2', 'art-3']);
  });

  it('deduplicates visible title/artist/year identities before verifying the four displayed objects', async () => {
    const { env, head } = makeEnv();
    search.mockResolvedValueOnce([
      { ...result(0), title: 'Same work', artist: 'Artist', year: 1950 },
      { ...result(1), title: ' SAME work ', artist: ' artist ', year: 1950 },
      result(2),
      result(3),
      result(4),
    ]);
    const refreshed = await refreshNgsPreparedSpotlights(env, {
      definitionIds: ['christmas-day'],
    });
    expect(
      refreshed.bundle.suggestions[0]!.artworks.map(({ id }) => id)
    ).toEqual(['art-0', 'art-2', 'art-3', 'art-4']);
    expect(head).toHaveBeenCalledWith('thumb-4');
    expect(head).not.toHaveBeenCalledWith('thumb-1');
  });

  it('rejects oversized candidates without publishing', async () => {
    const { env, put } = makeEnv();
    search.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        ...result(index),
        title: 'x'.repeat(2000),
      }))
    );
    await expect(refreshNgsPreparedSpotlights(env)).rejects.toThrow(
      /size bound/
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects incomplete cache data and visitor reads never retrieve or publish', async () => {
    const { env, entries, put } = makeEnv();
    expect(await readNgsPreparedBundle(env.CACHE)).toBeUndefined();
    entries.delete(NGS_PREPARED_SPOTLIGHT_CACHE_KEY);
    expect(await readNgsPreparedBundle(env.CACHE)).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(() =>
      validateNgsPreparedBundle({
        corpusVersion: NGS_PREPARED_SPOTLIGHT_REVISION,
      })
    ).toThrow();
  });
});
