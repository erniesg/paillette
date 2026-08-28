import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { isSafePublicAssetId } from '~/lib/public-asset-url';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import {
  withWorkOSSession,
  type WorkOSSession,
} from '~/lib/workos-auth.server';

const REQUEST_HEADERS = [
  'Accept',
  'If-Modified-Since',
  'If-None-Match',
  'Range',
] as const;
const RESPONSE_HEADERS = [
  'Accept-Ranges',
  'Content-Length',
  'Content-Range',
  'Content-Type',
  'ETag',
  'Last-Modified',
  'Set-Cookie',
] as const;
const privateNoStore = { 'Cache-Control': 'private, no-store' };

const errorResponse = (status: number, code: string, message: string) =>
  json(
    { success: false, error: { code, message } },
    { status, headers: privateNoStore }
  );

const handleAssetContent = async (
  { context, params, request }: LoaderFunctionArgs,
  session: WorkOSSession
) => {
  const assetId = params.assetId || '';
  if (!isSafePublicAssetId(assetId)) {
    return errorResponse(400, 'INVALID_INPUT', 'Invalid asset ID.');
  }
  if (!session.accessToken) {
    return errorResponse(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.'
    );
  }

  const headers = new Headers({
    Authorization: `Bearer ${session.accessToken}`,
  });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${getApiBaseUrl(getServerEnv(context))}/assets/${encodeURIComponent(assetId)}/content`,
      { headers, redirect: 'manual', signal: request.signal }
    );
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    return errorResponse(
      502,
      'ASSET_UPSTREAM_UNAVAILABLE',
      'The artwork image is temporarily unavailable.'
    );
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return errorResponse(
      502,
      'ASSET_REDIRECT_REJECTED',
      'Unexpected asset redirect.'
    );
  }

  const responseHeaders = new Headers(privateNoStore);
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.status >= 400)
    responseHeaders.set('Cache-Control', 'private, no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const loader = (args: LoaderFunctionArgs) =>
  withWorkOSSession(args as any, (session) =>
    handleAssetContent(args, session)
  );
