import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  consumeRollingWindow,
  limitFromEnv,
  readRollingWindow,
} from './rolling-window';

const memoryKv = () => {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
};

const at = (iso: string) => Date.parse(iso);

describe('consumeRollingWindow', () => {
  it('admits up to the limit and then refuses, saying when the next call opens', async () => {
    const { kv } = memoryKv();
    const options = { limit: 3, windowMs: HOUR_MS };
    for (const minute of ['12:00', '12:10', '12:20']) {
      const { allowed } = await consumeRollingWindow(kv, 'k', {
        ...options,
        now: at(`2026-09-24T${minute}:00Z`),
      });
      expect(allowed).toBe(true);
    }
    const refused = await consumeRollingWindow(kv, 'k', {
      ...options,
      now: at('2026-09-24T12:30:00Z'),
    });
    expect(refused.allowed).toBe(false);
    expect(refused.state).toEqual({
      limit: 3,
      used: 3,
      remaining: 0,
      nextAt: at('2026-09-24T13:00:00Z'),
    });
  });

  it('does not reset at the top of the hour', async () => {
    // The shape this replaces: ten calls at 12:59 and the bucket named for
    // hour 13 is empty at 13:01. Here the ten are still inside the last sixty
    // minutes, so the eleventh is refused.
    const { kv } = memoryKv();
    const options = { limit: 10, windowMs: HOUR_MS };
    for (let i = 0; i < 10; i += 1) {
      await consumeRollingWindow(kv, 'k', {
        ...options,
        now: at('2026-09-24T12:59:00Z') + i,
      });
    }
    const afterTheHour = await consumeRollingWindow(kv, 'k', {
      ...options,
      now: at('2026-09-24T13:01:00Z'),
    });
    expect(afterTheHour.allowed).toBe(false);
    expect(afterTheHour.state?.nextAt).toBe(at('2026-09-24T13:59:00Z'));

    const anHourLater = await consumeRollingWindow(kv, 'k', {
      ...options,
      now: at('2026-09-24T13:59:01Z'),
    });
    expect(anHourLater.allowed).toBe(true);
  });

  it('refills one call at a time, as each leaves the window', async () => {
    const { kv } = memoryKv();
    const options = { limit: 2, windowMs: HOUR_MS };
    await consumeRollingWindow(kv, 'k', { ...options, now: at('2026-09-24T12:00:00Z') });
    await consumeRollingWindow(kv, 'k', { ...options, now: at('2026-09-24T12:40:00Z') });
    const state = await readRollingWindow(kv, 'k', {
      ...options,
      now: at('2026-09-24T13:10:00Z'),
    });
    expect(state).toEqual({ limit: 2, used: 1, remaining: 1, nextAt: null });
  });

  it('keeps callers apart', async () => {
    const { kv } = memoryKv();
    const options = { limit: 1, windowMs: HOUR_MS, now: at('2026-09-24T12:00:00Z') };
    expect((await consumeRollingWindow(kv, 'a', options)).allowed).toBe(true);
    expect((await consumeRollingWindow(kv, 'b', options)).allowed).toBe(true);
    expect((await consumeRollingWindow(kv, 'a', options)).allowed).toBe(false);
  });

  it('reads a corrupt key as empty rather than as spent', async () => {
    const { kv, store } = memoryKv();
    store.set('k', '{not json');
    const state = await readRollingWindow(kv, 'k', { limit: 5, windowMs: HOUR_MS });
    expect(state?.remaining).toBe(5);
  });

  it('fails open without KV, as the counter it replaces did', async () => {
    expect(
      await consumeRollingWindow(undefined, 'k', { limit: 1, windowMs: HOUR_MS })
    ).toEqual({ allowed: true, state: null });
  });
});

describe('limitFromEnv', () => {
  it('takes a positive number and ignores anything else', () => {
    expect(limitFromEnv('60', 10)).toBe(60);
    expect(limitFromEnv('12.9', 10)).toBe(12);
    expect(limitFromEnv(undefined, 10)).toBe(10);
    expect(limitFromEnv('0', 10)).toBe(10);
    expect(limitFromEnv('lots', 10)).toBe(10);
  });
});
