import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { searchRoutes } from './routes/search';

// Environment bindings
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  VECTORIZE: Vectorize;
  CACHE: KVNamespace;
  AI: Ai;
  EMBEDDING_QUEUE: Queue;
  ENVIRONMENT: string;
  API_VERSION: string;
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

// API routes
const apiVersion = 'v1';

// Search routes
app.route(`/api/${apiVersion}/galleries/:galleryId`, searchRoutes);

// Placeholder for other routes
app.get(`/api/${apiVersion}/*`, (c) => {
  return c.json({ message: 'API endpoint placeholder' }, 200);
});

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
