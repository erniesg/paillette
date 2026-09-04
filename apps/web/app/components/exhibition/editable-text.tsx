/**
 * A piece of the exhibition, written by either hand, editable in place.
 *
 * There is no edit button and no save button. The text on the wall *is* the
 * field: click it and you are typing in it, Enter or blur commits, Escape puts
 * back what was there. A museum label does not have a pencil icon next to it.
 *
 * Two things are drawn rather than said:
 *
 *  - **Whose words these are** is the ink of the rule down the left — graphite
 *    for the human, the agent's colour for the agent. No caption.
 *  - **An unaccepted proposal** is the agent's alternative wording set below in
 *    a dashed rule, exactly as an agent's unconfirmed flag is dashed on a card.
 *    Clicking it accepts it. That is the same gesture, in prose.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { ResultSetOrigin } from '~/lib/webmcp/store';

export interface EditableTextProps {
  value: string;
  /** Who wrote what is on the wall. Decides the ink, and nothing else. */
  by: ResultSetOrigin | null;
  /** The agent's alternative, waiting for a click. */
  proposed?: string | null;
  onCommit: (value: string) => void;
  onAccept?: () => void;
  onDecline?: () => void;
  /** Screen-reader name. This is the only place the field is named in words. */
  label: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  /** Class applied to the text itself, so one component serves title and label. */
  textClassName?: string;
}

/** Grows with its content, so a statement is never a scrolling box. */
const useAutoHeight = (
  ref: { current: HTMLTextAreaElement | null },
  value: string,
  enabled: boolean
) => {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [ref, value, enabled]);
};

export const EditableText = ({
  value,
  by,
  proposed = null,
  onCommit,
  onAccept,
  onDecline,
  label,
  placeholder,
  multiline = false,
  className = '',
  textClassName = '',
}: EditableTextProps) => {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape has to survive the blur it causes. `setDraft` has not landed by the
  // time the blur handler runs, so without this the discarded text would be
  // committed by the very keystroke that discarded it.
  const cancelling = useRef(false);

  // The other party can write while this is on screen. Follow them unless the
  // human is mid-sentence, where clobbering the caret would be worse than
  // showing stale text for a moment.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useAutoHeight(areaRef, editing ? draft : value, multiline);

  const commit = () => {
    setEditing(false);
    if (cancelling.current) {
      cancelling.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The board's culling keys live one level up and must not fire while
    // someone is writing a sentence with the letter P in it.
    event.stopPropagation();
    if (event.key === 'Escape') {
      cancelling.current = true;
      (event.target as HTMLElement).blur();
      return;
    }
    // Enter commits a title. In a statement it is a paragraph break, so there
    // it takes the modifier.
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      (event.target as HTMLElement).blur();
    }
  };

  const shared = {
    'aria-label': label,
    value: draft,
    placeholder,
    onFocus: () => setEditing(true),
    onBlur: commit,
    onKeyDown,
    'data-provenance': by ?? 'none',
    className: `paillette-editable w-full resize-none border-0 bg-transparent p-0 outline-none ${textClassName}`,
  };

  return (
    <div className={`paillette-exhibition-field ${className}`} data-provenance={by ?? 'none'}>
      {multiline ? (
        <textarea
          {...shared}
          ref={areaRef}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          ref={inputRef}
          type="text"
          onChange={(event) => setDraft(event.target.value)}
        />
      )}

      {/* The agent's alternative, dashed and unaccepted. Click it to take it. */}
      {proposed && proposed !== value && (
        <div className="paillette-proposal mt-2 flex items-start gap-2">
          <button
            type="button"
            onClick={onAccept}
            aria-label={`Use the agent’s ${label.toLowerCase()}: ${proposed}`}
            data-provenance="agent"
            className={`paillette-proposal-text flex-1 border-0 bg-transparent p-0 text-left ${textClassName}`}
          >
            {proposed}
          </button>
          <button
            type="button"
            onClick={onDecline}
            aria-label={`Discard the agent’s ${label.toLowerCase()}`}
            className="paillette-proposal-decline mt-1 shrink-0 leading-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};
