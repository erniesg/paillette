import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSpeechRecognition,
  isQuietRecognitionError,
  readTranscripts,
  voiceErrorMessage,
  type SpeechRecognitionLike,
} from '~/lib/voice/recognition';
import {
  FLUSH_GRACE_MS,
  GRACE_MS,
  composeUtterance,
  graceProgress,
  interimOffset,
} from '~/lib/voice/utterance';
import {
  annotateForAgent,
  emptyResolution,
  readScene,
  resolveDeixis,
  segmentUtterance,
  type Referent,
  type Resolution,
} from '~/lib/voice/deixis';
import {
  createSpeechChannel,
  shouldSpeakReply,
  type SpeechChannel,
  type TurnChannel,
} from '~/lib/voice/speech-channel';
import { getWebMcpState } from '~/lib/webmcp/store';

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
  | { kind: 'you'; text: string; referents: Referent[] }
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'error'; text: string };

/**
 * What "this one" turned out to mean, drawn as the thumbnail inline — a
 * sentence with pictures in it.
 *
 * Pure presentation. `hovered` and `selection` reach the agent through
 * `get_view_context` whether or not any of this renders, so a chip that fails
 * to draw costs a picture and nothing else.
 */
function ReferentChip({ referent }: { referent: Referent }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded border border-primary-500/40 bg-primary-500/10 px-1 py-px align-middle">
      {referent.works.slice(0, 3).map((work) =>
        work.thumbnailUrl ? (
          <img
            key={work.id}
            src={work.thumbnailUrl}
            alt=""
            aria-hidden="true"
            className="h-4 w-4 rounded-sm object-cover"
          />
        ) : null
      )}
      <span className="text-primary-200">
        {referent.works.length === 1
          ? (referent.works[0]?.title ?? referent.phrase)
          : `${referent.works.length} works`}
      </span>
    </span>
  );
}

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
  /**
   * When the released utterance started its countdown, or null when nothing is
   * pending. Restarted if late words arrive, so the 1.2 s always runs from the
   * last time the sentence changed.
   */
  const [graceStartedAt, setGraceStartedAt] = useState<number | null>(null);
  const [graceFill, setGraceFill] = useState(0);
  /**
   * A spoken utterance is sitting in the field, uncommitted. Outlives the
   * countdown: touching the field stops the clock but the words are still
   * waiting on Enter or Esc.
   */
  const [pendingVoice, setPendingVoice] = useState(false);
  /**
   * What the deictic words in the pending utterance turned out to mean. Shown
   * while the countdown runs, so a wrong referent is something the human can
   * see and stop rather than something they find out about from the board.
   */
  const [resolution, setResolution] = useState<Resolution>(emptyResolution());
  const historyRef = useRef<AgentMessage[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** True between press and release, so a stop we caused reads as deliberate. */
  const holdingRef = useRef(false);
  /** The field as it stood before this utterance, for Esc to restore. */
  const beforeUtteranceRef = useRef('');
  /** Set once per render to a closure over the current text. See the effect. */
  const commitRef = useRef<() => void>(() => {});
  /** The composed field, readable from recogniser callbacks. */
  const composedRef = useRef('');
  /** Released with nothing heard yet, briefly waiting for a late transcript. */
  const awaitingFlushRef = useRef(false);
  /** `pendingVoice`, readable from the window key handler. */
  const pendingVoiceRef = useRef(false);
  /** The page's voice, or null where the browser has none. */
  const speechRef = useRef<SpeechChannel | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  /** How far the input has scrolled its own text, for the mirror to match. */
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    setAvailable(Boolean(getModelContext()));
  }, []);

  useEffect(() => {
    speechRef.current = createSpeechChannel();
    // Interruptible, and cheaply: a click anywhere is somebody's attention
    // moving on, and a note that keeps talking through that is a note nobody
    // asked for. Cancelling is a no-op unless this component is the speaker.
    const interrupt = () => speechRef.current?.cancel();
    document.addEventListener('pointerdown', interrupt, true);
    return () => {
      document.removeEventListener('pointerdown', interrupt, true);
      interrupt();
    };
  }, []);

  /**
   * Bind the pointing words in an utterance to what is on screen.
   *
   * Reads the shared WebMCP store rather than calling `get_view_context`: the
   * same data, but synchronous — so the chip is on screen the instant the human
   * lets go — and with thumbnails, which the tool's summary drops.
   */
  const resolveAgainstScreen = useCallback(
    (text: string): Resolution => {
      try {
        return resolveDeixis(text, readScene(getWebMcpState()));
      } catch {
        // Deixis is a courtesy. The turn is worth more than the chip.
        return emptyResolution();
      }
    },
    []
  );

  const run = useCallback(async (
    instruction: string,
    pointing: Resolution,
    channel: TurnChannel
  ) => {
    setBusy(true);
    setEntries((current) => [
      ...current,
      { kind: 'you', text: instruction, referents: pointing.referents },
    ]);
    historyRef.current = [
      ...historyRef.current,
      // The human's sentence goes up verbatim, with the bindings appended
      // underneath. Rewriting someone's words and then acting on the rewrite is
      // how an agent ends up confidently answering a question nobody asked.
      { role: 'user', content: annotateForAgent(instruction, pointing) },
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
            // The note is always shown. Whether it is also *heard* depends on
            // one thing: how the human's last turn arrived. Text in, text out;
            // voice in, voice out. That single rule is what makes typing and
            // talking feel like one conversation, and it needs nothing as
            // heavy as a manager deciding whose go it is.
            if (shouldSpeakReply(channel)) speechRef.current?.speak(said);
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

  const cancelGrace = useCallback(() => {
    setGraceStartedAt(null);
    setGraceFill(0);
  }, []);

  /**
   * Hold to talk. Not an open mic: a page that is always listening is a page
   * you have to remember is listening, and the whole point of the grace bar
   * below is that the human can see the exact moment the agent is about to act.
   */
  const startListening = useCallback(() => {
    if (holdingRef.current || busy) return;
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    // Talking over the human is the one thing a voice interface cannot do.
    speechRef.current?.cancel();
    cancelGrace();
    awaitingFlushRef.current = false;
    holdingRef.current = true;

    const recognition = new Recognition();
    recognition.lang = 'en-GB';
    recognition.interimResults = true;
    // The human decides where the sentence ends, not the recogniser's silence
    // detector. With `continuous = false` a pause mid-thought ends the turn and
    // the second half of "something warm… for above the sofa" is simply lost.
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const { final, interim: live } = readTranscripts(event);
      if (final) {
        // Settled words graduate into the text the human owns, at full
        // contrast.
        setInput((current) => composeUtterance(current, final));
        setInterim('');
        // Release can beat the recogniser's flush by a few hundred
        // milliseconds. If it did, the countdown starts here instead, so a
        // sentence that arrived late still gets its 1.2 s rather than sitting
        // in the field waiting for an Enter nobody knows to press.
        if (awaitingFlushRef.current) {
          awaitingFlushRef.current = false;
          setPendingVoice(true);
          setGraceFill(0);
          setGraceStartedAt(Date.now());
          return;
        }
        // And if it arrived during the countdown, the countdown restarts —
        // nobody should be asked to react to a sentence that changed under
        // them.
        setGraceStartedAt((current) => (current === null ? null : Date.now()));
        return;
      }
      setInterim(live);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      if (isQuietRecognitionError(event.error)) return;
      setListening(false);
      setInterim('');
      setEntries((current) => [
        ...current,
        { kind: 'error', text: voiceErrorMessage(event.error) },
      ]);
    };

    recognitionRef.current = recognition;
    beforeUtteranceRef.current = input;
    setListening(true);
    recognition.start();
  }, [busy, cancelGrace, input]);

  /**
   * Releasing does not send. It starts a countdown the human can watch, and
   * interrupt. That determinism is the feature — nothing here is clever about
   * guessing whether someone had finished talking.
   */
  const stopListening = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setListening(false);
    try {
      recognitionRef.current?.stop();
    } catch {
      // A recogniser that was never really started does not need stopping.
    }

    // Nothing heard yet: an accidental tap should not put a countdown on
    // screen. Wait briefly for a late flush, then give up — an open-ended wait
    // would let a stray transcript arrive minutes later and start sending.
    if (!composedRef.current.trim()) {
      awaitingFlushRef.current = true;
      setTimeout(() => {
        awaitingFlushRef.current = false;
      }, FLUSH_GRACE_MS);
      return;
    }

    setPendingVoice(true);
    setGraceStartedAt(Date.now());
    setGraceFill(0);
  }, []);

  /** Esc: the utterance never happened. The field goes back to what it held. */
  const discardUtterance = useCallback(() => {
    cancelGrace();
    setPendingVoice(false);
    setResolution(emptyResolution());
    setInterim('');
    setInput(beforeUtteranceRef.current);
  }, [cancelGrace]);

  const submit = useCallback(
    (text: string) => {
      cancelGrace();
      setPendingVoice(false);
      setResolution(emptyResolution());
      const instruction = text.trim();
      setInput('');
      setInterim('');
      beforeUtteranceRef.current = '';
      if (!instruction || busy) return;
      // A turn counts as spoken if the mic put words into it. Correcting the
      // transcript by hand before sending does not demote it: the sentence
      // started in someone's mouth, so the reply belongs in their ears.
      void run(
        instruction,
        resolveAgainstScreen(instruction),
        pendingVoice ? 'voice' : 'text'
      );
    },
    [busy, cancelGrace, pendingVoice, resolveAgainstScreen, run]
  );

  // Words arriving from the recogniser scroll the input without a scroll event
  // that React sees, so the offset is re-read whenever the text changes.
  useEffect(() => {
    setScrollLeft(fieldRef.current?.scrollLeft ?? 0);
  }, [input, interim]);

  // Re-pointed every render so the countdown below always commits the sentence
  // as it stands now, not as it stood when the timer was armed.
  composedRef.current = composeUtterance(input, interim);
  commitRef.current = () => submit(composedRef.current);
  pendingVoiceRef.current = pendingVoice;

  // While an utterance is waiting, keep the chips in step with the words —
  // including words the human retypes, which is the whole point of being able
  // to edit during the grace.
  useEffect(() => {
    if (!pendingVoice) return;
    setResolution(resolveAgainstScreen(composeUtterance(input, interim)));
  }, [input, interim, pendingVoice, resolveAgainstScreen]);

  useEffect(() => {
    if (graceStartedAt === null) return undefined;

    const timer = setTimeout(() => commitRef.current(), GRACE_MS);
    // The bar is a readout of that timer, not decoration, so it is driven from
    // the clock rather than a CSS animation — there is nothing to switch off
    // under prefers-reduced-motion, and the same number is assertable.
    let frame = 0;
    const tick = () => {
      setGraceFill(graceProgress(graceStartedAt, Date.now()));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [graceStartedAt]);

  /**
   * Hold Space anywhere on the page to talk — the same single-key grammar the
   * grid uses for flagging. It cannot fire while someone is typing, because a
   * field with focus needs the space bar for spaces; there is no ambiguity to
   * resolve, and therefore no mode to be in.
   */
  useEffect(() => {
    const editable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };
    const held = (event: KeyboardEvent) =>
      event.code === 'Space' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !editable(event.target);

    const down = (event: KeyboardEvent) => {
      // Esc has to reach a pending utterance wherever focus happens to be.
      // Releasing the mic does not move focus into the field, so requiring a
      // click first would mean the advertised way out did not work from the
      // state the human is actually in. Not prevented: if something else on the
      // page also treats Esc as "get me out of this", both are right.
      if (event.key === 'Escape') {
        if (pendingVoiceRef.current) discardUtterance();
        return;
      }
      if (!held(event)) return;
      // Space scrolls, and a page that jumps every time you speak is unusable.
      event.preventDefault();
      if (event.repeat) return;
      startListening();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      stopListening();
    };
    // A key-up lost to a focus change must not leave the mic open.
    const release = () => stopListening();

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [discardUtterance, startListening, stopListening]);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Unmounting is not a good moment to care.
      }
    },
    []
  );

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
          submit(composed);
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
              {/*
                Shifted by the input's own scroll offset. Say a whole sentence
                and the input scrolls its text left; a mirror that stayed put
                would come apart exactly when someone is speaking at length,
                which is the shot.
              */}
              <span
                className="flex"
                style={{ transform: `translateX(${-scrollLeft}px)` }}
              >
                <span className="text-white">
                  {composed.slice(0, settledLength)}
                </span>
                <span className="text-neutral-500">{interim}</span>
              </span>
            </div>
          )}
          <input
            ref={fieldRef}
            onScroll={(event) =>
              setScrollLeft((event.target as HTMLInputElement).scrollLeft)
            }
            value={composed}
            onChange={(event) => {
              // Typing takes ownership of every word in the field, spoken ones
              // included. Text is the ground truth.
              setInput(event.target.value);
              setInterim('');
              cancelGrace();
            }}
            // Reaching for the field is a request to edit, so the countdown
            // stops and waits rather than sending out from under the cursor.
            onFocus={cancelGrace}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && pendingVoice) {
                event.preventDefault();
                discardUtterance();
              }
            }}
            placeholder={placeholder}
            aria-label="Ask the agent"
            disabled={busy}
            className={`w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none ${
              interim ? 'text-transparent caret-white' : 'text-white'
            }`}
          />
          {/*
            The grace bar: a thin line under the field, draining left to right,
            after which the utterance commits. It is the only promise this
            component makes — that you can always see when the agent is about
            to act — so it is deliberately dumb.
          */}
          {graceStartedAt !== null && (
            <div
              role="progressbar"
              aria-label="Sending in a moment"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(graceFill * 100)}
              className="pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 overflow-hidden rounded-full bg-neutral-800"
            >
              <div
                className="h-full bg-primary-400"
                style={{ width: `${graceFill * 100}%` }}
              />
            </div>
          )}
        </div>
        {micSupported && (
          <button
            type="button"
            // Push-to-talk. Pointer events rather than click, so the control is
            // held; the keyboard equivalent is Space or Enter held on the
            // focused button, because a hold-only control cannot be reached
            // without a pointer.
            onPointerDown={(event) => {
              event.preventDefault();
              startListening();
            }}
            onPointerUp={stopListening}
            onPointerLeave={stopListening}
            onPointerCancel={stopListening}
            onKeyDown={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              if (event.repeat) return;
              startListening();
            }}
            onKeyUp={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              stopListening();
            }}
            onBlur={stopListening}
            disabled={busy}
            aria-pressed={listening}
            aria-label={listening ? 'Listening — release to send' : 'Hold to speak'}
            className={`shrink-0 select-none rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
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

      {/*
        The bar says how long is left; this says what to do about it. Someone
        who cannot see a two-pixel line draining still gets the whole contract
        in words, which is the part that has to survive.
      */}
      {pendingVoice && (
        <>
          {/*
            What the pointing words resolved to, while there is still time to
            stop it. A referent bound to the wrong painting has to be visible
            here, or the first anyone knows of it is a board full of the wrong
            answer.
          */}
          {resolution.referents.length > 0 && (
            <p className="mt-2 text-xs text-neutral-400">
              {resolution.referents.map((referent, index) => (
                <span key={`${referent.start}-${index}`} className="mr-2">
                  <span className="text-neutral-600">
                    “{referent.phrase}” ={' '}
                  </span>
                  <ReferentChip referent={referent} />
                </span>
              ))}
            </p>
          )}
          {resolution.unresolved.map((gap, index) => (
            <p
              key={`${gap.start}-${index}`}
              className="mt-1 text-xs text-amber-300/80"
            >
              Could not tell what “{gap.phrase}” means — {gap.reason}.
            </p>
          ))}
          <p aria-live="polite" className="mt-2 text-xs text-neutral-500">
            {graceStartedAt !== null
              ? 'Sending in a moment — click in to edit, Enter to send now, Esc to discard.'
              : 'Waiting on you — Enter to send, Esc to discard.'}
          </p>
        </>
      )}
      {micSupported && !pendingVoice && !listening && (
        <p className="mt-2 text-xs text-neutral-600">
          Hold the mic, or hold Space, to talk.
        </p>
      )}

      {entries.length > 0 && (
        <ol className="mt-4 space-y-2 text-sm">
          {entries.map((entry, index) => (
            <li key={index}>
              {entry.kind === 'you' && (
                <p className="text-neutral-300">
                  <span className="mr-2 text-xs uppercase tracking-wider text-neutral-600">
                    you
                  </span>
                  {segmentUtterance(entry.text, entry.referents).map(
                    (segment, at) =>
                      segment.kind === 'text' ? (
                        <span key={at}>{segment.text}</span>
                      ) : (
                        <ReferentChip key={at} referent={segment.referent} />
                      )
                  )}
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
