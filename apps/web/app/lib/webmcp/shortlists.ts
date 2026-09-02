/**
 * Shortlists: the only thing an anonymous visitor — human or agent — can
 * actually write here.
 *
 * Paillette's catalogue is read-only to anonymous callers by design, so
 * `create_collection` / `add_to_collection` write to the human's own browser
 * rather than pretending to change the archive. That constraint is stated in
 * the tool descriptions, not hidden behind an optimistic success message.
 *
 * Every write is preceded by an in-page confirmation (see `requestConfirmation`
 * in `./store`), so the human sees the mutation before it happens.
 */

const STORAGE_KEY = 'paillette-webmcp-shortlists';

export interface Shortlist {
  id: string;
  name: string;
  description?: string;
  artworkIds: string[];
  createdAt: number;
  updatedAt: number;
}

let memory: Shortlist[] = [];
let hydrated = false;

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Private mode, or storage disabled. Fall back to in-memory.
    return null;
  }
};

const hydrate = () => {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memory = parsed.filter(
        (entry): entry is Shortlist =>
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.name === 'string' &&
          Array.isArray(entry.artworkIds)
      );
    }
  } catch {
    memory = [];
  }
};

const persist = () => {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Quota or private mode; the in-memory copy still serves this session.
  }
};

export const listShortlists = (): Shortlist[] => {
  hydrate();
  return memory;
};

export const createShortlist = (
  name: string,
  description?: string
): Shortlist => {
  hydrate();
  const now = Date.now();
  const shortlist: Shortlist = {
    id: `shortlist-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    ...(description ? { description } : {}),
    artworkIds: [],
    createdAt: now,
    updatedAt: now,
  };
  memory = [...memory, shortlist];
  persist();
  return shortlist;
};

export const addToShortlist = (
  shortlistId: string,
  artworkIds: readonly string[]
): Shortlist => {
  hydrate();
  const index = memory.findIndex((entry) => entry.id === shortlistId);
  if (index === -1) throw new Error(`No shortlist "${shortlistId}".`);

  const existing = memory[index];
  if (!existing) throw new Error(`No shortlist "${shortlistId}".`);
  const merged = [...new Set([...existing.artworkIds, ...artworkIds])];
  const updated: Shortlist = {
    ...existing,
    artworkIds: merged,
    updatedAt: Date.now(),
  };
  memory = memory.map((entry, position) =>
    position === index ? updated : entry
  );
  persist();
  return updated;
};

export const __resetShortlistsForTest = () => {
  memory = [];
  hydrated = false;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};
