import { afterEach, describe, expect, it, vi } from 'vitest';

import agent from './agent';

const ENV = { OPENAI_API_KEY: 'test-key' };

const TOOLS = [
  {
    type: 'function',
    function: { name: 'get_view_context', parameters: { type: 'object' } },
  },
];

const post = (body: unknown, env: Record<string, unknown> = ENV) =>
  agent.request(
    '/public-agent/turn',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /public-agent/turn — timing', () => {
  it('returns what the call cost beside the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '' } }],
          usage: {
            prompt_tokens: 5210,
            completion_tokens: 42,
            prompt_tokens_details: { cached_tokens: 4096 },
          },
        })
      )
    );

    const response = await post({
      messages: [{ role: 'user', content: 'storms at sea' }],
      tools: TOOLS,
      turn: { text: 'storms at sea', flagsDelta: [{ artworkId: 'a', title: 'Gale', to: 'pick' }] },
    });
    const body = (await response.json()) as {
      data: { message: unknown; timing: Record<string, number | null> };
    };

    expect(response.status).toBe(200);
    expect(body.data.message).toEqual({ role: 'assistant', content: '' });
    expect(body.data.timing).toMatchObject({
      promptTokens: 5210,
      completionTokens: 42,
      cachedTokens: 4096,
    });
    expect(body.data.timing.modelMs).toBeGreaterThanOrEqual(0);
    expect(body.data.timing.routeMs).toBeGreaterThanOrEqual(body.data.timing.modelMs as number);
    expect(body.data.timing.systemPromptChars).toBeGreaterThan(1000);
    // The gesture sentence the route wrote from `turn`, measured.
    expect(body.data.timing.gestureChars).toBeGreaterThan(0);
    expect(body.data.timing.toolsChars).toBe(JSON.stringify(TOOLS).length);
    expect(response.headers.get('Server-Timing')).toMatch(/^model;dur=\d+, route;dur=\d+$/);
  });

  it('reports tokens as unknown rather than zero when OpenAI omits usage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x' } }] })
      )
    );

    const response = await post({
      messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS,
    });
    const body = (await response.json()) as {
      data: { timing: Record<string, number | null> };
    };

    expect(body.data.timing.promptTokens).toBeNull();
    expect(body.data.timing.cachedTokens).toBeNull();
    expect(body.data.timing.gestureChars).toBe(0);
  });
});
