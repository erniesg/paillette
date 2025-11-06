import { describe, it, expect } from 'vitest';
import app from './index';

describe('API Health Check', () => {
  it('should return healthy status', async () => {
    const req = new Request('http://localhost/health');
    const env = {
      ENVIRONMENT: 'test',
      API_VERSION: 'v1',
    } as any;

    const res = await app.fetch(req, env);
    const data = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.environment).toBe('test');
  });

  it('should return 404 for unknown routes', async () => {
    const req = new Request('http://localhost/unknown');
    const env = {} as any;

    const res = await app.fetch(req, env);
    const data = (await res.json()) as any;

    expect(res.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });
});
