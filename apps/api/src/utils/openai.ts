/**
 * The one place the OpenAI API is called from.
 *
 * Three anonymous-surface features share it: the CSV header mapper, the query
 * interpreter for indexed collections, and the describe_artwork captioner.
 * Every caller degrades to its deterministic path when OPENAI_API_KEY is
 * unset, so the demo works with the helper disabled.
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-5.6-luna';

/**
 * Two very different things arrive here as `429`, and telling them apart is
 * the difference between an hour of diagnosis and a one-line config change:
 * this site's own daily counter refusing to spend more, and OpenAI throttling
 * the key upstream. The first is ours to raise; the second is not. So the
 * error carries a code and callers relay it rather than flattening both into
 * one sentence.
 */
export type OpenAiFailureCode =
  | 'OPENAI_NOT_CONFIGURED'
  /** Our own KV day-counter hit `OPENAI_DAILY_CALL_LIMIT`. Ours to raise. */
  | 'OPENAI_DAILY_BUDGET_SPENT'
  /** OpenAI itself returned 429 — the key is throttled or out of credit. */
  | 'OPENAI_RATE_LIMITED'
  | 'OPENAI_REQUEST_FAILED'
  | 'OPENAI_BAD_RESPONSE';

export class OpenAiUnavailableError extends Error {
  readonly status: number;
  readonly code: OpenAiFailureCode;
  constructor(
    message: string,
    status = 503,
    code: OpenAiFailureCode = 'OPENAI_REQUEST_FAILED'
  ) {
    super(message);
    this.name = 'OpenAiUnavailableError';
    this.status = status;
    this.code = code;
  }
}

export type OpenAiTextPart = { type: 'text'; text: string };
export type OpenAiImagePart = {
  type: 'image_url';
  image_url: { url: string };
};

/**
 * One global daily budget for the shared OPENAI_API_KEY across all three
 * callers (header mapping, query intent, captioning). Per-IP rate limits
 * bound one visitor; this bounds everyone. KV counters are best-effort —
 * concurrent increments can race, so the cap is approximate, which is the
 * right trade for a cost ceiling that must never become a hard outage.
 */
export const DEFAULT_OPENAI_DAILY_CALL_LIMIT = 500;

export const openaiQuotaKey = (now: Date = new Date()): string =>
  `openai-quota:v1:${now.toISOString().slice(0, 10)}`;

export const readOpenAiQuota = async (
  env: OpenAiQuotaEnv,
  now: Date = new Date()
): Promise<{ limit: number; used: number } | null> => {
  if (!env.CACHE) return null;
  const limit = parseLimit(env);
  try {
    const raw = await env.CACHE.get(openaiQuotaKey(now));
    return { limit, used: raw ? parseInt(raw, 10) || 0 : 0 };
  } catch {
    return null;
  }
};

const parseLimit = (env: OpenAiQuotaEnv): number => {
  const parsed = parseInt(env.OPENAI_DAILY_CALL_LIMIT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_OPENAI_DAILY_CALL_LIMIT;
};

/** Returns false only when this call would exceed the daily budget. */
const consumeQuota = async (env: OpenAiQuotaEnv): Promise<boolean> => {
  if (!env.CACHE) return true;
  const key = openaiQuotaKey();
  try {
    const raw = await env.CACHE.get(key);
    const used = raw ? parseInt(raw, 10) || 0 : 0;
    if (used >= parseLimit(env)) {
      return false;
    }
    await env.CACHE.put(key, String(used + 1), { expirationTtl: 48 * 3600 });
    return true;
  } catch {
    return true;
  }
};

export type OpenAiMessage = {
  role: 'system' | 'user';
  content: string | Array<OpenAiTextPart | OpenAiImagePart>;
};

export type OpenAiQuotaEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_DAILY_CALL_LIMIT?: string;
  /** KV namespace for the shared daily counter. Optional: without it the
   * daily cap cannot be enforced, so calls are allowed (matching the
   * best-effort philosophy of the per-IP anonymous limiters). */
  CACHE?: KVNamespace;
};

