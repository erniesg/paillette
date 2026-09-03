/**
 * POST /api/public-search/:orgId/exemplars — same-origin proxy for the
 * relevance-feedback engine behind `search_by_exemplars` and `redeal`.
 *
 * Mirrors `api.public-search.$orgId.text.ts` exactly: allowlist the org, attach
 * the server-held public-search credentials, forward, and strip works hidden
 * from the public catalogue on the way back. The browser never sees a key and
 * there is no agent-only endpoint — the human's own redeal and the agent's
 * `redeal` tool go through this one route.
 */

import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  copyPublicSearchResponseHeaders,
  getApiBaseUrl,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  isHiddenPublicNgsArtwork,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

/** Matches the caps the upstream route enforces, so bad input fails here. */
const MAX_EXEMPLARS_PER_SIDE = 32;
const MAX_EXCLUSIONS = 400;

const readIdList = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (id) ids.add(id);
    if (ids.size >= limit) break;
  }
  return [...ids];
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
};

export const action = async ({
  context,
  params,
  request,
}: ActionFunctionArgs) => {
  const orgId = params.orgId;
  if (!orgId) {
    return json<ApiResponse>(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Org ID is required.' } },
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
  if (!headers) return publicSearchConfigError();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json<ApiResponse>(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON request body.' } },
      { status: 400 }
    );
  }

  const positiveIds = readIdList(body.positiveIds, MAX_EXEMPLARS_PER_SIDE);
  if (positiveIds.length === 0) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'positiveIds must contain at least one artwork id.',
        },
      },
      { status: 400 }
    );
  }

  const payload = {
    positiveIds,
    negativeIds: readIdList(body.negativeIds, MAX_EXEMPLARS_PER_SIDE),
    excludeIds: readIdList(body.excludeIds, MAX_EXCLUSIONS),
    topK: Math.round(clamp(body.topK, 1, 100, 12)),
    negativeWeight: clamp(body.negativeWeight, 0, 1, 0.5),
  };

  const apiBaseUrl = getApiBaseUrl(env);
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/orgs/${resolvePublicSearchOrgId(orgId)}/search/exemplars`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: request.signal,
      }
    );
  } catch (error) {
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
          code: 'PUBLIC_EXEMPLAR_SEARCH_UPSTREAM_UNAVAILABLE',
          message: 'Exemplar search is temporarily unavailable.',
        },
      },
      { status: 502, headers: new Headers({ 'Cache-Control': 'no-store' }) }
    );
  }

  const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
  copyPublicSearchResponseHeaders(response, responseHeaders);

  let responsePayload: ApiResponse<SearchResponse>;
  try {
    responsePayload = (await response.json()) as ApiResponse<SearchResponse>;
  } catch {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_EXEMPLAR_SEARCH_UPSTREAM_ERROR',
          message: 'Exemplar search returned an invalid response.',
        },
      },
      { status: response.ok ? 502 : response.status, headers: responseHeaders }
    );
  }

  if (responsePayload.success && responsePayload.data) {
    const results = responsePayload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    responsePayload.data = {
      ...responsePayload.data,
      results,
      count: results.length,
    };
  }

  return json(responsePayload, {
    status: response.status,
    headers: responseHeaders,
  });
};
