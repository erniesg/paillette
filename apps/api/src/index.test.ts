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

  it('should expose MCP OAuth protected resource metadata', async () => {
    const req = new Request(
      'https://paillette-api-stg.berlayar.ai/.well-known/oauth-protected-resource'
    );
    const env = {
      ENVIRONMENT: 'staging',
      API_VERSION: 'v1',
      LOGTO_ISSUER: 'https://m2fmae.logto.app/oidc',
      LOGTO_API_RESOURCE: 'https://paillette-api-stg.berlayar.ai',
    } as any;

    const res = await app.fetch(req, env);
    const data = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(data.resource).toBe('https://paillette-api-stg.berlayar.ai');
    expect(data.authorization_servers).toEqual([
      'https://m2fmae.logto.app/oidc',
    ]);
    expect(data.scopes_supported).toContain('mcp:read');
    expect(data.scopes_supported).toContain('mcp:write');
    expect(data.scopes_supported).toContain('artworks:read');
    expect(data.scopes_supported).toContain('translations:create');
    expect(data.scopes_supported).toContain('image_extractions:create');
  });

  it('should challenge unauthenticated MCP requests with resource metadata', async () => {
    const req = new Request(
      'https://paillette-api-stg.berlayar.ai/api/v1/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      }
    );
    const env = {
      ENVIRONMENT: 'staging',
      API_VERSION: 'v1',
      LOGTO_ISSUER: 'https://m2fmae.logto.app/oidc',
      LOGTO_API_RESOURCE: 'https://paillette-api-stg.berlayar.ai',
    } as any;

    const res = await app.fetch(req, env);
    const data = (await res.json()) as any;

    expect(res.status).toBe(401);
    expect(data.error.code).toBe('UNAUTHORIZED');
    expect(res.headers.get('WWW-Authenticate')).toBe(
      [
        'Bearer resource_metadata="https://paillette-api-stg.berlayar.ai/.well-known/oauth-protected-resource"',
        'scope="mcp:read"',
      ].join(', ')
    );
  });
});
