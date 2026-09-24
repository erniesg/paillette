import { afterEach, describe, expect, it, vi } from 'vitest';

import agent from './agent';

const memoryKv = () => {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
};

const turn = (bindings: Record<string, unknown>) =>
  agent.request(
    '/public-agent/turn',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'storms' }],
        tools: [{ type: 'function', function: { name: 'get_view_context' } }],
      }),
    },
    bindings
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /public-agent/turn — the hourly window', () => {
  it('does not reset at the top of the clock hour, and says it is ours', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' } }] }))
    );
    const bindings = {
      OPENAI_API_KEY: 'test-key',
      CACHE: memoryKv(),
      AGENT_MODEL_CALLS_PER_HOUR: '3',
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T12:58:00Z'));
    for (let i = 0; i < 3; i += 1) expect((await turn(bindings)).status).toBe(200);

    vi.setSystemTime(new Date('2026-09-24T13:02:00Z'));
    const refused = await turn(bindings);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(refused.status).toBe(429);
    // Not the provider's throttle: this one is a number in this repo's config.
    expect(body.error.code).toBe('AGENT_CALLS_SPENT');
    expect(body.error.message).toMatch(/56 min/);
  });
});
