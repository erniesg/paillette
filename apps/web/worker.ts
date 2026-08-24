import { createRequestHandler } from '@remix-run/cloudflare';
import * as build from './build/server/index.js';
import type { ServerBuild } from '@remix-run/cloudflare';

type Env = {
  APP_ENV?: string;
  PAILLETTE_API_URL?: string;
  PAILLETTE_PUBLIC_SEARCH_API_KEY?: string;
  LOGTO_ENDPOINT?: string;
  LOGTO_APP_ID?: string;
  LOGTO_API_RESOURCE?: string;
  RESEND_API_KEY?: string;
  PAILLETTE_FEEDBACK_FROM?: string;
  PAILLETTE_FEEDBACK_TO?: string;
  PAILLETTE_FEEDBACK_DISCORD_WEBHOOK_URL?: string;
  PAILLETTE_FEEDBACK_DISCORD_MENTION?: string;
  CODEX_DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK?: string;
};

const serverBuild = {
  assets: build.assets,
  assetsBuildDirectory: build.assetsBuildDirectory,
  basename: build.basename,
  entry: build.entry,
  future: build.future,
  isSpaMode: build.isSpaMode,
  mode: build.mode,
  publicPath: build.publicPath,
  routes: build.routes,
} as unknown as ServerBuild;

const PUBLIC_PAGE_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const PUBLIC_SEARCH_HTML_PATHS = ['/ngs/search', '/nga/search'];

const getPublicHtmlCacheControl = (pathname: string) => {
  if (pathname === '/about') {
    return PUBLIC_PAGE_CACHE_CONTROL;
  }

  if (PUBLIC_SEARCH_HTML_PATHS.includes(pathname)) {
    return PUBLIC_PAGE_CACHE_CONTROL;
  }

  return null;
};

const handleRemixRequest = createRequestHandler(serverBuild, 'production');

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const response = await handleRemixRequest(request, {
      cloudflare: { env, context },
    });

    const requestUrl = new URL(request.url);
    const cacheControl = getPublicHtmlCacheControl(requestUrl.pathname);
    if (cacheControl && request.method === 'GET') {
      response.headers.set('Cache-Control', cacheControl);
    }

    return response;
  },
};
