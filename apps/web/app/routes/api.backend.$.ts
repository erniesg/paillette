import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import {
  withWorkOSResourceSession,
  type WorkOSSession,
} from '~/lib/workos-auth.server';

type ProxyArgs = LoaderFunctionArgs | ActionFunctionArgs;

const ALLOWED_RESPONSE_HEADERS = [
  'Content-Type',
  'Content-Disposition',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-Extract-Limit',
  'X-Extract-Remaining',
];

const proxyAuthenticatedRequest = async (
  { context, params, request }: ProxyArgs,
  session: WorkOSSession
) => {
  if (!session.accessToken) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
        },
      },
      { status: 401 }
    );
  }

  const path = params['*'];
  if (!path || path.includes('..')) {
    return Response.json(
      {
        success: false,
        error: { code: 'INVALID_PATH', message: 'Invalid API path' },
      },
      { status: 400 }
    );
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${getApiBaseUrl(getServerEnv(context))}/${path.replace(/^\/+/, '')}`
  );
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers({
    Authorization: `Bearer ${session.accessToken}`,
  });
  for (const name of ['Accept', 'Content-Type', 'Idempotency-Key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
  });
  const responseHeaders = new Headers({ 'Cache-Control': 'private, no-store' });
  for (const name of ALLOWED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

const handle = (args: ProxyArgs) =>
  withWorkOSResourceSession(args as any, (session) =>
    proxyAuthenticatedRequest(args, session)
  );

export const loader = handle;
export const action = handle;
