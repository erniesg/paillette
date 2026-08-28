import { createRequestHandler } from '@remix-run/cloudflare';
import * as build from './build/server/index.js';
import type { ServerBuild } from '@remix-run/cloudflare';

type Env = {
  APP_ENV?: string;
  PAILLETTE_API_URL?: string;
  PAILLETTE_PUBLIC_SEARCH_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_COOKIE_PASSWORD?: string;
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

// Remix document responses include the root-loader payload. That payload can
// include a WorkOS session marker and search-access state, so it must never be
// put in a shared cache. Static assets do not advertise `text/html` and remain
// on the platform's normal asset-cache path.
export const getDocumentCacheControl = (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  return request.headers.get('Accept')?.includes('text/html')
    ? 'private, no-store'
    : null;
};

const handleRemixRequest = createRequestHandler(serverBuild, 'production');

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const response = await handleRemixRequest(request, {
      cloudflare: { env, context },
    });

    const cacheControl = getDocumentCacheControl(request);
    if (cacheControl) {
      response.headers.set('Cache-Control', cacheControl);
    }

    return response;
  },
};
