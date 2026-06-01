import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

export const action = async ({
  context,
  params,
  request,
}: ActionFunctionArgs) => {
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
  const headers = buildPublicSearchHeaders(request, env, 'application/json');
  if (!headers) {
    return publicSearchConfigError();
  }

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
