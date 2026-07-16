import { createRequestHandler } from '@remix-run/cloudflare';
// @ts-expect-error The generated Remix server bundle has no declaration file.
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

const handleRemixRequest = createRequestHandler(serverBuild, 'production');

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return handleRemixRequest(request, {
      cloudflare: { env, context },
    });
  },
};
