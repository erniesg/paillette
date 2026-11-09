import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { normalizePublicSearchText } from '@paillette/types/public-search-core';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
import {
  buildPublicSearchHeaders,
  copyPublicSearchResponseHeaders,
  filterPublicTextSearchResponse,
  getApiBaseUrl,
  getCanonicalPublicTextSearchRequest,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  isHiddenPublicNgsArtwork,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

const DEFAULT_PUBLIC_TEXT_MIN_SCORE = 0.2;
const PUBLIC_TEXT_SEARCH_FACETS = new Set(['artist', 'classification']);

const buildDynamicSearchHeaders = (response: Response) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  copyPublicSearchResponseHeaders(response, headers);
  const cacheStatus = response.headers.get('X-Paillette-Search-Cache');
  if (
    cacheStatus &&
    /^(?:BYPASS|SPOTLIGHT|KV-FRESH|KV-STALE|COALESCED|MISS)$/.test(cacheStatus)
  )
    headers.set('X-Paillette-Search-Cache', cacheStatus);
  return headers;
};

type ProxyDiagnostic = {
  requestedTopK: number | null;
  normalizedTopK: number | null;
  canonicalTopK: number | null;
  upstreamMs: number | null;
};

const textSearchAction = async (
  { context, params, request }: ActionFunctionArgs,
  diagnostic: ProxyDiagnostic
) => {
  const orgId = params.orgId;
  if (!orgId) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Org ID is required.',
        },
      },
      { status: 400 }
    );
  }

  if (!isAllowedPublicSearchRouteId(orgId)) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_SEARCH_SCOPE_FORBIDDEN',
          message: 'This organization is not available to public search.',
        },
      },
      { status: 403 }
    );
  }

  const env = getServerEnv(context);
  const headers = buildPublicSearchHeaders(request, env, 'application/json');
  if (!headers) {
    return publicSearchConfigError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid JSON request body.',
        },
      },
      { status: 400 }
    );
  }

  const query =
    typeof body.query === 'string' ? normalizePublicSearchText(body.query) : '';
  if (!query) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Search query is required.',
        },
      },
      { status: 400 }
    );
  }

  if (
    typeof body.visualRefinement === 'string' &&
    normalizePublicSearchText(body.visualRefinement)
  ) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'UNSUPPORTED_PUBLIC_REFINEMENT',
          message: 'Public colour refinement is performed locally.',
        },
      },
      { status: 400 }
    );
  }

  const requestedSearchPayload: Required<
    Omit<SearchTextRequest, 'facet' | 'visualRefinement' | 'constraints'>
  > &
    Pick<SearchTextRequest, 'facet' | 'visualRefinement' | 'constraints'> = {
    query,
    topK: clamp(body.topK, 1, 100, 30),
    minScore: clamp(body.minScore, 0, 1, DEFAULT_PUBLIC_TEXT_MIN_SCORE),
    facet:
      typeof body.facet === 'string' &&
      PUBLIC_TEXT_SEARCH_FACETS.has(body.facet)
        ? (body.facet as SearchTextRequest['facet'])
        : undefined,
    visualRefinement: undefined,
    constraints:
      body.constraints && typeof body.constraints === 'object'
        ? (body.constraints as SearchTextRequest['constraints'])
        : undefined,
  };
  const canonicalSearchPayload = getCanonicalPublicTextSearchRequest(
    requestedSearchPayload
  );
  diagnostic.requestedTopK =
    typeof body.topK === 'number' && Number.isFinite(body.topK) &&
    Math.abs(body.topK) <= 1_000_000 ? body.topK : null;
  diagnostic.normalizedTopK = requestedSearchPayload.topK;
  diagnostic.canonicalTopK = canonicalSearchPayload.topK;
  const resolvedOrgId = resolvePublicSearchOrgId(orgId);
  const apiBaseUrl = getApiBaseUrl(env);

  let response: Response;
  const upstreamStart = performance.now();
  try {
    response = await fetch(
      `${apiBaseUrl}/orgs/${resolvedOrgId}/search/text`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(canonicalSearchPayload),
        signal: request.signal,
      }
    );
  } catch (error) {
    diagnostic.upstreamMs = performance.now() - upstreamStart;
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      throw error;
    }
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_TEXT_SEARCH_UPSTREAM_UNAVAILABLE',
          message: 'Public text search is temporarily unavailable.',
        },
      },
      { status: 502, headers: new Headers({ 'Cache-Control': 'no-store' }) }
    );
  }

  let responsePayload: ApiResponse<SearchResponse>;
  try {
    responsePayload = (await response.json()) as ApiResponse<SearchResponse>;
  } catch {
    diagnostic.upstreamMs = performance.now() - upstreamStart;
    const status = response.ok ? 502 : response.status;
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: response.ok
            ? 'PUBLIC_TEXT_SEARCH_UPSTREAM_UNAVAILABLE'
            : 'PUBLIC_TEXT_SEARCH_UPSTREAM_ERROR',
          message: response.ok
            ? 'Public text search returned an invalid response.'
            : 'Public text search request failed.',
        },
      },
      { status, headers: buildDynamicSearchHeaders(response) }
    );
  }
  diagnostic.upstreamMs = performance.now() - upstreamStart;
  if (responsePayload.success && responsePayload.data) {
    const results = responsePayload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    responsePayload.data = {
      ...responsePayload.data,
      results,
      count: results.length,
    };

    const requestedResponsePayload = filterPublicTextSearchResponse(
      responsePayload,
      requestedSearchPayload
    );
    return json(requestedResponsePayload, {
      status: response.status,
      headers: buildDynamicSearchHeaders(response),
    });
  }

  return json(responsePayload, {
    status: response.status,
    headers: buildDynamicSearchHeaders(response),
  });
};

export const action = async (args: ActionFunctionArgs) => {
  const start = performance.now();
  const diagnostic: ProxyDiagnostic = {
    requestedTopK: null,
    normalizedTopK: null,
    canonicalTopK: null,
    upstreamMs: null,
  };
  let response: Response | undefined;
  try {
    response = await textSearchAction(args, diagnostic);
    const timing = `public_proxy;dur=${(performance.now() - start).toFixed(2)}`;
    response.headers.append('Server-Timing', timing);
    return response;
  } finally {
    try {
      console.log(
        JSON.stringify({
          event: 'public_search_proxy',
          scope:
            args.params.orgId === 'nga'
              ? 'nga'
              : args.params.orgId === 'ngs'
                ? 'ngs'
                : 'other',
          apiRequestId:
            response?.headers.get('X-Paillette-Search-Request-Id') || null,
          ...diagnostic,
          totalMs: performance.now() - start,
          httpStatus: response?.status || null,
          errorCategory: !response
            ? 'aborted_or_exception'
            : response.status >= 500
              ? 'upstream'
              : response.status >= 400
                ? 'rejected'
                : null,
        })
      );
    } catch {
      /* Logging cannot affect the proxy response. */
    }
  }
};
