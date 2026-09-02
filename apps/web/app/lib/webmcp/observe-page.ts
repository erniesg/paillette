/**
 * Keeps `get_view_context` honest.
 *
 * The agent should be able to ask "what is the human actually looking at?" and
 * get the truth, not a guess. Two observers supply it:
 *
 *  1. The URL. Paillette's search page is URL-driven (`?q=`, `?field=`,
 *     `?colour=`), so the route and the human's committed query are readable
 *     straight off `location` — the same source the page itself reads.
 *  2. The page's own search responses. Rather than scraping the rendered grid
 *     (fragile) or forking the route's React state (invasive, and another
 *     surface to keep in sync), the bridge observes the very
 *     `/api/public-search/...` responses the human's UI just consumed. What the
 *     agent reports is therefore exactly what is on screen.
 *
 * The `fetch` patch installs only when a WebMCP host is present, is wrapped in
 * try/catch at every step, reads a `clone()` so the page's own consumer is
 * untouched, and always returns the original promise unchanged.
 */

import { rememberArtworks } from './artwork-index';
import { toAgentArtworkSummary } from './artwork-summary';
import { getPublicCollection } from './collections';
import { setHumanResults, setPageContext, type PageContext } from './store';
import type { ApiResponse, ArtworkSearchResult } from '~/types';

const PUBLIC_SEARCH_PATH =
  /^\/api\/public-search\/([^/]+)\/(text|image|browse)$/;

/** Derives the human's page context from the URL the router is showing. */
export const readPageContext = (location: {
  pathname: string;
  search: string;
}): PageContext => {
  const params = new URLSearchParams(location.search);
  const segments = location.pathname.split('/').filter(Boolean);
  // `/collections/nga/search` and `/nga/search` both scope to `nga`.
  const candidate =
    segments[0] === 'collections' || segments[0] === 'galleries'
      ? segments[1]
      : segments[0];

  return {
    pathname: location.pathname,
    search: location.search,
    collectionId: getPublicCollection(candidate)?.id ?? null,
    query: params.get('q')?.trim() ?? '',
    facet: params.get('field'),
    colour: params.get('colour'),
  };
};

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const describe = (mode: string, context: PageContext, count: number) => {
  if (mode === 'browse') return `browsing the collection (${count} shown)`;
  if (mode === 'image') return `image search (${count} results)`;
  if (context.colour) return `colour search “${context.colour}” (${count} results)`;
  return context.query
    ? `search “${context.query}” (${count} results)`
    : `search (${count} results)`;
};

/**
 * Patches `window.fetch` to mirror public-search responses into the shared
 * store. Returns a disposer that restores the original.
 */
export const observePublicSearchResponses = (): (() => void) => {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  const original = window.fetch;
  const patched: typeof window.fetch = (input, init) => {
    const promise = original.call(window, input as RequestInfo, init);

    try {
      const url = new URL(requestUrl(input), window.location.origin);
      const match = PUBLIC_SEARCH_PATH.exec(url.pathname);
      if (match && url.origin === window.location.origin) {
        const mode = match[2] ?? '';
        promise
          .then((response) => {
            if (!response.ok) return;
            return response
              .clone()
              .json()
              .then((body: unknown) => {
                const payload = body as ApiResponse<{
                  results?: ArtworkSearchResult[];
                  total?: number;
                }>;
                const results = payload?.data?.results;
                if (!payload?.success || !Array.isArray(results)) return;
                rememberArtworks(results);
                const context = readPageContext(window.location);
                setHumanResults({
                  origin: 'human',
                  label: describe(mode, context, results.length),
                  items: results.map(toAgentArtworkSummary),
                  ...(typeof payload.data?.total === 'number'
                    ? { total: payload.data.total }
                    : {}),
                  at: Date.now(),
                });
              });
          })
          // Observation must never surface as an error to the page.
          .catch(() => {});
      }
    } catch {
      // A malformed URL is not our problem; hand the caller its promise back.
    }

    return promise;
  };

  window.fetch = patched;
  return () => {
    if (window.fetch === patched) window.fetch = original;
  };
};

export { setPageContext };
