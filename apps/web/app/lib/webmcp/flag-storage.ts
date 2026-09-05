/**
 * Flags, for as long as the tab is open.
 *
 * §9's first clause asks that flags "persist per session", and until now they
 * did not survive a reload: the map lived in module scope and its own docblock
 * called it "a working surface, not a saved document". Measured on staging,
 * three flags before a reload and **zero** after, with `get_view_context`
 * reporting no picks and no rejects. That is the clause failing on the reading
 * anyone would give it — `sessionStorage` is literally the platform's name for
 * "per session".
 *
 * **Why this is safe rather than a new class of behaviour.** Flags are keyed by
 * a namespaced artwork id (`open-access-art:nga:148513`), so nothing can bleed
 * between collections, and a flag for a work that is not on screen is already
 * an ordinary in-session state: running a second search today keeps every flag
 * from the first. Restoring after a reload does not invent that situation, it
 * just stops the reload being the one event that erases it.
 *
 * **What is deliberately not restored is the journal.** The journal is "what
 * the human did since the last turn", and it is drained into the next agent
 * turn. Rehydrating it would tell the agent, on the first thing typed after a
 * reload, that the human had just flagged twelve works in front of it. Standing
 * state and a delta are different things and only one of them survives.
 *
 * Everything here fails soft. Private modes throw on the first `sessionStorage`
 * access, quotas throw on write, and another tab can leave anything at all in
 * the key — none of which is a reason for the page not to load.
 */

import type { ArtworkSearchResult } from '~/types';
import type { FlagRecord } from './store';

/** Bumped if the record shape changes, so old payloads are ignored not misread. */
const STORAGE_KEY = 'paillette:flags:v1';
const VERSION = 2;

/**
 * A ceiling, because a long session is unbounded and a quota error is a silent
 * failure. Culling 63,253 works could in principle mark thousands; the newest
 * are the ones a person still means.
 */
const MAX_PERSISTED = 500;

/**
 * `sessionStorage` can throw merely on being *touched* — Safari's private mode
 * historically did, and a sandboxed iframe still does — so even the lookup is
 * wrapped. Returns null on the server, where the whole idea is meaningless.
 */
const storage = (): Storage | null => {
  try {
    if (typeof globalThis === 'undefined') return null;
    const candidate = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
};

const isFlagRecord = (value: unknown): value is FlagRecord => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.artworkId !== 'string' || !entry.artworkId.trim()) return false;
  if (entry.flag !== 'pick' && entry.flag !== 'reject') return false;
  if (entry.by !== 'human' && entry.by !== 'agent') return false;
  if (typeof entry.provisional !== 'boolean') return false;
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return false;
  if (entry.reason !== undefined && typeof entry.reason !== 'string') return false;
  return true;
};

/**
 * Write the standing flags, and the catalogue records they refer to.
 *
 * The records travel with them because a flag on its own is a hollow thing to
 * restore. `get_view_context` builds the agent's picture of a flagged work out
 * of the session index — title, palette, medium — and after a reload that index
 * is empty, so a restored pick would reach the model as an id with `title:
 * null` and `palette: []` over a prompt that tells it to name what it can see.
 * `flag_artworks` would refuse to touch it as well, since it rejects ids the
 * page has never loaded.
 *
 * Written as one entry so the flags and their works cannot disagree. If that
 * does not fit, the flags are written on their own rather than nothing at all:
 * a sparse restored flag is worse than a full one and much better than none.
 */
export const saveFlags = (
  records: readonly FlagRecord[],
  works: readonly ArtworkSearchResult[] = []
): void => {
  const store = storage();
  if (!store) return;
  try {
    if (!records.length) {
      store.removeItem(STORAGE_KEY);
      return;
    }
    const kept = records.slice(-MAX_PERSISTED);
    const keptIds = new Set(kept.map((record) => record.artworkId));
    const keptWorks = works.filter((work) => keptIds.has(work?.id));
    try {
      store.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: VERSION, records: kept, works: keptWorks })
      );
    } catch {
      store.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, records: kept }));
    }
  } catch {
    // Out of quota even for the flags alone, or a browser that refuses to store
    // anything. They are still correct in memory; they just will not outlive
    // the page.
  }
};

/**
 * Read them back, dropping anything that is not a flag record.
 *
 * Per-entry validation rather than all-or-nothing: one corrupt row in a payload
 * of twelve should cost that row, not the other eleven.
 */
export const loadFlags = (): {
  records: FlagRecord[];
  works: ArtworkSearchResult[];
} => {
  const empty = { records: [], works: [] };
  const store = storage();
  if (!store) return empty;
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;

  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      records?: unknown;
      works?: unknown;
    };
    if (parsed?.v !== VERSION || !Array.isArray(parsed.records)) return empty;
    return {
      records: parsed.records.filter(isFlagRecord).slice(-MAX_PERSISTED),
      // Loose on purpose: the index only needs an id to be useful, and a
      // record that is missing a field renders as a card with a gap in it
      // rather than as a crash.
      works: (Array.isArray(parsed.works) ? parsed.works : []).filter(
        (work: unknown): work is ArtworkSearchResult =>
          Boolean(work) &&
          typeof work === 'object' &&
          typeof (work as { id?: unknown }).id === 'string'
      ),
    };
  } catch {
    return empty;
  }
};

export const clearStoredFlags = (): void => {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to be done, and nothing that should reach the human.
  }
};

export const __FLAG_STORAGE_KEY_FOR_TEST = STORAGE_KEY;
