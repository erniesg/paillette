/**
 * The Realtime wire protocol, with no wire attached.
 *
 * Everything in this file is a pure function over JSON. That split is not
 * tidiness — a microphone, a peer connection and a media track cannot be
 * exercised on a headless machine, so the choice is between testing the
 * decisions or testing nothing. The decisions live here; `live-session.ts`
 * owns the parts that can only be checked by a human with a real microphone,
 * and is deliberately thin because of it.
 *
 * Shapes below were read from OpenAI's Realtime documentation on **2026-09-04**:
 * tools are flat (`{type:'function', name, description, parameters}`) rather
 * than nested under `function` the way Chat Completions does it; a completed
 * call arrives as a `function_call` item in `response.done`; and a result goes
 * back as a `function_call_output` conversation item.
 */

/** A tool as `document.modelContext` describes it. */
export type RegisteredTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

/**
 * Realtime's tool shape is *not* Chat Completions' tool shape.
 *
 * The turn route sends `{type:'function', function:{name, ...}}`. Realtime
 * wants the same fields one level up. Sending the nested form is accepted and
 * then silently ignored — the session simply never calls anything — which is
 * an hour of staring at a working connection that will not use its tools.
 */
export const toRealtimeTools = (tools: RegisteredTool[]) =>
  tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.inputSchema ?? { type: 'object', properties: {} },
  }));

/**
 * The one `session.update` this page sends, right after the channel opens.
 *
 * `turn_detection: null` is the push-to-talk decision expressed in protocol.
 * Every realtime example defaults to server VAD, which is an open microphone:
 * on a public page that is an unbounded cost with no natural end, and it is
 * indistinguishable from normal use while it runs. Holding a button is also
 * the only way a human is ever certain the page is not listening.
 *
 * Input transcription is on because the transcript is not a nicety here — it
 * is what lands in the field so the grace window has something to edit.
 * Without it, releasing the button would commit audio nobody can correct.
 */
export const buildSessionUpdate = (tools: RegisteredTool[]) => ({
  type: 'session.update' as const,
  session: {
    type: 'realtime' as const,
    audio: {
      input: {
        turn_detection: null,
        transcription: { model: 'gpt-live-transcribe' },
        noise_reduction: { type: 'near_field' as const },
      },
    },
    tools: toRealtimeTools(tools),
    tool_choice: 'auto' as const,
  },
});

/**
 * Ask for a reply, in one modality or the other.
 *
 * The house rule survives intact: text in, text out; voice in, voice out. It
 * is now a field on a request rather than a branch between two subsystems,
 * which is the whole point — the same session answers both, so a typed message
 * and a spoken one are turns in one conversation instead of two paths that can
 * drift.
 */
export const buildResponseCreate = (speak: boolean) => ({
  type: 'response.create' as const,
  response: { output_modalities: speak ? ['audio'] : ['text'] },
});

/** Put a typed sentence into the conversation without answering it yet. */
export const buildUserText = (text: string) => ({
  type: 'conversation.item.create' as const,
  item: {
    type: 'message' as const,
    role: 'user' as const,
    content: [{ type: 'input_text' as const, text }],
  },
});

/** Hand a tool's result back, keyed to the call that asked for it. */
export const buildToolResult = (callId: string, result: unknown) => ({
  type: 'conversation.item.create' as const,
  item: {
    type: 'function_call_output' as const,
    call_id: callId,
    // The same 4000-character ceiling the turn loop uses. A session that
    // replays its whole context on every response pays for every one of these
    // characters again, so thirty full catalogue records is a bill as well as
    // a distraction.
    output: JSON.stringify(result ?? null).slice(0, 4000),
  },
});

/**
 * Throw away audio the human decided against.
 *
 * Committing on release is what produces the transcript, and the transcript is
 * what the grace bar lets them edit. If they do edit it, the audio item is now
 * a version of the sentence they rejected sitting in the conversation, and
 * answering both is answering a question that was withdrawn.
 */
export const buildItemDelete = (itemId: string) => ({
  type: 'conversation.item.delete' as const,
  item_id: itemId,
});

