import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../src/index';
import frameRemoval from '../../src/routes/frame-removal';

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/frame-removal', frameRemoval as any);
  return app;
};

const db = {
  prepare(sql: string) {
    const statement = {
      bind: () => statement,
      first: async () => {
        if (sql.includes('FROM artworks')) {
          return {
            id: 'artwork-1',
            image_url: 'https://example.test/image.jpg',
            org_id: 'org-1',
            processing_status: null,
          };
        }
        return null;
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return statement;
  },
};

describe('frame removal authorization', () => {
  it('denies a viewer before updating or enqueueing an artwork', async () => {
    const send = vi.fn();
    const response = await makeApp().request(
      '/api/v1/frame-removal/artworks/0f8fad5b-d9cb-469f-a165-70867728950e/process-frame',
      { method: 'POST', headers: { 'X-User-Id': 'viewer-1' } },
      {
        DB: db,
        FRAME_REMOVAL_QUEUE: { send },
        ENVIRONMENT: 'test',
      } as unknown as Env
    );

    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
});
