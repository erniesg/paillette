import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSpeechRecognition,
  readTranscripts,
  voiceErrorMessage,
  type SpeechRecognitionLike,
} from '~/lib/voice/recognition';
import { composeUtterance, interimOffset } from '~/lib/voice/utterance';

/**
 * An agent, in the page, for visitors who did not bring one.
 *
 * WebMCP's premise is that *your* agent drives *this* page. That is the real
 * deployment, and nothing here replaces it — this component talks to
 * `document.modelContext` exactly as an external host would, through the tools
 * the page already registered. It exists because a visitor without a
 * WebMCP-capable browser otherwise sees a search box and never learns the tools
 * are there.
 *
 * The loop is deliberately split: the model runs server-side (the key is a
 * Worker secret) and decides, and every tool call it returns is executed *here*,
 * against this document. The server never touches the page.
 *
 * Conversational on purpose. "Something calm for a living room" then "warmer"
 * is the interaction worth showing — the refinement is where an agent earns its
 * place, and each turn re-reads what is currently on screen.
 */

type ToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

/** What the human sees: their turns, and what the agent did about them. */
type Entry =
  | { kind: 'you'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'error'; text: string };

const MAX_TURNS = 8;

type ModelContextLike = {
  getTools: () => Promise<
    Array<{ name: string; description?: string; inputSchema?: unknown }>
  >;
};

const getModelContext = (): ModelContextLike | null => {
  if (typeof document === 'undefined') return null;
  const holder = document as Document & { modelContext?: ModelContextLike };
  return holder.modelContext ?? null;
};

/**
 * Runs a tool the way a host does. Prefers the debug harness when present
 * because it enforces the same `AbortSignal` contract; otherwise it invokes the
 * registered tool directly.
 */
const callTool = async (name: string, args: Record<string, unknown>) => {
  const harness = (
    window as Window & {
      __paillette_webmcp?: {
        call: (n: string, i: Record<string, unknown>) => Promise<unknown>;
      };
    }
  ).__paillette_webmcp;
  if (harness) return harness.call(name, args);

  const context = getModelContext();
  const tools = (await context?.getTools?.()) ?? [];
  const tool = tools.find((candidate) => candidate.name === name) as
    | { execute?: (i: unknown, o: { signal: AbortSignal }) => Promise<unknown> }
    | undefined;
  if (!tool?.execute) throw new Error(`No tool "${name}" on this page.`);
  return tool.execute(args, { signal: new AbortController().signal });
};

