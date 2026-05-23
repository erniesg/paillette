import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  proxyJsonResponse,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

export const action = async ({ context, params, request }: ActionFunctionArgs) => {
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

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Search query is required.',
        },
      },
      { status: 400 }
    );
  }

  const payload: SearchTextRequest = {
    query,
    topK: clamp(body.topK, 1, 100, 30),
    minScore: clamp(body.minScore, 0, 1, 0.3),
  };

  const response = await fetch(
    `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/search/text`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }
  );

  return proxyJsonResponse<SearchResponse>(response);
};
