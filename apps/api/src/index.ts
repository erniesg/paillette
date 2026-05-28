import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import orgs from './routes/galleries';
import artworkRoutes from './routes/artworks';
import { searchRoutes } from './routes/search';
import { colorSearchRoutes } from './routes/color-search';
import { embeddingsRoutes } from './routes/embeddings';
import metadataRoutes from './routes/metadata';
import translationRoutes from './routes/translation';
import apiKeyRoutes from './routes/api-keys';
import impactRoutes from './routes/impact';
import assetRoutes from './routes/assets';
import mcpRoutes, { getMcpProtectedResourceMetadata } from './routes/mcp';
import ngsReviewRoutes from './routes/ngs-review';
import imageExtractionRoutes from './routes/image-extractions';

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
  API_KEY_PEPPER?: string;
  PAILLETTE_PUBLIC_SEARCH_API_KEY?: string;
  DAILY_FREE_QUERY_LIMIT?: string;
  TRANSLATION_FREE_LIFETIME_LIMIT?: string;
  IMAGE_EXTRACTION_FREE_LIFETIME_LIMIT?: string;
  JINA_API_KEY?: string;
  JINA_MULTIMODAL_MODEL?: string;
  JINA_EMBEDDING_DIMENSIONS?: string;
  CAPTION_VECTOR_SEARCH_ENABLED?: string;
  CAPTION_EMBEDDING_PROVIDER?: string;
  JINA_TEXT_MODEL?: string;
  JINA_TEXT_EMBEDDING_DIMENSIONS?: string;
  EMBEDDING_INDEX_VERSION?: string;
  SEARCH_FUSION_MODE?: string;
  ENABLE_NGS_REVIEW?: string;
  IMAGE_EXTRACTION_WORKER_URL?: string;
  IMAGE_EXTRACTION_WORKER_TOKEN?: string;
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
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-User-Id',
      'X-User-Email',
      'X-User-Name',
    ],
    exposeHeaders: [
      'Content-Length',
      'WWW-Authenticate',
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
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
        imageExtraction: 'POST /api/v1/image-extractions',
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
api.route('/me', apiKeyRoutes as any);
api.route('/impact', impactRoutes as any);
api.route('/orgs', orgs);
api.route('/galleries', orgs);
api.route('/metadata', metadataRoutes);
api.route('/translate', translationRoutes);
api.route('/assets', assetRoutes);
api.route('/image-extractions', imageExtractionRoutes as any);
api.route('/mcp', mcpRoutes as any);
api.route('/ngs-review', ngsReviewRoutes);

// Nested routes under orgs. /galleries remains as a legacy alias while the
// frontend and API clients move over.
api.route('/orgs/:orgId/artworks', artworkRoutes);
api.route('/orgs/:orgId', searchRoutes);
api.route('/orgs/:orgId', colorSearchRoutes);
api.route('/orgs/:orgId', embeddingsRoutes);
api.route('/galleries/:galleryId/artworks', artworkRoutes);
api.route('/galleries/:galleryId', searchRoutes);
api.route('/galleries/:galleryId', colorSearchRoutes);
api.route('/galleries/:galleryId', embeddingsRoutes);

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