export type LiveEvent =
  /** The session is configured and ready to be talked to. */
  | { kind: 'ready' }
  /** What the human said, as text, for the field to receive. */
  | { kind: 'transcript'; text: string; itemId: string | null }
  /** The agent's reply, complete. Shown always; spoken only if it was asked for. */
  | { kind: 'reply'; text: string }
  /** A tool the browser must run against `document.modelContext`. */
  | { kind: 'tool'; callId: string; name: string; args: Record<string, unknown> }
  /** The agent has stopped producing this response. */
  | { kind: 'response-done' }
  | { kind: 'error'; message: string }
  /** Nothing this page acts on. Most traffic is this. */
  | { kind: 'ignored' };

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return asObject(JSON.parse(raw));
  } catch {
    // Let the tool reject nonsense and say why, exactly as the typed loop does.
    return {};
  }
};

/**
 * Turn one server event into the thing this page should do about it.
 *
 * Function calls are read from `response.done` rather than from
 * `response.function_call_arguments.done`. Both carry the same call, and the
 * former is the one that also tells us the response has finished — so reading
 * it alone means the tool results and the "it has stopped talking" signal
 * cannot arrive out of order with each other.
 */
export const readLiveEvent = (raw: unknown): LiveEvent[] => {
  const event = asObject(raw);
  const type = typeof event.type === 'string' ? event.type : '';

  switch (type) {
    case 'session.updated':
      return [{ kind: 'ready' }];

    case 'conversation.item.input_audio_transcription.completed': {
      const text = typeof event.transcript === 'string' ? event.transcript : '';
      return text.trim()
        ? [
            {
              kind: 'transcript',
              text: text.trim(),
              itemId: typeof event.item_id === 'string' ? event.item_id : null,
            },
          ]
        : [{ kind: 'ignored' }];
    }

    case 'response.done': {
      const response = asObject(event.response);
      const output = Array.isArray(response.output) ? response.output : [];
      const events: LiveEvent[] = [];

      for (const entry of output) {
        const item = asObject(entry);
        if (item.type === 'function_call') {
          const callId = typeof item.call_id === 'string' ? item.call_id : '';
          const name = typeof item.name === 'string' ? item.name : '';
          if (callId && name) {
            events.push({
              kind: 'tool',
              callId,
              name,
              args: parseArgs(item.arguments),
            });
          }
          continue;
        }
        const said = readSaidText(item);
        if (said) events.push({ kind: 'reply', text: said });
      }

      events.push({ kind: 'response-done' });
      return events;
    }

    case 'error': {
      const detail = asObject(event.error);
      return [
        {
          kind: 'error',
          message:
            typeof detail.message === 'string' && detail.message
              ? detail.message
              : 'The live session hit an error.',
        },
      ];
    }

    default:
      return [{ kind: 'ignored' }];
  }
};

/**
 * What the agent actually said, whichever modality it said it in.
 *
 * A spoken reply arrives as an audio part with a transcript beside it; a typed
 * one arrives as text. The page shows the sentence either way — the board is
 * the rest of the answer, and the note above it is not optional just because
 * the answer happened to be audible.
 */
const readSaidText = (item: Record<string, unknown>): string => {
  const content = Array.isArray(item.content) ? item.content : [];
  const parts: string[] = [];
  for (const entry of content) {
    const part = asObject(entry);
    const value =
      typeof part.text === 'string'
        ? part.text
        : typeof part.transcript === 'string'
          ? part.transcript
          : '';
    if (value.trim()) parts.push(value.trim());
  }
  return parts.join(' ').trim();
};

/**
 * Tools that only read the page can run at once; anything that changes what is
 * on screen keeps its turn.
 *
 * Same rule as the typed loop, and for the same reason: two `set_results` in
 * flight leave the board showing whichever returned last rather than what was
 * asked for. Passed in rather than imported so this module stays free of the
 * tool registry.
 */
export const partitionCalls = <T extends { name: string }>(
  calls: T[],
  isReadOnly: (name: string) => boolean
): { reads: T[]; writes: T[] } => ({
  reads: calls.filter((call) => isReadOnly(call.name)),
  writes: calls.filter((call) => !isReadOnly(call.name)),
});
