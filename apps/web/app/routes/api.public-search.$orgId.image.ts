import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, ArtworkSearchResult, SearchResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  isHiddenPublicNgsArtwork,
  logPublicUsageEvent,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
  schedulePublicSearchWork,
} from '~/lib/public-search.server';
import { parsePublicImageSearchConstraints } from '~/lib/public-image-search-plan';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const NO_STORE = 'no-store';

const noStoreJson = <T>(
  payload: T,
  status: number,
  extraHeaders?: HeadersInit
) => {
  const headers = new Headers(extraHeaders);
  headers.set('Cache-Control', NO_STORE);
  return json(payload, { status, headers });
};

const invalidImageRequest = (message: string) =>
  noStoreJson<ApiResponse>(
    {
      success: false,
      error: { code: 'INVALID_INPUT', message },
    },
    400
  );

const clamp = (
  value: FormDataEntryValue | null,
  min: number,
  max: number,
  fallback: number
) => {
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

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
    return noStoreJson<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Org ID is required.',
        },
      },
      400
    );
  }

  if (!isAllowedPublicSearchRouteId(orgId)) {
    return noStoreJson<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_SEARCH_SCOPE_FORBIDDEN',
          message: 'This organization is not available to public search.',
        },
      },
      403
    );
  }

  const env = getServerEnv(context);
  const headers = buildPublicSearchHeaders(request, env);
  if (!headers) {
    const response = publicSearchConfigError();
    response.headers.set('Cache-Control', NO_STORE);
    return response;
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return invalidImageRequest('Malformed multipart form data.');
  }

  const imageEntries = incoming.getAll('image');
  const image = imageEntries[0];
  if (imageEntries.length !== 1 || !(image instanceof File)) {
    return invalidImageRequest('Exactly one image file is required.');
  }
  if (image.size === 0) {
    return invalidImageRequest('Image must not be empty.');
  }
  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return invalidImageRequest('Image must be a JPEG, PNG, or WebP file.');
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return invalidImageRequest('Image must be 10 MB or smaller.');
  }

  const constraintEntries = incoming.getAll('constraints');
  if (constraintEntries.length > 1) {
    return invalidImageRequest('Constraints must be provided at most once.');
  }
  let constraints;
  try {
    constraints = parsePublicImageSearchConstraints(
      constraintEntries[0] ?? null
    );
  } catch (error) {
    return invalidImageRequest(
      error instanceof Error ? error.message : 'Invalid constraints.'
    );
  }

  for (const field of ['topK', 'minScore'] as const) {
    if (incoming.getAll(field).length > 1) {
      return invalidImageRequest(`${field} must be provided at most once.`);
    }
  }

  const outbound = new FormData();
  outbound.set('image', image);
  const topK = clamp(incoming.get('topK'), 1, 100, 30);
  const minScore = clamp(incoming.get('minScore'), 0, 1, 0.3);
  outbound.set('topK', String(topK));
  outbound.set('minScore', String(minScore));
  if (constraints !== undefined) {
    outbound.set('constraints', JSON.stringify(constraints));
  }
  const resolvedOrgId = resolvePublicSearchOrgId(orgId);

  let response: Response;
  try {
    response = await fetch(
      `${getApiBaseUrl(env)}/orgs/${resolvedOrgId}/search/image`,
      {
        method: 'POST',
        headers,
        body: outbound,
        signal: request.signal,
      }
    );
  } catch (error) {
    if (
      request.signal.aborted ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError')
    ) {
      throw error;
    }
    return noStoreJson<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_IMAGE_SEARCH_UPSTREAM_UNAVAILABLE',
          message: 'Public image search is temporarily unavailable.',
        },
      },
      502
    );
  }

  const responseForNonJson = response.clone();
  let payload: ApiResponse<SearchResponse>;
  try {
    payload = (await response.json()) as ApiResponse<SearchResponse>;
  } catch {
    if (!response.ok) {
      const responseHeaders = new Headers();
      const contentType = response.headers.get('Content-Type');
      const retryAfter = response.headers.get('Retry-After');
      if (contentType) responseHeaders.set('Content-Type', contentType);
      if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
      responseHeaders.set('Cache-Control', NO_STORE);
      return new Response(responseForNonJson.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }
    return noStoreJson<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_IMAGE_SEARCH_UPSTREAM_UNAVAILABLE',
          message: 'Public image search returned an invalid response.',
        },
      },
      502
    );
  }
  if (payload.success && payload.data) {
    const rawResultCount = payload.data.results.length;
    const results = payload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    payload.data = {
      ...payload.data,
      results,
      count: results.length,
    };

    schedulePublicSearchWork(
      context,
      logPublicUsageEvent(request, env, {
        eventType: 'search',
        queryType: 'public_image_search',
        orgId: resolvedOrgId,
        search: {
          mode: 'image',
          image: {
            name: image.name || null,
            type: image.type || null,
            size: image.size,
            lastModified: image.lastModified || null,
          },
          topK,
          minScore,
          ...(constraints !== undefined ? { constraints } : {}),
          rawResultCount,
          resultCount: results.length,
          hiddenFilteredCount: rawResultCount - results.length,
          queryTime: payload.data.queryTime,
        },
        results: results.map(getUsageResult),
        metadata: {
          routeOrgId: orgId,
        },
      })
    );
  }

  const responseHeaders = new Headers();
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
  return noStoreJson(payload, response.status, responseHeaders);
};
