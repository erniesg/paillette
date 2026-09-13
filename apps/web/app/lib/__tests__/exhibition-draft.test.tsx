import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';
import { shareExhibitionCopy } from '../exhibition-draft';
import { useExhibitionDraft } from '~/components/exhibition/use-exhibition-draft';
import { decodeExhibitionLink } from '../exhibition-link';

type DraftPage = ExhibitionPage & { collectionId?: string; titleByAgent?: boolean };

const page = (overrides: Partial<DraftPage> = {}): DraftPage => ({
  collectionId: 'nga',
  title: 'Quiet water',
  titleByAgent: true,
  statement: 'Two pictures in low light.',
  statementByAgent: true,
  works: [
    {
      artworkId: 'a', title: 'A', artist: null, date: null, medium: null,
      accession: null, sourceUrl: null, imageUrl: null, label: 'First.',
      labelByAgent: true, dimensions: null,
    },
    {
      artworkId: 'b', title: 'B', artist: null, date: null, medium: null,
      accession: null, sourceUrl: null, imageUrl: null, label: null,
      labelByAgent: false, dimensions: null,
    },
  ],
  regions: [{ label: 'North wall', artworkIds: ['b', 'a'] }],
  missing: 0,
  code: 'same-show',
  canonicalUrl: 'https://paillette.test/e/same-show?v=room&frame=oak&theme=light',
  institution: 'NGA', institutionUrl: 'https://nga.example', rights: 'Public domain',
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useExhibitionDraft', () => {
  it('restores saved labels and clears them back to the source', async () => {
    const first = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(first.result.current.page.works[0]?.label).toBe('First.'));
    act(() => first.result.current.setLabel('a', 'A human correction.', 'human'));
    expect(first.result.current.dirty).toBe(true);
    expect(first.result.current.page.works[0]).toMatchObject({
      label: 'A human correction.', labelByAgent: false,
    });
    first.unmount();

    const restored = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(restored.result.current.page.works[0]?.label).toBe('A human correction.'));
    act(() => restored.result.current.setLabel('a', '', 'human'));
    expect(restored.result.current.page.works[0]?.label).toBeNull();
    expect(restored.result.current.dirty).toBe(true);
    act(() => restored.result.current.reset());
    expect(restored.result.current.page.works[0]).toMatchObject({ label: 'First.', labelByAgent: true });
    expect(restored.result.current.dirty).toBe(false);
  });

  it('does not leak a draft into a different exhibition', async () => {
    const hook = renderHook(({ source }) => useExhibitionDraft(source), { initialProps: { source: page() } });
    await waitFor(() => expect(hook.result.current.page.title).toBe('Quiet water'));
    act(() => hook.result.current.setLabel('a', 'Only the first show.', 'human'));
    hook.rerender({ source: page({ code: 'another-show', canonicalUrl: 'https://paillette.test/e/another-show' }) });
    await waitFor(() => expect(hook.result.current.page.works[0]?.label).toBe('First.'));
  });

  it('reports unavailable local storage while retaining the in-memory edit', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const hook = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(hook.result.current.page.title).toBe('Quiet water'));
    act(() => hook.result.current.setLabel('a', 'Still here.', 'human'));
    expect(hook.result.current.page.works[0]?.label).toBe('Still here.');
    expect(hook.result.current.storageError).toBe(true);
  });

  it('clears a previous storage error after reading a new exhibition successfully', async () => {
    vi.spyOn(Storage.prototype, 'getItem')
      .mockImplementationOnce(() => { throw new Error('blocked'); })
      .mockImplementation(() => null);
    const hook = renderHook(({ source }) => useExhibitionDraft(source), { initialProps: { source: page() } });
    await waitFor(() => expect(hook.result.current.storageError).toBe(true));
    hook.rerender({ source: page({ code: 'healthy-show', canonicalUrl: 'https://paillette.test/e/healthy-show' }) });
    await waitFor(() => expect(hook.result.current.storageError).toBe(false));
  });

  it('keeps two open draft editors synchronized so reset cannot resurrect a stale edit', async () => {
    const first = renderHook(() => useExhibitionDraft(page()));
    const second = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(first.result.current.page.title).toBe('Quiet water'));

    act(() => first.result.current.setLabel('a', 'First editor.', 'human'));
    await waitFor(() => expect(second.result.current.page.works[0]?.label).toBe('First editor.'));
    act(() => second.result.current.setLabel('b', 'Second editor.', 'human'));
    await waitFor(() => expect(first.result.current.page.works[1]?.label).toBe('Second editor.'));

    act(() => first.result.current.reset());
    await waitFor(() => expect(second.result.current.dirty).toBe(false));
    expect(second.result.current.page.works[0]?.label).toBe('First.');
    expect(second.result.current.page.works[1]?.label).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('keeps volatile edits through a temporary storage failure and persists them on recovery', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const hook = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(hook.result.current.page.title).toBe('Quiet water'));
    act(() => hook.result.current.setLabel('a', 'Kept one.', 'human'));
    act(() => hook.result.current.setLabel('b', 'Kept two.', 'human'));
    expect(hook.result.current.page.works.map((work) => work.label)).toEqual(['Kept one.', 'Kept two.']);

    expect(hook.result.current.storageError).toBe(true);
    setItem.mockRestore();
    act(() => hook.result.current.setLabel('a', 'Recovered one.', 'human'));
    expect(hook.result.current.storageError).toBe(false);
    hook.unmount();
    const restored = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(restored.result.current.page.works.map((work) => work.label)).toEqual(['Recovered one.', 'Kept two.']));
  });

  it('keeps a failed reset tombstone until a later write can persist it', async () => {
    const hook = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(hook.result.current.page.title).toBe('Quiet water'));
    act(() => hook.result.current.setLabel('a', 'Before reset.', 'human'));
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    act(() => hook.result.current.reset());
    removeItem.mockRestore();
    act(() => hook.result.current.setLabel('b', 'After reset.', 'human'));
    hook.unmount();

    const restored = renderHook(() => useExhibitionDraft(page()));
    await waitFor(() => expect(restored.result.current.page.works.map((work) => work.label)).toEqual(['First.', 'After reset.']));
  });

  it('handles prototype-named artwork IDs as ordinary known artwork IDs', async () => {
    const source = page({
      works: ['toString', 'constructor', '__proto__'].map((artworkId) => ({
        artworkId, title: artworkId, artist: null, date: null, medium: null,
        accession: null, sourceUrl: null, imageUrl: null, label: null,
        labelByAgent: false, dimensions: null,
      })),
    });
    const hook = renderHook(() => useExhibitionDraft(source));
    await waitFor(() => expect(hook.result.current.page.works.map((work) => work.label)).toEqual([null, null, null]));
    act(() => hook.result.current.setLabel('toString', 'Safe.', 'human'));
    act(() => hook.result.current.setLabel('constructor', 'Also safe.', 'human'));
    act(() => hook.result.current.setLabel('__proto__', 'Safe too.', 'human'));
    expect(hook.result.current.page.works.map((work) => work.label)).toEqual(['Safe.', 'Also safe.', 'Safe too.']);
    hook.unmount();

    const restored = renderHook(() => useExhibitionDraft(source));
    await waitFor(() => expect(restored.result.current.page.works.map((work) => work.label)).toEqual(['Safe.', 'Also safe.', 'Safe too.']));
    act(() => restored.result.current.reset());
    expect(restored.result.current.page.works.map((work) => work.label)).toEqual([null, null, null]);
  });
});

