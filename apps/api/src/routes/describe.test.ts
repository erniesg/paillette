import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../index';
import {
  DEFAULT_DESCRIBE_MODEL,
  DESCRIBE_MODELS,
  MAX_DESCRIBES_PER_CLIENT_PER_HOUR,
} from './describe';
import { OPEN_ACCESS_ORG_ID } from '../utils/orgs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof NodeDatabaseSync;
};

// ---------------------------------------------------------------------------
// Test doubles: real SQLite from the shipped schema, exactly as
// indexing.test.ts does, so collection scoping and the metadata column behave
// as they do in D1.
// ---------------------------------------------------------------------------

const SCHEMA = readFileSync(
  new URL('../../../../packages/database/src/schema.sql', import.meta.url),
  'utf8'
);

type BindValue = string | number | null;

const createD1 = (sqlite: NodeDatabaseSync) => {
  const prepare = (sql: string) => {
    let bound: BindValue[] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        bound = args.map((value) => {
          if (value === undefined || value === null) return null;
          if (typeof value === 'boolean') return value ? 1 : 0;
          if (typeof value === 'number' || typeof value === 'string') return value;
          return String(value);
        });
        return statement;
      },
      first: async <T>() => (sqlite.prepare(sql).get(...bound) as T) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...bound) as T[] }),
      run: async () => {
        const info = sqlite.prepare(sql).run(...bound);
        return { meta: { changes: Number(info.changes) } };
      },
    };
    return statement;
  };

  return {
    prepare,
    batch: async (statements: Array<ReturnType<typeof prepare>>) => {
      const output = [];
      for (const statement of statements) output.push(await statement.run());
      return output;
    },
  };
};

const createR2 = () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    put: async (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, {
        bytes: new Uint8Array(value),
        contentType: options?.httpMetadata?.contentType || 'image/jpeg',
      });
      return { key };
    },
    get: async (key: string) => {
      const object = objects.get(key);
      if (!object) return null;
      return {
        httpMetadata: { contentType: object.contentType },
        arrayBuffer: async () => object.bytes.buffer.slice(
          object.bytes.byteOffset,
          object.bytes.byteOffset + object.bytes.byteLength
        ) as ArrayBuffer,
      };
    },
  };
};

const createKv = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
};

const ARTWORK_ID = '6b3f7f54-1111-4b8c-a1f6-2e5d7c9b4a30';
const IMAGE_KEY = 'nga/open-access/6b3f7f54/original.jpg';
const SEED_USER_ID = '00000000-0000-4000-8000-000000000009';

type FakeDb = ReturnType<typeof createD1>;
type TestEnv = {
  ENVIRONMENT: string;
  API_VERSION: string;
  OPENAI_API_KEY?: string;
  DB: FakeDb;
  IMAGES: ReturnType<typeof createR2>;
  CACHE: ReturnType<typeof createKv>;
};

const createEnv = (sqlite: NodeDatabaseSync): TestEnv => ({
  ENVIRONMENT: 'test',
  API_VERSION: 'v1',
  OPENAI_API_KEY: 'test-openai-key',
  DB: createD1(sqlite),
  IMAGES: createR2(),
  CACHE: createKv(),
});

/** The open-access org row and a user to own seeded artworks (FKs are live). */
const seedScope = (sqlite: NodeDatabaseSync) => {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, name, role, password_hash)
       VALUES (?, 'seed@paillette.local', 'Describe Test Seed', 'curator', 'disabled:no-password-login')`
    )
    .run(SEED_USER_ID);
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO orgs (
         id, name, slug, description, settings, api_key, api_key_hash, owner_id
       )
       VALUES (?, 'Open Access Art', 'open-access-art', 'Test org for describe.', '{}',
               'retired-org-key:test', 'disabled:no-org-key-auth', ?)`
    )
    .run(OPEN_ACCESS_ORG_ID, SEED_USER_ID);
};

