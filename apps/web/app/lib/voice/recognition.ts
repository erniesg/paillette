/**
 * The browser's speech recogniser, narrowed to the parts this app uses.
 *
 * `SpeechRecognition` is not in the DOM lib and is prefixed everywhere that
 * ships it, so the types live here rather than being re-declared at each call
 * site. Everything below is pure: no component, no state, nothing that needs a
 * DOM to test. The component owns *when* to listen; this owns *what the words
 * mean when they arrive*.
 */

/** A single recognition alternative, per the (non-standard) web speech shape. */
export type RecognitionAlternative = { transcript: string };

/** One result in `SpeechRecognitionResultList`; `isFinal` marks a settled one. */
export type RecognitionResult = ArrayLike<RecognitionAlternative> & {
  isFinal: boolean;
};

export type RecognitionEvent = { results: ArrayLike<RecognitionResult> };

/** The `onerror` payload carries a machine-readable reason string. */
export type RecognitionError = { error: string };

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

type RecognitionWindow = Window & {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

/**
 * The constructor, or null where the browser has none. Feature-detected rather
 * than sniffed: Firefox has no recogniser at all and must get an identical page
 * minus the mic, not a button that throws.
 */
export const getSpeechRecognition = (): RecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const holder = window as RecognitionWindow;
  const found = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
  return typeof found === 'function'
    ? (found as RecognitionConstructor)
    : null;
};

/**
 * Split a result list into what has settled and what is still moving.
 *
 * The recogniser re-sends the whole list every event, so both halves are
 * rebuilt from scratch each time rather than accumulated.
 */
export const readTranscripts = (
  event: RecognitionEvent
): { final: string; interim: string } => {
  let final = '';
  let interim = '';
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result) continue;
    const transcript = result[0]?.transcript ?? '';
    if (result.isFinal) final += transcript;
    else interim += transcript;
  }
  return { final: final.trim(), interim: interim.trim() };
};

export const voiceErrorMessage = (error: string): string => {
  switch (error) {
    case 'not-allowed':
      return 'Microphone access was denied. Allow it in your browser, then try again.';
    case 'no-speech':
      return 'No speech was heard. Try again.';
    default:
      return 'Voice input stopped. Try again.';
  }
};

/**
 * `aborted` is what releasing the control raises in some builds — the human
 * caused it on purpose, so reporting it back to them is noise. Everything else,
 * including `no-speech`, is worth saying out loud: a mic that heard nothing
 * looks identical to a mic that is broken.
 */
export const isQuietRecognitionError = (error: string): boolean =>
  error === 'aborted';
