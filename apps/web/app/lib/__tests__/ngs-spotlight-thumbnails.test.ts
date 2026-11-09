import { describe, expect, it, vi } from 'vitest';
import type { PublicSearchSpotlightBundle } from '@paillette/types/public-search';
import {
  getNgsSpotlightThumbnailPaths,
  prefetchNgsSpotlightThumbnails,
} from '../ngs-spotlight-thumbnails';

const bundle: PublicSearchSpotlightBundle = {
  schemaVersion: 1,
  contractVersion: '32',
  corpusVersion: 'fixture',
  provider: 'ngs',
  generatedAt: '2026-11-09T00:00:00.000Z',
  requestDefaults: { topK: 30, minScore: 0.2 },
  suggestions: ['christmas-day', 'mother-child'].map((id) => ({
    id,
    type: 'occasion',
    label: id,
    query: id,
    dot: '#365f9c',
    artworks: Array.from({ length: 8 }, (_, index) => ({
      id: 'work-' + index,
      orgId: 'ngs',
      title: 'Test artwork ' + index,
      artist: 'Test artist',
      similarity: 0.9,
      thumbnailUrl:
        'https://paillette-api.berlayar.ai/api/v1/assets/thumb-' +
        index +
        '/content',
      imageUrl:
        'https://paillette-api.berlayar.ai/api/v1/assets/original-' +
        index +
        '/content',
      source: {
        provider: 'ngs' as const,
        institution: 'National Gallery Singapore',
        recordId: String(index),
      },
      palette: [],
    })),
  })),
};

describe('prepared NGS thumbnail warming', () => {
  it('warms only the finite deduplicated highlight selection through the protected same-origin proxy', async () => {
    expect(getNgsSpotlightThumbnailPaths(bundle)).toEqual(
      [0, 1, 2, 3].map((i) => '/api/public-assets/thumb-' + i + '/content')
    );
    const fetcher = vi.fn(
      async () =>
        new Response('image', { headers: { 'Content-Type': 'image/jpeg' } })
    );
    await prefetchNgsSpotlightThumbnails(
      bundle,
      new AbortController().signal,
      fetcher
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [path, init] of fetcher.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(path).toMatch(/^\/api\/public-assets\/thumb-[0-3]\/content$/);
      expect(init.credentials).toBe('same-origin');
      expect(init.cache).toBe('default');
      expect(init.method).toBeUndefined();
      expect(init.headers).toBeUndefined();
    }
  });

  it('warms only selected thematic highlights, not the unrelated full-search lead cards', async () => {
    const selected = structuredClone(bundle);
    for (const suggestion of selected.suggestions)
      suggestion.highlightArtworks = [suggestion.artworks[6]!];
    expect(getNgsSpotlightThumbnailPaths(selected)).toEqual([
      '/api/public-assets/thumb-6/content',
    ]);
    const fetcher = vi.fn(async () => new Response('image'));
    await prefetchNgsSpotlightThumbnails(
      selected,
      new AbortController().signal,
      fetcher
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('never warms public NGA or arbitrary external URLs', async () => {
    const fetcher = vi.fn();
    await prefetchNgsSpotlightThumbnails(
      { ...bundle, provider: 'nga' },
      new AbortController().signal,
      fetcher
    );
    expect(fetcher).not.toHaveBeenCalled();
    const external = structuredClone(bundle);
    for (const suggestion of external.suggestions)
      for (const artwork of suggestion.artworks)
        artwork.thumbnailUrl = 'https://hostile.example/private';
    expect(getNgsSpotlightThumbnailPaths(external)).toEqual([]);
  });

  it('does not start background downloads after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await prefetchNgsSpotlightThumbnails(bundle, controller.signal, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops the bounded workers when access is denied', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    await prefetchNgsSpotlightThumbnails(
      bundle,
      new AbortController().signal,
      fetcher
    );
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('allows a broken thumbnail without losing the remaining prepared cards', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async () => new Response('image'));
    await prefetchNgsSpotlightThumbnails(
      bundle,
      new AbortController().signal,
      fetcher
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