export type OpenAiCompletionOptions = {
  env: OpenAiQuotaEnv;
  messages: OpenAiMessage[];
  /** Ask for strict JSON output; the parsed object is returned directly. */
  json?: boolean;
  model?: string;
  maxTokens?: number;
  /**
   * The GPT-5.x family spends `max_completion_tokens` on reasoning *before* it
   * writes anything, so a small budget can be consumed entirely by reasoning
   * and return an empty completion with `finish_reason: "length"`. Pass 'none'
   * for calls that want a short structured answer rather than deliberation.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

/**
 * Run one chat completion. With `json`, returns the parsed object — a
 * malformed response throws rather than letting callers improvise.
 */
/** A message in a tool-calling exchange, relayed between page and model. */
export type OpenAiToolMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export type OpenAiChatOptions = {
  env: OpenAiQuotaEnv;
  messages: OpenAiToolMessage[];
  /** Function definitions, in OpenAI's `{type:'function', function:{...}}` shape. */
  tools: Record<string, unknown>[];
  model?: string;
  maxTokens?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

/**
 * One tool-calling turn. Unlike `openaiCompletion` this returns the assistant
 * message untouched — including `tool_calls` — because the caller is a loop
 * that has to relay it back verbatim on the next turn.
 *
 * Nothing is executed here. The tools live on a page; this only decides.
 */
export const openaiChat = async (
  options: OpenAiChatOptions
): Promise<Record<string, unknown>> => {
  const apiKey = options.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAiUnavailableError(
      'OPENAI_API_KEY is not configured',
      503,
      'OPENAI_NOT_CONFIGURED'
    );
  }
  if (!(await consumeQuota(options.env))) {
    throw new OpenAiUnavailableError(
      'The shared OpenAI daily budget for this site is exhausted',
      429,
      'OPENAI_DAILY_BUDGET_SPENT'
    );
  }

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      messages: options.messages,
      tools: options.tools,
      tool_choice: 'auto',
      max_completion_tokens: options.maxTokens ?? 1200,
      ...(options.reasoningEffort
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new OpenAiUnavailableError(
      `OpenAI request failed with ${response.status}`,
      response.status === 429 ? 429 : 503,
      response.status === 429 ? 'OPENAI_RATE_LIMITED' : 'OPENAI_REQUEST_FAILED'
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: Record<string, unknown> }>;
  };
  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new OpenAiUnavailableError(
      'OpenAI returned no message',
      503,
      'OPENAI_BAD_RESPONSE'
    );
  }
  return message;
};

export const openaiCompletion = async (
  options: OpenAiCompletionOptions
): Promise<string | Record<string, unknown>> => {
  const apiKey = options.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAiUnavailableError(
      'OPENAI_API_KEY is not configured',
      503,
      'OPENAI_NOT_CONFIGURED'
    );
  }

  if (!(await consumeQuota(options.env))) {
    throw new OpenAiUnavailableError(
      'The shared OpenAI daily budget for this site is exhausted',
      429,
      'OPENAI_DAILY_BUDGET_SPENT'
    );
  }

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      messages: options.messages,
      // The GPT-5.x family takes max_completion_tokens and rejects the legacy
      // max_tokens field; temperature is likewise unsupported there, so the
      // strict-prompt-plus-JSON approach carries the determinism instead.
      max_completion_tokens: options.maxTokens ?? 600,
      ...(options.reasoningEffort
        ? { reasoning_effort: options.reasoningEffort }
        : {}),
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new OpenAiUnavailableError(
      `OpenAI request failed with ${response.status}`,
      response.status === 429 ? 429 : 503,
      response.status === 429 ? 'OPENAI_RATE_LIMITED' : 'OPENAI_REQUEST_FAILED'
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new OpenAiUnavailableError(
      'OpenAI returned an empty completion',
      503,
      'OPENAI_BAD_RESPONSE'
    );
  }

  if (!options.json) {
    return content;
  }

  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new OpenAiUnavailableError(
      'OpenAI returned malformed JSON for a structured request',
      503,
      'OPENAI_BAD_RESPONSE'
    );
  }
};
