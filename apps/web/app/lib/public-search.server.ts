import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
export { isHiddenPublicNgsArtwork } from './public-ngs-visibility';

type WorkerContext = {
  cloudflare?: {
    env?: Record<string, string | undefined>;
  };
};

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type PublicTextSearchCacheKeyInput = {
  apiBaseUrl: string;
  orgId: string;
  query: string;
};

type PublicTextSearchRequest = Required<SearchTextRequest>;

export const PUBLIC_TEXT_SEARCH_CACHE_TOP_K = 100;
export const PUBLIC_TEXT_SEARCH_CACHE_MIN_SCORE = 0;
export const PUBLIC_SEARCH_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800';

const ORG_ID_ALIASES: Record<string, string> = {
  ngs: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  'national-gallery-singapore': 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  '00000000-0000-4000-8000-000000000101':
    'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
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

export const getCanonicalPublicTextSearchRequest = (
  request: PublicTextSearchRequest
): PublicTextSearchRequest => ({
  ...request,
  topK: PUBLIC_TEXT_SEARCH_CACHE_TOP_K,
  minScore: PUBLIC_TEXT_SEARCH_CACHE_MIN_SCORE,
});

export const filterPublicTextSearchResponse = (
  payload: ApiResponse<SearchResponse>,
  request: PublicTextSearchRequest
): ApiResponse<SearchResponse> => {
  if (!payload.success || !payload.data) {
    return payload;
  }

  const results = payload.data.results
    .filter((artwork) => artwork.similarity >= request.minScore)
    .slice(0, request.topK);

  return {
    ...payload,
    data: {
      ...payload.data,
      results,
      count: results.length,
    },
  };
};

export const buildPublicTextSearchCacheKey = ({
  apiBaseUrl,
  orgId,
  query,
}: PublicTextSearchCacheKeyInput) => {
  const url = new URL('https://paillette-public-search-cache.local/text');
  url.searchParams.set('v', '1');
  url.searchParams.set('api', apiBaseUrl);
  url.searchParams.set('org', orgId);
  url.searchParams.set('query', query.trim());

  return new Request(url.toString(), { method: 'GET' });
};

const getPublicSearchCache = (): CacheLike | null => {
  const runtime = globalThis as typeof globalThis & {
    caches?: { default?: CacheLike };
  };

  return runtime.caches?.default ?? null;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

export const getPublicSearchPayloadEtag = (payload: ApiResponse) =>
  `W/"public-search-${hashString(JSON.stringify(payload))}"`;

export const buildPublicSearchCacheHeaders = (
  status: 'HIT' | 'MISS' | 'BYPASS',
  payload?: ApiResponse
) => {
  const headers = new Headers({
    'Cache-Control': PUBLIC_SEARCH_CACHE_CONTROL,
    'X-Paillette-Search-Cache': status,
  });

  if (payload) {
    headers.set('ETag', getPublicSearchPayloadEtag(payload));
  }

  return headers;
};

export const readPublicTextSearchCache = async (
  cacheKey: Request
): Promise<ApiResponse<SearchResponse> | null> => {
  const cache = getPublicSearchCache();
  if (!cache) {
    return null;
  }

  try {
    const cachedResponse = await cache.match(cacheKey);
    if (!cachedResponse) {
      return null;
    }

    return (await cachedResponse.json()) as ApiResponse<SearchResponse>;
  } catch (error) {
    console.warn('Failed to read public text search cache:', error);
    return null;
  }
};

export const writePublicTextSearchCache = async (
  cacheKey: Request,
  payload: ApiResponse<SearchResponse>,
  status: number
) => {
  if (status !== 200 || !payload.success || !payload.data) {
    return;
  }

  const cache = getPublicSearchCache();
  if (!cache) {
    return;
  }

  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Cache-Control': PUBLIC_SEARCH_CACHE_CONTROL,
          'Content-Type': 'application/json',
          ETag: getPublicSearchPayloadEtag(payload),
        },
      })
    );
  } catch (error) {
    console.warn('Failed to write public text search cache:', error);
  }
};

const getPublicSearchAuthHeaders = (
  env: Record<string, string | undefined>
): Record<string, string> | null => {
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

export const logPublicUsageEvent = async (
  request: Request,
  env: Record<string, string | undefined>,
  payload: Record<string, unknown>
) => {
  const headers = buildPublicSearchHeaders(request, env, 'application/json');
  if (!headers) {
    return;
  }

  try {
    await fetch(`${getApiBaseUrl(env)}/usage-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('Failed to log public usage event:', error);
  }
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
