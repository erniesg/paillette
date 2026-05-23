import { json } from '@remix-run/cloudflare';
import type { ApiResponse } from '~/types';

type WorkerContext = {
  cloudflare?: {
    env?: Record<string, string | undefined>;
  };
};

const ORG_ID_ALIASES: Record<string, string> = {
  ngs: '00000000-0000-4000-8000-000000000101',
};

export const resolvePublicSearchOrgId = (orgId: string) =>
  ORG_ID_ALIASES[orgId.toLowerCase()] || orgId;

const getProcessEnv = () => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };

  return runtime.process?.env ?? {};
};

export const getServerEnv = (context: unknown) => ({
  ...getProcessEnv(),
  ...(((context as WorkerContext).cloudflare?.env ?? {}) as Record<
    string,
    string | undefined
  >),
});

export const getApiBaseUrl = (env: Record<string, string | undefined>) => {
  const appEnv = env.APP_ENV || env.NODE_ENV || 'development';
  const apiUrl =
    env.PAILLETTE_API_URL ||
    env.API_URL ||
    env.VITE_API_URL ||
    (appEnv === 'production'
      ? 'https://paillette-api.berlayar.ai'
      : 'https://paillette-api-stg.berlayar.ai');

  return `${apiUrl.replace(/\/+$/, '')}/api/v1`;
};

const getPublicSearchAuthHeaders = (env: Record<string, string | undefined>) => {
  const apiKey = env.PAILLETTE_PUBLIC_SEARCH_API_KEY;
  if (apiKey) {
    return { 'X-API-Key': apiKey };
  }

  if ((env.APP_ENV || env.NODE_ENV) !== 'production') {
    return {
      'X-User-Id': 'public-search-web',
      'X-User-Email': 'public-search-web@paillette.local',
      'X-User-Name': 'Public Search Web',
    };
  }

  return null;
};

export const buildPublicSearchHeaders = (
  request: Request,
  env: Record<string, string | undefined>,
  contentType?: string
) => {
  const authHeaders = getPublicSearchAuthHeaders(env);
  if (!authHeaders) {
    return null;
  }

  const headers = new Headers(authHeaders);
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  const forwardedHeaders = [
    'Accept',
    'Accept-Language',
    'Origin',
    'Referer',
    'User-Agent',
    'X-Forwarded-For',
    'CF-Connecting-IP',
    'CF-IPCountry',
    'CF-Ray',
  ];

  for (const header of forwardedHeaders) {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }

  return headers;
};

export const proxyJsonResponse = async <T>(response: Response) => {
  const payload = (await response.json()) as ApiResponse<T>;
  const headers = new Headers();

  for (const header of ['X-RateLimit-Limit', 'X-RateLimit-Remaining']) {
    const value = response.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }

  return json(payload, {
    status: response.status,
    headers,
  });
};

export const publicSearchConfigError = () =>
  json(
    {
      success: false,
      error: {
        code: 'PUBLIC_SEARCH_NOT_CONFIGURED',
        message: 'Public search API authentication is not configured.',
      },
    } satisfies ApiResponse,
    { status: 503 }
  );
