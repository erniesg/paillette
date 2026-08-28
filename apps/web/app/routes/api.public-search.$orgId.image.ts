import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  isHiddenPublicNgsArtwork,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
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

  let payload: ApiResponse<SearchResponse>;
  try {
    payload = (await response.json()) as ApiResponse<SearchResponse>;
  } catch {
    if (!response.ok) {
      const responseHeaders = new Headers();
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
      return noStoreJson<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PUBLIC_IMAGE_SEARCH_UPSTREAM_ERROR',
            message: 'Public image search request failed.',
          },
        },
        response.status,
        responseHeaders
      );
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
    const results = payload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    payload.data = {
      ...payload.data,
      results,
      count: results.length,
    };

  }

  const responseHeaders = new Headers();
  for (const header of [
    'Retry-After',
    'X-NGA-Search-Limit',
    'X-NGA-Search-Used',
    'X-NGA-Search-Remaining',
  ]) {
    const value = response.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }
  return noStoreJson(payload, response.status, responseHeaders);
};
