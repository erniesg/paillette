import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../index';
import {
  METADATA_MAP_MAX_PER_HOUR,
  sanitizeHeaderMapping,
  validateMetadataMapRequest,
} from './metadata-map';

// The route only needs KV for the per-IP limiter; no database or storage.
const createEnv = (overrides: Record<string, unknown> = {}) => ({
  ENVIRONMENT: 'test',
  API_VERSION: 'v1',
  OPENAI_API_KEY: 'test-openai-key',
  CACHE: {
    store: new Map<string, string>(),
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  },
  ...overrides,
});
const { store } = { store: new Map<string, string>() };

const BASE = 'https://api.test/api/v1/public-index';

const postMetadataMap = async (
  env: ReturnType<typeof createEnv>,
  body: unknown,
  ip = '203.0.113.9'
) => {
  const response = await app.fetch(
    new Request(`${BASE}/metadata-map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ip ? { 'CF-Connecting-IP': ip } : {}),
      },
      body: JSON.stringify(body),
    }),
    env as never
  );
  return { response, payload: (await response.json()) as any };
};

/** OpenAI-shaped response carrying `content` as the completion body. */
const openAiReply = (content: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify(content) } }],
      })
    )
  );

const VALID_BODY = {
  headers: ['Object Ref', 'Mood'],
  samples: [['1890.1', 'stormy']],
};

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateMetadataMapRequest', () => {
  it('accepts headers with no samples and trims the header names', () => {
    expect(validateMetadataMapRequest({ headers: [' Title '], samples: [] })).toEqual({
      headers: ['Title'],
      samples: [],
    });
    expect(validateMetadataMapRequest({ headers: ['a'] })).toEqual({
      headers: ['a'],
      samples: [],
    });
  });

  it('rejects a non-object body and a missing or empty header list', () => {
    expect(validateMetadataMapRequest(null)).toMatch(/JSON object/);
    expect(validateMetadataMapRequest([1])).toMatch(/JSON object/);
    expect(validateMetadataMapRequest({})).toMatch(/array of strings/);
    expect(validateMetadataMapRequest({ headers: [] })).toMatch(/between 1 and/);
  });

  it('enforces the 40-header ceiling and string headers', () => {
    expect(
      validateMetadataMapRequest({ headers: Array.from({ length: 41 }, (_, i) => `h${i}`) })
    ).toMatch(/between 1 and/);
    expect(validateMetadataMapRequest({ headers: ['a', 5] })).toMatch(/must be a string/);
    expect(validateMetadataMapRequest({ headers: ['a', '   '] })).toMatch(/blank/);
  });

  it('enforces sample count, row shape, cell types and cell length', () => {
    const headers = ['a', 'b'];
    expect(
      validateMetadataMapRequest({ headers, samples: [[], [], [], []] })
    ).toMatch(/At most 3/);
    expect(
      validateMetadataMapRequest({ headers, samples: [['only-one-cell']] })
    ).toMatch(/one cell per header/);
    expect(
      validateMetadataMapRequest({ headers, samples: [['x', 12]] })
    ).toMatch(/must be a string/);
    expect(
      validateMetadataMapRequest({ headers, samples: [['x', 'y'.repeat(121)]], })
    ).toMatch(/120 characters or fewer/);
    expect(
      validateMetadataMapRequest({ headers, samples: ['nope'] })
    ).toMatch(/array of strings/);
  });
});

describe('sanitizeHeaderMapping', () => {
  it('keeps known targets, case-folds them, and forces everything else to ignore', () => {
    const mapping = sanitizeHeaderMapping(
      {
        'Object Ref': 'Accession_Number',
        artist: 'artist',
        mood: 'vibes',
        orphan: undefined,
      },
      ['Object Ref', 'artist', 'mood', 'orphan']
    );
    expect(mapping).toEqual({
      'Object Ref': 'accession_number',
      artist: 'artist',
      mood: 'ignore',
      orphan: 'ignore',
    });
  });

  it('ignores everything when the model answers with garbage', () => {
    expect(sanitizeHeaderMapping('nope', ['a'])).toEqual({ a: 'ignore' });
    expect(sanitizeHeaderMapping(null, ['a'])).toEqual({ a: 'ignore' });
  });
});

describe('POST /public-index/metadata-map', () => {
  it('maps headers through OpenAI and returns the sanitized mapping', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                mapping: { 'Object Ref': 'accession_number', Mood: 'medium' },
              }),
            },
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const { response, payload } = await postMetadataMap(createEnv(), VALID_BODY);
    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      data: {
        mapping: { 'Object Ref': 'accession_number', Mood: 'medium' },
      },
    });

    // One OpenAI chat completion, carrying only headers and samples.
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { method: string; body: string; headers: Record<string, string> },
    ];
    expect(url).toContain('api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]!.role).toBe('user');
    expect(JSON.parse(body.messages[1]!.content)).toEqual(VALID_BODY);
  });

  it('returns 400 on malformed bodies without calling OpenAI', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    for (const body of [
      { headers: [] },
      { headers: 'Title' },
      { headers: ['a'], samples: [['too', 'many', 'cells']] },
      { headers: ['a'], samples: [['x'.repeat(121)]] },
    ]) {
      const { response, payload } = await postMetadataMap(createEnv(), body);
      expect(response.status).toBe(400);
      expect(payload.error.code).toBe('INVALID_INPUT');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('degrades with 503 MAPPING_UNAVAILABLE when no API key is configured', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const { response, payload } = await postMetadataMap(
      createEnv({ OPENAI_API_KEY: undefined }),
      VALID_BODY
    );
    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('MAPPING_UNAVAILABLE');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('degrades with 503 when OpenAI fails or answers malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream boom', { status: 500 }))
    );
    const failing = await postMetadataMap(createEnv(), VALID_BODY);
    expect(failing.response.status).toBe(503);
    expect(failing.payload.error.code).toBe('MAPPING_UNAVAILABLE');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: 'not json at all' } }],
        })
      )
    );
    const malformed = await postMetadataMap(createEnv(), VALID_BODY);
    expect(malformed.response.status).toBe(503);
    expect(malformed.payload.error.code).toBe('MAPPING_UNAVAILABLE');
  });

  it('rate limits hard per IP while leaving other addresses alone', async () => {
    openAiReply({ mapping: { 'Object Ref': 'accession_number', Mood: 'ignore' } });
    const env = createEnv();

    for (let call = 0; call < METADATA_MAP_MAX_PER_HOUR; call += 1) {
      const { response } = await postMetadataMap(env, VALID_BODY);
      expect(response.status).toBe(200);
    }

    const blocked = await postMetadataMap(env, VALID_BODY);
    expect(blocked.response.status).toBe(429);
    expect(blocked.payload.error.code).toBe('METADATA_MAP_RATE_LIMITED');

    const otherIp = await postMetadataMap(env, VALID_BODY, '198.51.100.7');
    expect(otherIp.response.status).toBe(200);
  });

  it('stays reachable without a client identity (limiter inert, like indexing)', async () => {
    openAiReply({ mapping: { 'Object Ref': 'ignore', Mood: 'ignore' } });
    const { response } = await postMetadataMap(createEnv(), VALID_BODY, '');
    expect(response.status).toBe(200);
  });

  it('requires no authentication on the anonymous public-index surface', async () => {
    openAiReply({ mapping: {} });
    // app.fetch without any Authorization header or API key reaches the route.
    const { response } = await postMetadataMap(createEnv(), VALID_BODY);
    expect(response.status).toBe(200);
  });
});
