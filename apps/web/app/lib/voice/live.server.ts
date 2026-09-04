/**
 * Same-origin proxy for the live session's four metered moments.
 *
 * Follows the `public-agent/turn` pattern exactly: the browser never learns
 * the API origin, no key is forwarded (the upstream routes are anonymous and
 * carry their own budget), responses are `no-store`, and Cloudflare's
 * connecting address — which the upstream meter keys on — is what reaches the
 * API. A client-supplied address header is never trusted or forwarded, because
 * a spoofable one is a per-caller budget anybody can reset.
 */

import { json } from '@remix-run/cloudflare';
import {
  buildPublicIndexHeaders,
  getApiBaseUrl,
  getServerEnv,
} from '~/lib/public-index.server';

/** getApiBaseUrl appends /api/v1; the live routes sit at the API root. */
export const liveApiRoot = (context: unknown) =>
  getApiBaseUrl(getServerEnv(context)).replace(/\/api\/v1$/, '');

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const liveUnavailable = () =>
  json(
    {
      success: false,
      error: {
        code: 'LIVE_UNAVAILABLE',
        message: 'Live audio is unavailable right now.',
      },
    },
    { status: 503, headers: new Headers(NO_STORE) }
  );

/**
 * Relay one live request and hand back its envelope unchanged.
 *
 * The upstream refusals are already written to be read by a person — the
 * per-caller ceiling and the site-wide one say different true things — so
 * flattening them here would throw away the only sentence the page has to show.
 */
export const proxyLive = async (
  request: Request,
  context: unknown,
  path: string
) => {
  let upstream: Response;
  try {
    upstream = await fetch(`${liveApiRoot(context)}/api/public-live/${path}`, {
      method: 'POST',
      headers: buildPublicIndexHeaders(request, 'application/json'),
      body: await request.text(),
      signal: request.signal,
    });
  } catch {
    return liveUnavailable();
  }

  const payload = await upstream.json().catch(() => null);
  if (payload === null) return liveUnavailable();

  return json(payload, {
    status: upstream.status,
    headers: new Headers(NO_STORE),
  });
};
