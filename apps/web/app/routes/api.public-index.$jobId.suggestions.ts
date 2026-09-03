import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import {
  buildPublicIndexHeaders,
  getApiBaseUrl,
  getServerEnv,
  indexErrorResponse,
} from '~/lib/public-index.server';
import { schedulePublicSearchWork } from '~/lib/public-search.server';
import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search-core';
import {
  generateCollectionSuggestions,
  type CollectionSuggestions,
  type SuggestionSearchResult,
} from './__lib/collection-suggestions.server';

const SAFE_JOB_ID = /^[A-Za-z0-9-]{1,64}$/;
/**
 * An hour is generous for a demo collection that never changes once its job
 * completes — the whole point is to compute this once, not on every page view.
 */
const SUGGESTIONS_CACHE_CONTROL = 'public, max-age=3600';

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

/** Same technique as `public-search.server`'s `getPublicSearchCache` — the
 * Workers Cache API needs no binding, just the `caches.default` global. */
const getSuggestionsCache = (): CacheLike | null => {
  const runtime = globalThis as typeof globalThis & {
    caches?: { default?: CacheLike };
  };
  return runtime.caches?.default ?? null;
};

/**
 * The contract version is part of the key, same as the NGA/NGS spotlight
 * bundles (`PUBLIC_SEARCH_CONTRACT_VERSION`): a search-behaviour change
 * invalidates every cached bundle instead of quietly serving suggestions
 * proven against a contract that no longer matches what search returns.
 */
const buildCacheKey = (jobId: string) =>
  new Request(
    `https://paillette-collection-suggestions.internal/v${PUBLIC_SEARCH_CONTRACT_VERSION}/${jobId}`,
    { method: 'GET' }
  );

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'AbortError';

type UpstreamStatus = {
  success?: boolean;
  data?: { state?: string; collectionId?: string };
};

type UpstreamSearchResult = {
  id?: unknown;
  similarity?: unknown;
  artist?: unknown;
  medium?: unknown;
  classification?: unknown;
  year?: unknown;
};

/**
 * GET /api/public-index/:jobId/suggestions — collection-specific suggested
 * queries for a job that just finished, so a visitor (or an agent reading
 * `get_index_status`) lands on "here is what you can ask" instead of a blank
 * search box. Only computed once the job is `complete`, and cached at the
 * edge from then on since the collection never changes again.
 */
export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const jobId = params.jobId || '';
  if (!SAFE_JOB_ID.test(jobId)) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid job ID.');
  }

  const cache = getSuggestionsCache();
  const cacheKey = buildCacheKey(jobId);
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch (error) {
      console.warn('Failed to read collection-suggestions cache:', error);
    }
  }

  const env = getServerEnv(context);
  const apiBase = getApiBaseUrl(env);
  const getHeaders = buildPublicIndexHeaders(request);
  const postHeaders = buildPublicIndexHeaders(request, 'application/json');

  let statusPayload: UpstreamStatus;
  try {
    const statusResponse = await fetch(`${apiBase}/public-index/jobs/${jobId}`, {
      method: 'GET',
      headers: getHeaders,
      signal: request.signal,
    });
    statusPayload = await statusResponse.json();
    if (!statusResponse.ok || !statusPayload.success || !statusPayload.data) {
      return indexErrorResponse(
        statusResponse.status === 404 ? 404 : 502,
        statusResponse.status === 404
          ? 'NOT_FOUND'
          : 'PUBLIC_INDEX_UPSTREAM_ERROR',
        statusResponse.status === 404
          ? 'Indexing job not found.'
          : 'Indexing returned an invalid response.'
      );
    }
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) throw error;
    return indexErrorResponse(
      502,
      'PUBLIC_INDEX_UPSTREAM_UNAVAILABLE',
      'Indexing is temporarily unavailable.'
    );
  }

  const state = statusPayload.data?.state ?? 'unknown';
  const collectionId = statusPayload.data?.collectionId ?? '';

  // Suggestions are derived from finished search results, so a still-running
  // job reports "not ready yet" rather than a bundle built on a partial index.
  if (state !== 'complete') {
    return json(
      { success: true, data: { ready: false, state } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const search = async (
    query: string,
    topK: number
  ): Promise<SuggestionSearchResult[]> => {
    const response = await fetch(
      `${apiBase}/public-index/jobs/${jobId}/search`,
      {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({ query, topK }),
        signal: request.signal,
      }
    );
    const payload = (await response.json()) as {
      success?: boolean;
      data?: { results?: UpstreamSearchResult[] };
    };
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(
        `Suggestion search failed for "${query}" with HTTP ${response.status}`
      );
    }
    return (payload.data.results ?? []).map((result) => ({
      id: typeof result.id === 'string' ? result.id : '',
      similarity: typeof result.similarity === 'number' ? result.similarity : 0,
      artist: typeof result.artist === 'string' ? result.artist : null,
      medium: typeof result.medium === 'string' ? result.medium : null,
      classification:
        typeof result.classification === 'string' ? result.classification : null,
      year: typeof result.year === 'number' ? result.year : null,
    }));
  };

  let bundle: CollectionSuggestions;
  try {
    bundle = await generateCollectionSuggestions({ jobId, collectionId, search });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) throw error;
    return indexErrorResponse(
      502,
      'SUGGESTIONS_FAILED',
      'Could not generate suggested searches for this collection.'
    );
  }

  const response = json(
    { success: true, data: { ready: true, ...bundle } },
    { headers: { 'Cache-Control': SUGGESTIONS_CACHE_CONTROL } }
  );

  if (cache) {
    schedulePublicSearchWork(
      context,
      cache.put(cacheKey, response.clone()).catch((error) => {
        console.warn('Failed to write collection-suggestions cache:', error);
      })
    );
  }

  return response;
};
