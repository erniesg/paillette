import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import usageEventRoutes from '../../src/routes/usage-events';
import type { Env } from '../../src/index';

type UsageEvent = {
  id: string;
  query_type: string | null;
  org_id: string | null;
  metadata: string | null;
};

type ArtworkEvent = {
  usage_event_id: string;
  artwork_id: string;
  org_id: string | null;
  rank: number | null;
  score: number | null;
  interaction: string;
  metadata: string | null;
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeUsageDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  run() {
    return this.db.run(this.sql, this.params);
  }

  first<T>() {
    return this.db.first<T>();
  }

  all<T>() {
    return this.db.all<T>();
  }
}

class FakeUsageDb {
  usageEvents: UsageEvent[] = [];
  artworkEvents: ArtworkEvent[] = [];

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO api_usage_events')) {
      const [
        id,
        ,
        ,
        ,
        ,
        ,
        ,
        queryType,
        orgId,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        metadata,
      ] = params as Array<string | null | undefined>;
      this.usageEvents.push({
        id: id as string,
        query_type: queryType ?? null,
        org_id: orgId ?? null,
        metadata: metadata ?? null,
      });
    }

    if (sql.includes('INSERT INTO artwork_usage_events')) {
      const [
        ,
        usageEventId,
        artworkId,
        orgId,
        rank,
        score,
        interaction,
        metadata,
      ] = params as Array<string | number | null | undefined>;
      this.artworkEvents.push({
        usage_event_id: usageEventId as string,
        artwork_id: artworkId as string,
        org_id: (orgId as string | null) ?? null,
        rank: (rank as number | null) ?? null,
        score: (score as number | null) ?? null,
        interaction: interaction as string,
        metadata: (metadata as string | null) ?? null,
      });
    }

    return { success: true, meta: { changes: 1 } };
  }

  async first<T>() {
    return null as T | null;
  }

  async all<T>() {
    return { success: true, results: [] as T[] };
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/usage-events', usageEventRoutes);
  return app;
};

const makeEnv = (db: FakeUsageDb): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    VECTORIZE: undefined as unknown as Vectorize,
    CACHE: {} as KVNamespace,
    AI: {} as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
  }) as Env;

describe('Usage event API', () => {
  it('records citation-copy artwork interactions without quota middleware', async () => {
    const db = new FakeUsageDb();
    const app = makeApp();

    const res = await app.request(
      '/api/v1/usage-events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'vitest-usage/1.0',
          'X-User-Id': 'public-search-web',
        },
        body: JSON.stringify({
          eventType: 'artwork_interaction',
          queryType: 'public_citation_copy',
          orgId: 'org-1',
          search: {
            mode: 'text',
            query: 'pineapple',
            topK: 30,
          },
          interaction: {
            type: 'citation_copy',
            action: 'citation_copy',
            artworkId: '1993-01678',
            orgId: 'org-1',
            rank: 1,
            score: 0.92,
            metadata: {
              style: 'chicago',
              plainTextLength: 120,
            },
          },
        }),
      },
      makeEnv(db)
    );

    expect(res.status).toBe(200);
    expect(db.usageEvents).toHaveLength(1);
    expect(db.usageEvents[0]).toMatchObject({
      query_type: 'public_citation_copy',
      org_id: 'org-1',
    });
    expect(JSON.parse(db.usageEvents[0].metadata || '{}')).toMatchObject({
      eventType: 'artwork_interaction',
      search: {
        mode: 'text',
        query: 'pineapple',
      },
      interaction: {
        type: 'citation_copy',
        artworkId: '1993-01678',
      },
    });
    expect(db.artworkEvents).toHaveLength(1);
    expect(db.artworkEvents[0]).toMatchObject({
      usage_event_id: db.usageEvents[0].id,
      artwork_id: '1993-01678',
      interaction: 'citation_copy',
      rank: 1,
      score: 0.92,
    });
    expect(JSON.parse(db.artworkEvents[0].metadata || '{}')).toMatchObject({
      action: 'citation_copy',
      style: 'chicago',
      plainTextLength: 120,
    });
  });
});