describe('shareExhibitionCopy', () => {
  it('posts a new complete exhibit and returns its framed room URL', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { url: 'https://paillette.test/e/new-exhibit' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);

    const url = await shareExhibitionCopy(page(), { template: 'room', frame: 'gilt' });

    const firstCall = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(firstCall[1].body))).toEqual({
      collectionId: 'nga', title: 'Quiet water', titleByAgent: true,
      statement: 'Two pictures in low light.', statementByAgent: true,
      works: [
        { artworkId: 'a', label: 'First.', labelByAgent: true },
        { artworkId: 'b', label: null, labelByAgent: false },
      ],
      regions: [{ label: 'North wall', artworkIds: ['b', 'a'] }],
    });
    expect(url).toBe('https://paillette.test/e/new-exhibit?v=room&frame=gilt');
  });

  it('falls back to a complete self-contained link when publishing fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const url = await shareExhibitionCopy(page(), { template: 'room', frame: 'oak' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('v')).toBe('room');
    expect(parsed.searchParams.get('frame')).toBe('oak');
    const payload = await decodeExhibitionLink(parsed.searchParams.get('e')!);
    expect(payload?.collectionId).toBe('nga');
    expect(payload?.works[0]).toEqual({ artworkId: 'a', label: 'First.', labelByAgent: true });
  });

  it('does not hand out an off-site URL from an invalid publish response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { url: 'javascript:alert(1)' } }), { status: 201 })));
    const url = await shareExhibitionCopy(page(), { template: 'page', frame: 'none' });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://paillette.test');
    expect(parsed.pathname).toBe('/exhibition');
  });

  it('falls back when publishing does not respond before the sharing deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const sharing = shareExhibitionCopy(page(), { template: 'page', frame: 'none' });
    await vi.advanceTimersByTimeAsync(15_000);
    const url = await sharing;

    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(new URL(url).pathname).toBe('/exhibition');
  });

  it('keeps the deadline through a stalled successful response body', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
      } as Response)
    );
    vi.stubGlobal('fetch', fetcher);

    const sharing = shareExhibitionCopy(page(), { template: 'page', frame: 'none' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new URL(await sharing).pathname).toBe('/exhibition');
  });
});
