/**
 * Server-side proxy for the anonymous WebMCP indexing API.
 *
 * Mirrors the public-search proxy pattern in `public-search.server.ts`: the
 * browser never learns the API origin, and every response is `no-store`.
 * Unlike public search these upstream routes are anonymous by design, so no
 * API key is forwarded — the only thing that must reach the API is
 * Cloudflare's connecting address, which is what the upstream rate limiter
 * keys on. A client-supplied address header is never trusted or forwarded.
 */

import { json } from '@remix-run/cloudflare';
import { getApiBaseUrl, getServerEnv } from './public-search.server';

export { getApiBaseUrl, getServerEnv };

/** Ceiling on one batch upload, enforced before anything reaches the API. */
export const PUBLIC_INDEX_MAX_BATCH_BYTES = 48 * 1024 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const indexErrorResponse = (
  status: number,
  code: string,
  message: string
) =>
  json(
    { success: false, error: { code, message } },
    { status, headers: new Headers(NO_STORE) }
  );

export const buildPublicIndexHeaders = (
  request: Request,
  contentType?: string
) => {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);

  // Set by Cloudflare at the edge. Never substitute X-Forwarded-For here:
  // it is client-controlled and would let one visitor spoof another's bucket.
  const connectingIp = request.headers.get('CF-Connecting-IP');
  if (connectingIp) headers.set('CF-Connecting-IP', connectingIp);

  for (const header of ['Accept', 'Accept-Language', 'User-Agent']) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }

  return headers;
};

const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError';

/**
 * Forward one request upstream and hand back its JSON envelope unchanged, so
 * error codes the API defines (caps, rate limits, closed jobs) reach the agent
 * intact rather than being flattened into a generic failure.
 */
export const proxyPublicIndexJson = async (
  request: Request,
  context: unknown,
  path: string,
  init: { method: string; body?: BodyInit; contentType?: string }
) => {
  const env = getServerEnv(context);
  const headers = buildPublicIndexHeaders(request, init.contentType);

  let upstream: Response;
  try {
    upstream = await fetch(`${getApiBaseUrl(env)}/public-index${path}`, {
      method: init.method,
      headers,
      body: init.body,
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) throw error;
    return indexErrorResponse(
      502,
      'PUBLIC_INDEX_UPSTREAM_UNAVAILABLE',
      'Indexing is temporarily unavailable.'
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return indexErrorResponse(
      upstream.ok ? 502 : upstream.status,
      'PUBLIC_INDEX_UPSTREAM_ERROR',
      'Indexing returned an invalid response.'
    );
  }

  const headersOut = new Headers(NO_STORE);
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) headersOut.set('Retry-After', retryAfter);

  return json(payload, { status: upstream.status, headers: headersOut });
};
