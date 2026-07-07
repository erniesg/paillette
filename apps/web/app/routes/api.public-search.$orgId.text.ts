import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
import {
  buildPublicSearchCacheHeaders,
  buildPublicTextSearchCacheKey,
  buildPublicSearchHeaders,
  filterPublicTextSearchResponse,
  getApiBaseUrl,
  getCanonicalPublicTextSearchRequest,
  getServerEnv,
  isHiddenPublicNgsArtwork,
  logPublicUsageEvent,
  publicSearchConfigError,
  readPublicTextSearchCache,
  resolvePublicSearchOrgId,
  writePublicTextSearchCache,
} from '~/lib/public-search.server';
import type { ArtworkSearchResult } from '~/types';

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

const DEFAULT_PUBLIC_TEXT_MIN_SCORE = 0.2;
const PUBLIC_TEXT_SEARCH_FACETS = new Set(['artist']);

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

  const requestedSearchPayload: Required<Omit<SearchTextRequest, 'facet'>> &
    Pick<SearchTextRequest, 'facet'> = {
    query,
    topK: clamp(body.topK, 1, 100, 30),
    minScore: clamp(body.minScore, 0, 1, DEFAULT_PUBLIC_TEXT_MIN_SCORE),
    facet:
      typeof body.facet === 'string' &&
      PUBLIC_TEXT_SEARCH_FACETS.has(body.facet)
        ? (body.facet as SearchTextRequest['facet'])
        : undefined,
  };
  const searchPayload: SearchTextRequest = requestedSearchPayload;
  const canonicalSearchPayload = getCanonicalPublicTextSearchRequest(
    requestedSearchPayload
  );
  const usageContext = asRecord(body.usageContext);
  const shouldLogUsage = usageContext.auto !== true;
  const resolvedOrgId = resolvePublicSearchOrgId(orgId);
  const apiBaseUrl = getApiBaseUrl(env);
  const cacheKey = buildPublicTextSearchCacheKey({
    apiBaseUrl,
    facet: requestedSearchPayload.facet,
    orgId: resolvedOrgId,
    query,
  });

  const cachedPayload = await readPublicTextSearchCache(cacheKey);
  if (cachedPayload) {
    const responsePayload = filterPublicTextSearchResponse(
      cachedPayload,
      requestedSearchPayload
    );

    if (shouldLogUsage && responsePayload.success && responsePayload.data) {
      const results = responsePayload.data.results;
      await logPublicUsageEvent(request, env, {
        eventType: 'search',
        queryType: `public_${usageContext.mode === 'colour' ? 'colour' : 'text'}_search`,
        orgId: resolvedOrgId,
        search: {
          mode: usageContext.mode === 'colour' ? 'colour' : 'text',
          query,
          topK: searchPayload.topK,
          minScore: searchPayload.minScore,
          facet: requestedSearchPayload.facet,
          rawResultCount: cachedPayload.data?.results.length ?? results.length,
          resultCount: results.length,
          hiddenFilteredCount: 0,
          queryTime: responsePayload.data.queryTime,
          colours: Array.isArray(usageContext.colours)
            ? usageContext.colours
            : undefined,
          cache: 'hit',
        },
        results: results.map(getUsageResult),
        metadata: {
          routeOrgId: orgId,
          usageContext,
        },
      });
    }

    return json(responsePayload, {
      status: 200,
      headers: buildPublicSearchCacheHeaders('HIT', responsePayload),
    });
  }

  const response = await fetch(
    `${apiBaseUrl}/orgs/${resolvedOrgId}/search/text`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(canonicalSearchPayload),
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

    await writePublicTextSearchCache(
      cacheKey,
      responsePayload,
      response.status
    );

    const requestedResponsePayload = filterPublicTextSearchResponse(
      responsePayload,
      requestedSearchPayload
    );

    if (shouldLogUsage) {
      const requestedResults = requestedResponsePayload.data?.results || [];
      await logPublicUsageEvent(request, env, {
        eventType: 'search',
        queryType: `public_${usageContext.mode === 'colour' ? 'colour' : 'text'}_search`,
        orgId: resolvedOrgId,
        search: {
          mode: usageContext.mode === 'colour' ? 'colour' : 'text',
          query,
          topK: searchPayload.topK,
          minScore: searchPayload.minScore,
          facet: requestedSearchPayload.facet,
          rawResultCount,
          resultCount: requestedResults.length,
          hiddenFilteredCount: rawResultCount - results.length,
          queryTime: requestedResponsePayload.data?.queryTime,
          colours: Array.isArray(usageContext.colours)
            ? usageContext.colours
            : undefined,
          cache: 'miss',
        },
        results: requestedResults.map(getUsageResult),
        metadata: {
          routeOrgId: orgId,
          usageContext,
        },
      });
    }

    return json(requestedResponsePayload, {
      status: response.status,
      headers: buildPublicSearchCacheHeaders('MISS', requestedResponsePayload),
    });
  }

  return json(responsePayload, {
    status: response.status,
    headers: buildPublicSearchCacheHeaders('BYPASS', responsePayload),
  });
};
