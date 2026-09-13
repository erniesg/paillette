import { useEffect, useRef, useState } from 'react';
import type { HungWork } from '~/lib/exhibition-page.server';
import {
  requestLabelSuggestion,
  LABEL_SUGGESTION_MAX_CHARS,
} from '~/lib/exhibition-label-suggestion';

export interface LabelEditorProps {
  work: HungWork;
  collectionId?: string;
  exhibitionTitle: string;
  exhibitionStatement?: string | null;
  onCommit: (text: string, by: 'human' | 'agent') => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** A curator-owned label field, with an agent draft that must be accepted. */
export const LabelEditor = ({
  work,
  collectionId = 'nga',
  exhibitionTitle,
  exhibitionStatement,
  onCommit,
  onDirtyChange,
}: LabelEditorProps) => {
  const [draft, setDraft] = useState(work.label ?? '');
  const [committed, setCommitted] = useState(work.label ?? '');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const draftRef = useRef(draft);
  const artworkIdRef = useRef(work.artworkId);
  const onDirtyChangeRef = useRef(onDirtyChange);

  draftRef.current = draft;
  artworkIdRef.current = work.artworkId;
  onDirtyChangeRef.current = onDirtyChange;

  // A request belongs to the work it began for. Do not carry a late answer
  // across a next/previous artwork transition.
  useEffect(() => {
    controllerRef.current?.abort();
    sequence.current += 1;
    setBusy(false);
    setDraft(work.label ?? '');
    setCommitted(work.label ?? '');
    setSuggestion(null);
    setError(null);
  }, [work.artworkId, work.label]);

  const dirty = draft !== committed;

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(
    () => () => {
      onDirtyChangeRef.current?.(false);
    },
    []
  );

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    []
  );

  const save = () => {
    const text = draft.trim();
    setDraft(text);
    if (text !== committed.trim()) {
      onCommit(text, 'human');
      setCommitted(text);
    } else {
      setCommitted(text);
    }
  };

  const discard = () => {
    setDraft(committed);
    setSuggestion(null);
    setError(null);
  };

  const generate = async () => {
    const statement = exhibitionStatement?.trim() ?? '';
    if (!statement || busy) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++sequence.current;
    const requestedArtworkId = work.artworkId;
    const requestedDraft = draftRef.current;
    setBusy(true);
    setError(null);
    setSuggestion(null);

    try {
      const next = await requestLabelSuggestion({
        collectionId,
        artworkId: requestedArtworkId,
        exhibitionTitle,
        exhibitionStatement: statement,
        signal: controller.signal,
      });
      // Editing is an instruction. A late suggestion is discarded rather than
      // offered beside text the curator has since changed.
      if (
        sequence.current !== request ||
        artworkIdRef.current !== requestedArtworkId ||
        draftRef.current !== requestedDraft
      ) {
        return;
      }
      setSuggestion(next);
    } catch (caught) {
      if ((caught as { name?: string } | null)?.name !== 'AbortError' && sequence.current === request) {
        setError('Couldn’t generate a label. Try again.');
      }
    } finally {
      if (sequence.current === request) setBusy(false);
    }
  };

  const statementMissing = !(exhibitionStatement?.trim());
  const labelName = `Wall label for ${work.title}`;

  return (
    <section className="paillette-label-editor" aria-label={labelName}>
      <label className="sr-only" htmlFor={`label-${work.artworkId}`}>
        {labelName}
      </label>
      <textarea
        id={`label-${work.artworkId}`}
        aria-label={labelName}
        maxLength={LABEL_SUGGESTION_MAX_CHARS}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setSuggestion(null);
          setError(null);
        }}
        rows={4}
      />
      <div className="flex gap-2">
        <button type="button" onClick={save}>
          Save label
        </button>
        <button type="button" onClick={generate} disabled={busy || statementMissing}>
          {busy ? 'Generating…' : 'Generate label'}
        </button>
        {dirty && (
          <button type="button" onClick={discard}>
            Discard changes
          </button>
        )}
      </div>
      {statementMissing && (
        <p>Add an exhibition statement before generating a label.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {suggestion && (
        <div>
          <p>{suggestion}</p>
          <button
            type="button"
            onClick={() => {
              setDraft(suggestion);
              setCommitted(suggestion);
              setSuggestion(null);
              onCommit(suggestion, 'agent');
            }}
          >
            Accept suggestion
          </button>
          <button type="button" onClick={() => setSuggestion(null)}>
            Dismiss suggestion
          </button>
        </div>
      )}
    </section>
  );
};
