import { json } from '@remix-run/cloudflare';
import { normalizePublicSearchText } from '@paillette/types/public-search-core';
import type { ApiResponse, SearchResponse, SearchTextRequest } from '~/types';
import { PUBLIC_TEXT_SEARCH_CACHE_VERSION } from './public-search-cache';
export { PUBLIC_TEXT_SEARCH_CACHE_VERSION } from './public-search-cache';
export { isHiddenPublicNgsArtwork } from './public-ngs-visibility';

type WorkerContext = {
  cloudflare?: {
    env?: Record<string, string | undefined>;
    context?: Pick<ExecutionContext, 'waitUntil'>;
  };
};

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type PublicTextSearchCacheKeyInput = {
  apiBaseUrl: string;
  facet?: string | null;
  orgId: string;
  query: string;
  visualRefinement?: string | null;
};

type PublicTextSearchRequest = Required<
  Omit<SearchTextRequest, 'facet' | 'visualRefinement'>
> &
  Pick<SearchTextRequest, 'facet' | 'visualRefinement'>;

export const PUBLIC_TEXT_SEARCH_CACHE_TOP_K = 100;
export const PUBLIC_TEXT_SEARCH_CACHE_MIN_SCORE = 0;
export const PUBLIC_SEARCH_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800';
const EMPTY_API_SEARCH_SERVER_TIMING = [
  'result_kv',
  'artist_lookup',
  'image_embedding_cache',
  'image_embedding_upstream',
  'image_vectorize',
  'caption_embedding_cache',
  'caption_embedding_upstream',
  'caption_vectorize',
  'metadata',
  'hydration',
  'usage',
  'telemetry',
  'total',
]
  .map((stage) => `${stage};dur=0.0`)
  .join(', ');

const ORG_ID_ALIASES: Record<string, string> = {
  ngs: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  'national-gallery-singapore': 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  '00000000-0000-4000-8000-000000000101':
    'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  open: 'open-access-art',
  nga: 'nga',
  'open-access-art': 'open-access-art',
};

const ALLOWED_PUBLIC_SEARCH_ROUTE_IDS = new Set([
  'ngs',
  'national-gallery-singapore',
  'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  '00000000-0000-4000-8000-000000000101',
  'nga',
]);

export const isAllowedPublicSearchRouteId = (orgId: string) => {
  try {
    return ALLOWED_PUBLIC_SEARCH_ROUTE_IDS.has(
      decodeURIComponent(orgId).trim().toLowerCase()
    );
  } catch {
    return false;
  }
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

export const schedulePublicSearchWork = (
  context: unknown,
  work: Promise<unknown>
) => {
  const executionContext = (context as WorkerContext).cloudflare?.context;
  if (executionContext) {
    executionContext.waitUntil(work);
  }
};

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
  facet,
  orgId,
  query,
  visualRefinement,
}: PublicTextSearchCacheKeyInput) => {
  const url = new URL('https://paillette-public-search-cache.local/text');
  url.searchParams.set('v', PUBLIC_TEXT_SEARCH_CACHE_VERSION);
  url.searchParams.set('api', apiBaseUrl);
  url.searchParams.set('org', orgId);
  url.searchParams.set('query', normalizePublicSearchText(query));
  if (facet) {
    url.searchParams.set('facet', facet);
  }
  if (visualRefinement) {
    url.searchParams.set('visual', normalizePublicSearchText(visualRefinement));
  }

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
  status: 'HIT' | 'MISS' | 'BYPASS' | 'KV-FRESH' | 'KV-STALE' | 'COALESCED',
  payload?: ApiResponse,
  upstreamHeaders?: Headers,
  edgeCacheMs = 0,
  webTotalMs = edgeCacheMs
) => {
  const headers = new Headers({
    'Cache-Control': PUBLIC_SEARCH_CACHE_CONTROL,
    'X-Paillette-Search-Cache': status,
    'X-Paillette-Upstream-Embeddings': '0',
    'X-Paillette-Embedding-Cache': 'image=not-needed,caption=not-needed',
    'X-Paillette-Search-Path': 'web-edge-cache',
    'X-Paillette-Search-Contract': PUBLIC_TEXT_SEARCH_CACHE_VERSION,
  });

  for (const name of [
    'X-Paillette-Upstream-Embeddings',
    'X-Paillette-Embedding-Cache',
    'X-Paillette-Search-Path',
    'X-Paillette-Search-Contract',
  ]) {
    const value = upstreamHeaders?.get(name);
    if (value) headers.set(name, value);
  }

  const upstreamTiming =
    upstreamHeaders?.get('Server-Timing') || EMPTY_API_SEARCH_SERVER_TIMING;
  headers.set(
    'Server-Timing',
    [
      upstreamTiming,
      `edge_cache;dur=${Math.max(edgeCacheMs, 0).toFixed(1)}`,
      `web_total;dur=${Math.max(webTotalMs, 0).toFixed(1)}`,
    ]
      .filter(Boolean)
      .join(', ')
  );

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

    const payload =
      (await cachedResponse.json()) as ApiResponse<SearchResponse>;
    if (payload.success && payload.data) {
      return {
        ...payload,
        data: { ...payload.data, queryTime: 0 },
      };
    }
    return payload;
  } catch (error) {
    console.warn(
      'Failed to read public text search cache:',
      error instanceof Error ? error.name : 'Error'
    );
    return null;
  }
};

export const writePublicTextSearchCache = async (
  cacheKey: Request,
  payload: ApiResponse<SearchResponse>,
  status: number
) => {
  if (
    status !== 200 ||
    !payload.success ||
    !payload.data ||
    payload.meta?.search?.cacheable === false
  ) {
    return;
  }

  const cache = getPublicSearchCache();
  if (!cache) {
    return;
  }

  try {
    const stablePayload: ApiResponse<SearchResponse> = {
      ...payload,
      data: payload.data
        ? {
            ...payload.data,
            queryTime: 0,
          }
        : payload.data,
    };
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(stablePayload), {
        status: 200,
        headers: {
          'Cache-Control': PUBLIC_SEARCH_CACHE_CONTROL,
          'Content-Type': 'application/json',
          ETag: getPublicSearchPayloadEtag(stablePayload),
        },
      })
    );
  } catch (error) {
    console.warn(
      'Failed to write public text search cache:',
      error instanceof Error ? error.name : 'Error'
    );
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
    console.warn(
      'Failed to log public usage event:',
      error instanceof Error ? error.name : 'Error'
    );
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
