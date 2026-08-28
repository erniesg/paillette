import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES,
  type PublicSearchSpotlightBundle,
} from '@paillette/types/public-search';
import {
  getSearchSpotlightPath,
  getSpotlightArtworks,
  getSpotlightSearchPlaceholder,
  loadSearchSpotlightBundle,
} from '../search-spotlights';
import { NGA_SPOTLIGHT_DEFINITIONS } from '../nga-spotlight-definitions';
import { NGS_SPOTLIGHT_DEFINITIONS } from '../ngs-spotlight-definitions';

const artwork = (id: string, provider: 'nga' | 'ngs' = 'nga') => ({
  id,
  orgId: 'nga',
  title: `Artwork ${id}`,
  artist: `Artist ${id}`,
  year: 1900 + Number(id),
  imageUrl: `https://example.com/${id}.jpg`,
  thumbnailUrl: `https://example.com/${id}-thumb.jpg`,
  similarity: 1 - Number(id) / 100,
  source: {
    provider,
    institution:
      provider === 'nga'
        ? 'National Gallery of Art, Washington'
        : 'National Gallery Singapore',
    recordId: id,
    url: `https://www.nga.gov/artworks/${id}`,
    accessionNumber: `A-${id}`,
    rights: 'Open Access',
  },
  palette: ['#4c78a8', '#ffffff'],
});

const validBundle: PublicSearchSpotlightBundle = {
  schemaVersion: 1,
  contractVersion: '32',
  corpusVersion: 'nga-fixture-v1',
  provider: 'nga',
  generatedAt: '2026-07-17T08:00:00.000Z',
  requestDefaults: { topK: 30, minScore: 0.2 },
  suggestions: NGA_SPOTLIGHT_DEFINITIONS.map((definition, index) => ({
    ...definition,
    artworks: [1, 2, 3, 4].map((cardIndex) =>
      artwork(String(index * 4 + cardIndex))
    ),
  })),
};

const validNgsBundle: PublicSearchSpotlightBundle = {
  ...validBundle,
  corpusVersion: 'ngs-fixture-v1',
  provider: 'ngs',
  suggestions: NGS_SPOTLIGHT_DEFINITIONS.map((definition, index) => ({
    ...definition,
    artworks: [1, 2, 3, 4].map((cardIndex) =>
      artwork(String(index * 4 + cardIndex), 'ngs')
    ),
  })),
};

