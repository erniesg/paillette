import { describe, expect, it, vi } from 'vitest';

import {
  IMAGE_SEARCH_COMPOSER_CLASS_NAME,
  IMAGE_SEARCH_PREVIEW_CLASS_NAME,
  MASONRY_IMAGE_CLASS_NAME,
  getNextUrlDrivenTextSearchExecutionId,
  getSearchParamsForQuery,
  getMasonryImageFrameStyle,
  collectPalette,
  shouldObserveMasonryColumnEnds,
} from '../galleries.$galleryId.search';
import { QueryClient } from '@tanstack/react-query';
import type { ArtworkSearchResult } from '~/types';
import {
  createSearchComposerState,
  getSearchPresentation,
  selectEditorMode,
  type SubmittedSearch,
} from '~/lib/public-search-composer';

const artwork = (
  metadata: ArtworkSearchResult['metadata'] = {}
): ArtworkSearchResult => ({
  id: 'artwork-1',
  galleryId: 'gallery-1',
  title: 'Stable masonry work',
  imageUrl: 'https://example.com/artwork.jpg',
  similarity: 1,
  metadata,
});

describe('masonry image layout', () => {
  it('reserves image height from artwork dimensions before lazy images load', () => {
    expect(
      getMasonryImageFrameStyle(
        artwork({
          dimensions: {
            width: 200,
            height: 100,
          },
        })
      )
    ).toEqual({
      aspectRatio: '1 / 0.5',
    });
  });

  it('uses a deterministic fallback ratio when dimensions are missing', () => {
    const first = getMasonryImageFrameStyle(artwork());
    const second = getMasonryImageFrameStyle(artwork());

    expect(first).toEqual(second);
    expect(first.aspectRatio).toMatch(/^1 \/ \d+(\.\d+)?$/);
  });

  it('contains masonry images so single-result cards do not crop the artwork', () => {
    expect(MASONRY_IMAGE_CLASS_NAME).toContain('object-contain');
    expect(MASONRY_IMAGE_CLASS_NAME).not.toContain('object-cover');
    expect(MASONRY_IMAGE_CLASS_NAME).not.toContain('scale-');
  });
});

describe('masonry infinite loading', () => {
  it('watches column ends only for active masonry infinite browse', () => {
    expect(
      shouldObserveMasonryColumnEnds({
        hasMoreResults: true,
        isBrowsingCollection: true,
        isFetchingNextPage: false,
        isLoading: false,
        view: 'masonry',
      })
    ).toBe(true);

    expect(
      shouldObserveMasonryColumnEnds({
        hasMoreResults: true,
        isBrowsingCollection: true,
        isFetchingNextPage: false,
        isLoading: false,
        view: 'table',
      })
    ).toBe(false);
    expect(
      shouldObserveMasonryColumnEnds({
        hasMoreResults: true,
        isBrowsingCollection: true,
        isFetchingNextPage: true,
        isLoading: false,
        view: 'masonry',
      })
    ).toBe(false);
  });
});

describe('composable colour refinement', () => {
  it('parses and memoizes each result palette once per result object', () => {
    const result = artwork({
      colorPalette: {
        colors: ['#4c78a8', '#ffffff'],
        percentages: [0.8, 0.2],
      },
    });

    const first = collectPalette(result);
    const second = collectPalette(result);

    expect(first).toEqual(['#4c78a8', '#ffffff']);
    expect(second).toBe(first);
  });

  it('keeps text, facet, and colour as separate shareable URL state', () => {
    expect(getSearchParamsForQuery('angels', null, 'navy')).toEqual({
      q: 'angels',
      colour: 'navy',
    });
    expect(
      getSearchParamsForQuery('blue painted ornament', null, 'custom:#4c78a8')
    ).toEqual({
      q: 'blue painted ornament',
      colour: 'custom:#4c78a8',
    });
    expect(
      getSearchParamsForQuery('Painting', 'classification', 'navy')
    ).toEqual({
      q: 'Painting',
      field: 'classification',
      colour: 'navy',
    });
  });
});

describe('progressive search layout state', () => {
  const submittedText: SubmittedSearch = {
    kind: 'text',
    query: 'paintings',
    facet: 'classification',
  };

  it('does not mount result controls or an empty state for a passive image editor', () => {
    expect(
      getSearchPresentation(createSearchComposerState('image'))
    ).toMatchObject({
      hasActiveSearch: false,
      showResultControls: false,
      showEmptyState: false,
    });
  });

  it('keeps result controls mounted for the prior owner while image is only edited', () => {
    const state = selectEditorMode(
      createSearchComposerState('text', submittedText),
      'image'
    );

    expect(getSearchPresentation(state)).toMatchObject({
      hasActiveSearch: true,
      owner: 'text',
      showResultControls: true,
      ownershipNotice: 'Showing Text results until an image is uploaded.',
    });
  });

  it('keeps a selected image editor compact while its submitted image owns results', () => {
    expect(IMAGE_SEARCH_COMPOSER_CLASS_NAME).toContain('max-w-2xl');
    expect(IMAGE_SEARCH_COMPOSER_CLASS_NAME).not.toContain('min-h-');
    expect(IMAGE_SEARCH_PREVIEW_CLASS_NAME).toContain('sm:flex-row');
    expect(IMAGE_SEARCH_PREVIEW_CLASS_NAME).not.toContain('min-h-');
  });
});

describe('URL-driven text search execution', () => {
  it('refetches a restored URL search even when its prior execution is cached', async () => {
    const queryClient = new QueryClient();
    const canonicalKey = ['search', 'text', 'nga', 'quiet shore'] as const;
    const cachedExecutionId = 4;
    const restoredExecutionId = getNextUrlDrivenTextSearchExecutionId(
      cachedExecutionId,
      5
    );
    const cachedKey = [...canonicalKey, cachedExecutionId];
    const restoredKey = [...canonicalKey, restoredExecutionId];
    const search = vi.fn(async () => ({ results: ['fresh result'] }));

    queryClient.setQueryData(cachedKey, { results: ['cached result'] });

    const result = await queryClient.fetchQuery({
      queryKey: restoredKey,
      queryFn: search,
      staleTime: Infinity,
    });

    expect(restoredExecutionId).toBe(5);
    expect(restoredKey).not.toEqual(cachedKey);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ results: ['fresh result'] });
  });
});
