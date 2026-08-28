import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { normalizePublicSearchText } from '@paillette/types/public-search-core';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
import {
  buildPublicSearchHeaders,
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
  for (const header of [
    'Retry-After',
    'X-Paillette-Search-Cache',
    'X-NGA-Search-Limit',
    'X-NGA-Search-Used',
    'X-NGA-Search-Remaining',
  ]) {
    const value = response.headers.get(header);
    if (value) headers.set(header, value);
  }
  return headers;
};

export const action = async ({
  context,
  params,
  request,
}: ActionFunctionArgs) => {
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
  const resolvedOrgId = resolvePublicSearchOrgId(orgId);
  const apiBaseUrl = getApiBaseUrl(env);

  const response = await fetch(
    `${apiBaseUrl}/orgs/${resolvedOrgId}/search/text`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(canonicalSearchPayload),
      signal: request.signal,
    }
  );

  const responsePayload =
    (await response.json()) as ApiResponse<SearchResponse>;
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
