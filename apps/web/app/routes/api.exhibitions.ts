/**
 * `POST /api/exhibitions` — same-origin proxy for publishing a show.
 *
 * Same shape as the `public-labels` and `public-describe` proxies: the browser
 * never learns the API origin, nothing is cached, no API key is forwarded (the
 * upstream route is anonymous by design), and the one header that must reach
 * the API is Cloudflare's connecting address, which is what the upstream
 * per-caller budget keys on.
 *
 * The one thing this adds is the absolute URL. The API stores the show and
 * knows its code; it does not know which origin the curator is looking at, and
 * guessing would hand out a staging link from production or the reverse. The
 * origin is known exactly here, so the URL is assembled here.
 */

import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { shareCodePath } from '@paillette/types/share-codes';
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

export const action = async ({ context, request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return indexErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  }

  const env = getServerEnv(context);
  // getApiBaseUrl appends /api/v1; the anonymous surface is mounted at root.
  const apiRoot = getApiBaseUrl(env).replace(/\/api\/v1$/, '');

  let upstream: Response;
  try {
    upstream = await fetch(`${apiRoot}/api/public-exhibitions`, {
      method: 'POST',
      headers: buildPublicIndexHeaders(request, 'application/json'),
      body: await request.text(),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) throw error;
    return indexErrorResponse(
      502,
      'EXHIBITIONS_UNAVAILABLE',
      'Publishing is temporarily unavailable.'
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return indexErrorResponse(
      upstream.ok ? 502 : upstream.status,
      'EXHIBITIONS_UPSTREAM_ERROR',
      'The exhibition service returned an invalid response.'
    );
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) headers.set('Retry-After', retryAfter);

  const code = (payload as { data?: { code?: unknown } })?.data?.code;
  if (upstream.ok && typeof code === 'string' && code) {
    const url = new URL(shareCodePath(code), request.url).toString();
    return json(
      {
        ...(payload as Record<string, unknown>),
        data: { ...(payload as { data: object }).data, url },
      },
      { status: upstream.status, headers }
    );
  }

  return json(payload, { status: upstream.status, headers });
};
