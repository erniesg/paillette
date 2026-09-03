/**
 * The flag affordances on a card.
 *
 * Deliberately plain. Three real `<button>`s with real labels and
 * `aria-pressed`, because a flag is a state someone toggled and a screen
 * reader should say so — and because the keyboard path (`P`/`X`/`U`) and the
 * click path have to end up in exactly the same place, which they do: both
 * call `toggleFlag`.
 *
 * Styling stops at "visible". Everything a designer needs to take this over is
 * exposed as data attributes and stable class names:
 *
 *   .paillette-card            data-artwork-id
 *                              data-flag="pick" | "reject" | "none"
 *                              data-flag-by="human" | "agent"
 *                              data-flag-provisional="true" | "false"
 *                              data-hovered="true" | "false"
 *                              data-selected="true" | "false"
 *   .paillette-flag-badge      the corner control
 *   .paillette-flag-button     data-flag-action="pick" | "reject" | "clear"
 *                              aria-pressed
 *
 * `data-flag-by` and `data-flag-provisional` are the provenance hooks: two
 * inks and a dashed state, drawn entirely in CSS, with no JavaScript here
 * needing to know which colour the agent got.
 */

import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { installBoardKeyboard } from '~/lib/webmcp/board-keyboard';
import { toggleFlag } from '~/lib/webmcp/flags';
import { toggleSelection } from '~/lib/webmcp/selection';
import {
  getWebMcpState,
  getWebMcpServerState,
  setHoveredArtwork,
  subscribeWebMcpState,
  type FlagRecord,
} from '~/lib/webmcp/store';

/**
 * Mount the culling keys for as long as a results grid is on screen.
 *
 * Installed from the grid rather than the prompt bar because the bindings are
 * about the board: without cards there is nothing to pick, and nothing worth
 * redealing.
 */
export const useBoardKeyboard = () => {
  useEffect(() => installBoardKeyboard(), []);
};

export const useFlag = (artworkId: string): FlagRecord | null =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () =>
      getWebMcpState().flags.find((flag) => flag.artworkId === artworkId) ??
      null,
    () =>
      getWebMcpServerState().flags.find(
        (flag) => flag.artworkId === artworkId
      ) ?? null
  );

const useHovered = (artworkId: string): boolean =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().hovered === artworkId,
    () => false
  );

const useSelected = (artworkId: string): boolean =>
  useSyncExternalStore(
    subscribeWebMcpState,
    () => getWebMcpState().selection.includes(artworkId),
    () => false
  );

/**
 * Everything a result card needs to become flaggable, in one spread.
 *
 * Hover *and* focus both set the deictic anchor, so the keys work for someone
 * driving with a mouse and for someone driving with Tab — and so "this one"
 * means something to the agent either way.
 */
export const useCardFlagProps = (artworkId: string) => {
  const flag = useFlag(artworkId);
  const hovered = useHovered(artworkId);
  const selected = useSelected(artworkId);

  const point = useCallback(() => setHoveredArtwork(artworkId), [artworkId]);
  const unpoint = useCallback(() => {
    if (getWebMcpState().hovered === artworkId) setHoveredArtwork(null);
  }, [artworkId]);

  // Capture, so shift-click means "these" rather than opening the dialog the
  // card's own click handler would. A plain click is left completely alone.
  const select = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      if (!event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      toggleSelection(artworkId);
    },
    [artworkId]
  );

  return {
    'data-artwork-id': artworkId,
    'data-flag': flag?.flag ?? 'none',
    'data-flag-by': flag?.by ?? 'none',
    'data-flag-provisional': String(Boolean(flag?.provisional)),
    'data-hovered': String(hovered),
    'data-selected': String(selected),
    onMouseEnter: point,
    onMouseLeave: unpoint,
    onFocus: point,
    onBlur: unpoint,
    onClickCapture: select,
  } as const;
};

const ACTIONS = [
  { action: 'pick' as const, key: 'P', label: 'Pick' },
  { action: 'reject' as const, key: 'X', label: 'Reject' },
  { action: 'clear' as const, key: 'U', label: 'Unflag' },
];

export const FlagBadge = ({
  artworkId,
  title,
}: {
  artworkId: string;
  /** Named in the button labels, so "Pick" is never ambiguous out of context. */
  title?: string;
}) => {
  const flag = useFlag(artworkId);
  const suffix = title ? ` ${title}` : '';

  return (
    <div
      className="paillette-flag-badge flex items-center gap-1"
      data-flag={flag?.flag ?? 'none'}
      data-flag-by={flag?.by ?? 'none'}
      data-flag-provisional={String(Boolean(flag?.provisional))}
    >
      {ACTIONS.map(({ action, key, label }) => {
        // "Unflag" is not a state, so it is a plain button rather than a
        // toggle — claiming aria-pressed on it would be a lie.
        const pressed = action === 'clear' ? undefined : flag?.flag === action;
        return (
          <button
            key={action}
            type="button"
            data-flag-action={action}
            {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
            // The accessible name carries the word; the button carries the
            // key. A tooltip restating a control the letter already names is
            // the interface explaining itself.
            aria-label={`${label}${suffix} (${key})`}
            onClick={(event) => {
              // The card behind this opens a dialog on click.
              event.stopPropagation();
              event.preventDefault();
              toggleFlag(artworkId, action, { by: 'human' });
            }}
            className={`paillette-flag-button border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] ${
              pressed
                ? 'border-white/60 text-white'
                : 'border-white/15 text-white/45 hover:text-white/80'
            }`}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
};
