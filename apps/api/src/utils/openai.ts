/**
 * The one place the OpenAI API is called from.
 *
 * Three anonymous-surface features share it: the CSV header mapper, the query
 * interpreter for indexed collections, and the describe_artwork captioner.
 * Every caller degrades to its deterministic path when OPENAI_API_KEY is
 * unset, so the demo works with the helper disabled.
 */

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAiUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'OpenAiUnavailableError';
    this.status = status;
  }
}

export type OpenAiTextPart = { type: 'text'; text: string };
export type OpenAiImagePart = {
  type: 'image_url';
  image_url: { url: string };
};

export type OpenAiMessage = {
  role: 'system' | 'user';
  content: string | Array<OpenAiTextPart | OpenAiImagePart>;
};

export type OpenAiCompletionOptions = {
  env: { OPENAI_API_KEY?: string };
  messages: OpenAiMessage[];
  /** Ask for strict JSON output; the parsed object is returned directly. */
  json?: boolean;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

/**
 * Run one chat completion. With `json`, returns the parsed object — a
 * malformed response throws rather than letting callers improvise.
 */
export const openaiCompletion = async (
  options: OpenAiCompletionOptions
): Promise<string | Record<string, unknown>> => {
  const apiKey = options.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAiUnavailableError('OPENAI_API_KEY is not configured');
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
      max_tokens: options.maxTokens ?? 600,
      temperature: options.temperature ?? 0,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new OpenAiUnavailableError(
      `OpenAI request failed with ${response.status}`,
      response.status === 429 ? 429 : 503
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new OpenAiUnavailableError('OpenAI returned an empty completion');
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
      'OpenAI returned malformed JSON for a structured request'
    );
  }
};
