import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import {
  buildPublicIndexHeaders,
  getApiBaseUrl,
  getServerEnv,
} from '~/lib/public-index.server';

/**
 * POST /api/public-live/call — the SDP exchange, relayed.
 *
 * Not JSON, so it does not go through `proxyLive`: an SDP offer goes up as
 * `application/sdp` and an SDP answer comes back as text. The session
 * credential rides in `X-Live-Token` and is the only thing this hop adds to
 * the upstream headers — it is an ephemeral sixty-second credential the Worker
 * minted, not an account key, and it is what the Worker presents to the
 * provider on this page's behalf.
 */
export const action = async ({ context, request }: ActionFunctionArgs) => {
  const apiRoot = getApiBaseUrl(getServerEnv(context)).replace(/\/api\/v1$/, '');
  const session = new URL(request.url).searchParams.get('session') ?? '';

  const headers = buildPublicIndexHeaders(request, 'application/sdp');
  const token = request.headers.get('X-Live-Token');
  if (token) headers.set('X-Live-Token', token);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiRoot}/api/public-live/call?session=${encodeURIComponent(session)}`,
      {
        method: 'POST',
        headers,
        body: await request.text(),
        signal: request.signal,
      }
    );
  } catch {
    return new Response('', { status: 503 });
  }

  // The answer is SDP on success and a JSON envelope on refusal. Both are
  // relayed as-is with their status: the page only needs to know whether it
  // got an answer, and inventing a body for either would lose the reason.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/sdp',
      'Cache-Control': 'no-store',
    },
  });
};
