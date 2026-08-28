import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
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

const noStore = <T>(payload: T, status: number, upstream?: Response) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (upstream) {
    for (const header of [
      'Retry-After',
      'X-NGA-Search-Limit',
      'X-NGA-Search-Used',
      'X-NGA-Search-Remaining',
    ]) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }
  }
  return json(payload, { status, headers });
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

  const response = await fetch(
    `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/search/quota`,
    { method: 'GET', headers, signal: request.signal }
  );
  let payload: ApiResponse;
  try {
    payload = (await response.json()) as ApiResponse;
  } catch {
    payload = {
      success: false,
      error: {
        code: 'PUBLIC_SEARCH_QUOTA_UPSTREAM_ERROR',
        message: 'Search quota is temporarily unavailable.',
      },
    };
  }
  return noStore(payload, response.status, response);
};
