import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import {
  buildPublicIndexHeaders,
  getApiBaseUrl,
  getServerEnv,
  indexErrorResponse,
} from '~/lib/public-index.server';

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError';

/**
 * POST /api/public-labels — same-origin proxy for the anonymous wall-label
 * writer, following the public-describe proxy exactly: the browser never
 * learns the API origin, responses are `no-store`, no API key is forwarded
 * (the upstream route is anonymous by design), and the only thing that must
 * reach the API is Cloudflare's connecting address, which is what the upstream
 * per-caller budget keys on.
 */
export const action = async ({ context, request }: ActionFunctionArgs) => {
  const env = getServerEnv(context);
  // getApiBaseUrl appends /api/v1; labels is mounted at the API root.
  const apiRoot = getApiBaseUrl(env).replace(/\/api\/v1$/, '');

  let upstream: Response;
  try {
    upstream = await fetch(`${apiRoot}/api/public-labels`, {
      method: 'POST',
      headers: buildPublicIndexHeaders(request, 'application/json'),
      body: await request.text(),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) throw error;
    return indexErrorResponse(
      502,
      'LABELS_UNAVAILABLE',
      'Label writing is temporarily unavailable.'
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return indexErrorResponse(
      upstream.ok ? 502 : upstream.status,
      'LABELS_UPSTREAM_ERROR',
      'The label service returned an invalid response.'
    );
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) headers.set('Retry-After', retryAfter);

  return json(payload, { status: upstream.status, headers });
};
