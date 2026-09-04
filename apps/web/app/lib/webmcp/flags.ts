/**
 * Flags — the currency both operators spend on the same board.
 *
 * The premise the whole workspace rests on: the human has taste and cannot
 * say it, so stop asking them to author a query and let them *react*. `P` and
 * `X` on a card are not UI state, they are typed utterances the agent reads
 * out of `get_view_context` and the deterministic redeal computes from.
 *
 * Three rules make the two hands coexist:
 *
 *  - Flags are keyed by artwork id, not by board position, so they survive a
 *    redeal. A judgement about a picture outlives the arrangement it was made
 *    in, and the exemplar set only accumulates.
 *  - An agent's flag is **provisional** until the human confirms it. The agent
 *    may disagree in the same currency the human uses, but it may not move the
 *    human's exemplars on its own — `getExemplars()` counts confirmed flags
 *    only, which is what stops a model from quietly steering the redeal.
 *  - Every change is journalled. A turn sent to the agent carries the flags
 *    laid down since the last turn (`drainFlagChanges`), so a click is an
 *    utterance even when nothing was typed.
 *
 * Scoped to the tab. The map is the live copy and `sessionStorage` is its
 * shadow, so a reload restores what was on the board and closing the tab throws
 * it away — which is what §9 means by "flags persist per session", and what
 * this module's own comment used to deny by calling itself "a working surface,
 * not a saved document". It is still a working surface; it just no longer loses
 * the work to a refresh. See `flag-storage`, and note that the *journal* is
 * deliberately not restored.
 */

import { recallArtwork, rememberArtworks } from './artwork-index';
import { clearStoredFlags, loadFlags, saveFlags } from './flag-storage';
import {
  getWebMcpState,
  setFlagRecords,
  type FlagRecord,
  type FlagValue,
  type ResultSetOrigin,
} from './store';

export type { FlagRecord, FlagValue };

/** What `P`/`X`/`U` and `flag_artworks` can ask for. */
export type FlagIntent = FlagValue | 'clear';

/** One entry in the journal drained into the next turn's payload. */
export interface FlagChange {
  artworkId: string;
  /** What the flag was before this change, or null if unflagged. */
  from: FlagValue | null;
  /** What it is now, or null if cleared. */
  to: FlagValue | null;
  by: ResultSetOrigin;
  reason?: string;
  at: number;
}

/** Keyed by artwork id so flags outlive the board they were laid on. */
const flags = new Map<string, FlagRecord>();

/** Changes since the last drain — what the next human turn will carry. */
let journal: FlagChange[] = [];

const publish = () => {
  const records = [...flags.values()];
  setFlagRecords(records);
  // The one write point, so the one place persistence belongs. See
  // `flag-storage`: this is what makes §9's "flags persist per session" true
  // across a reload rather than only across a re-render. The catalogue records
  // go with them, because the session index does not survive either and a
  // restored flag with no record reaches the agent as a bare id.
  saveFlags(
    records,
    records
      .map((entry) => recallArtwork(entry.artworkId))
      .filter((work): work is NonNullable<typeof work> => Boolean(work))
  );
};

/**
 * Restore the standing flags from the session, once.
 *
 * Called at module load on the client and skipped entirely on the server, where
 * `sessionStorage` does not exist. Existing in-memory flags win: hydration is
 * for a cold page, and clobbering a flag someone has already pressed this tick
 * would be a race with the human's own hands.
 *
 * **The journal is not restored, on purpose.** It carries what the human did
 * *since the last turn*, and it is drained into the next agent turn — so
 * rehydrating it would open the first typed sentence after a reload by telling
 * the agent the human had just flagged everything on the board. Standing state
 * survives a reload; a delta does not.
 */
export const hydrateFlags = (): number => {
  const { records: restored, works } = loadFlags();
  // The works first, so that by the time anything reads a restored flag the
  // catalogue record behind it is already in the index.
  if (works.length) rememberArtworks(works);
  let added = 0;
  for (const record of restored) {
    if (flags.has(record.artworkId)) continue;
    flags.set(record.artworkId, record);
    added += 1;
  }
  if (added) publish();
  return added;
};

const record = (change: FlagChange) => {
  journal.push(change);
  publish();
  return change;
};

export const getFlag = (artworkId: string): FlagRecord | null =>
  flags.get(artworkId) ?? null;

export const listFlags = (): FlagRecord[] => [...flags.values()];

