/**
 * Lightroom's keys, on a museum catalogue.
 *
 * `P` pick, `X` reject, `U` unflag, `C` compare — the exact bindings a
 * photographer has had in their fingers since 2007, doing the exact job they
 * have always done: culling. Nothing is invented here, which is the point.
 * The paradigm is borrowed whole and pointed at 63,253 works instead of a
 * card full of raw files. Shift-click and `Esc` are the other borrowed pair:
 * they have meant "and this one" and "never mind" since the Finder.
 *
 * And **Enter on an empty prompt bar redeals**, with no model call anywhere in
 * the path. That single binding is the argument the whole submission rests on:
 * the mechanism works with one operator or two, so the agent is a collaborator
 * on a real workspace rather than the thing that makes the workspace go.
 *
 * Installed from the results grid rather than the prompt bar, so it is one
 * page-level keyboard contract instead of two that have to agree.
 */

import { toggleFlag } from './flags';
import { clearSelection } from './selection';
import { getWebMcpState, setCompare } from './store';
import { submitHumanTurn, type HumanTurnOutcome } from './turn';

/**
 * The utterance bar, identified by its accessible name.
 *
 * Deliberately a semantic selector rather than a test id: the name is what a
 * screen reader announces, so it is the one attribute that cannot quietly
 * change without someone noticing. `[data-utterance-bar]` is honoured too, as
 * the explicit opt-in for whoever owns that component next.
 */
export const UTTERANCE_BAR_SELECTOR =
  '[data-utterance-bar], input[aria-label="Ask the agent"]';

const isTextEntry = (element: Element | null): element is HTMLElement =>
  Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        (element as HTMLElement).isContentEditable)
  );

export const isEmptyUtteranceBar = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (!target.matches(UTTERANCE_BAR_SELECTOR)) return false;
  const value = (target as HTMLInputElement).value ?? '';
  return value.trim().length === 0;
};

export interface BoardKeyboardOptions {
  /** Reports every redeal the keyboard triggers, for surfacing failures. */
  onTurn?: (outcome: HumanTurnOutcome) => void;
  onError?: (error: unknown) => void;
}

/**
 * The whole binding table, exported so it can be exercised without a DOM
 * event and so the help text and the behaviour cannot drift apart.
 */
export const handleBoardKey = (
  event: KeyboardEvent,
  options: BoardKeyboardOptions = {}
): boolean => {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  // Enter on an empty utterance bar: the beat. Nothing typed means the flags
  // are the whole instruction, so run the deterministic deal and never reach
  // the model. The prompt bar already ignores an empty submit, so preventing
  // the default here cannot race with it.
  if (event.key === 'Enter' && isEmptyUtteranceBar(event.target)) {
    event.preventDefault();
    void submitHumanTurn()
      .then((outcome) => options.onTurn?.(outcome))
      .catch((error) => options.onError?.(error));
    return true;
  }

  // Escape is the way out of a text field and into the board. Without it the
  // culling keys are unreachable for as long as a caret is parked somewhere,
  // and "click on the background first" is not a thing anyone should have to
  // be told. Conventional enough to need no explaining: Escape has meant
  // "never mind" in every text field since there were text fields.
  if (event.key === 'Escape' && isTextEntry(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
    return true;
  }

  // Every other binding is a bare letter, so it must not fire while someone is
  // typing a word that happens to contain it.
  if (isTextEntry(document.activeElement)) return false;
  if (isTextEntry(event.target as Element | null)) return false;

  const state = getWebMcpState();
  const hovered = state.hovered;
  const key = event.key.toLowerCase();

  if (key === 'p' || key === 'x' || key === 'u') {
    if (!hovered) return false;
    event.preventDefault();
    toggleFlag(hovered, key === 'p' ? 'pick' : key === 'x' ? 'reject' : 'clear', {
      by: 'human',
    });
    return true;
  }

  // Escape drops "these" without touching a single judgement. Pointing at
  // something is not an opinion about it, so it has to be cheap to undo.
  if (event.key === 'Escape') {
    if (getWebMcpState().selection.length === 0) return false;
    event.preventDefault();
    clearSelection();
    return true;
  }

  if (key === 'c') {
    const pair = resolveComparePair();
    if (!pair) return false;
    event.preventDefault();
    setCompare({
      artworkIds: pair,
      question: null,
      askedBy: 'human',
      at: Date.now(),
    });
    return true;
  }

  return false;
};

/**
 * What `C` compares, in order of how explicit the human was being.
 *
 * Two selected works is an unambiguous request. Otherwise the useful question
 * is almost always "how does the one I'm looking at stand against one I have
 * already kept?", so pair the hovered card with the first confirmed pick.
 */
export const resolveComparePair = (): [string, string] | null => {
  const state = getWebMcpState();
  const [firstSelected, secondSelected] = state.selection;
  if (firstSelected && secondSelected) return [firstSelected, secondSelected];

  const hovered = state.hovered;
  if (!hovered) return null;
  if (firstSelected && firstSelected !== hovered) {
    return [firstSelected, hovered];
  }

  const pick = state.flags.find(
    (flag) => flag.flag === 'pick' && !flag.provisional && flag.artworkId !== hovered
  );
  return pick ? [pick.artworkId, hovered] : null;
};

/** Attach the bindings to a document. Returns the detach function. */
export const installBoardKeyboard = (
  options: BoardKeyboardOptions = {}
): (() => void) => {
  if (typeof document === 'undefined') return () => {};
  const listener = (event: KeyboardEvent) => {
    handleBoardKey(event, options);
  };
  // Capture, so Enter is claimed before the prompt bar's form submits.
  document.addEventListener('keydown', listener, true);
  return () => document.removeEventListener('keydown', listener, true);
};
