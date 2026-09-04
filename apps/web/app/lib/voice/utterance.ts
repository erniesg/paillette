/**
 * One field, two inputs.
 *
 * There is no voice mode. There is a text field, and speech is a second way of
 * getting characters into it. Every rule here exists to keep that true:
 * the recogniser *extends* what is already there, it never replaces it, and the
 * text the human can see and edit is always the thing that will be sent.
 */

/** How long a released utterance sits, visibly, before it commits. */
export const GRACE_MS = 1200;

/**
 * How long release will wait for a transcript that has not arrived yet before
 * concluding nothing was said. Bounded on purpose: an open-ended wait lets a
 * stray result turn up minutes later and start a countdown nobody expects.
 */
export const FLUSH_GRACE_MS = 700;

const endsOpen = (text: string) => /[\s([{“"'\-—]$/.test(text);
const startsClosed = (interim: string) => /^[\s,.;:!?)\]}]/.test(interim);

/**
 * What the field shows: the text the human owns, plus the words currently being
 * heard. Joined with a single space, because the recogniser hands back a bare
 * phrase with no leading whitespace and "warm landscapewithout people" is the
 * kind of detail that makes a demo look broken.
 */
export const composeUtterance = (committed: string, interim: string): string => {
  if (!interim) return committed;
  if (!committed) return interim;
  if (endsOpen(committed) || startsClosed(interim)) return committed + interim;
  return `${committed} ${interim}`;
};

/**
 * Where the spoken half begins inside the composed string. The field renders
 * everything before this at full contrast and everything after it dimmed, so
 * "provisional" is a visible property of the words rather than a badge next to
 * them.
 */
export const interimOffset = (committed: string, interim: string): number =>
  composeUtterance(committed, interim).length - interim.length;

/**
 * A spoken turn ends when the recogniser settles *or* when the human lets go,
 * whichever happens first — some builds return only interim results for a short
 * press, and dropping those would lose words the human watched appear.
 */
export const settleUtterance = (
  committed: string,
  final: string,
  interim: string
): string => composeUtterance(committed, final || interim);

/**
 * The grace bar's fill, 0 → 1. Driven from timestamps rather than a CSS
 * animation so that the same number can be asserted in a test and read by
 * someone who has asked their machine for less motion.
 */
export const graceProgress = (
  startedAt: number,
  now: number,
  duration = GRACE_MS
): number => {
  if (duration <= 0) return 1;
  const elapsed = (now - startedAt) / duration;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return elapsed > 1 ? 1 : elapsed;
};
