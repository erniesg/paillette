import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse } from '~/types';
import {
  getNgaSearchQuota,
  getNgaSearchQuotaFromHeaders,
  type NgaSearchQuota,
} from '~/lib/nga-search-quota';
import {
  buildPublicSearchHeaders,
  copyPublicSearchResponseHeaders,
  getApiBaseUrl,
  getServerEnv,
  isAllowedPublicSearchRouteId,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const noStore = <T>(payload: T, status: number, upstream?: Response) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (upstream) {
    copyPublicSearchResponseHeaders(upstream, headers);
  }
  return json(payload, { status, headers });
};

const upstreamQuotaError = () =>
  noStore<ApiResponse>(
    {
      success: false,
      error: {
        code: 'PUBLIC_SEARCH_QUOTA_UPSTREAM_ERROR',
        message: 'Search quota is temporarily unavailable.',
      },
    },
    502
  );

const getSuccessfulQuota = (payload: unknown): NgaSearchQuota | null => {
  if (!payload || typeof payload !== 'object') return null;
  const envelope = payload as { success?: unknown; data?: unknown };
  return envelope.success === true ? getNgaSearchQuota(envelope.data) : null;
};

const isSameQuota = (left: NgaSearchQuota, right: NgaSearchQuota) =>
  left.limit === right.limit &&
  left.used === right.used &&
  left.remaining === right.remaining;

export const loader = async ({
  context,
  params,
  request,
}: LoaderFunctionArgs) => {
  const orgId = params.orgId;
  if (!orgId) {
    return noStore<ApiResponse>(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Org ID is required.' } },
      400
    );
  }
  if (!isAllowedPublicSearchRouteId(orgId)) {
    return noStore<ApiResponse>(
      {
        success: false,
        error: {
          code: 'PUBLIC_SEARCH_SCOPE_FORBIDDEN',
          message: 'This organization is not available to public search.',
        },
      },
      403
    );
  }

  const env = getServerEnv(context);
  const headers = buildPublicSearchHeaders(request, env, 'application/json');
  if (!headers) {
    const response = publicSearchConfigError();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const response = await fetch(
    `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/search/quota`,
    { method: 'GET', headers, signal: request.signal }
  );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return response.ok
      ? upstreamQuotaError()
      : noStore<ApiResponse>(
          {
            success: false,
            error: {
              code: 'PUBLIC_SEARCH_QUOTA_UPSTREAM_ERROR',
              message: 'Search quota is temporarily unavailable.',
            },
          },
          response.status,
          response
        );
  }

  if (!response.ok) {
    return noStore(payload as ApiResponse, response.status, response);
  }

  const bodyQuota = getSuccessfulQuota(payload);
  const headerQuota = getNgaSearchQuotaFromHeaders(response.headers);
  if (!bodyQuota || !headerQuota || !isSameQuota(bodyQuota, headerQuota)) {
    return upstreamQuotaError();
  }

  return noStore<ApiResponse<NgaSearchQuota>>(
    { success: true, data: bodyQuota },
    response.status,
    response
  );
};
