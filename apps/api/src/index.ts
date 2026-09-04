import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import orgs from './routes/galleries';
import artworkRoutes from './routes/artworks';
import collectionRoutes from './routes/collections';
import { searchRoutes } from './routes/search';
import { colorSearchRoutes } from './routes/color-search';
import { embeddingsRoutes } from './routes/embeddings';
import metadataRoutes from './routes/metadata';
import translationRoutes from './routes/translation';
import apiKeyRoutes from './routes/api-keys';
import impactRoutes from './routes/impact';
import assetRoutes from './routes/assets';
import usageEventRoutes from './routes/usage-events';
import mcpRoutes, { getMcpProtectedResourceMetadata } from './routes/mcp';
import ngsReviewRoutes from './routes/ngs-review';
import extractRoutes from './routes/extract';
import indexingRoutes from './routes/indexing';
import describeRoutes from './routes/describe';
import agentRoutes from './routes/agent';
import labelRoutes from './routes/labels';
import metadataMapRoutes from './routes/metadata-map';
import { requireAuthOrApiKey } from './middleware/auth';
import {
  processOpenAccessAssetBatch,
  type OpenAccessAssetMessage,
} from './queues/open-access-assets-queue';

// Environment bindings
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  VECTORIZE: Vectorize;
  VECTORIZE_V2?: Vectorize;
  CAPTION_VECTORIZE?: Vectorize;
  CAPTION_VECTORIZE_V2?: Vectorize;
  CACHE: KVNamespace;
  AI: Ai;
  EMBEDDING_QUEUE: Queue;
  FRAME_REMOVAL_QUEUE: Queue;
  TRANSLATION_QUEUE?: Queue;
  OPEN_ACCESS_ASSET_QUEUE?: Queue<OpenAccessAssetMessage>;
  BUCKET: R2Bucket;
  ENVIRONMENT: string;
  API_VERSION: string;
  // Translation provider API keys
  OPENAI_API_KEY?: string;
  YOUDAO_APP_KEY?: string;
  YOUDAO_APP_SECRET?: string;
  GOOGLE_TRANSLATE_API_KEY?: string;
  LOGTO_ISSUER?: string;
  LOGTO_JWKS_URI?: string;
  LOGTO_API_RESOURCE?: string;
  AUTH_ISSUER?: string;
  AUTH_JWKS_URI?: string;
  AUTH_CLIENT_ID?: string;
  SEARCH_ACCESS_MODE?: string;
  SEARCH_ACCESS_BOOTSTRAP_EMAIL?: string;
  /** Immutable WorkOS subject for the one bootstrap administrator. */
  WORKOS_BOOTSTRAP_SUBJECT?: string;
  API_KEY_PEPPER?: string;
  /** Dedicated HMAC key for the internal MCP-to-REST handoff. It must never
   * be reused as a personal API-key hashing pepper. */
  MCP_INTERNAL_CAPABILITY_SECRET?: string;
  PAILLETTE_PUBLIC_SEARCH_API_KEY?: string;
  DAILY_FREE_QUERY_LIMIT?: string;
  PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE?: string;
  TRANSLATION_FREE_LIFETIME_LIMIT?: string;
  EXTRACT_FREE_LIFETIME_LIMIT?: string;
  FAL_KEY?: string;
  JINA_API_KEY?: string;
  /** Daily cap on OpenAI calls across the mapper, interpreter and captioner. */
  OPENAI_DAILY_CALL_LIMIT?: string;
  JINA_MULTIMODAL_MODEL?: string;
  JINA_EMBEDDING_DIMENSIONS?: string;
  CAPTION_VECTOR_SEARCH_ENABLED?: string;
  CAPTION_EMBEDDING_PROVIDER?: string;
  JINA_TEXT_MODEL?: string;
  JINA_TEXT_EMBEDDING_DIMENSIONS?: string;
  QUERY_EMBEDDING_API_URL?: string;
  QUERY_EMBEDDING_API_TOKEN?: string;
  EMBEDDING_INDEX_VERSION?: string;
  SEARCH_FUSION_MODE?: string;
  ENABLE_NGS_REVIEW?: string;
  EXTRACT_WORKER_URL?: string;
  EXTRACT_WORKER_TOKEN?: string;
  LOCAL_SAM3_EXTRACT_URL?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: [
      'http://localhost:5173',
      'https://paillette.berlayar.ai',
      'https://paillette-stg.berlayar.ai',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposeHeaders: [
      'Content-Length',
      'WWW-Authenticate',
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'Retry-After',
      'X-Paillette-Search-Cache',
      'X-NGA-Search-Limit',
      'X-NGA-Search-Used',
      'X-NGA-Search-Remaining',
      'X-Extract-Limit',
      'X-Extract-Remaining',
    ],
    maxAge: 600,
    credentials: true,
  })
);

