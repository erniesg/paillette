/**
 * The link, and nothing else.
 *
 * One control, in the catalogue mono, in the rail under the statement. It
 * publishes the show and copies its URL — so the board stops dying with the
 * tab, which is the one promise in the pitch the build was not keeping.
 *
 * The word changes to say it worked and changes back. That is the entire
 * feedback design: a toast would be a second surface for a fact that fits in
 * the button that caused it, and a modal offering Slack, X and WhatsApp would
 * be three more controls for a job the clipboard already does.
 *
 * **Two links, in order of preference.** The show is POSTed to
 * `/api/exhibitions` and comes back as seven characters. If that fails — the
 * API is down, the hourly budget is spent, the network is gone — it falls back
 * to the self-contained `?e=…` link, which needs no server and still opens. A
 * long ugly URL that works beats a short one that does not exist.
 *
 * **The failure that made this worth rewriting** was quieter than either:
 * `navigator.clipboard` is undefined outside a secure context, the write threw,
 * and the button text never changed. The human clicked, nothing happened, and
 * nothing said why. Now the URL is put on screen and selected, so it can be
 * copied by hand. The selected text is the affordance; the word only says why
 * it is there.
 */

import { useEffect, useRef, useState } from 'react';
import {
  encodeExhibitionLink,
  exhibitionLinkPath,
  type ExhibitionLinkPayload,
} from '~/lib/exhibition-link';
import { listHungWorks, resolveHang } from '~/lib/webmcp/exhibition';
import { getWebMcpState } from '~/lib/webmcp/store';
import { useExhibition } from './exhibition-head';

type ShareState = 'idle' | 'working' | 'copied' | 'failed';

const buildPayload = (collectionId: string): ExhibitionLinkPayload => {
  const state = getWebMcpState().exhibition;
  return {
    collectionId,
    title: state.title.current?.value ?? null,
    titleByAgent: state.title.current?.by === 'agent',
    statement: state.statement.current?.value ?? null,
    statementByAgent: state.statement.current?.by === 'agent',
    works: listHungWorks(state).map((work) => ({
      artworkId: work.artworkId,
      label: work.label,
      labelByAgent: work.labelBy === 'agent',
    })),
  };
};

/**
 * The short link, or null.
 *
 * Never throws: every way this can fail has the same answer, which is to hand
 * out the self-contained link instead.
 */
const publish = async (
  payload: ExhibitionLinkPayload
): Promise<string | null> => {
  try {
    const response = await fetch('/api/exhibitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { url?: unknown } };
    const url = body?.data?.url;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
};

export const ShareExhibitionLink = ({
  collectionId = 'nga',
}: {
  collectionId?: string;
}) => {
  const exhibition = useExhibition();
  const [state, setState] = useState<ShareState>('idle');
  /** Set only when the clipboard could not take it, so it can be taken by hand. */
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // Selected after render, not during: the input does not exist until the
  // state that reveals it has been committed.
  useEffect(() => {
    if (fallbackUrl && field.current) {
      field.current.focus();
      field.current.select();
    }
  }, [fallbackUrl]);

  // A show with no works is not shareable, and a link to nothing is worse than
  // no link.
  if (resolveHang(exhibition).length === 0) return null;

  const copy = async () => {
    if (state === 'working') return;
    if (timer.current) clearTimeout(timer.current);
    setFallbackUrl(null);
    // Publishing is a round trip now. Without this the button sits there
    // saying "Copy link" while nothing visible happens, which is the same
    // silence this control was rewritten to remove.
    setState('working');

    const payload = buildPayload(collectionId);
    const url =
      (await publish(payload)) ??
      `${window.location.origin}${exhibitionLinkPath(
        await encodeExhibitionLink(payload)
      )}`;

    try {
      // Feature-detected: the async clipboard needs a secure context, and a
      // dead button is worse than one that hands the link over another way.
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2400);
    } catch {
      setState('failed');
      setFallbackUrl(url);
      // No timer. The field stays until they have taken the link — clearing it
      // out from under someone mid-drag is the original bug in another form.
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        disabled={state === 'working'}
        data-share-state={state}
        className="paillette-share-link lt-catalogue"
      >
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Copy failed'
            : state === 'working'
              ? 'Copying…'
              : 'Copy link'}
      </button>

      {fallbackUrl && (
        <input
          ref={field}
          readOnly
          value={fallbackUrl}
          aria-label="Exhibition link"
          onFocus={(event) => event.currentTarget.select()}
          className="paillette-share-fallback lt-catalogue"
        />
      )}
    </>
  );
};
