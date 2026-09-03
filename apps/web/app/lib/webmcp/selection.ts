/**
 * Pointing at more than one thing.
 *
 * Hover answers "this one". Selection answers "these" — and "these" is the
 * word that makes a spoken sentence like *"more like these, but colder"*
 * resolvable, because the voice supplies the adjective and the cursor supplies
 * the referents. Neither channel can do the other's half.
 *
 * Shift-click, which is what shift-click has meant since the Finder, and a
 * plain click anywhere clears it. Selection is not a flag: it says what the
 * conversation is about, not what the human thinks of it, so it never feeds
 * the redeal and it is not journalled.
 */

import { getWebMcpState, setSelection } from './store';

export const getSelection = (): string[] => [...getWebMcpState().selection];

export const isSelected = (artworkId: string): boolean =>
  getWebMcpState().selection.includes(artworkId);

/** Add or remove one work. Returns the selection as it now stands. */
export const toggleSelection = (artworkId: string): string[] => {
  const id = artworkId.trim();
  if (!id) return getSelection();

  const current = getWebMcpState().selection;
  const next = current.includes(id)
    ? current.filter((existing) => existing !== id)
    : [...current, id];
  setSelection(next);
  return next;
};

export const clearSelection = () => {
  if (getWebMcpState().selection.length === 0) return;
  setSelection([]);
};
