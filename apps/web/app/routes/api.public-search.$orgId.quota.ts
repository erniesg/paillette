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

const PUBLIC_QUOTA_ERRORS = {
  NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED:
    'NGA public search quota has been exhausted.',
  NGA_PUBLIC_SEARCH_QUOTA_UNAVAILABLE:
    'NGA public search quota is temporarily unavailable.',
} as const;

const sanitizeUpstreamQuotaError = (
  payload: unknown,
  headers: Headers
): ApiResponse => {
  const genericError: ApiResponse = {
    success: false,
    error: {
      code: 'PUBLIC_SEARCH_QUOTA_UPSTREAM_ERROR',
      message: 'Search quota is temporarily unavailable.',
    },
  };
  if (!payload || typeof payload !== 'object') return genericError;

  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return genericError;
  const code = (error as { code?: unknown }).code;
  if (
    typeof code !== 'string' ||
    !(code in PUBLIC_QUOTA_ERRORS)
  ) {
    return genericError;
  }

  const sanitized: ApiResponse = {
    success: false,
    error: { code, message: PUBLIC_QUOTA_ERRORS[code as keyof typeof PUBLIC_QUOTA_ERRORS] },
  };
  if (code !== 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED') {
    return sanitized;
  }

  const details = (error as { details?: unknown }).details;
  const bodyQuota =
    details && typeof details === 'object'
      ? getNgaSearchQuota((details as { quota?: unknown }).quota)
      : null;
  const headerQuota = getNgaSearchQuotaFromHeaders(headers);
  const quota = headerQuota ?? bodyQuota;
  if (quota) {
    sanitized.error!.details = { quota };
  }
  return sanitized;
};

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

  let response: Response;
  try {
    response = await fetch(
      `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/search/quota`,
      { method: 'GET', headers, signal: request.signal }
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      throw error;
    }
    return upstreamQuotaError();
  }
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
    return noStore(
      sanitizeUpstreamQuotaError(payload, response.headers),
      response.status,
      response
    );
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
