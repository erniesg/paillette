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

  it('exposes NGA quota headers to browser search clients', async () => {
    const req = new Request('http://localhost/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    const env = { ENVIRONMENT: 'test', API_VERSION: 'v1' } as any;

    const res = await app.fetch(req, env);
    const exposed = res.headers.get('Access-Control-Expose-Headers') || '';

    expect(exposed).toContain('X-NGA-Search-Limit');
    expect(exposed).toContain('X-NGA-Search-Used');
    expect(exposed).toContain('X-NGA-Search-Remaining');
  });

  it('does not allow browser clients to send synthetic identity headers', async () => {
    const req = new Request('http://localhost/health', {
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Headers': 'X-User-Id',
      },
    });
    const env = { ENVIRONMENT: 'test', API_VERSION: 'v1' } as any;

    const res = await app.fetch(req, env);
    expect(res.headers.get('Access-Control-Allow-Headers') || '').not.toContain(
      'X-User-Id'
    );
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
    expect(data.scopes_supported).toContain('extract:create');
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
