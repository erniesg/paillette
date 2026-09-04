/**
 * The exhibition — the object both parties write.
 *
 * The culling loop is one-sided in a way this is not. Anyone can pick pictures
 * for you; nobody can write your exhibition for you, and you cannot write it
 * without the collection. So the genuinely shared object is the **theme**:
 * prose, which is where the human's meaning lives, next to an ordered hang and
 * a label per work.
 *
 * Three rules make two hands on one document survive each other:
 *
 *  - **A field the human has edited is theirs.** An agent write onto a held
 *    field does not land; it is parked as a proposal, drawn dashed in the
 *    agent's ink, and one click from the human accepts it. Exactly the shape
 *    the provisional flag already has, in prose.
 *  - **Writes merge.** Changing one label restates one label. Nothing else in
 *    the document has to be repeated to keep it.
 *  - **Labels are keyed by artwork id**, like flags, so a label written for a
 *    work outlives the deal it was written on. Redeal the board six times and
 *    the labels for the survivors are still there.
 *
 * The hang follows the board rather than being a second list to keep in sync:
 * `redeal` and `set_results` already decide which twelve works are up, and a
 * work the human rejected is not in the show whatever the document says.
 */

import { getExemplars, listFlags } from './flags';
import {
  getWebMcpState,
  setExhibition,
  type ExhibitionState,
  type ExhibitionField,
  type AuthoredText,
  type AtlasRegion,
  type ResultSetOrigin,
} from './store';

export type {
  ExhibitionState,
  ExhibitionField,
  AuthoredText,
  AtlasRegion,
};

/**
 * A hang has an end. Twenty-four is two boards' worth — enough that a show
 * assembled over several deals is not truncated, small enough that the
 * shareable link stays inside the length every messaging client will carry.
 */
export const EXHIBITION_MAX_WORKS = 24;

/** Museum discipline, enforced rather than requested. */
export const TITLE_MAX_CHARS = 90;
export const STATEMENT_MAX_CHARS = 800;
export const LABEL_MAX_CHARS = 320;
export const REGION_LABEL_MAX_CHARS = 60;

export const emptyField = (): ExhibitionField => ({
  current: null,
  proposed: null,
});

export const emptyExhibition = (): ExhibitionState => ({
  title: emptyField(),
  statement: emptyField(),
  labels: {},
  order: [],
  withdrawn: [],
  regions: [],
  updatedAt: 0,
});

const read = (): ExhibitionState => getWebMcpState().exhibition;

const clip = (value: string, max: number) => value.trim().slice(0, max);

/**
 * Whether this text is the human's to keep.
 *
 * True when they typed it, and true when they accepted the agent's wording —
 * accepting is an edit. `by` stays as whoever actually wrote the words, so the
 * ink on screen and the credit on the shared page are both honest; only the
 * right to overwrite follows `heldByHuman`.
 */
const held = (text: AuthoredText | null): boolean => Boolean(text?.heldByHuman);

const authored = (
  value: string,
  by: ResultSetOrigin,
  heldByHuman: boolean
): AuthoredText => ({ value, by, heldByHuman, at: Date.now() });

/**
 * One field, written by one hand.
 *
 * The agent may always propose. It may only *land* on a field nobody has
 * claimed, or on one it wrote itself and nobody has since taken over.
 */
const applyText = (
  field: ExhibitionField,
  value: string,
  by: ResultSetOrigin
): { field: ExhibitionField; landed: boolean } => {
  if (by === 'human') {
    // The human's own words clear any pending proposal: they have answered it.
    return { field: { current: authored(value, 'human', true), proposed: null }, landed: true };
  }
  if (held(field.current)) {
    if (field.current?.value === value) return { field, landed: false };
    return {
      field: { ...field, proposed: authored(value, 'agent', false) },
      landed: false,
    };
  }
  return { field: { current: authored(value, 'agent', false), proposed: null }, landed: true };
};

/** The human takes the agent's wording. It becomes theirs to keep. */
const acceptField = (field: ExhibitionField): ExhibitionField => {
  if (!field.proposed) return field;
  return {
    current: { ...field.proposed, heldByHuman: true, at: Date.now() },
    proposed: null,
  };
};

const dropProposal = (field: ExhibitionField): ExhibitionField =>
  field.proposed ? { ...field, proposed: null } : field;

// ---------------------------------------------------------------------------
// The hang
// ---------------------------------------------------------------------------

/**
 * Which works are in the show, in order.
 *
 * Derived rather than stored, so nobody has to keep a second list in step with
 * the board. The order the curator set wins; the board fills in behind it; a
 * work with a label but no seat is one the agent added deliberately and is
 * hung last. A work the human rejected is never in the show — the `X` they
 * already pressed is the instruction, and asking them to press a second thing
 * to take it off the wall would be the interface arguing with itself.
 */
