import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { isSafePublicAssetId } from '~/lib/public-asset-url';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import {
  withWorkOSResourceSession,
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
] as const;

const privateNoStoreHeaders = {
  'Cache-Control': 'private, no-store',
};

const handleAssetContent = async (
  { context, params, request }: LoaderFunctionArgs,
  session: WorkOSSession
) => {
  const assetId = params.assetId || '';
  if (!isSafePublicAssetId(assetId)) {
    return json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid asset ID.' },
      },
      { status: 400, headers: privateNoStoreHeaders }
    );
  }

  if (!session.accessToken) {
    return json(
      {
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
        },
      },
      { status: 401, headers: privateNoStoreHeaders }
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
      new Request(
        `${getApiBaseUrl(getServerEnv(context))}/assets/${encodeURIComponent(assetId)}/content`,
        { headers }
      )
    );
  } catch {
    return json(
      {
        success: false,
        error: {
          code: 'ASSET_UPSTREAM_UNAVAILABLE',
          message: 'The artwork image is temporarily unavailable.',
        },
      },
      { status: 502, headers: privateNoStoreHeaders }
    );
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set(
    'Cache-Control',
    upstream.status < 400 ? 'private, max-age=3600' : 'private, no-store'
  );

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const loader = (args: LoaderFunctionArgs) =>
  withWorkOSResourceSession(args as any, (session) =>
    handleAssetContent(args, session)
  );
