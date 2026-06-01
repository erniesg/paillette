import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  isHiddenPublicNgsArtwork,
  logPublicUsageEvent,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';
import type { ArtworkSearchResult } from '~/types';

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getUsageResult = (artwork: ArtworkSearchResult, index: number) => {
  const metadata = artwork.metadata || {};

  return {
    artworkId: artwork.id,
    orgId: artwork.orgId || artwork.galleryId,
    rank: index + 1,
    score: artwork.similarity,
    metadata: {
      title: artwork.title || metadata.title || null,
      artist: artwork.artist || metadata.artist || null,
      accessionNumber:
        metadata.accessionNumber || metadata.accession_number || null,
      sourceUrl: metadata.sourceUrl || metadata.source_url || null,
      sourceInstitution:
        metadata.sourceInstitution || metadata.source_institution || null,
    },
  };
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

  const query = typeof body.query === 'string' ? body.query.trim() : '';
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

  const searchPayload: SearchTextRequest = {
    query,
    topK: clamp(body.topK, 1, 100, 30),
    minScore: clamp(body.minScore, 0, 1, 0.3),
  };
  const usageContext = asRecord(body.usageContext);
  const shouldLogUsage = usageContext.auto !== true;
  const resolvedOrgId = resolvePublicSearchOrgId(orgId);

  const response = await fetch(
    `${getApiBaseUrl(env)}/orgs/${resolvedOrgId}/search/text`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(searchPayload),
    }
  );

  const responsePayload =
    (await response.json()) as ApiResponse<SearchResponse>;
  if (responsePayload.success && responsePayload.data) {
    const rawResultCount = responsePayload.data.results.length;
    const results = responsePayload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    responsePayload.data = {
      ...responsePayload.data,
      results,
      count: results.length,
    };

    if (shouldLogUsage) {
      await logPublicUsageEvent(request, env, {
        eventType: 'search',
        queryType: `public_${usageContext.mode === 'colour' ? 'colour' : 'text'}_search`,
        orgId: resolvedOrgId,
        search: {
          mode: usageContext.mode === 'colour' ? 'colour' : 'text',
          query,
          topK: searchPayload.topK,
          minScore: searchPayload.minScore,
          rawResultCount,
          resultCount: results.length,
          hiddenFilteredCount: rawResultCount - results.length,
          queryTime: responsePayload.data.queryTime,
          colours: Array.isArray(usageContext.colours)
            ? usageContext.colours
            : undefined,
        },
        results: results.map(getUsageResult),
        metadata: {
          routeOrgId: orgId,
          usageContext,
        },
      });
    }
  }

  return json(responsePayload, { status: response.status });
};
