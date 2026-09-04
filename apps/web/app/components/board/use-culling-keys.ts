import { useEffect } from 'react';

/**
 * Lightroom's culling keys, on whichever card the human is pointing at.
 *
 * `P` picks, `X` rejects, `U` clears, `C` opens compare. They are Lightroom's
 * own bindings and have been for about twenty years, which is the entire
 * argument for using them: the gesture needs no legend because the muscle
 * memory already exists, and a board that invented its own keys would have to
 * explain them.
 *
 * The target is whatever the caller says it is — the card under the cursor, or
 * the one holding focus. Hover is what Lightroom uses in grid view; focus is
 * what makes the same loop work with no pointer at all, which is the whole of
 * the text-first requirement as it applies to a board.
 */

export type CullingFlag = 'pick' | 'reject';

export interface CullingKeysOptions {
  /** The card under the cursor or holding focus. Nothing fires without one. */
  targetId: string | null;
  /** `null` means clear — `U` in Lightroom, and the third state of the toggle. */
  onFlag: (id: string, flag: CullingFlag | null) => void;
  /** `C`. Optional: a board with nothing to compare against should not bind it. */
  onCompare?: () => void;
  /** Off while a modal owns the keyboard, or the board is not interactive. */
  enabled?: boolean;
}

/**
 * True when the keystroke belongs to something the human is typing into.
 *
 * Without this, typing "explore" into the search bar silently picks and
 * rejects things behind it — the utterance bar and the board share one
 * keyboard, and the bar has to win every time it is focused.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  // A combobox or a listbox option is a text surface even when it is a div.
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

export function useCullingKeys({
  targetId,
  onFlag,
  onCompare,
  enabled = true,
}: CullingKeysOptions) {
  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      // A shortcut that fires under Cmd or Ctrl steals the browser's own
      // bindings — Cmd-P is print, Ctrl-U is view source.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const key = event.key.toLowerCase();

      if (key === 'c') {
        if (!onCompare) return;
        event.preventDefault();
        onCompare();
        return;
      }

      if (!targetId) return;

      if (key === 'p') {
        event.preventDefault();
        onFlag(targetId, 'pick');
      } else if (key === 'x') {
        event.preventDefault();
        onFlag(targetId, 'reject');
      } else if (key === 'u') {
        event.preventDefault();
        onFlag(targetId, null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [targetId, onFlag, onCompare, enabled]);
}