const seedArtwork = async (
  env: TestEnv,
  overrides: {
    artworkId?: string;
    customMetadata?: string;
    withAsset?: boolean;
    assetProvider?: 'r2' | 'external';
    imageUrl?: string | null;
  } = {}
) => {
  const artworkId = overrides.artworkId ?? ARTWORK_ID;
  env.DB.prepare(
    `INSERT INTO artworks (id, org_id, title, image_url, custom_metadata, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      artworkId,
      OPEN_ACCESS_ORG_ID,
      'Seeded work',
      overrides.imageUrl === undefined ? 'https://api.nga.gov/images/seed.jpg' : overrides.imageUrl,
      overrides.customMetadata ?? '{}',
      SEED_USER_ID
    )
    .run();
  if (overrides.withAsset !== false) {
    env.DB.prepare(
      `INSERT INTO assets (id, artwork_id, org_id, role, storage_provider, object_key, url, mime_type)
       VALUES ('asset-1', ?, ?, 'original', ?, ?, ?, 'image/jpeg')`
    )
      .bind(
        artworkId,
        OPEN_ACCESS_ORG_ID,
        overrides.assetProvider ?? 'r2',
        IMAGE_KEY,
        overrides.assetProvider === 'external'
          ? 'https://iiif.example/seed/original.jpg'
          : null
      )
      .run();
  }
  return artworkId;
};

const putImage = async (env: TestEnv, bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])) => {
  await env.IMAGES.put(IMAGE_KEY, bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
};

/** An OpenAI-shaped completion carrying one caption. */
const stubOpenAi = (caption = 'A lone sail on a grey, flat sea under a wide sky.') => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.openai.com/v1/chat/completions') {
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ caption }) } }],
        });
      }
      // Any other URL is the external-asset fallback fetch.
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const postDescribe = (
  env: TestEnv,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) =>
  app.fetch(
    new Request('https://api.test/api/public-describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env as never
  );

const sha256Hex = async (value: string) =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('public-describe route', () => {
  let sqlite: NodeDatabaseSync;
  let env: TestEnv;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(SCHEMA);
    seedScope(sqlite);
    env = createEnv(sqlite);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sqlite.close();
  });

  it('describes an R2-backed artwork, persists the caption and returns it', async () => {
    await seedArtwork(env);
    await putImage(env);
    const fetchMock = stubOpenAi();

    const response = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      data: {
        artworkId: ARTWORK_ID,
        collectionId: 'nga',
        caption: 'A lone sail on a grey, flat sea under a wide sky.',
        model: DEFAULT_DESCRIBE_MODEL,
        cached: false,
        persisted: true,
      },
    });

    // One model call, carrying the R2 bytes as a data URL and asking for JSON.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DEFAULT_DESCRIBE_MODEL);
    expect(body.response_format).toEqual({ type: 'json_object' });
    const imagePart = body.messages[1].content.find(
      (part: { type: string }) => part.type === 'image_url'
    );
    expect(imagePart.image_url.url).toMatch(/^data:image\/jpeg;base64,/);

    // The caption lands on the metadata key the search corpus and the web UI
    // already read, with provenance.
    const row = sqlite
      .prepare('SELECT custom_metadata FROM artworks WHERE id = ?')
      .get(ARTWORK_ID) as { custom_metadata: string };
    const metadata = JSON.parse(row.custom_metadata);
    expect(metadata.generated_caption).toMatchObject({
      text: 'A lone sail on a grey, flat sea under a wide sky.',
      model: DEFAULT_DESCRIBE_MODEL,
      prompt_version: 'describe-artwork-v1',
    });
    expect(typeof metadata.generated_caption.generated_at).toBe('string');
  });

  it('serves a stored caption from D1 without any model call', async () => {
    await seedArtwork(env, {
      customMetadata: JSON.stringify({
        provider: 'nga',
        generated_caption: {
          text: 'A stored description of the work.',
          model: 'gpt-5.6-terra',
          prompt_version: 'describe-artwork-v1',
          generated_at: '2026-09-01T00:00:00.000Z',
        },
      }),
    });
    const fetchMock = stubOpenAi();

    const response = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      caption: 'A stored description of the work.',
      model: 'gpt-5.6-terra',
      cached: true,
      persisted: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a model outside the allowlist before reading anything', async () => {
    await seedArtwork(env);
    const fetchMock = stubOpenAi();

    const response = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
      model: 'gpt-4-turbo',
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_MODEL');
    expect(payload.error.message).toContain(DESCRIBE_MODELS.join(', '));
    expect(fetchMock).not.toHaveBeenCalled();

    const row = sqlite
      .prepare('SELECT custom_metadata FROM artworks WHERE id = ?')
      .get(ARTWORK_ID) as { custom_metadata: string };
    expect(JSON.parse(row.custom_metadata)).toEqual({});
  });

  it('passes an allowlisted model through to the completion', async () => {
    await seedArtwork(env);
    await putImage(env);
    const fetchMock = stubOpenAi();

    const response = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
      model: 'gpt-5.6-terra',
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.model).toBe('gpt-5.6-terra');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).model).toBe('gpt-5.6-terra');
  });

  it('degrades to 503 when OPENAI_API_KEY is unset, without calling the model', async () => {
    await seedArtwork(env);
    await putImage(env);
    const keyless = { ...env, OPENAI_API_KEY: undefined };
    const fetchMock = stubOpenAi();

    const response = await postDescribe(keyless, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('DESCRIBE_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still returns the caption with persisted:false when the D1 update fails', async () => {
    await seedArtwork(env);
    await putImage(env);
    stubOpenAi();

    const inner = env.DB;
    const broken = {
      prepare: (sql: string) => {
        if (sql.includes('UPDATE artworks SET custom_metadata')) {
          throw new Error('D1 write failed');
        }
        return inner.prepare(sql);
      },
      batch: inner.batch,
    };

    const response = await postDescribe({ ...env, DB: broken }, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      caption: 'A lone sail on a grey, flat sea under a wide sky.',
      cached: false,
      persisted: false,
    });
  });

  it('falls back to the recorded external URL when no R2 object exists', async () => {
    await seedArtwork(env, { assetProvider: 'external', imageUrl: null });
    const fetchMock = stubOpenAi();

    const response = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.data.persisted).toBe(true);
    const externalFetch = fetchMock.mock.calls.find(
      ([url]) => String(url) === 'https://iiif.example/seed/original.jpg'
    );
    expect(externalFetch).toBeTruthy();
  });

  it('refuses an artwork with no readable image at all', async () => {
    await seedArtwork(env, { withAsset: false, imageUrl: null });
    const fetchMock = stubOpenAi();

    const response = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: ARTWORK_ID,
    });
    const payload = (await response.json()) as any;

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe('ARTWORK_IMAGE_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only reads the open-access collection, and nothing outside it', async () => {
    const otherId = 'aa14c9a6-2222-4b8c-a1f6-2e5d7c9b4a30';
    // A real second org, so the fixture satisfies the schema's foreign keys —
    // the route must still refuse to read it.
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO orgs (
           id, name, slug, description, settings, api_key, api_key_hash, owner_id
         )
         VALUES ('some-other-org', 'Private Org', 'private-org', 'Not public.', '{}',
                 'retired-org-key:private', 'disabled:no-org-key-auth', ?)`
      )
      .run(SEED_USER_ID);
    env.DB.prepare(
      `INSERT INTO artworks (id, org_id, title, uploaded_by)
       VALUES (?, 'some-other-org', 'Private work', ?)`
    )
      .bind(otherId, SEED_USER_ID)
      .run();
    const fetchMock = stubOpenAi();

    const wrongCollection = await postDescribe(env, {
      collectionId: 'my-private-collection',
      artworkId: ARTWORK_ID,
    });
    expect(wrongCollection.status).toBe(404);
    expect(((await wrongCollection.json()) as any).error.code).toBe('NOT_FOUND');

    const foreignArtwork = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: otherId,
    });
    expect(foreignArtwork.status).toBe(404);
    expect(((await foreignArtwork.json()) as any).error.code).toBe('ARTWORK_NOT_FOUND');

    const deleted = await postDescribe(env, {
      collectionId: 'nga',
      artworkId: 'does-not-exist',
    });
    expect(deleted.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('budgets model calls per address, tighter than indexing jobs', async () => {
    await seedArtwork(env);
    await putImage(env);
    stubOpenAi();

    const ip = '203.0.113.9';
    const clientHash = await sha256Hex(`webmcp-describe:${ip}`);
    const bucket = Math.floor(Date.now() / 3_600_000);
    env.CACHE.store.set(`webmcp-describe:v1:${bucket}:${clientHash}`, String(MAX_DESCRIBES_PER_CLIENT_PER_HOUR));

    const response = await postDescribe(
      env,
      { collectionId: 'nga', artworkId: ARTWORK_ID },
      { 'CF-Connecting-IP': ip }
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe('DESCRIBE_RATE_LIMITED');
    expect(response.headers.get('Retry-After')).toBe('600');
  });

  it('rejects a malformed request body', async () => {
    const response = await app.fetch(
      new Request('https://api.test/api/public-describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
      env as never
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe('INVALID_INPUT');
  });
});
