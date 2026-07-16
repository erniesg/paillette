import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';
import { withWorkOSSession, type WorkOSSession } from '~/lib/workos-auth.server';

const handleUsageEvent = async ({
  context,
  params,
  request,
}: ActionFunctionArgs, session: WorkOSSession) => {
  const orgId = params.orgId;
  if (!orgId) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Org ID is required.',
        },
      },
      { status: 400 }
    );
  }

  const env = getServerEnv(context);
  if (!session.accessToken) {
    return json<ApiResponse>({
      success: true,
      meta: { timestamp: new Date().toISOString() },
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const headers = buildPublicSearchHeaders(
    request,
    session.accessToken,
    'application/json'
  );

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid JSON request body.',
        },
      },
      { status: 400 }
    );
  }

  const response = await fetch(`${getApiBaseUrl(env)}/usage-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      orgId: body.orgId || resolvePublicSearchOrgId(orgId),
      metadata: {
        routeOrgId: orgId,
        ...(body.metadata &&
        typeof body.metadata === 'object' &&
        !Array.isArray(body.metadata)
          ? body.metadata
          : {}),
      },
    }),
  });

  if (!response.ok) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'USAGE_EVENT_FAILED',
          message: 'Failed to record usage event.',
        },
      },
      { status: response.status }
    );
  }

  return json<ApiResponse>({
    success: true,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};

export const action = (args: ActionFunctionArgs) =>
  withWorkOSSession(args as any, (session) => handleUsageEvent(args, session));
