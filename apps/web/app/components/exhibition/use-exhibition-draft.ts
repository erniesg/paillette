import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExhibitionPage } from '~/lib/exhibition-page.server';
import {
  copyExhibitionDraft,
  DRAFT_LABEL_MAX_LENGTH,
  emptyExhibitionDraft,
  EXHIBITION_DRAFT_CHANGE_EVENT,
  exhibitionDraftKey,
  ownDraftLabel,
  readStoredExhibitionDraft,
  serializeExhibitionDraft,
  type DraftableExhibitionPage,
  type LabelAuthor,
  type StoredExhibitionDraft,
} from '~/lib/exhibition-draft';

type DraftState = { key: string; labels: StoredExhibitionDraft };

const sameLabel = (
  label: { text: string; by: LabelAuthor } | undefined,
  work: ExhibitionPage['works'][number]
) => label?.text === (work.label ?? '') && label?.by === (work.labelByAgent ? 'agent' : 'human');

export const useExhibitionDraft = (originalPage: DraftableExhibitionPage, onIncomingChange?: () => void) => {
  const onIncomingChangeRef = useRef(onIncomingChange);
  onIncomingChangeRef.current = onIncomingChange;
  const key = exhibitionDraftKey(originalPage);
  const artworkIdsKey = originalPage.works.map((work) => work.artworkId).join('\u0000');
  const knownArtworkIds = useMemo(
    () => new Set(originalPage.works.map((work) => work.artworkId)),
    [artworkIdsKey]
  );
  const workById = new Map(originalPage.works.map((work) => [work.artworkId, work]));
  const [state, setState] = useState<DraftState>(() => ({ key, labels: emptyExhibitionDraft() }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [mounted, setMounted] = useState(false);
  const [storageError, setStorageError] = useState(false);
  // A storage failure must not make the next edit read stale disk data. The
  // key makes the volatile copy a tombstone only for the exhibition it reset.
  const volatile = useRef<DraftState | null>(null);
  const active = state.key === key ? state : { key, labels: emptyExhibitionDraft() };

  const readCurrentLabels = (): StoredExhibitionDraft => {
    if (volatile.current?.key === key) return copyExhibitionDraft(volatile.current.labels);
    return readStoredExhibitionDraft(localStorage.getItem(key), knownArtworkIds);
  };

  const latestStoredLabels = (): StoredExhibitionDraft => {
    try {
      return readCurrentLabels();
    } catch {
      setStorageError(true);
      return copyExhibitionDraft(
        stateRef.current.key === key ? stateRef.current.labels : emptyExhibitionDraft()
      );
    }
  };

  // Reading localStorage after hydration keeps server rendering deterministic.
  useEffect(() => {
    setMounted(true);
    const sync = (labels: StoredExhibitionDraft) => {
      onIncomingChangeRef.current?.();
      setState((previous) => previous.key === key ? { key, labels } : previous);
    };
    let stored: StoredExhibitionDraft;
    try {
      stored = readCurrentLabels();
      setStorageError(false);
    } catch {
      stored = copyExhibitionDraft(
        stateRef.current.key === key ? stateRef.current.labels : emptyExhibitionDraft()
      );
      setStorageError(true);
    }
    // An interaction can be queued between hydration and this effect. Keep
    // that in-memory edit rather than replacing it with the older disk copy.
    setState((previous) => {
      const labels = copyExhibitionDraft(stored);
      if (previous.key === key) {
        for (const [id, value] of Object.entries(previous.labels)) labels[id] = value;
      }
      return { key, labels };
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || event.storageArea !== localStorage) return;
      // `newValue` can belong to an earlier queued event. The current value is
      // the only value that can safely synchronize this editor.
      sync(latestStoredLabels());
    };
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: unknown }>).detail;
      if (!detail || detail.key !== key) return;
      sync(latestStoredLabels());
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EXHIBITION_DRAFT_CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EXHIBITION_DRAFT_CHANGE_EVENT, onLocalChange);
    };
  }, [artworkIdsKey, key]);

  const page = useMemo(() => ({
    ...originalPage,
    works: originalPage.works.map((work) => {
      const draft = ownDraftLabel(active.labels, work.artworkId);
      return draft
        ? { ...work, label: draft.text || null, labelByAgent: draft.by === 'agent' }
        : work;
    }),
  }), [active.labels, originalPage]);

  const dirty = Object.keys(active.labels).length > 0;

  const persist = (labels: StoredExhibitionDraft) => {
    if (!mounted) return;
    try {
      if (Object.keys(labels).length) localStorage.setItem(key, serializeExhibitionDraft(labels));
      else localStorage.removeItem(key);
      if (volatile.current?.key === key) volatile.current = null;
      setStorageError(false);
      window.dispatchEvent(new CustomEvent(EXHIBITION_DRAFT_CHANGE_EVENT, {
        detail: { key },
      }));
    } catch {
      volatile.current = { key, labels: copyExhibitionDraft(labels) };
      setStorageError(true);
    }
  };

  const setLabel = (id: string, text: string, by: LabelAuthor) => {
    const source = workById.get(id);
    if (!source || text.length > DRAFT_LABEL_MAX_LENGTH) return;
    const labels = latestStoredLabels();
    if (sameLabel({ text, by }, source)) delete labels[id];
    else labels[id] = { text, by };
    setState({ key, labels });
    persist(labels);
  };

  const reset = () => {
    const labels = emptyExhibitionDraft();
    setState({ key, labels });
    persist(labels);
  };

  return { page, dirty, storageError, setLabel, reset };
};