export const resolveHang = (state: ExhibitionState = read()): string[] => {
  const page = getWebMcpState();
  const flags = listFlags();
  const out = new Set(state.withdrawn);
  for (const flag of flags) {
    if (flag.flag === 'reject' && !flag.provisional) out.add(flag.artworkId);
  }

  const boardOrder = page.board?.order ?? [];
  const fallback = boardOrder.length ? boardOrder : getExemplars().positive;

  const hung: string[] = [];
  const seen = new Set<string>();
  const consider = (id: string) => {
    if (!id || seen.has(id) || out.has(id)) return;
    if (hung.length >= EXHIBITION_MAX_WORKS) return;
    seen.add(id);
    hung.push(id);
  };

  state.order.forEach(consider);
  fallback.forEach(consider);
  Object.keys(state.labels).forEach(consider);
  return hung;
};

export interface HungWork {
  artworkId: string;
  position: number;
  label: string | null;
  /** Who wrote the label on the wall, or null when there is none. */
  labelBy: ResultSetOrigin | null;
  /** True when the human wrote or accepted it — the agent must not overwrite. */
  labelHeldByHuman: boolean;
  /** The agent's unaccepted alternative, if it has offered one. */
  proposedLabel: string | null;
}

export const listHungWorks = (state: ExhibitionState = read()): HungWork[] =>
  resolveHang(state).map((artworkId, index) => {
    const field = state.labels[artworkId] ?? emptyField();
    return {
      artworkId,
      position: index,
      label: field.current?.value ?? null,
      labelBy: field.current?.by ?? null,
      labelHeldByHuman: held(field.current),
      proposedLabel: field.proposed?.value ?? null,
    };
  });

/** Has anyone written anything at all? Decides whether the page shows a show. */
export const hasExhibition = (state: ExhibitionState = read()): boolean =>
  Boolean(
    state.title.current ||
      state.statement.current ||
      Object.values(state.labels).some((field) => field.current) ||
      state.regions.length
  );

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface ExhibitionWorkPatch {
  artworkId: string;
  label?: string;
  position?: number;
}

export interface ExhibitionPatch {
  title?: string;
  statement?: string;
  works?: ExhibitionWorkPatch[];
  /** Take works off the wall. The counterpart to a merge that never removes. */
  removeArtworkIds?: string[];
}

/** What did not land, and why — so the agent can read the human's words back. */
export interface DeferredWrite {
  field: 'title' | 'statement' | `label:${string}`;
  /** What is on the wall now, which the agent must work with rather than around. */
  current: string;
  proposed: string;
}

export interface ExhibitionWriteResult {
  state: ExhibitionState;
  changed: string[];
  deferred: DeferredWrite[];
}

/**
 * Merge a patch into the exhibition. The only write path; the page's inline
 * editors and the `set_exhibition` tool both come through here so that the
 * provenance rule cannot be true on one path and not the other.
 */
export const writeExhibition = (
  patch: ExhibitionPatch,
  options: { by: ResultSetOrigin }
): ExhibitionWriteResult => {
  const previous = read();
  const next: ExhibitionState = {
    ...previous,
    labels: { ...previous.labels },
    order: [...previous.order],
    withdrawn: [...previous.withdrawn],
    regions: [...previous.regions],
  };
  const changed: string[] = [];
  const deferred: DeferredWrite[] = [];

  if (typeof patch.title === 'string') {
    const value = clip(patch.title, TITLE_MAX_CHARS);
    const result = applyText(previous.title, value, options.by);
    next.title = result.field;
    if (result.landed) changed.push('title');
    else if (result.field.proposed) {
      deferred.push({
        field: 'title',
        current: previous.title.current?.value ?? '',
        proposed: value,
      });
    }
  }

  if (typeof patch.statement === 'string') {
    const value = clip(patch.statement, STATEMENT_MAX_CHARS);
    const result = applyText(previous.statement, value, options.by);
    next.statement = result.field;
    if (result.landed) changed.push('statement');
    else if (result.field.proposed) {
      deferred.push({
        field: 'statement',
        current: previous.statement.current?.value ?? '',
        proposed: value,
      });
    }
  }

  /**
   * The hang follows the board until somebody states an order, and then it is
   * theirs. Materialising it on every write would freeze the first board a
   * label was written on, so the next redeal would append its twelve works
   * behind the twelve that had just left — the show growing instead of
   * changing. So `order` is only written when a position is actually given.
   */
  let order: string[] | null = null;
  const positions = () => (order ??= resolveHang(previous));

  for (const work of patch.works ?? []) {
    const artworkId = work.artworkId?.trim();
    if (!artworkId) continue;

    if (typeof work.label === 'string') {
      const value = clip(work.label, LABEL_MAX_CHARS);
      const field = previous.labels[artworkId] ?? emptyField();
      const result = applyText(field, value, options.by);
      next.labels[artworkId] = result.field;
      if (result.landed) changed.push(`label:${artworkId}`);
      else if (result.field.proposed) {
        deferred.push({
          field: `label:${artworkId}`,
          current: field.current?.value ?? '',
          proposed: value,
        });
      }
    } else if (!next.labels[artworkId]) {
      // Named with no label: the caller is putting it in the show.
      next.labels[artworkId] = emptyField();
    }

    // A named work rejoins the show even if it had been taken down.
    next.withdrawn = next.withdrawn.filter((id) => id !== artworkId);

    if (typeof work.position === 'number' && Number.isFinite(work.position)) {
      const target = Math.max(
        0,
        Math.min(Math.round(work.position), EXHIBITION_MAX_WORKS - 1)
      );
      const hang = positions().filter((id) => id !== artworkId);
      hang.splice(Math.min(target, hang.length), 0, artworkId);
      order = hang;
      changed.push(`position:${artworkId}`);
    }
  }

  for (const raw of patch.removeArtworkIds ?? []) {
    const artworkId = raw?.trim();
    if (!artworkId) continue;
    if (!next.withdrawn.includes(artworkId)) next.withdrawn.push(artworkId);
    if (order) order = order.filter((id) => id !== artworkId);
    changed.push(`removed:${artworkId}`);
  }

  if (order) next.order = order.slice(0, EXHIBITION_MAX_WORKS);
  if (changed.length || deferred.length) next.updatedAt = Date.now();
  setExhibition(next);
  return { state: next, changed, deferred };
};