export function AgentPrompt({
  placeholder = 'Ask for what you want to see…',
  className = '',
}: {
  placeholder?: string;
  className?: string;
}) {
  const [available, setAvailable] = useState(false);
  /** The text the human owns. Ground truth: this is what gets sent. */
  const [input, setInput] = useState('');
  /** Words currently being heard. Provisional, and rendered as such. */
  const [interim, setInterim] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const historyRef = useRef<AgentMessage[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setAvailable(Boolean(getModelContext()));
  }, []);

  const run = useCallback(async (instruction: string) => {
    setBusy(true);
    setEntries((current) => [...current, { kind: 'you', text: instruction }]);
    historyRef.current = [
      ...historyRef.current,
      { role: 'user', content: instruction },
    ];

    try {
      const context = getModelContext();
      const registered = (await context?.getTools?.()) ?? [];
      // The page's own schemas become the model's function definitions; nothing
      // about the tool surface is duplicated here.
      const tools = registered.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const response = await fetch('/api/public-agent/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: historyRef.current, tools }),
        });
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { message: AgentMessage };
          error?: { message?: string };
        };
        if (!response.ok || !payload.success || !payload.data) {
          setEntries((current) => [
            ...current,
            {
              kind: 'error',
              text: payload.error?.message ?? 'The agent could not continue.',
            },
          ]);
          return;
        }

        const message = payload.data.message;
        historyRef.current = [...historyRef.current, message];

        const calls = message.tool_calls ?? [];
        if (calls.length === 0) {
          const said = (message.content ?? '').trim();
          if (said) {
            setEntries((current) => [...current, { kind: 'agent', text: said }]);
          }
          return;
        }

        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            // Let the tool reject malformed arguments and say why.
          }
          setEntries((current) => [
            ...current,
            { kind: 'tool', name: call.function.name },
          ]);

          let result: unknown;
          try {
            result = await callTool(call.function.name, args);
          } catch (error) {
            result = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
          historyRef.current = [
            ...historyRef.current,
            {
              role: 'tool',
              tool_call_id: call.id,
              // The model needs the shape and the ids, not thirty full records.
              content: JSON.stringify(result).slice(0, 4000),
            },
          ];
        }
      }
    } catch (error) {
      setEntries((current) => [
        ...current,
        {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleMic = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'en-GB';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const { final, interim: live } = readTranscripts(event);

      // A settled result is the goal; the interim text was just so the words
      // appear on camera while the person is still speaking.
      if (final) {
        setInterim('');
        setInput('');
        void run(final);
        return;
      }
      if (live) setInterim(live);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      setInterim('');
      setEntries((current) => [
        ...current,
        { kind: 'error', text: voiceErrorMessage(event.error) },
      ]);
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening, run]);

  // Nothing to offer where the page never registered its tools.
  if (!available) return null;

  const micSupported = getSpeechRecognition() !== null;
  // One string, two contrasts: what the human owns, then what is still being
  // heard. Both live in the same field because there is only one field.
  const composed = composeUtterance(input, interim);
  const settledLength = interimOffset(input, interim);

  return (
    <section
      aria-label="Ask the agent"
      className={`rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 ${className}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const instruction = composed.trim();
          if (!instruction || busy) return;
          setInput('');
          setInterim('');
          void run(instruction);
        }}
        className="flex items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          {/*
            A mirror under a transparent input, so provisional words can be a
            different colour from settled ones inside a single field. The
            alternative — a second box for the transcript — would reintroduce
            the mode switch this whole design exists to remove. Metrics are
            copied from the input exactly, transparent border included, and if
            they ever drifted the failure would be cosmetic: the value is
            unaffected.
          */}
          {interim && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre rounded-lg border border-transparent px-3 py-2 text-sm"
            >
              <span className="text-white">
                {composed.slice(0, settledLength)}
              </span>
              <span className="text-neutral-500">{interim}</span>
            </div>
          )}
          <input
            value={composed}
            onChange={(event) => {
              // Typing takes ownership of every word in the field, spoken ones
              // included. Text is the ground truth.
              setInput(event.target.value);
              setInterim('');
            }}
            placeholder={placeholder}
            aria-label="Ask the agent"
            disabled={busy}
            className={`w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none ${
              interim ? 'text-transparent caret-white' : 'text-white'
            }`}
          />
        </div>
        {micSupported && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? 'Stop listening' : 'Speak your request'}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm transition-colors ${
              listening
                ? 'border-primary-400 bg-primary-500/15 text-primary-200'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {listening ? (
              <span className="flex items-center gap-1.5">
                {/*
                  The word carries the meaning; the pulse only makes it easier
                  to catch out of the corner of an eye. Someone who has asked
                  for less motion gets a steady dot and loses nothing.
                */}
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary-300 motion-reduce:animate-none" />
                listening
              </span>
            ) : (
              '🎤'
            )}
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !composed.trim()}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-500 disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Ask'}
        </button>
      </form>

      {entries.length > 0 && (
        <ol className="mt-4 space-y-2 text-sm">
          {entries.map((entry, index) => (
            <li key={index}>
              {entry.kind === 'you' && (
                <p className="text-neutral-300">
                  <span className="mr-2 text-xs uppercase tracking-wider text-neutral-600">
                    you
                  </span>
                  {entry.text}
                </p>
              )}
              {entry.kind === 'tool' && (
                <p className="font-mono text-xs text-primary-300">
                  → {entry.name}
                </p>
              )}
              {entry.kind === 'agent' && (
                <p className="text-neutral-400">{entry.text}</p>
              )}
              {entry.kind === 'error' && (
                <p role="alert" className="text-red-300">
                  {entry.text}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