/**
 * Set a flag outright. This is the agent's path (`flag_artworks`) and the
 * resolution path for a compare click, where the caller knows exactly what the
 * flag should end up as rather than toggling it.
 *
 * Returns null when nothing changed, so callers can avoid journalling a no-op.
 */
export const setFlag = (
  artworkId: string,
  intent: FlagIntent,
  options: { by: ResultSetOrigin; reason?: string }
): FlagChange | null => {
  const id = artworkId.trim();
  if (!id) return null;

  const existing = flags.get(id) ?? null;
  const from = existing?.flag ?? null;
  const at = Date.now();

  if (intent === 'clear') {
    if (!existing) return null;
    flags.delete(id);
    return record({ artworkId: id, from, to: null, by: options.by, at });
  }

  // A human touching an agent's provisional flag is the confirmation. Even
  // when the value is unchanged that is a real event: it promotes the flag out
  // of provisional and into the exemplar set.
  const confirms =
    options.by === 'human' && existing?.provisional === true;
  if (existing && existing.flag === intent && !confirms) return null;

  flags.set(id, {
    artworkId: id,
    flag: intent,
    by: options.by,
    provisional: options.by === 'agent',
    ...(options.reason ? { reason: options.reason } : {}),
    at,
  });
  return record({
    artworkId: id,
    from,
    to: intent,
    by: options.by,
    ...(options.reason ? { reason: options.reason } : {}),
    at,
  });
};

/**
 * Lightroom's toggle, which is what a key press means: `P` on something already
 * picked clears it. Anything else — unflagged, rejected, or an agent's
 * provisional pick — becomes a confirmed pick.
 */
export const toggleFlag = (
  artworkId: string,
  intent: FlagIntent,
  options: { by: ResultSetOrigin; reason?: string }
): FlagChange | null => {
  if (intent === 'clear') return setFlag(artworkId, 'clear', options);
  const existing = flags.get(artworkId.trim());
  const alreadyMine =
    existing?.flag === intent && !(options.by === 'human' && existing.provisional);
  return setFlag(artworkId, alreadyMine ? 'clear' : intent, options);
};

/**
 * The exemplar set the deterministic redeal runs on: confirmed flags only.
 *
 * This is the pin-survival guarantee expressed as a read. A model that forgets
 * a pick cannot lose it, because the model never had write access to this list
 * — `flag_artworks` can only ever add provisional entries.
 */
export const getExemplars = (): { positive: string[]; negative: string[] } => {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const flag of flags.values()) {
    if (flag.provisional) continue;
    (flag.flag === 'pick' ? positive : negative).push(flag.artworkId);
  }
  return { positive, negative };
};

/** Confirmed picks only — the ids a redeal must not drop. */
export const getPinnedIds = (): string[] => getExemplars().positive;

/** Read the journal without clearing it. For rendering and for tests. */
export const peekFlagChanges = (): FlagChange[] => [...journal];

/**
 * Take everything laid down since the last turn and reset the journal. Called
 * once as a human turn is assembled, so no gesture is reported twice.
 */
export const drainFlagChanges = (): FlagChange[] => {
  const drained = journal;
  journal = [];
  return drained;
};

export const clearAllFlags = () => {
  if (!flags.size) return;
  flags.clear();
  journal = [];
  publish();
};

/**
 * Flags for works that are not on the current board are still real — they are
 * the memory of everything considered and declined. This splits them for the
 * agent's benefit so it can talk about the pile as well as the wall.
 */
export const partitionFlags = (boardOrder: readonly string[]) => {
  const onBoard = new Set(boardOrder);
  const hung: FlagRecord[] = [];
  const filed: FlagRecord[] = [];
  for (const flag of flags.values()) {
    (onBoard.has(flag.artworkId) ? hung : filed).push(flag);
  }
  return { hung, filed };
};

export const __resetFlagsForTest = () => {
  flags.clear();
  journal = [];
  setFlagRecords([]);
  // Otherwise one test's flags hydrate into the next one's cold page.
  clearStoredFlags();
};

/** Re-hydrate the store from the map. The bridge calls this on mount. */
export const republishFlags = publish;

/*
 * Restore on load, client only.
 *
 * `storage()` returns null on the server, so this costs nothing during SSR and
 * cannot desynchronise the rendered HTML. On the client the store is read
 * through `useSyncExternalStore` with a server snapshot, which is precisely the
 * hook for a client-side store whose value differs from the server's: it
 * renders the server snapshot while hydrating and re-renders once.
 */
hydrateFlags();

/** Current state of the board, read straight off the shared store. */
export const getBoardOrder = (): string[] => getWebMcpState().board?.order ?? [];
