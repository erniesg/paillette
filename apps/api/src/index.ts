import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import galleries from './routes/galleries';
import artworkRoutes from './routes/artworks';
import { searchRoutes } from './routes/search';
import { colorSearchRoutes } from './routes/color-search';
import { embeddingsRoutes } from './routes/embeddings';
import metadataRoutes from './routes/metadata';
import translationRoutes from './routes/translation';

// Environment bindings
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  VECTORIZE: Vectorize;
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
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'https://paillette.art'], // Update with actual domains
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'X-Request-ID'],
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
api.route('/galleries', galleries);
api.route('/artworks', artworkRoutes);
api.route('/metadata', metadataRoutes);
api.route('/translate', translationRoutes);

// Search and embeddings routes (nested under galleries)
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
