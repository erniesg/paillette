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
import mcpRoutes from './routes/mcp';

// Environment bindings
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  VECTORIZE: Vectorize;
  CAPTION_VECTORIZE?: Vectorize;
  CACHE: KVNamespace;
  AI: Ai;
  EMBEDDING_QUEUE: Queue;
  TRANSLATION_QUEUE?: Queue;
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
  DAILY_FREE_QUERY_LIMIT?: string;
  TRANSLATION_FREE_LIFETIME_LIMIT?: string;
  JINA_API_KEY?: string;
  JINA_MULTIMODAL_MODEL?: string;
  JINA_EMBEDDING_DIMENSIONS?: string;
  CAPTION_EMBEDDING_PROVIDER?: string;
  JINA_TEXT_MODEL?: string;
  JINA_TEXT_EMBEDDING_DIMENSIONS?: string;
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
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
    ],
    maxAge: 600,
    credentials: true,
  })
);

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    environment: c.env.ENVIRONMENT,
    version: c.env.API_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// API v1 routes
const api = new Hono<{ Bindings: Env }>();
api.route('/me', apiKeyRoutes as any);
api.route('/impact', impactRoutes as any);
api.route('/orgs', orgs);
api.route('/galleries', orgs);
api.route('/metadata', metadataRoutes);
api.route('/translate', translationRoutes);
api.route('/assets', assetRoutes);
api.route('/mcp', mcpRoutes as any);

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
