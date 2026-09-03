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
 * POST /api/public-agent/turn — same-origin proxy for the in-page agent loop,
 * following the `public-describe` pattern: the browser never learns the API
 * origin, no key is forwarded (the upstream route is anonymous by design),
 * responses are `no-store`, and Cloudflare's connecting address — which the
 * upstream per-caller budget keys on — is what reaches the API.
 */
export const action = async ({ context, request }: ActionFunctionArgs) => {
  const env = getServerEnv(context);
  // getApiBaseUrl appends /api/v1; the agent route is mounted at the API root.
  const apiRoot = getApiBaseUrl(env).replace(/\/api\/v1$/, '');

  let upstream: Response;
  try {
    upstream = await fetch(`${apiRoot}/api/public-agent/turn`, {
      method: 'POST',
      headers: buildPublicIndexHeaders(request, 'application/json'),
      body: await request.text(),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) throw error;
    return indexErrorResponse(
      502,
      'AGENT_UNAVAILABLE',
      'The agent is temporarily unavailable.'
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return indexErrorResponse(
      upstream.ok ? 502 : upstream.status,
      'AGENT_UPSTREAM_ERROR',
      'The agent returned an invalid response.'
    );
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) headers.set('Retry-After', retryAfter);

  return json(payload, { status: upstream.status, headers });
};
