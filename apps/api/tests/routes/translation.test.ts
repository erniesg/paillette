import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import translationRoutes from '../../src/routes/translation';
import type { Env } from '../../src/index';

const { translateMock } = vi.hoisted(() => ({
  translateMock: vi.fn(),
}));

vi.mock('@paillette/translation', () => ({
  TranslationService: class {
    translate = translateMock;
  },
}));

type TranslationUsage = {
  used: number;
  quota: number;
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeTranslationDb,
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
    return this.db.first<T>(this.sql, this.params);
  }
}

class FakeTranslationDb {
  usage = new Map<string, TranslationUsage>();

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO translation_usage_lifetime')) {
      const [userId, quota] = params as [string, number];
      const current = this.usage.get(userId) ?? { used: 0, quota };
      current.quota = quota;
      this.usage.set(userId, current);
      return { success: true, meta: { changes: 1 } };
    }

    if (
      sql.includes('UPDATE translation_usage_lifetime') &&
      sql.includes('used = used + 1')
    ) {
      const [userId] = params as [string];
      const current = this.usage.get(userId);
      if (!current || current.used + 1 > current.quota) {
        return { success: true, meta: { changes: 0 } };
      }

      current.used += 1;
      return { success: true, meta: { changes: 1 } };
    }

    if (
      sql.includes('UPDATE translation_usage_lifetime') &&
      sql.includes('CASE WHEN used > 0')
    ) {
      const [userId] = params as [string];
      const current = this.usage.get(userId);
      if (current) current.used = Math.max(current.used - 1, 0);
      return { success: true, meta: { changes: current ? 1 : 0 } };
    }

    return { success: true, meta: { changes: 1 } };
  }

  async first<T>(sql: string, params: unknown[]) {
    if (sql.includes('FROM translation_usage_lifetime')) {
      const [userId] = params as [string];
      return (this.usage.get(userId) ?? null) as T | null;
    }

    return null;
  }
}

const makeApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/translate', translationRoutes as any);
  return app;
};

const makeEnv = (db: FakeTranslationDb, quota = 10): Env =>
  ({
    DB: db as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    VECTORIZE: undefined as unknown as Vectorize,
    CACHE: {} as KVNamespace,
    AI: { run: vi.fn() } as unknown as Ai,
    EMBEDDING_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
    API_VERSION: 'v1',
    TRANSLATION_FREE_LIFETIME_LIMIT: String(quota),
  }) as Env;

const translateText = (
  app: Hono<{ Bindings: Env }>,
  env: Env,
  body = {
    text: 'Gallery label',
    sourceLang: 'en',
    targetLang: 'zh',
  }
) =>
  app.request(
    '/api/v1/translate/text',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'user-1',
      },
      body: JSON.stringify(body),
    },
    env
  );

describe('translation quota', () => {
  beforeEach(() => {
    translateMock.mockReset();
    translateMock.mockResolvedValue({
      translatedText: 'Translated label',
      provider: 'test',
      cached: false,
      cost: 0,
    });
  });

  it('returns server-side lifetime usage', async () => {
    const db = new FakeTranslationDb();
    const res = await makeApp().request(
      '/api/v1/translate/usage',
      { headers: { 'X-User-Id': 'user-1' } },
      makeEnv(db)
    );
    const data = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(data.data).toEqual({ used: 0, quota: 10, remaining: 10 });
  });

  it('increments usage only for successful translations', async () => {
    const db = new FakeTranslationDb();
    const res = await translateText(makeApp(), makeEnv(db));
    const data = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(data.data.translatedText).toBe('Translated label');
    expect(data.data.usage).toEqual({ used: 1, quota: 10, remaining: 9 });
    expect(db.usage.get('user-1')?.used).toBe(1);
  });

  it('rejects requests after the lifetime quota is exhausted', async () => {
    const db = new FakeTranslationDb();
    db.usage.set('user-1', { used: 10, quota: 10 });

    const res = await translateText(makeApp(), makeEnv(db));
    const data = (await res.json()) as any;

    expect(res.status).toBe(429);
    expect(data.error.code).toBe('TRANSLATION_QUOTA_EXCEEDED');
    expect(translateMock).not.toHaveBeenCalled();
  });

  it('rolls back reserved usage when translation fails', async () => {
    translateMock.mockRejectedValueOnce(new Error('provider down'));
    const db = new FakeTranslationDb();

    const res = await translateText(makeApp(), makeEnv(db));
    const data = (await res.json()) as any;

    expect(res.status).toBe(500);
    expect(data.error.code).toBe('TRANSLATION_FAILED');
    expect(db.usage.get('user-1')?.used).toBe(0);
  });
});
