import { describe, expect, it, vi } from 'vitest';
import app, { type Env } from '../src/index';

const OPEN_ACCESS_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const env = (): Env =>
  ({
    DB: {
      prepare: vi.fn((sql: string) => {
        const statement = {
          bind: vi.fn(() => statement),
          first: vi.fn(async () => {
            if (sql.includes('FROM orgs')) return { id: OPEN_ACCESS_ORG_ID };
            if (sql.includes('COUNT(*)')) return { count: 0 };
            return null;
          }),
          all: vi.fn(async () => ({ results: [] })),
        };
        return statement;
      }),
    } as unknown as D1Database,
    ENVIRONMENT: 'test',
    API_VERSION: 'test',
  }) as Env;

describe('API public NGA artwork boundary', () => {
  it('permits an anonymous exact NGA artwork list', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/v1/orgs/nga/artworks?public_only=true'),
      env()
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ['NGS list', 'GET', '/api/v1/orgs/ngs/artworks'],
    ['private list', 'GET', '/api/v1/orgs/private-org/artworks'],
    ['NGA mutation', 'POST', '/api/v1/orgs/nga/artworks/upsert'],
    ['embedding read', 'GET', '/api/v1/orgs/nga/embeddings'],
  ])('does not make %s public', async (_name, method, path) => {
    const response = await app.fetch(
      new Request(`http://localhost${path}`, { method }),
      env()
    );

    expect(response.status).toBe(401);
  });
});
