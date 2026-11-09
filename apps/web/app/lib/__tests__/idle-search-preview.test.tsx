import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import {
  getIdleSearchPreviewKey,
  useIdleSearchPreview,
} from '../idle-search-preview';
import { buildPublicTextSearchPlan } from '../public-text-search-plan';
import { buildSuggestionPool } from '../search-suggestions';
import { selectIdleShowcaseArtworks } from '../idle-showcase';
import type { SearchResponse } from '~/types';

const plan = (query: string, orgId = 'ngs', facet: 'artist' | null = null) =>
  buildPublicTextSearchPlan({
    orgId,
    committedTextQuery: query,
    facet,
    colourQuery: null,
    topK: 30,
    minScore: 0.1,
  })!;
const getAccessToken = vi.fn(async () => 'test-token');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('fetches the active Christmas preview through authenticated search, retains in-flight progress across rotation, and reuses it', async () => {
  const suggestion = buildSuggestionPool(
    [
      {
        type: 'occasion',
        label: 'Christmas Day',
        query: 'Christmas Day',
        dot: '#cdbfa2',
        date: '2026-12-25',
        detail: 'Today',
        isToday: true,
        source: 'fallback',
      },
    ],
    { routeId: 'ngs' }
  ).find((item) => item.label === 'Christmas Day')!;
  expect(suggestion.spotlightId).toBeUndefined();
  const christmas = plan(suggestion.query);
  const response: SearchResponse = {
    results: [
      {
        id: 'api-match',
        galleryId: 'ngs',
        title: 'API fixture',
        imageUrl: '/api-match-original',
        thumbnailUrl: '/api-match',
        similarity: 0.9,
        metadata: {},
      },
    ],
    count: 1,
    queryTime: 1,
  };
  let finish!: (value: typeof response) => void;
  const search = vi.spyOn(apiClient, 'searchText').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { rerender } = renderHook(
    ({ active, enabled }) =>
      useIdleSearchPreview({ plan: active, enabled, getAccessToken }),
    {
      wrapper,
      initialProps: { active: christmas, enabled: true },
    }
  );
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  expect(search).toHaveBeenCalledWith(
    'ngs',
    christmas.request,
    getAccessToken,
    expect.any(AbortSignal)
  );
  // Rotation to a mapped spotlight needs no preview API request.
  rerender({ active: plan('Flowers'), enabled: false });
  expect(search.mock.calls[0]?.[3]?.aborted).toBe(false);
  await act(async () => finish(response));
  expect(client.getQueryData(getIdleSearchPreviewKey(christmas))).toEqual(
    response
  );
  expect(
    selectIdleShowcaseArtworks(response.results).map((work) => work.id)
  ).toEqual(['api-match']);
  rerender({ active: christmas, enabled: true });
  expect(search).toHaveBeenCalledTimes(1);
  expect(
    client.getQueryData(getIdleSearchPreviewKey(plan('Christmas Eve')))
  ).toBeUndefined();
  expect(
    client.getQueryData(getIdleSearchPreviewKey(plan('Christmas Day', 'other')))
  ).toBeUndefined();
  expect(
    client.getQueryData(
      getIdleSearchPreviewKey(plan('Christmas Day', 'ngs', 'artist'))
    )
  ).toBeUndefined();
  client.clear();
});

it('does not repeat a failed automatic request on every rotation', async () => {
  const search = vi
    .spyOn(apiClient, 'searchText')
    .mockRejectedValue(new Error('offline'));
  const client = new QueryClient();
  const christmas = plan('Christmas Day');
  const { rerender } = renderHook(
    ({ active, enabled }) =>
      useIdleSearchPreview({ plan: active, enabled, getAccessToken }),
    {
      initialProps: { active: christmas, enabled: true },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  await waitFor(() =>
    expect(
      client.getQueryState(getIdleSearchPreviewKey(christmas))?.status
    ).toBe('error')
  );
  rerender({ active: plan('Flowers'), enabled: false });
  rerender({ active: christmas, enabled: true });
  expect(search).toHaveBeenCalledTimes(1);
  client.clear();
});

it('does not request a preview when the session or submitted-result gate disables it', () => {
  const search = vi.spyOn(apiClient, 'searchText');
  const client = new QueryClient();
  renderHook(
    () =>
      useIdleSearchPreview({
        plan: plan('Christmas Day'),
        enabled: false,
        getAccessToken,
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  expect(search).not.toHaveBeenCalled();
  client.clear();
});

it('bounds a hung preview without tying cancellation to rotation', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.spyOn(apiClient, 'searchText').mockImplementation(
    (...args: Parameters<typeof apiClient.searchText>) => {
      const requestSignal = args[3];
      signal = requestSignal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () =>
          reject(new Error('preview timeout'))
        );
      });
    }
  );
  const client = new QueryClient();
  renderHook(
    () =>
      useIdleSearchPreview({
        plan: plan('Christmas Day'),
        enabled: true,
        getAccessToken,
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_001);
  });
  expect(signal?.aborted).toBe(true);
  expect(
    client.getQueryState(getIdleSearchPreviewKey(plan('Christmas Day')))?.status
  ).toBe('error');
  client.clear();
});
