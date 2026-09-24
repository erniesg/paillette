import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const noStore = (payload: ApiResponse, status: number) =>
  json<ApiResponse>(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

/**
 * GET /api/public-usage/:orgId — every budget this visitor can run out of.
 *
 * The POST below records what someone did; this reads what they can still do:
 * labels and agent calls over the last hour, searches over the last day, and
 * the site's daily model budget, each `{limit, used, remaining, nextAt}`. It is
 * the shape `spent-budget.ts` reads, and spends none of them.
 *
 * The connecting address is forwarded because the label and agent budgets are
 * keyed on it, exactly as the label and agent proxies forward it.
 */
export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const orgId = params.orgId;
  if (!orgId || !isAllowedPublicSearchRouteId(orgId)) {
    return noStore(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'No budgets for this collection.' },
      },
      404
    );
  }

  const env = getServerEnv(context);
  const headers = buildPublicSearchHeaders(request, env, 'application/json');
  if (!headers) return publicSearchConfigError();
  const connectingIp = request.headers.get('CF-Connecting-IP');
  if (connectingIp) headers.set('CF-Connecting-IP', connectingIp);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/search/budgets`,
      { method: 'GET', headers, signal: request.signal }
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return noStore(
      {
        success: false,
        error: { code: 'BUDGETS_UNAVAILABLE', message: 'Budgets are unavailable.' },
      },
      502
    );
  }

  let payload: ApiResponse;
  try {
    payload = (await upstream.json()) as ApiResponse;
  } catch {
    return noStore(
      {
        success: false,
        error: { code: 'BUDGETS_UNAVAILABLE', message: 'Budgets are unavailable.' },
      },
      502
    );
  }
  return noStore(payload, upstream.status);
};

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
