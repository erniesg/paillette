/**
 * POST /api/public-agent/turn — one turn of an agent loop, for visitors who
 * did not arrive with an agent of their own.
 *
 * WebMCP's premise is that *your* agent drives *this* page, and that is how
 * Paillette is meant to be used. But it leaves anyone without a WebMCP-capable
 * browser looking at a search box, unable to see the thing the tools exist for.
 * This route closes that gap: the page sends the tool schemas it registered on
 * `document.modelContext` plus the conversation so far, and gets back the
 * model's next move.
 *
 * Deliberately stateless and deliberately does not execute anything. Tool calls
 * come back to the browser, which runs them through the same
 * `document.modelContext` an external agent would use, and posts the results
 * into the next turn. The page stays the only thing that touches the page.
 *
 * Bounded like the other anonymous paid routes: the shared daily OpenAI budget
 * via `openaiCompletion`, a per-caller hourly cap, a turn cap enforced by the
 * caller's own message count, and a hard ceiling on payload size.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { openaiChat, type OpenAiToolMessage } from '../utils/openai';

/** One conversation should not be able to spend the whole daily budget. */
export const MAX_AGENT_TURNS_PER_CLIENT_PER_HOUR = 40;
/** Beyond this the loop is not converging and should be stopped. */
export const MAX_MESSAGES_PER_REQUEST = 60;
const MAX_BODY_CHARS = 120_000;
const AGENT_MODEL = 'gpt-5.6-terra';

const SYSTEM_PROMPT = [
  'You operate a museum art-search page through the tools it exposes.',
  'Work on the page rather than in text: when you find works worth seeing, put them on the screen with set_results, and open one with show_artwork.',
  'Chain tools when a request needs more than one — a mood search, then a colour or visual refinement, then a selection.',
  'When you pin a selection, always pass a short note saying what the works have in common.',
  'Be decisive and do not ask clarifying questions. Keep any spoken reply to two sentences; the page is doing the showing.',
].join(' ');

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`webmcp-agent:${candidate}`)
  );
  return toHex(digest);
};

const withinAgentRateLimit = async (
  env: Env,
  clientHash: string | null
): Promise<boolean> => {
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `webmcp-agent:v1:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= MAX_AGENT_TURNS_PER_CLIENT_PER_HOUR) {
      return false;
    }
    await env.CACHE.put(key, String((Number.isFinite(used) ? used : 0) + 1), {
      expirationTtl: 7200,
    });
    return true;
  } catch {
    return true;
  }
};

const agent = new Hono<{ Bindings: Env }>();

agent.post('/public-agent/turn', async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return c.json(
      jsonError('PAYLOAD_TOO_LARGE', 'That conversation is too long to continue.'),
      413
    );
  }

  let body: { messages?: unknown; tools?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (messages.length === 0) {
    return c.json(jsonError('INVALID_INPUT', 'messages is required.'), 400);
  }
  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    return c.json(
      jsonError(
        'TOO_MANY_TURNS',
        'This conversation ran too long without settling. Start a new one.'
      ),
      400
    );
  }
  if (tools.length === 0) {
    return c.json(
      jsonError(
        'NO_TOOLS',
        'No tools were offered. The page registers these on document.modelContext.'
      ),
      400
    );
  }

  const clientHash = await getClientHash(
    c.req.header('CF-Connecting-IP') || undefined
  );
  if (!(await withinAgentRateLimit(c.env, clientHash))) {
    return c.json(
      jsonError(
        'AGENT_RATE_LIMITED',
        'You have used this hour’s shared agent budget. Try again shortly.'
      ),
      429
    );
  }

  try {
    const message = await openaiChat({
      env: c.env,
      model: AGENT_MODEL,
      // The GPT-5.x family spends its completion budget on reasoning first, so
      // an agent turn needs room for both that and the tool call it emits.
      maxTokens: 1200,
      reasoningEffort: 'none',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(messages as OpenAiToolMessage[]),
      ],
      tools: tools as Record<string, unknown>[],
      signal: c.req.raw.signal,
    });

    return c.json(
      { success: true as const, data: { message } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: unknown }).status) || 503
        : 503;
    return c.json(
      jsonError(
        'AGENT_UNAVAILABLE',
        status === 429
          ? 'The shared daily agent budget for this site is spent.'
          : 'The agent is temporarily unavailable.'
      ),
      status === 429 ? 429 : 503
    );
  }
});

export default agent;
