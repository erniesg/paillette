import { useCallback, useEffect, useRef, useState } from 'react';

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

/** A single recognition alternative, per the (non-standard) web speech shape. */
type RecognitionAlternative = { transcript: string };

/** One result in `SpeechRecognitionResultList`; `isFinal` marks a settled one. */
type RecognitionResult = ArrayLike<RecognitionAlternative> & {
  isFinal: boolean;
};

/** The `onerror` payload carries a machine-readable reason string. */
type RecognitionError = { error: string };

const voiceErrorMessage = (error: string): string => {
  switch (error) {
    case 'not-allowed':
      return 'Microphone access was denied. Allow it in your browser, then try again.';
    case 'no-speech':
      return 'No speech was heard. Try again.';
    default:
      return 'Voice input stopped. Try again.';
  }
};

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
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const historyRef = useRef<AgentMessage[]>([]);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(
    null
  );

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
    const holder = window as Window & {
      webkitSpeechRecognition?: new () => never;
      SpeechRecognition?: new () => never;
    };
    const Recognition = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
    if (!Recognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new Recognition() as unknown as {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: (event: { results: ArrayLike<RecognitionResult> }) => void;
      onend: () => void;
      onerror: (event: RecognitionError) => void;
      start: () => void;
      stop: () => void;
    };
    recognition.lang = 'en-GB';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interim = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalTranscript += transcript;
        else interim += transcript;
      }

      // A settled result is the goal; the interim text was just so the words
      // appear on camera while the person is still speaking.
      const settled = finalTranscript.trim();
      if (settled) {
        setInput('');
        void run(settled);
        return;
      }

      const live = interim.trim();
      if (live) setInput(live);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
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

  const micSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as Window & { webkitSpeechRecognition?: unknown })
        .webkitSpeechRecognition ??
        (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition
    );

  return (
    <section
      aria-label="Ask the agent"
      className={`rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 ${className}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const instruction = input.trim();
          if (!instruction || busy) return;
          setInput('');
          void run(instruction);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder}
          aria-label="Ask the agent"
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none"
        />
        {micSupported && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? 'Stop listening' : 'Speak your request'}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              listening
                ? 'border-primary-400 bg-primary-500/15 text-primary-200'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {listening ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary-300" />
                listening
              </span>
            ) : (
              '🎤'
            )}
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !input.trim()}
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
