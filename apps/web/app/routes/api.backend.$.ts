import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import {
  withWorkOSSession,
  type WorkOSSession,
} from '~/lib/workos-auth.server';

type ProxyArgs = LoaderFunctionArgs | ActionFunctionArgs;

const REQUEST_HEADERS = ['Accept', 'Content-Type', 'Idempotency-Key'] as const;
const RESPONSE_HEADERS = [
  'Content-Type',
  'Content-Disposition',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-Extract-Limit',
  'X-Extract-Remaining',
  'X-NGS-Search-Limit',
  'X-NGS-Search-Used',
  'X-NGS-Search-Remaining',
  'X-NGA-Search-Limit',
  'X-NGA-Search-Used',
  'X-NGA-Search-Remaining',
  'X-Paillette-Search-Cache',
  'ETag',
  'Last-Modified',
] as const;

const privateNoStore = { 'Cache-Control': 'private, no-store' };

const proxyError = (status: number, code: string, message: string) =>
  json(
    { success: false, error: { code, message } },
    { status, headers: privateNoStore }
  );

const isSafeApiPath = (path: string | undefined) =>
  Boolean(path) &&
  !path!.includes('..') &&
  !path!.includes('\\') &&
  !path!.split('/').some((segment) => !segment || segment === '.');

const proxyAuthenticatedRequest = async (
  { context, params, request }: ProxyArgs,
  session: WorkOSSession
) => {
  if (!session.accessToken) {
    return proxyError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.'
    );
  }

  const path = params['*'];
  if (!isSafeApiPath(path)) {
    return proxyError(400, 'INVALID_PATH', 'Invalid API path.');
  }

  const apiBaseUrl = getApiBaseUrl(getServerEnv(context));
  const upstreamUrl = new URL(`${apiBaseUrl}/${path}`);
  upstreamUrl.search = new URL(request.url).search;

  const headers = new Headers({
    Authorization: `Bearer ${session.accessToken}`,
  });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : request.body,
      redirect: 'manual',
      signal: request.signal,
    });
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    return proxyError(
      502,
      'BACKEND_UNAVAILABLE',
      'The service is temporarily unavailable.'
    );
  }

  // Never follow an API redirect: that could forward a WorkOS token beyond the
  // configured API origin.
  if (upstream.status >= 300 && upstream.status < 400) {
    return proxyError(
      502,
      'BACKEND_REDIRECT_REJECTED',
      'Unexpected backend redirect.'
    );
  }

  const responseHeaders = new Headers(privateNoStore);
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

const handle = (args: ProxyArgs) =>
  withWorkOSSession(args as any, (session) =>
    proxyAuthenticatedRequest(args, session)
  );

export const loader = handle;
export const action = handle;