app.get('/', (c) => {
  return c.json({
    success: true,
    data: {
      service: 'paillette-api',
      environment: c.env.ENVIRONMENT,
      version: c.env.API_VERSION,
      health: '/health',
      api: '/api/v1',
      endpoints: {
        textSearch: 'POST /api/v1/orgs/:orgId/search/text',
        imageSearch: 'POST /api/v1/orgs/:orgId/search/image',
        colorSearch: 'POST /api/v1/orgs/:orgId/search/color',
        extract: 'POST /api/v1/extract',
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
});

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    environment: c.env.ENVIRONMENT,
    version: c.env.API_VERSION,
    timestamp: new Date().toISOString(),
  });
});

app.get('/.well-known/oauth-protected-resource', (c) =>
  c.json(getMcpProtectedResourceMetadata(c.req.url, c.env))
);

app.get('/.well-known/oauth-protected-resource/api/v1/mcp', (c) =>
  c.json(getMcpProtectedResourceMetadata(c.req.url, c.env))
);

// API v1 routes
const api = new Hono<{ Bindings: Env }>();
api.get('/.well-known/oauth-protected-resource', (c) =>
  c.json(getMcpProtectedResourceMetadata(c.req.url, c.env))
);
// NGA artwork browse is deliberately anonymous. The match is GET-only and
// segment-exact so it cannot expose NGS/private reads, mutations, embeddings,
// or arbitrary nested artwork endpoints.
const isPublicNgaArtworkRead = (c: { req: { method: string; path: string } }) =>
  c.req.method === 'GET' &&
  /^\/api\/v1\/(?:orgs|galleries)\/nga\/artworks(?:\/[^/%]+)?$/.test(
    c.req.path
  );

// WebMCP indexing is deliberately anonymous: the demo runs in ChatGPT's
// in-app browser with no account. The routes behind this exemption write only
// into the hard-coded sandbox organisation seeded by migration 0021, are
// bounded by INDEXING_CAPS, and expose no NGA/NGS data. The prefix is matched
// exactly so no other API surface can be reached without authentication.
const isPublicIndexingRoute = (c: { req: { path: string } }) =>
  /^\/api\/v1\/public-index\/[A-Za-z0-9/_.-]*$/.test(c.req.path);

api.use('*', async (c, next) => {
  // MCP owns its OAuth challenge so clients still receive the required
  // resource metadata and scope hint. All other API data routes share this
  // authentication/access boundary before reaching route-local middleware.
  if (c.req.path.endsWith('/mcp')) {
    await next();
    return;
  }
  if (isPublicNgaArtworkRead(c)) {
    await next();
    return;
  }
  if (isPublicIndexingRoute(c)) {
    await next();
    return;
  }
  return requireAuthOrApiKey(c as any, next);
});
api.route('/public-index', indexingRoutes);
api.route('/public-index', metadataMapRoutes);
api.route('/me', apiKeyRoutes as any);
api.route('/impact', impactRoutes as any);
api.route('/usage-events', usageEventRoutes as any);
api.route('/orgs', orgs);
api.route('/galleries', orgs);
api.route('/metadata', metadataRoutes);
api.route('/translate', translationRoutes);
api.route('/assets', assetRoutes);
api.route('/extract', extractRoutes as any);
api.route('/mcp', mcpRoutes as any);
api.route('/ngs-review', ngsReviewRoutes);

// Nested routes under orgs. /galleries remains as a legacy alias while the
// frontend and API clients move over.
api.route('/orgs/:orgId/artworks', artworkRoutes);
api.route('/orgs/:orgId/collections', collectionRoutes);
api.route('/orgs/:orgId', searchRoutes);
api.route('/orgs/:orgId', colorSearchRoutes);
api.route('/orgs/:orgId', embeddingsRoutes);
api.route('/galleries/:galleryId/artworks', artworkRoutes);
api.route('/galleries/:galleryId/collections', collectionRoutes);
api.route('/galleries/:galleryId', searchRoutes);
api.route('/galleries/:galleryId', colorSearchRoutes);
api.route('/galleries/:galleryId', embeddingsRoutes);

// Mounted under /api (not inside the authenticated /api/v1 sub-app) so it
// stays anonymous: the route enforces its own model allowlist, per-caller
// budget and read scope, mirroring the public-index surface.
app.route('/api', describeRoutes);
app.route('/api', agentRoutes);
app.route('/api', labelRoutes);

// Mount API routes
app.route('/api/v1', api);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested endpoint does not exist',
      },
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);

  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          c.env.ENVIRONMENT === 'production'
            ? 'An unexpected error occurred'
            : err.message,
      },
    },
    500
  );
});

export default app;

(
  app as unknown as {
    queue: (
      batch: MessageBatch<OpenAccessAssetMessage>,
      env: Env,
      ctx: ExecutionContext
    ) => Promise<void>;
  }
).queue = async (batch, env) => {
  await processOpenAccessAssetBatch(batch, env);
};
