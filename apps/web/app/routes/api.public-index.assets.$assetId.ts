import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  buildPublicIndexHeaders,
  getApiBaseUrl,
  getServerEnv,
  indexErrorResponse,
} from '~/lib/public-index.server';

const SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,160}$/;
const RESPONSE_HEADERS = [
  'Content-Length',
  'Content-Type',
  'ETag',
  'Last-Modified',
] as const;

/**
 * GET /api/public-index/assets/:assetId — stream an indexed image back
 * same-origin so a freshly indexed collection renders without credentials.
 */
export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const assetId = params.assetId || '';
  if (!SAFE_ASSET_ID.test(assetId)) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid asset ID.');
  }

  const headers = buildPublicIndexHeaders(request);
  for (const header of ['If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${getApiBaseUrl(getServerEnv(context))}/public-index/assets/${encodeURIComponent(assetId)}`,
      { headers, redirect: 'manual', signal: request.signal }
    );
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    return indexErrorResponse(
      502,
      'PUBLIC_INDEX_ASSET_UNAVAILABLE',
      'The indexed image is temporarily unavailable.'
    );
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return indexErrorResponse(
      502,
      'PUBLIC_INDEX_ASSET_REDIRECT_REJECTED',
      'Unexpected asset redirect.'
    );
  }

  const responseHeaders = new Headers({ 'Cache-Control': 'public, max-age=3600' });
  for (const header of RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
