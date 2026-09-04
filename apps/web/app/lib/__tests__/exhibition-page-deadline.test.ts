/**
 * What happens when the catalogue accepts the connection and then stops
 * talking.
 *
 * This is the failure none of the other tests could see, because a stubbed
 * `fetch` that rejects is a *fast* failure and every path already handled it.
 * A hang is different: the promise never settles, and until these deadlines
 * existed, one unresponsive record held twenty-three healthy ones and the
 * whole page behind it. The visitor got a blank tab until their browser gave
 * up, which is a worse outcome than any error page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildExhibitionPage,
  deadlineSignal,
  loadExhibitionByCode,
  PREVIEW_DEADLINE_MS,
  RECORD_DEADLINE_MS,
} from '../exhibition-page.server';
import type { ExhibitionLinkPayload } from '../exhibition-link';

const env = { APP_ENV: 'staging', PAILLETTE_API_URL: 'https://api.example' };

const record = (id: string) => ({
  success: true,
  data: {
    id,
    title: `Work ${id}`,
    artist: 'Fitz Henry Lane',
    date_text: '1863',
    provenance: JSON.stringify({
      source_image_url: 'https://api.nga.gov/iiif/abc/full/full/0/default.jpg',
    }),
  },
});

const show = (ids: string[]): ExhibitionLinkPayload => ({
  collectionId: 'nga',
  title: 'Leaving',
  titleByAgent: true,
  statement: 'It is about leaving.',
  statementByAgent: false,
  works: ids.map((artworkId) => ({ artworkId, label: null, labelByAgent: false })),
});

/**
 * `fetch` where the named ids never answer.
 *
 * The hang honours the abort signal, which is what a real socket does — the
 * runtime aborts it and the fetch rejects. A stub that ignored the signal
 * would hang the test rather than the code, and prove nothing.
 */
const hangingApi = (slow: string[]) =>
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const id = decodeURIComponent(url.split('/artworks/')[1] ?? '');
    const stalls =
      slow.includes(id) || (url.includes('/public-exhibitions/') && slow.includes('code'));

    if (!stalls) {
      if (url.includes('/public-exhibitions/')) {
        return Promise.resolve(
          Response.json({
            success: true,
            data: { collectionId: 'nga', title: 'Leaving', works: [{ artworkId: 'a' }] },
          })
        );
      }
      return Promise.resolve(Response.json(record(id)));
    }

    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // never settles, and nothing can rescue it
      signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a record that never answers', () => {
  it('drops out and the rest of the show still renders', async () => {
    vi.stubGlobal('fetch', hangingApi(['b']));

    let settled = false;
    const pending = buildExhibitionPage({
      payload: show(['a', 'b', 'c']),
      env,
      canonicalUrl: 'https://paillette.test/e/aB3xk9m',
    }).then((value) => {
      settled = true;
      return value;
    });

    /*
     * The deadline has to be the thing that resolves this, and nothing else.
     * Just short of it the page is still waiting; just past it the page is
     * there. Without both halves this test would pass against a stub that
     * simply never hung, and would have proved nothing about the timeout.
     */
    await vi.advanceTimersByTimeAsync(RECORD_DEADLINE_MS - 100);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    const page = await pending;
    expect(settled).toBe(true);

    expect(page).not.toBeNull();
    expect(page!.works.map((work) => work.artworkId)).toEqual(['a', 'c']);
    // Reported, not hidden — the colophon prints this count.
    expect(page!.missing).toBe(1);
  });

  it('does not wait for the slow one before starting the others', async () => {
    vi.stubGlobal('fetch', hangingApi(['a']));

    const pending = buildExhibitionPage({
      payload: show(['a', 'b', 'c']),
      env,
      canonicalUrl: 'https://paillette.test/e/aB3xk9m',
    });
    await vi.advanceTimersByTimeAsync(RECORD_DEADLINE_MS + 50);
    const page = await pending;

    // The hang was first in the list; the two behind it are still here, which
    // is the whole point of fetching them concurrently.
    expect(page!.works.map((work) => work.artworkId)).toEqual(['b', 'c']);
  });

  it('gives up on the whole show only when nothing answers', async () => {
    vi.stubGlobal('fetch', hangingApi(['a', 'b']));

    const pending = buildExhibitionPage({
      payload: show(['a', 'b']),
      env,
      canonicalUrl: 'https://paillette.test/e/aB3xk9m',
    });
    await vi.advanceTimersByTimeAsync(RECORD_DEADLINE_MS + 50);

    // Null, which every caller turns into a 404 rather than an empty room.
    await expect(pending).resolves.toBeNull();
  });
});

describe('a lookup that never answers', () => {
  it('gives up rather than holding the request open', async () => {
    vi.stubGlobal('fetch', hangingApi(['code']));

    const pending = loadExhibitionByCode('aB3xk9m', env);
    await vi.advanceTimersByTimeAsync(RECORD_DEADLINE_MS + 50);
    await expect(pending).resolves.toBeNull();
  });
});

describe('the crawler budget', () => {
  it('is tighter than the page, because an unfurler will not wait', () => {
    // Stated as a test rather than a comment: if someone raises this above the
    // page's deadline the card silently stops rendering in Slack, and nothing
    // else in the suite would notice.
    expect(PREVIEW_DEADLINE_MS).toBeLessThan(RECORD_DEADLINE_MS);
  });

  /*
   * Found on staging, not here. The first version applied this budget per
   * fetch, so the preview path's two sequential calls could take twice the
   * number written down — and at 1500 ms it was tripping on ordinary traffic
   * (the lookup alone measured 0.13-1.50 s) and silently falling through to
   * the full app shell. `deadlineSignal` makes it one clock for the path.
   */
  it('caps the whole path once, not each hop separately', async () => {
    vi.stubGlobal('fetch', hangingApi(['b']));

    const budget = deadlineSignal(PREVIEW_DEADLINE_MS);
    let aborted = false;
    budget!.addEventListener('abort', () => {
      aborted = true;
    });

    // Spend most of the budget on the first hop...
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS - 100);
    expect(aborted).toBe(false);

    // ...and the second hop inherits what is left rather than starting over.
    const pending = buildExhibitionPage({
      payload: show(['a', 'b']),
      env,
      canonicalUrl: 'https://paillette.test/e/aB3xk9m',
      signal: budget,
      deadlineMs: PREVIEW_DEADLINE_MS,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(aborted).toBe(true);

    /*
     * The budget expired 200 ms into the second hop rather than giving it a
     * fresh 2500 ms — that is the whole point. What survives is what had
     * already answered: `a` came back immediately, `b` was still hanging when
     * the shared signal fired. A card with one of two works beats a bare URL,
     * so this is a partial page rather than a fall-through.
     */
    const page = await pending;
    expect(page!.works.map((work) => work.artworkId)).toEqual(['a']);
    expect(page!.missing).toBe(1);
  });

  it('abandons a slow record inside the preview budget', async () => {
    vi.stubGlobal('fetch', hangingApi(['b']));

    const pending = buildExhibitionPage({
      payload: show(['a', 'b']),
      env,
      canonicalUrl: 'https://paillette.test/e/aB3xk9m',
      deadlineMs: PREVIEW_DEADLINE_MS,
    });
    // Advance only to the preview budget, not the page's — if the tighter
    // deadline were not being honoured this would still be pending.
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS + 50);
    const page = await pending;

    expect(page!.works.map((work) => work.artworkId)).toEqual(['a']);
  });
});