const responseFor = (value: unknown, status = 200) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('search spotlight loading', () => {
  it('loads the exact versioned NGA path once with the caller abort signal', async () => {
    const fetcher = vi.fn(async () => responseFor(validBundle));
    const signal = new AbortController().signal;

    const loaded = await loadSearchSpotlightBundle('nga', {
      fetcher,
      signal,
    });

    const assetPath = getSearchSpotlightPath('nga');
    expect(assetPath).toMatch(
      /^\/search-spotlights\/nga\/v32-[a-f0-9]{64}\.json$/
    );
    expect(loaded).toEqual(validBundle);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      assetPath,
      expect.objectContaining({ signal })
    );
  });

  it('keeps the immutable asset URL content-addressed', async () => {
    const assetPath = getSearchSpotlightPath('nga');
    const bytes = await readFile(
      resolve(process.cwd(), 'public', assetPath.slice(1))
    );
    const digest = createHash('sha256').update(bytes).digest('hex');

    expect(assetPath.endsWith(`-${digest}.json`)).toBe(true);
  });

  it('loads the content-addressed NGS cache through the WorkOS session proxy', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        responseFor({ success: true, data: validNgsBundle })
      );
    const getAccessToken = vi.fn(async () => 'ngs-token');

    const loaded = await loadSearchSpotlightBundle('ngs', {
      getAccessToken,
    });

    expect(getSearchSpotlightPath('ngs')).toMatch(
      /^\/orgs\/ngs\/search-spotlights\/v32-[a-f0-9]{64}$/
    );
    expect(loaded).toEqual(validNgsBundle);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/api\/backend\/orgs\/ngs\/search-spotlights\/v32-[a-f0-9]{64}$/
      ),
      expect.objectContaining({
        headers: {},
      })
    );

    fetcher.mockRestore();
  });

  it('stores the complete cached result set for every NGA Try term', async () => {
    const assetPath = getSearchSpotlightPath('nga');
    const current = JSON.parse(
      await readFile(
        resolve(process.cwd(), 'public', assetPath.slice(1)),
        'utf8'
      )
    ) as PublicSearchSpotlightBundle;

    expect(current.contractVersion).toBe('32');
    expect(
      current.suggestions.map((suggestion) => ({
        id: suggestion.id,
        cachedResults: suggestion.artworks.length,
      }))
    ).toEqual(
      NGA_SPOTLIGHT_DEFINITIONS.map((definition) => ({
        id: definition.id,
        cachedResults: definition.id === 'ginevra-de-benci' ? 1 : 30,
      }))
    );
    expect(
      current.suggestions.reduce(
        (total, suggestion) => total + suggestion.artworks.length,
        0
      )
    ).toBe(301);
  });

  it('shows the Whistler mother-and-child artwork once from the real cached NGA bundle', async () => {
    const assetPath = getSearchSpotlightPath('nga');
    const current = JSON.parse(
      await readFile(
        resolve(process.cwd(), 'public', assetPath.slice(1)),
        'utf8'
      )
    ) as PublicSearchSpotlightBundle;

    const cachedWhistlers = current.suggestions
      .find((suggestion) => suggestion.id === 'mother-child')
      ?.artworks.filter(
        (candidate) =>
          candidate.title === 'Mother and Child, No. 1' &&
          candidate.artist === 'James McNeill Whistler' &&
          candidate.year === 1891
      );
    const displayedWhistlers = getSpotlightArtworks(
      current,
      'mother-child'
    ).filter(
      (candidate) =>
        candidate.title === 'Mother and Child, No. 1' &&
        candidate.artist === 'James McNeill Whistler' &&
        candidate.year === 1891
    );

    expect(cachedWhistlers).toHaveLength(2);
    expect(displayedWhistlers).toHaveLength(1);
    expect(displayedWhistlers[0]?.id).toBe('open-access-art:nga:11236');
  });

  it.each([
    ['malformed JSON', () => responseFor('{nope')],
    [
      'contract mismatch',
      () => responseFor({ ...validBundle, contractVersion: '17' }),
    ],
    ['wrong provider', () => responseFor({ ...validBundle, provider: 'ngs' })],
    [
      'suggestion contract drift',
      () =>
        responseFor({
          ...validBundle,
          suggestions: validBundle.suggestions.map((suggestion, index) =>
            index === 0 ? { ...suggestion, label: 'changed copy' } : suggestion
          ),
        }),
    ],
    [
      'empty cached result set',
      () =>
        responseFor({
          ...validBundle,
          suggestions: validBundle.suggestions.map((suggestion, index) =>
            index === 0 ? { ...suggestion, artworks: [] } : suggestion
          ),
        }),
    ],
    [
      'duplicate suggestion IDs',
      () =>
        responseFor({
          ...validBundle,
          suggestions: [validBundle.suggestions[0], validBundle.suggestions[0]],
        }),
    ],
    [
      'oversize payload',
      () =>
        responseFor({
          ...validBundle,
          suggestions: [
            {
              ...validBundle.suggestions[0],
              detail: 'x'.repeat(PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES),
            },
          ],
        }),
    ],
  ])(
    'throws for invalid %s so React Query can retry',
    async (_label, makeResponse) => {
      const fetcher = vi.fn(async () => makeResponse());

      await expect(
        loadSearchSpotlightBundle('nga', { fetcher })
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['a missing asset', () => Promise.resolve(responseFor({}, 404))],
    ['a server failure', () => Promise.resolve(responseFor({}, 503))],
    ['a network failure', () => Promise.reject(new Error('network down'))],
  ])('throws for %s so React Query can retry later', async (_label, fetch) => {
    const fetcher = vi.fn(fetch);

    await expect(
      loadSearchSpotlightBundle('nga', { fetcher })
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('adapts only allowlisted spotlight card data to artwork results', () => {
    const results = getSpotlightArtworks(validBundle, 'stormy-seas-ships');

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({
      id: '1',
      orgId: 'nga',
      galleryId: 'nga',
      title: 'Artwork 1',
      artist: 'Artist 1',
      year: 1901,
      imageUrl: 'https://example.com/1.jpg',
      thumbnailUrl: 'https://example.com/1-thumb.jpg',
      similarity: 0.99,
      metadata: {
        provider: 'nga',
        sourceInstitution: 'National Gallery of Art, Washington',
        sourceUrl: 'https://www.nga.gov/artworks/1',
        sourceRecordId: '1',
        accessionNumber: 'A-1',
        rights: 'Open Access',
        dominantColors: ['#4c78a8', '#ffffff'],
      },
    });
    expect(getSpotlightArtworks(validBundle, 'missing')).toEqual([]);
  });

  it('provides cached cards only for the exact featured search', () => {
    expect(
      getSpotlightSearchPlaceholder(validBundle, {
        query: '  A STORMY SEA WITH SHIPS ',
        topK: 3,
        minScore: 0.97,
      })
    ).toMatchObject({
      count: 3,
      queryTime: 0,
      results: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });

    expect(
      getSpotlightSearchPlaceholder(validBundle, {
        query: 'Painting',
        topK: 30,
        minScore: 0.2,
      })
    ).toBeUndefined();
    expect(
      getSpotlightSearchPlaceholder(validBundle, {
        query: 'Painting',
        facet: 'classification',
        topK: 30,
        minScore: 0.2,
      })
    ).toMatchObject({ count: 4 });
  });

  it('provides cached results for every NGA Try term', () => {
    for (const definition of NGA_SPOTLIGHT_DEFINITIONS) {
      expect(
        getSpotlightSearchPlaceholder(validBundle, {
          query: definition.query,
          facet: 'facet' in definition ? definition.facet : null,
          colourId: 'colourId' in definition ? definition.colourId : null,
          topK: 30,
          minScore: 0.2,
        })
      ).toMatchObject({ count: 4, queryTime: 0 });
    }
  });
});
