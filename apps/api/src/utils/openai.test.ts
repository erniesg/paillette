import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPENAI_DAILY_CALL_LIMIT,
  openaiCompletion,
  openaiQuotaKey,
  readOpenAiQuota,
} from './openai';

const ENV = { OPENAI_API_KEY: 'test-key' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('openaiCompletion', () => {
  it('returns the parsed object for a json request', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
      );
    const result = await openaiCompletion({
      env: ENV,
      messages: [{ role: 'user', content: 'hi' }],
      json: true,
    });
    expect(result).toEqual({ ok: true });
    fetchMock.mockRestore();
  });

  it('throws 503 when the key is missing', async () => {
    await expect(
      openaiCompletion({ env: {}, messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('daily quota', () => {
  it('counts every call against the shared counter', async () => {
    const store = new Map<string, string>();
    const env = {
      ...ENV,
      CACHE: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => {
          store.set(k, v);
        },
      } as unknown as KVNamespace,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        jsonResponse({ choices: [{ message: { content: 'ok' } }] })
      );

    await openaiCompletion({
      env,
      messages: [{ role: 'user', content: 'a' }],
    });
    await openaiCompletion({
      env,
      messages: [{ role: 'user', content: 'b' }],
    });
    expect(store.get(openaiQuotaKey())).toBe('2');
    fetchMock.mockRestore();
  });

  it('rejects with 429 and skips the fetch once the limit is reached', async () => {
    const store = new Map<string, string>([
      [openaiQuotaKey(), String(DEFAULT_OPENAI_DAILY_CALL_LIMIT)],
    ]);
    const env = {
      ...ENV,
      CACHE: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => {
          store.set(k, v);
        },
      } as unknown as KVNamespace,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(
      openaiCompletion({
        env,
        messages: [{ role: 'user', content: 'a' }],
      })
    ).rejects.toMatchObject({
      name: 'OpenAiUnavailableError',
      status: 429,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('honours OPENAI_DAILY_CALL_LIMIT', async () => {
    const store = new Map<string, string>([[openaiQuotaKey(), '3']]);
    const env = {
      ...ENV,
      OPENAI_DAILY_CALL_LIMIT: '3',
      CACHE: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => {
          store.set(k, v);
        },
      } as unknown as KVNamespace,
    };
    await expect(
      openaiCompletion({ env, messages: [{ role: 'user', content: 'a' }] })
    ).rejects.toMatchObject({ status: 429 });
  });

  it('fails open when KV is unavailable', async () => {
    const env = {
      ...ENV,
      CACHE: {
        get: async () => {
          throw new Error('kv down');
        },
        put: async () => {
          throw new Error('kv down');
        },
      } as unknown as KVNamespace,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: 'ok' } }] })
      );
    await expect(
      openaiCompletion({ env, messages: [{ role: 'user', content: 'a' }] })
    ).resolves.toBe('ok');
    fetchMock.mockRestore();
  });

  it('readOpenAiQuota reports usage and the effective limit', async () => {
    const store = new Map<string, string>([[openaiQuotaKey(), '12']]);
    const env = {
      OPENAI_DAILY_CALL_LIMIT: '40',
      CACHE: {
        get: async (k: string) => store.get(k) ?? null,
      } as unknown as KVNamespace,
    };
    await expect(readOpenAiQuota(env)).resolves.toEqual({
      limit: 40,
      used: 12,
    });
    await expect(readOpenAiQuota({})).resolves.toBeNull();
  });

  it('keys the counter by UTC day', () => {
    expect(openaiQuotaKey(new Date('2026-09-03T23:59:59Z'))).toBe(
      'openai-quota:v1:2026-09-03'
    );
    expect(openaiQuotaKey(new Date('2026-09-04T00:00:00Z'))).toBe(
      'openai-quota:v1:2026-09-04'
    );
  });
});
