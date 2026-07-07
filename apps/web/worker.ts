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

const handleRemixRequest = createRequestHandler(serverBuild, 'production');

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return handleRemixRequest(request, {
      cloudflare: { env, context },
    });
  },
};
