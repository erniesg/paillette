/**
 * The symmetric channel rule: text in, text out — voice in, voice out.
 *
 * The agent writes a note every turn and it is always displayed. Whether it is
 * also *spoken* depends on one thing: how the human's last turn arrived. Type
 * and you read the reply; speak and you hear it. That single rule is what makes
 * the two inputs feel like one conversation without anything as heavy as a
 * conversation manager deciding when it is the agent's go.
 *
 * It also fails in the right direction. Nobody who has never touched the mic can
 * be surprised by sound, and nobody talking to the page has to keep looking at
 * it to find out what happened.
 */

export type TurnChannel = 'text' | 'voice';

/**
 * A turn counts as spoken if the mic put any words into it. Editing a
 * transcript by hand before sending does not demote it: the human's mouth
 * started the sentence, so the reply belongs in their ears.
 */
export const shouldSpeakReply = (lastTurn: TurnChannel | null): boolean =>
  lastTurn === 'voice';

const SENTENCE_END = /[.!?…](?:["'”’)\]]+)?(?:\s|$)/;

/**
 * One sentence, never more. The board is the rest of the answer, and a
 * paragraph read aloud over a grid of paintings is a podcast played at someone
 * who is trying to look at something.
 */
export const firstSentence = (text: string, maxLength = 220): string => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const match = SENTENCE_END.exec(trimmed);
  const sentence = match
    ? trimmed.slice(0, match.index + match[0].trimEnd().length)
    : trimmed;

  if (sentence.length <= maxLength) return sentence;

  // Long single sentence: cut at the last word boundary rather than mid-word,
  // and mark it, because a clause that stops dead sounds like a crash.
  const clipped = sentence.slice(0, maxLength);
  const boundary = clipped.lastIndexOf(' ');
  return `${(boundary > 0 ? clipped.slice(0, boundary) : clipped).trimEnd()}…`;
};

export interface SpeechChannel {
  /** Speaks one sentence. A no-op if something else already has the voice. */
  speak: (text: string) => void;
  /** Stops anything this channel started. Leaves other speakers alone. */
  cancel: () => void;
}

type SynthesisWindow = Window & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

/**
 * Returns null where the browser cannot speak, so the caller renders and
 * behaves identically minus the sound rather than guarding every call site.
 */
export const createSpeechChannel = (): SpeechChannel | null => {
  if (typeof window === 'undefined') return null;
  const holder = window as SynthesisWindow;
  const synthesis = holder.speechSynthesis;
  const Utterance = holder.SpeechSynthesisUtterance;
  if (!synthesis || typeof Utterance !== 'function') return null;

  let mine: SpeechSynthesisUtterance | null = null;

  const cancel = () => {
    if (!mine) return;
    mine = null;
    synthesis.cancel();
  };

  return {
    speak: (text: string) => {
      const sentence = firstSentence(text);
      if (!sentence) return;

      // A caption read-aloud is a button someone pressed on purpose. It
      // outranks a note the agent volunteered, so this waits rather than
      // cancelling into it — the two would otherwise talk over each other with
      // no way for the listener to tell which is which.
      if (!mine && (synthesis.speaking || synthesis.pending)) return;

      cancel();
      const utterance = new Utterance(sentence);
      utterance.rate = 0.96;
      utterance.onend = () => {
        if (utterance === mine) mine = null;
      };
      utterance.onerror = () => {
        if (utterance === mine) mine = null;
      };
      mine = utterance;
      synthesis.speak(utterance);
    },
    cancel,
  };
};