/** The human takes the agent's proposed wording. */
export const acceptProposal = (
  field: 'title' | 'statement' | { artworkId: string }
): void => {
  const previous = read();
  if (field === 'title') {
    setExhibition({
      ...previous,
      title: acceptField(previous.title),
      updatedAt: Date.now(),
    });
    return;
  }
  if (field === 'statement') {
    setExhibition({
      ...previous,
      statement: acceptField(previous.statement),
      updatedAt: Date.now(),
    });
    return;
  }
  const existing = previous.labels[field.artworkId];
  if (!existing?.proposed) return;
  setExhibition({
    ...previous,
    labels: { ...previous.labels, [field.artworkId]: acceptField(existing) },
    updatedAt: Date.now(),
  });
};

/** The human declines it. The proposal goes; what they wrote stays. */
export const declineProposal = (
  field: 'title' | 'statement' | { artworkId: string }
): void => {
  const previous = read();
  if (field === 'title') {
    setExhibition({ ...previous, title: dropProposal(previous.title) });
    return;
  }
  if (field === 'statement') {
    setExhibition({ ...previous, statement: dropProposal(previous.statement) });
    return;
  }
  const existing = previous.labels[field.artworkId];
  if (!existing?.proposed) return;
  setExhibition({
    ...previous,
    labels: { ...previous.labels, [field.artworkId]: dropProposal(existing) },
  });
};

// ---------------------------------------------------------------------------
// Regions on the atlas
// ---------------------------------------------------------------------------

export interface RegionPatch {
  label: string;
  artworkIds: string[];
  note?: string;
}

/**
 * Name the groupings on the atlas.
 *
 * Replaces the whole set rather than merging: a region is an arrangement, and
 * an arrangement half-updated is not an arrangement. Passing an empty array
 * dissolves them all, which is how the human clears one they did not want.
 */
export const setRegions = (
  regions: RegionPatch[],
  options: { by: ResultSetOrigin }
): AtlasRegion[] => {
  const previous = read();
  const claimed = new Set<string>();
  const next: AtlasRegion[] = [];

  for (const region of regions) {
    const label = clip(region.label ?? '', REGION_LABEL_MAX_CHARS);
    if (!label) continue;
    // A work belongs to one region. Two labels over one picture is the atlas
    // arguing with itself.
    const artworkIds = [...new Set(region.artworkIds ?? [])]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id) && !claimed.has(id));
    if (!artworkIds.length) continue;
    artworkIds.forEach((id) => claimed.add(id));
    next.push({
      id: `region-${next.length + 1}`,
      label,
      artworkIds,
      ...(region.note?.trim() ? { note: region.note.trim() } : {}),
      by: options.by,
    });
  }

  setExhibition({ ...previous, regions: next, updatedAt: Date.now() });
  return next;
};

/** The human dissolves one. Its works stay on the atlas, unlabelled. */
export const dissolveRegion = (regionId: string): void => {
  const previous = read();
  const regions = previous.regions.filter((region) => region.id !== regionId);
  if (regions.length === previous.regions.length) return;
  setExhibition({ ...previous, regions, updatedAt: Date.now() });
};

/** The human renames one. Renaming makes it theirs. */
export const renameRegion = (regionId: string, label: string): void => {
  const previous = read();
  const trimmed = clip(label, REGION_LABEL_MAX_CHARS);
  if (!trimmed) return;
  const regions = previous.regions.map((region) =>
    region.id === regionId ? { ...region, label: trimmed, by: 'human' as const } : region
  );
  setExhibition({ ...previous, regions, updatedAt: Date.now() });
};

export const __resetExhibitionForTest = () => setExhibition(emptyExhibition());
